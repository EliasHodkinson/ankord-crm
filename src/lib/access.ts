import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import {
  communications,
  contactFacts,
  contacts,
  customerGrants,
  customers,
  projectAccounts,
  projectContacts,
  projectPhases,
  projectSteps,
  projects,
  tasks,
} from "@/lib/db/schema";
import { getGraphToken, requireUser } from "@/lib/auth/session";
import { getItem } from "@/lib/graph/sharepoint";
import type { AppRole } from "@/lib/roles";

/**
 * Who can see what. Every read and every write goes through here.
 *
 * Admins, staff and viewers see the whole book, as before. A `restricted`
 * person sees nothing until an admin grants them a business partner, and then
 * sees only that partner and what hangs off it — its contacts, projects,
 * communications, follow-ups, account register and SharePoint folder. Leads,
 * reports, import, Xero and settings stay closed to them however many partners
 * they hold.
 *
 * The rules are enforced here, on the server, not by hiding buttons. The UI
 * hides what a person cannot use only so they are not offered dead ends.
 *
 * Denials in pages are notFound(): a restricted person cannot tell a record
 * they may not see from one that does not exist. Denials in actions throw.
 */

export type Access =
  | { userId: string; role: Exclude<AppRole, "restricted">; restricted: false }
  | { userId: string; role: "restricted"; restricted: true; customerIds: string[] };

/** The signed-in person's access, read once per request. */
export const getAccess = cache(async (): Promise<Access> => {
  const { user } = await requireUser();
  if (user.role !== "restricted") {
    return { userId: user.id, role: user.role, restricted: false };
  }
  const rows = await getDb()
    .select({ customerId: customerGrants.customerId })
    .from(customerGrants)
    .where(eq(customerGrants.userId, user.id));
  return {
    userId: user.id,
    role: "restricted",
    restricted: true,
    customerIds: rows.map((r) => r.customerId),
  };
});

export class AccessDenied extends Error {
  constructor(message = "You don't have access to that.") {
    super(message);
    this.name = "AccessDenied";
  }
}

/* ── whole areas ─────────────────────────────────────────────────── */

/** For pages that only staff use — leads, reports, import. */
export async function requireStaffPage(): Promise<Access> {
  const access = await getAccess();
  if (access.restricted) notFound();
  return access;
}

/** For actions that only staff use. */
export async function assertStaff(): Promise<Access> {
  const access = await getAccess();
  if (access.restricted) throw new AccessDenied();
  return access;
}

/* ── SQL filters for lists ───────────────────────────────────────── */

const NOTHING = sql`false`;

/** Rows whose customer column is one this person may see. */
export function customerScope(access: Access, column: AnyPgColumn): SQL | undefined {
  if (!access.restricted) return undefined;
  return access.customerIds.length ? inArray(column, access.customerIds) : NOTHING;
}

function visibleProjectIds(access: Access & { restricted: true }) {
  return getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(inArray(projects.customerId, access.customerIds));
}

/** Rows whose project column is a project of a customer this person may see. */
export function projectScope(access: Access, column: AnyPgColumn): SQL | undefined {
  if (!access.restricted) return undefined;
  return access.customerIds.length ? inArray(column, visibleProjectIds(access)) : NOTHING;
}

/**
 * For rows that can hang off a customer, a project or both — communications,
 * tasks, activity. Visible when either link is visible. A row linked to
 * neither (or only to a lead) is not.
 */
export function linkedScope(
  access: Access,
  columns: { customerId: AnyPgColumn; projectId: AnyPgColumn },
): SQL | undefined {
  if (!access.restricted) return undefined;
  if (!access.customerIds.length) return NOTHING;
  return or(
    inArray(columns.customerId, access.customerIds),
    inArray(columns.projectId, visibleProjectIds(access)),
  );
}

/**
 * Follow-ups. Linked ones follow their record; an unlinked one belongs to
 * whoever it is assigned to or was written by, so a restricted person can still
 * keep their own to-do list.
 */
export function taskScope(access: Access): SQL | undefined {
  if (!access.restricted) return undefined;
  const unlinked = and(
    isNull(tasks.customerId),
    isNull(tasks.projectId),
    isNull(tasks.leadId),
    isNull(tasks.contactId),
    or(eq(tasks.assigneeId, access.userId), eq(tasks.createdById, access.userId)),
  );
  // A follow-up that is also against a lead stays hidden: leads are staff-only.
  const linked = and(
    isNull(tasks.leadId),
    linkedScope(access, { customerId: tasks.customerId, projectId: tasks.projectId }),
  );
  return or(unlinked, linked);
}

/* ── single records ──────────────────────────────────────────────── */

function allows(access: Access, customerId: string | null | undefined): boolean {
  if (!access.restricted) return true;
  return Boolean(customerId && access.customerIds.includes(customerId));
}

async function projectCustomer(projectId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ customerId: projects.customerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row?.customerId ?? null;
}

export async function canSeeCustomer(id: string): Promise<boolean> {
  return allows(await getAccess(), id);
}

export async function canSeeProject(id: string): Promise<boolean> {
  const access = await getAccess();
  if (!access.restricted) return true;
  return allows(access, await projectCustomer(id));
}

/** Leads are a staff-only area: there is no per-lead grant. */
export async function canSeeLead(): Promise<boolean> {
  return !(await getAccess()).restricted;
}

function deny(ok: boolean): void {
  if (!ok) throw new AccessDenied();
}

export async function assertCustomer(id: string): Promise<void> {
  deny(await canSeeCustomer(id));
}

export async function assertProject(id: string): Promise<void> {
  deny(await canSeeProject(id));
}

export async function assertLead(): Promise<void> {
  deny(await canSeeLead());
}

