import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { customerGrants, customers, sharepointGrants, users } from "@/lib/db/schema";
import { getGraphToken } from "@/lib/auth/session";
import { GraphError } from "@/lib/graph/client";
import {
  deletePermission,
  grantItemAccess,
  listPermissions,
  type DrivePermission,
} from "@/lib/graph/sharepoint";
import { describeGraphFailure } from "@/lib/graph/errors";

/**
 * Mirrors customer grants onto SharePoint.
 *
 * Granting a restricted person a business partner gives them direct access to
 * that partner's folder (and, by inheritance, every project folder inside it).
 * Revoking removes exactly the permission the CRM added — never one somebody
 * set up by hand — which is what the sharepoint_grants ledger is for.
 *
 * Everything runs with the acting admin's delegated token. SharePoint decides
 * whether they may change permissions on the folder; when it says no, the
 * failure is recorded and shown in Settings with a retry, rather than thrown.
 *
 * A row is "active" until revokedAt is set. A failed revocation stays active,
 * because the permission may still be there.
 */

export type FolderOutcome = {
  customerId: string;
  customerName: string;
  status: "applied" | "preexisting" | "failed" | "no_folder" | "unchanged" | "revoked" | "revoke_failed";
  message?: string;
};

type Person = { id: string; azureOid: string; email: string };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Is this permission a grant to this person specifically (not a group or link)? */
function grantsTo(permission: DrivePermission, person: Person): boolean {
  const user = permission.grantedToV2?.user ?? permission.grantedTo?.user;
  if (!user) return false;
  if (user.id && user.id === person.azureOid) return true;
  return Boolean(user.email && user.email.toLowerCase() === person.email.toLowerCase());
}

