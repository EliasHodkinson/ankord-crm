import "server-only";
import { asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { customerGrants, customers, sharepointGrants, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";

/**
 * Reads for Settings → People and access. Admin-only: who else is in the CRM,
 * what they can see, and what the CRM has done in SharePoint on their behalf.
 */

export async function listPeople() {
  await requireAdmin();
  const db = getDb();
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      photo: users.photo,
      jobTitle: users.jobTitle,
      role: users.role,
      roleSource: users.roleSource,
      isActive: users.isActive,
      isGuest: users.isGuest,
      lastSeenAt: users.lastSeenAt,
      invitedAt: users.invitedAt,
      grantCount: sql<number>`(select count(*)::int from ${customerGrants} where ${customerGrants.userId} = ${users.id})`,
      folderProblems: sql<number>`(select count(*)::int from ${sharepointGrants} where ${sharepointGrants.userId} = ${users.id} and ${sharepointGrants.revokedAt} is null and ${sharepointGrants.status} in ('failed','revoke_failed'))`,
    })
    .from(users)
    .orderBy(desc(users.isActive), asc(users.name));
}

export type PersonRow = Awaited<ReturnType<typeof listPeople>>[number];

export async function getPerson(id: string) {
  await requireAdmin();
  const db = getDb();

  const [person] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!person) return null;

  const [grants, folders, allCustomers] = await Promise.all([
    db
      .select({
        customerId: customerGrants.customerId,
        fileAccess: customerGrants.fileAccess,
        createdAt: customerGrants.createdAt,
      })
      .from(customerGrants)
      .where(eq(customerGrants.userId, id)),
    db
      .select({
        id: sharepointGrants.id,
        customerId: sharepointGrants.customerId,
        customerName: customers.name,
        role: sharepointGrants.role,
        status: sharepointGrants.status,
        error: sharepointGrants.error,
        appliedAt: sharepointGrants.appliedAt,
        revokedAt: sharepointGrants.revokedAt,
        appliedByName: users.name,
      })
      .from(sharepointGrants)
      .leftJoin(customers, eq(customers.id, sharepointGrants.customerId))
      .leftJoin(users, eq(users.id, sharepointGrants.appliedById))
      .where(eq(sharepointGrants.userId, id))
      .orderBy(desc(sharepointGrants.appliedAt))
      .limit(100),
    db
      .select({
        id: customers.id,
        name: customers.name,
        hasFolder: sql<boolean>`${customers.spItemId} is not null`,
        archived: sql<boolean>`${customers.archivedAt} is not null`,
      })
      .from(customers)
      .orderBy(asc(customers.name)),
  ]);

  return { person, grants, folders, customers: allCustomers };
}

export type PersonRecord = NonNullable<Awaited<ReturnType<typeof getPerson>>>;

/** Customers to offer in the "add a person" form. */
export async function listCustomerChoices() {
  await requireAdmin();
  return getDb()
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(isNull(customers.archivedAt))
    .orderBy(asc(customers.name));
}