export async function assertContact(id: string): Promise<string> {
  const [row] = await getDb()
    .select({ customerId: contacts.customerId })
    .from(contacts)
    .where(eq(contacts.id, id))
    .limit(1);
  if (!row) throw new AccessDenied("That person is no longer here.");
  await assertCustomer(row.customerId);
  return row.customerId;
}

export async function assertContactFact(id: string): Promise<void> {
  const [row] = await getDb()
    .select({ customerId: contacts.customerId })
    .from(contactFacts)
    .innerJoin(contacts, eq(contacts.id, contactFacts.contactId))
    .where(eq(contactFacts.id, id))
    .limit(1);
  if (!row) return;
  await assertCustomer(row.customerId);
}

/** Returns the step's real project, so callers never trust a passed-in one. */
export async function assertStep(stepId: string): Promise<string> {
  const [row] = await getDb()
    .select({ projectId: projectSteps.projectId })
    .from(projectSteps)
    .where(eq(projectSteps.id, stepId))
    .limit(1);
  if (!row) throw new AccessDenied("That step is no longer here.");
  await assertProject(row.projectId);
  return row.projectId;
}

export async function assertPhase(phaseId: string, projectId: string): Promise<void> {
  const [row] = await getDb()
    .select({ projectId: projectPhases.projectId })
    .from(projectPhases)
    .where(eq(projectPhases.id, phaseId))
    .limit(1);
  if (!row || row.projectId !== projectId) throw new AccessDenied();
  await assertProject(projectId);
}

export async function assertKeyContact(id: string): Promise<string> {
  const [row] = await getDb()
    .select({ projectId: projectContacts.projectId })
    .from(projectContacts)
    .where(eq(projectContacts.id, id))
    .limit(1);
  if (!row) throw new AccessDenied("That contact is no longer here.");
  await assertProject(row.projectId);
  return row.projectId;
}

export async function assertAccount(id: string): Promise<void> {
  const [row] = await getDb()
    .select({ projectId: projectAccounts.projectId, customerId: projectAccounts.customerId })
    .from(projectAccounts)
    .where(eq(projectAccounts.id, id))
    .limit(1);
  if (!row) throw new AccessDenied("That account is no longer here.");
  await assertLinks(row);
}

export async function assertTask(id: string): Promise<void> {
  const access = await getAccess();
  if (!access.restricted) return;
  const scope = taskScope(access);
  const [row] = await getDb()
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, id), scope))
    .limit(1);
  deny(Boolean(row));
}

export async function assertCommunication(id: string): Promise<void> {
  const access = await getAccess();
  if (!access.restricted) return;
  const [row] = await getDb()
    .select({ id: communications.id })
    .from(communications)
    .where(
      and(
        eq(communications.id, id),
        linkedScope(access, {
          customerId: communications.customerId,
          projectId: communications.projectId,
        }),
      ),
    )
    .limit(1);
  deny(Boolean(row));
}

/**
 * For anything being written against one or more records — a logged call, a
 * follow-up, a linked email. Every record named must be visible, so nothing can
 * be filed against a customer by guessing its id.
 */
export async function assertLinks(links: {
  customerId?: string | null;
  projectId?: string | null;
  leadId?: string | null;
  contactId?: string | null;
}): Promise<void> {
  const access = await getAccess();
  if (!access.restricted) return;
  if (links.leadId) throw new AccessDenied();
  if (links.customerId) await assertCustomer(links.customerId);
  if (links.projectId) await assertProject(links.projectId);
  if (links.contactId) await assertContact(links.contactId);
}

/* ── SharePoint folders ──────────────────────────────────────────── */

/**
 * The folder roots a restricted person may browse: the folders of their
 * customers and of those customers' projects.
 */
async function visibleFolderRoots(access: Access & { restricted: true }) {
  if (!access.customerIds.length) return [];
  const db = getDb();
  const [customerFolders, projectFolders] = await Promise.all([
    db
      .select({ driveId: customers.spDriveId, itemId: customers.spItemId })
      .from(customers)
      .where(inArray(customers.id, access.customerIds)),
    db
      .select({ driveId: projects.spDriveId, itemId: projects.spItemId })
      .from(projects)
      .where(inArray(projects.customerId, access.customerIds)),
  ]);
  return [...customerFolders, ...projectFolders].filter(
    (f): f is { driveId: string; itemId: string } => Boolean(f.driveId && f.itemId),
  );
}

/**
 * Whether a SharePoint item is inside a folder this person may use.
 *
 * Staff are bounded by SharePoint itself, as before. For a restricted person
 * the CRM also checks, so that an id lifted from somewhere else cannot be
 * browsed through the CRM even if SharePoint would happen to allow it. The
 * walk goes up through parents until it meets a permitted root or runs out.
 */
export async function assertFolder(driveId: string, itemId: string): Promise<void> {
  const access = await getAccess();
  if (!access.restricted) return;

  const roots = await visibleFolderRoots(access);
  const rootIds = new Set(roots.filter((r) => r.driveId === driveId).map((r) => r.itemId));
  if (rootIds.size === 0) throw new AccessDenied();
  if (rootIds.has(itemId)) return;

  const token = await getGraphToken();
  let current = itemId;
  // Client folders are only a few levels deep; the cap keeps a cycle or a
  // very deep tree from turning one request into dozens of Graph calls.
  for (let depth = 0; depth < 12; depth += 1) {
    const item = await getItem(token, driveId, current);
    const parent = item.parentReference;
    if (!parent?.id || parent.driveId !== driveId) break;
    if (rootIds.has(parent.id)) return;
    current = parent.id;
  }
  throw new AccessDenied();
}