async function loadPerson(userId: string): Promise<Person | null> {
  const [row] = await getDb()
    .select({ id: users.id, azureOid: users.azureOid, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

async function loadFolder(customerId: string) {
  const [row] = await getDb()
    .select({
      name: customers.name,
      driveId: customers.spDriveId,
      itemId: customers.spItemId,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return row ?? null;
}

/** Ledger rows still in force for this person on this customer. */
function activeRows(userId: string, customerId?: string) {
  return getDb()
    .select()
    .from(sharepointGrants)
    .where(
      and(
        eq(sharepointGrants.userId, userId),
        customerId ? eq(sharepointGrants.customerId, customerId) : undefined,
        isNull(sharepointGrants.revokedAt),
      ),
    )
    .orderBy(desc(sharepointGrants.appliedAt));
}

/**
 * Gives a person access to one customer's folder, recording what was done.
 * Safe to call again: an existing grant at the same level is left alone, and a
 * failed one is retried.
 */
export async function applyFolderGrant(opts: {
  actorId: string;
  userId: string;
  customerId: string;
  role: "read" | "write";
  token?: string;
}): Promise<FolderOutcome> {
  const db = getDb();
  const folder = await loadFolder(opts.customerId);
  const base = { customerId: opts.customerId, customerName: folder?.name ?? "That business partner" };

  if (!folder?.driveId || !folder.itemId) {
    return {
      ...base,
      status: "no_folder",
      message: "No SharePoint folder yet. Access is applied when one is created.",
    };
  }
  const { driveId, itemId } = folder;

  const person = await loadPerson(opts.userId);
  if (!person) return { ...base, status: "failed", message: "That person no longer exists." };

  // Anything already in force for this exact folder?
  const existing = (await activeRows(opts.userId, opts.customerId)).filter(
    (r) => r.driveId === driveId && r.itemId === itemId,
  );
  const live = existing.find((r) => r.status === "applied" || r.status === "preexisting");
  if (live && (live.role === opts.role || live.status === "preexisting")) {
    return { ...base, status: "unchanged" };
  }

  let token: string;
  try {
    token = opts.token ?? (await getGraphToken());
  } catch (error) {
    return record("failed", null, describeGraphFailure(error));
  }

  // A different level is a change: take ours off first, then add the new one.
  if (live) {
    const [outcome] = await revokeFolderGrants({
      actorId: opts.actorId,
      userId: opts.userId,
      customerId: opts.customerId,
      token,
    });
    if (outcome?.status === "revoke_failed") return outcome;
  }

  // Earlier failures are superseded by this attempt.
  const stale = existing.filter((r) => r.status === "failed").map((r) => r.id);
  if (stale.length) {
    await db
      .update(sharepointGrants)
      .set({ revokedAt: new Date(), revokedById: opts.actorId })
      .where(inArray(sharepointGrants.id, stale));
  }

  try {
    // If they can already reach the folder in their own right — shared to them
    // by hand, or inherited from a folder above — the CRM adds nothing, and so
    // will remove nothing later.
    const permissions = await listPermissions(token, driveId, itemId);
    const theirs = permissions.find((p) => grantsTo(p, person));
    if (theirs) {
      await record("preexisting", null, null);
      return {
        ...base,
        status: "preexisting",
        message: "They already had access to this folder. The CRM left it as it was.",
      };
    }

    const recipient = GUID.test(person.azureOid)
      ? { objectId: person.azureOid }
      : { email: person.email };
    const permission = await grantItemAccess(token, driveId, itemId, recipient, opts.role);
    await record("applied", permission.id, null);
    return { ...base, status: "applied" };
  } catch (error) {
    const message = describeGraphFailure(error);
    await record("failed", null, message);
    return { ...base, status: "failed", message };
  }

  async function record(
    status: "applied" | "preexisting" | "failed",
    permissionId: string | null,
    error: string | null,
  ): Promise<FolderOutcome> {
    await db.insert(sharepointGrants).values({
      userId: opts.userId,
      customerId: opts.customerId,
      driveId,
      itemId,
      permissionId,
      role: opts.role,
      status,
      error,
      appliedById: opts.actorId,
    });
    return { ...base, status, message: error ?? undefined };
  }
}

/**
 * Takes away what the CRM added for this person — on one customer, or on all
 * of them when customerId is left out. Permissions the CRM found already in
 * place are released from the ledger but not touched in SharePoint.
 */
export async function revokeFolderGrants(opts: {
  actorId: string;
  userId: string;
  customerId?: string;
  token?: string;
}): Promise<FolderOutcome[]> {
  const db = getDb();
  const rows = await activeRows(opts.userId, opts.customerId);
  if (rows.length === 0) return [];

  const names = new Map(
    (
      await db
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(inArray(customers.id, rows.map((r) => r.customerId).filter((id): id is string => Boolean(id))))
    ).map((c) => [c.id, c.name]),
  );

  let token = opts.token;
  const outcomes: FolderOutcome[] = [];

  for (const row of rows) {
    const base = {
      customerId: row.customerId ?? "",
      customerName: (row.customerId && names.get(row.customerId)) || "A deleted business partner",
    };

    // Nothing of ours is in SharePoint for these — just close the row.
    if (!row.permissionId || row.status === "preexisting" || row.status === "failed") {
      await db
        .update(sharepointGrants)
        .set({ revokedAt: new Date(), revokedById: opts.actorId })
        .where(eq(sharepointGrants.id, row.id));
      outcomes.push({ ...base, status: "revoked" });
      continue;
    }

    try {
      token ??= await getGraphToken();
      await deletePermission(token, row.driveId, row.itemId, row.permissionId);
    } catch (error) {
      // Already gone — removed by hand, or the folder was deleted — is the
      // outcome we wanted.
      if (!(error instanceof GraphError && error.isNotFound)) {
        const message = describeGraphFailure(error);
        await db
          .update(sharepointGrants)
          .set({ status: "revoke_failed", error: message })
          .where(eq(sharepointGrants.id, row.id));
        outcomes.push({ ...base, status: "revoke_failed", message });
        continue;
      }
    }

    await db
      .update(sharepointGrants)
      .set({ status: "revoked", error: null, revokedAt: new Date(), revokedById: opts.actorId })
      .where(eq(sharepointGrants.id, row.id));
    outcomes.push({ ...base, status: "revoked" });
  }

  return outcomes;
}

/**
 * When a customer's folder is created after people were granted it, give them
 * access now. Best-effort, like folder provisioning itself: failures land in
 * the ledger and show in Settings.
 */
export async function applyGrantsForCustomerFolder(opts: {
  actorId: string;
  customerId: string;
  token?: string;
}): Promise<FolderOutcome[]> {
  const grants = await getDb()
    .select({ userId: customerGrants.userId, fileAccess: customerGrants.fileAccess })
    .from(customerGrants)
    .innerJoin(users, eq(users.id, customerGrants.userId))
    .where(
      and(
        eq(customerGrants.customerId, opts.customerId),
        eq(users.role, "restricted"),
        eq(users.isActive, true),
      ),
    );

  const outcomes: FolderOutcome[] = [];
  for (const grant of grants) {
    outcomes.push(
      await applyFolderGrant({
        actorId: opts.actorId,
        userId: grant.userId,
        customerId: opts.customerId,
        role: grant.fileAccess,
        token: opts.token,
      }),
    );
  }
  return outcomes;
}
