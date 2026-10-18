"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { customerGrants, customers, sessions, users } from "@/lib/db/schema";
import { getGraphToken, requireAdmin, sessionScopes } from "@/lib/auth/session";
import { hasAccessAdminScopes } from "@/lib/auth/entra";
import { findDirectoryUser, inviteGuest, isGuestPrincipal } from "@/lib/graph/users";
import { describeGraphFailure } from "@/lib/graph/errors";
import { appUrl, requireEnv } from "@/lib/env";
import {
  applyFolderGrant,
  revokeFolderGrants,
  type FolderOutcome,
} from "@/lib/sharepoint-access";
import { SECTIONS, SECTION_INFO } from "@/lib/sections";
import { fail, logActivity, type ActionState } from "./shared";

/**
 * Settings → People and access. Admin-only, every one of them.
 *
 * Sign-in stays Entra single-tenant: these actions decide what a person sees
 * once they are in, and invite people from outside Ankor'd as B2B guests so
 * they can get in at all. Folder access is applied to SharePoint as the admin,
 * with their delegated token — see lib/sharepoint-access.ts.
 */

const ROLES = ["admin", "member", "viewer", "restricted"] as const;
const roleSchema = z.enum(ROLES);
const fileAccessSchema = z.enum(["read", "write"]);

function revalidatePeople(userId?: string) {
  revalidatePath("/settings");
  revalidatePath("/settings/people");
  if (userId) revalidatePath(`/settings/people/${userId}`);
}

/** One line per folder that did not go to plan, for the form's message. */
function summarise(outcomes: FolderOutcome[]): string | null {
  const problems = outcomes.filter((o) => o.status === "failed" || o.status === "revoke_failed");
  if (problems.length === 0) return null;
  return problems
    .map((o) => `${o.customerName}: ${o.message ?? "SharePoint refused the change."}`)
    .join(" ");
}

/* ── adding someone ──────────────────────────────────────────────── */

const addSchema = z.object({
  email: z.email("That doesn't look like an email address.").transform((v) => v.trim().toLowerCase()),
  name: z.string().trim().min(1, "Who is it?"),
  role: roleSchema,
  invite: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  sendEmail: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  fileAccess: fileAccessSchema.default("write"),
});

/**
 * Adds a person to the CRM before they first sign in, with their role and the
 * business partners they may see.
 *
 * Someone already in the tenant — an Ankor'd member, or an existing guest — is
 * looked up and added. Someone who is not can be invited as a B2B guest: no
 * Ankor'd licence, they sign in with their own email, and Microsoft sends them
 * the invitation unless told not to.
 */
export async function addPerson(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user: admin } = await requireAdmin();
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
    return fail(Object.values(flat).flat()[0] ?? "Some fields need attention.", flat);
  }
  const { email, name, role, invite, sendEmail, fileAccess } = parsed.data;
  const customerIds = z.array(z.uuid()).safeParse(formData.getAll("customerIds"));
  if (!customerIds.success) return fail("One of the business partners is not valid.");

  const db = getDb();
  const [already] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (already) {
    return fail(`${email} is already in the CRM. Open them from the list to change their access.`);
  }

  let oid: string;
  let isGuest: boolean;
  let redeemUrl: string | null = null;

  try {
    const token = await getGraphToken();
    const found = await findDirectoryUser(token, email);

    if (found) {
      oid = found.id;
      isGuest = isGuestPrincipal(found);
    } else if (invite) {
      if (!hasAccessAdminScopes(await sessionScopes())) {
        return fail(
          "Inviting guests needs one more Microsoft permission on your sign-in. Use “Allow inviting guests” above, then try again.",
        );
      }
      const invitation = await inviteGuest(token, {
        email,
        displayName: name,
        redirectUrl: appUrl(),
        sendEmail,
      });
      oid = invitation.invitedUser.id;
      isGuest = true;
      redeemUrl = invitation.inviteRedeemUrl;
    } else {
      return fail(
        `Nobody with ${email} is in the Ankor'd tenant. Tick “Invite as a guest” to bring them in from outside.`,
      );
    }
  } catch (error) {
    return fail(describeGraphFailure(error));
  }

  const [created] = await db
    .insert(users)
    .values({
      azureOid: oid,
      tenantId: requireEnv("AZURE_AD_TENANT_ID"),
      email,
      name,
      role,
      roleSource: "manual",
      isGuest,
      invitedById: admin.id,
      invitedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: users.id });

  if (!created) {
    return fail("That person is already in the CRM under another address. Find them in the list.");
  }

  let problems: string | null = null;
  if (role === "restricted" && customerIds.data.length) {
    const outcomes = await grantCustomers(admin.id, created.id, customerIds.data, fileAccess);
    problems = summarise(outcomes);
  }

  await logActivity({
    entityType: "user",
    entityId: created.id,
    verb: "added",
    summary: `Added ${name} to the CRM${isGuest ? " as a guest" : ""}`,
  });

  revalidatePeople(created.id);
  return {
    ok: true,
    message: problems
      ? `Added ${name}, but some folders could not be shared: ${problems}`
      : `Added ${name}.`,
    data: {
      userId: created.id,
      ...(redeemUrl && !sendEmail ? { redeemUrl } : {}),
    },
  };
}

/* ── role and status ─────────────────────────────────────────────── */

export async function setPersonRole(userId: string, role: string): Promise<ActionState> {
  const { user: admin } = await requireAdmin();
  const parsed = roleSchema.safeParse(role);
  if (!parsed.success) return fail("Unknown role.");

  if (userId === admin.id && parsed.data !== "admin") {
    return fail("You can't remove your own admin access — ask another admin to do it.");
  }

  const db = getDb();
  const [target] = await db
    .select({ role: users.role, roleSource: users.roleSource, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return fail("That person is no longer here.");

  // Entra owns roles it has assigned, and would put a widening change back at
  // the next sign-in. Restricting is the exception: it is sticky, Entra never
  // widens it (lib/roles.ts), so the CRM can always narrow someone.
  if (target.roleSource === "entra" && parsed.data !== "restricted") {
    return fail(
      "This person's role is managed in Entra. Change their app role assignment there — or restrict them here, which Entra will not override.",
    );
  }

  await db
    .update(users)
    .set({ role: parsed.data, roleSource: "manual", updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Becoming restricted puts their grants into force, folders included.
  let problems: string | null = null;
  if (parsed.data === "restricted" && target.role !== "restricted") {
    const grants = await db
      .select({ customerId: customerGrants.customerId, fileAccess: customerGrants.fileAccess })
      .from(customerGrants)
      .where(eq(customerGrants.userId, userId));
    const outcomes: FolderOutcome[] = [];
    for (const g of grants) {
      outcomes.push(
        await applyFolderGrant({
          actorId: admin.id,
          userId,
          customerId: g.customerId,
          role: g.fileAccess,
        }),
      );
    }
    problems = summarise(outcomes);
  }

  await logActivity({
    entityType: "user",
    entityId: userId,
    verb: "role_changed",
    summary: `Changed ${target.name}'s access to ${parsed.data}`,
  });

  revalidatePeople(userId);
  return problems
    ? { ok: true, message: `Role updated, but: ${problems}` }
    : { ok: true, message: "Role updated." };
}

/**
 * Suspending someone signs them out everywhere at once — their sessions, and
 * the Microsoft tokens held in them, are deleted — and takes back the folder
 * access the CRM gave them. Restoring does not re-share folders by itself;
 * saving their business partners again does.
 */
export async function setPersonActive(userId: string, isActive: boolean): Promise<ActionState> {
  const { user: admin } = await requireAdmin();
  if (userId === admin.id && !isActive) {
    return fail("You can't switch off your own access.");
  }

  const db = getDb();
  await db.update(users).set({ isActive, updatedAt: new Date() }).where(eq(users.id, userId));

  let problems: string | null = null;
  if (!isActive) {
    await db.delete(sessions).where(eq(sessions.userId, userId));
    problems = summarise(await revokeFolderGrants({ actorId: admin.id, userId }));
  }

  revalidatePeople(userId);
  return problems
    ? { ok: true, message: `Suspended, but some folder access could not be removed: ${problems}` }
    : { ok: true, message: isActive ? "Access restored." : "Suspended and signed out." };
}

/* ── which business partners ─────────────────────────────────────── */

async function grantCustomers(
  actorId: string,
  userId: string,
  customerIds: string[],
  fileAccess: "read" | "write",
): Promise<FolderOutcome[]> {
  const db = getDb();
  // Only real customers — a made-up id would otherwise fail on the foreign key.
  const real = customerIds.length
    ? (
        await db
          .select({ id: customers.id })
          .from(customers)
          .where(inArray(customers.id, customerIds))
      ).map((c) => c.id)
    : [];
  if (real.length === 0) return [];
  customerIds = real;
  await db
    .insert(customerGrants)
    .values(customerIds.map((customerId) => ({ userId, customerId, fileAccess, grantedById: actorId })))
    .onConflictDoNothing();

  const outcomes: FolderOutcome[] = [];
  for (const customerId of customerIds) {
    outcomes.push(await applyFolderGrant({ actorId, userId, customerId, role: fileAccess }));
  }
  return outcomes;
}

/**
 * Replaces the set of business partners a person may see. Each partner comes
 * in as `customerIds`, with its folder level as `access:<customerId>`.
 *
 * Only the difference is applied to SharePoint: new partners are shared, ones
 * taken away are unshared, and a changed level is swapped.
 */
export async function saveCustomerGrants(
  userId: string,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user: admin } = await requireAdmin();
  const ids = z.array(z.uuid()).safeParse(formData.getAll("customerIds"));
  if (!ids.success) return fail("One of the business partners is not valid.");

  const db = getDb();
  const [person] = await db
    .select({ role: users.role, name: users.name, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!person) return fail("That person is no longer here.");

  const wanted = new Map<string, "read" | "write">();
  for (const id of new Set(ids.data)) {
    const level = fileAccessSchema.safeParse(formData.get(`access:${id}`) ?? "write");
    wanted.set(id, level.success ? level.data : "write");
  }

  // Only real customers — a made-up id would otherwise fail on the foreign key.
  const real = wanted.size
    ? new Set(
        (
          await db
            .select({ id: customers.id })
            .from(customers)
            .where(inArray(customers.id, [...wanted.keys()]))
        ).map((c) => c.id),
      )
    : new Set<string>();

  const current = await db
    .select({ customerId: customerGrants.customerId, fileAccess: customerGrants.fileAccess })
    .from(customerGrants)
    .where(eq(customerGrants.userId, userId));
  const had = new Map(current.map((g) => [g.customerId, g.fileAccess]));

  const added = [...wanted.keys()].filter((id) => real.has(id) && !had.has(id));
  const removed = [...had.keys()].filter((id) => !wanted.has(id));
  const changed = [...wanted.entries()].filter(
    ([id, level]) => had.has(id) && had.get(id) !== level,
  );

  if (removed.length) {
    await db
      .delete(customerGrants)
      .where(and(eq(customerGrants.userId, userId), inArray(customerGrants.customerId, removed)));
  }
  if (added.length) {
    await db
      .insert(customerGrants)
      .values(
        added.map((customerId) => ({
          userId,
          customerId,
          fileAccess: wanted.get(customerId)!,
          grantedById: admin.id,
        })),
      )
      .onConflictDoNothing();
  }
  for (const [customerId, level] of changed) {
    await db
      .update(customerGrants)
      .set({ fileAccess: level })
      .where(and(eq(customerGrants.userId, userId), eq(customerGrants.customerId, customerId)));
  }

  // SharePoint follows. Folder access is only for restricted people — staff
  // reach the library through the site itself — and never for a suspended one.
  const outcomes: FolderOutcome[] = [];
  for (const customerId of removed) {
    outcomes.push(...(await revokeFolderGrants({ actorId: admin.id, userId, customerId })));
  }
  if (person.role === "restricted" && person.isActive) {
    for (const customerId of [...added, ...changed.map(([id]) => id)]) {
      outcomes.push(
        await applyFolderGrant({
          actorId: admin.id,
          userId,
          customerId,
          role: wanted.get(customerId)!,
        }),
      );
    }
  }

  await logActivity({
    entityType: "user",
    entityId: userId,
    verb: "access_changed",
    summary: `Changed which business partners ${person.name} can see (+${added.length} −${removed.length})`,
  });

  revalidatePeople(userId);
  const problems = summarise(outcomes);
  return problems
    ? { ok: false, message: `Saved in the CRM, but SharePoint did not take every change. ${problems}` }
    : { ok: true, message: "Access saved." };
}

/* ── which sections ──────────────────────────────────────────────── */

/**
 * Sets the sections of the CRM a restricted person may open. Each one ticked
 * comes in as `section:<name>`. Saved as an explicit list, so a section added
 * later starts switched off for anyone an admin has already narrowed.
 */
export async function saveSections(
  userId: string,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const db = getDb();
  const [person] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!person) return fail("That person is no longer here.");

  const chosen = SECTIONS.filter((s) => formData.get(`section:${s}`) != null);
  await db
    .update(users)
    .set({ sections: chosen, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await logActivity({
    entityType: "user",
    entityId: userId,
    verb: "access_changed",
    summary: chosen.length
      ? `Set the sections ${person.name} can open: ${chosen.map((s) => SECTION_INFO[s].label).join(", ")}`
      : `Switched off every section for ${person.name} but Overview`,
  });

  revalidatePeople(userId);
  return { ok: true, message: "Sections saved." };
}

/** Tries a folder again after SharePoint refused — once the admin has fixed whatever it was. */
export async function retryFolderGrant(userId: string, customerId: string): Promise<ActionState> {
  const { user: admin } = await requireAdmin();
  const db = getDb();

  const [grant] = await db
    .select({ fileAccess: customerGrants.fileAccess })
    .from(customerGrants)
    .where(and(eq(customerGrants.userId, userId), eq(customerGrants.customerId, customerId)))
    .limit(1);

  // No grant any more means the outstanding work is a removal.
  const outcomes = grant
    ? [await applyFolderGrant({ actorId: admin.id, userId, customerId, role: grant.fileAccess })]
    : await revokeFolderGrants({ actorId: admin.id, userId, customerId });

  revalidatePeople(userId);
  const problems = summarise(outcomes);
  return problems ? fail(problems) : { ok: true, message: "SharePoint is up to date." };
}
