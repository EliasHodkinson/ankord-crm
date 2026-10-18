import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contacts, customers, leads, projectSteps, projects, users } from "@/lib/db/schema";
import { assertLead, assertStaff, customerScope, getAccess } from "@/lib/access";

/**
 * Plain lists of records, for the MCP tools. The pages build their own richer
 * queries; these return the same rows to anyone who could see them there —
 * every one is filtered through lib/access.ts.
 */

const like = (q: string) => `%${q.trim()}%`;

export async function listCustomerRows(filter: {
  q?: string;
  status?: "prospect" | "active" | "on_hold" | "former";
  kind?: "customer" | "supplier" | "media";
  includeArchived?: boolean;
  limit?: number;
}) {
  const access = await getAccess();
  const where: (SQL | undefined)[] = [customerScope(access, customers.id)];
  if (!filter.includeArchived) where.push(isNull(customers.archivedAt));
  if (filter.status) where.push(eq(customers.status, filter.status));
  if (filter.kind === "customer") where.push(eq(customers.isCustomer, true));
  if (filter.kind === "supplier") where.push(eq(customers.isSupplier, true));
  if (filter.kind === "media") where.push(eq(customers.isMedia, true));
  if (filter.q) {
    where.push(
      or(
        ilike(customers.name, like(filter.q)),
        ilike(customers.legalName, like(filter.q)),
        ilike(customers.suburb, like(filter.q)),
      ),
    );
  }
  return getDb()
    .select({
      id: customers.id,
      name: customers.name,
      status: customers.status,
      isCustomer: customers.isCustomer,
      isSupplier: customers.isSupplier,
      isMedia: customers.isMedia,
      suburb: customers.suburb,
      state: customers.state,
      email: customers.email,
      phone: customers.phone,
      owner: users.name,
      tags: customers.tags,
      lastActivityAt: customers.lastActivityAt,
      inXero: sql<boolean>`${customers.xeroContactId} is not null`,
      activeProjects: sql<number>`(select count(*)::int from ${projects} where ${projects.customerId} = ${customers.id} and ${projects.status} in ('planning','active','on_hold'))`,
    })
    .from(customers)
    .leftJoin(users, eq(users.id, customers.ownerId))
    .where(and(...where))
    .orderBy(asc(customers.name))
    .limit(Math.min(filter.limit ?? 50, 200));
}

export async function listContactRows(filter: { q?: string; customerId?: string; limit?: number }) {
  const access = await getAccess();
  const where: (SQL | undefined)[] = [customerScope(access, contacts.customerId), isNull(contacts.archivedAt)];
  if (filter.customerId) where.push(eq(contacts.customerId, filter.customerId));
  if (filter.q) {
    where.push(
      or(
        ilike(contacts.firstName, like(filter.q)),
        ilike(contacts.lastName, like(filter.q)),
        ilike(contacts.email, like(filter.q)),
        ilike(contacts.jobTitle, like(filter.q)),
      ),
    );
  }
  return getDb()
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      jobTitle: contacts.jobTitle,
      email: contacts.email,
      phone: contacts.phone,
      mobile: contacts.mobile,
      isPrimary: contacts.isPrimary,
      customerId: contacts.customerId,
      customer: customers.name,
    })
    .from(contacts)
    .innerJoin(customers, eq(customers.id, contacts.customerId))
    .where(and(...where))
    .orderBy(asc(customers.name), desc(contacts.isPrimary), asc(contacts.firstName))
    .limit(Math.min(filter.limit ?? 50, 200));
}

/** Leads are staff-only: a restricted person is refused, not shown an empty list. */
export async function listLeadRows(filter: {
  q?: string;
  stages?: string[];
  ownerId?: string;
  limit?: number;
}) {
  await assertStaff();
  const where: (SQL | undefined)[] = [];
  if (filter.stages?.length) {
    where.push(inArray(leads.stage, filter.stages as (typeof leads.stage.enumValues)[number][]));
  }
  if (filter.ownerId) where.push(eq(leads.ownerId, filter.ownerId));
  if (filter.q) {
    where.push(
      or(
        ilike(leads.companyName, like(filter.q)),
        ilike(leads.contactName, like(filter.q)),
        ilike(leads.email, like(filter.q)),
      ),
    );
  }
  return getDb()
    .select({
      id: leads.id,
      companyName: leads.companyName,
      contactName: leads.contactName,
      email: leads.email,
      stage: leads.stage,
      valueAud: leads.valueAud,
      probability: leads.probability,
      expectedCloseDate: leads.expectedCloseDate,
      nextAction: leads.nextAction,
      nextActionAt: leads.nextActionAt,
      owner: users.name,
      lastActivityAt: leads.lastActivityAt,
      convertedCustomerId: leads.convertedCustomerId,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(leads.updatedAt))
    .limit(Math.min(filter.limit ?? 50, 200));
}

export async function getLeadRecord(id: string) {
  await assertLead();
  const lead = await getDb().query.leads.findFirst({
    where: eq(leads.id, id),
    with: { owner: { columns: { id: true, name: true, email: true } } },
  });
  return lead ?? null;
}

export async function listProjectRows(filter: {
  q?: string;
  customerId?: string;
  statuses?: string[];
  limit?: number;
}) {
  const access = await getAccess();
  const where: (SQL | undefined)[] = [customerScope(access, projects.customerId)];
  if (filter.customerId) where.push(eq(projects.customerId, filter.customerId));
  if (filter.statuses?.length) {
    where.push(
      inArray(projects.status, filter.statuses as (typeof projects.status.enumValues)[number][]),
    );
  }
  if (filter.q) {
    where.push(
      or(
        ilike(projects.name, like(filter.q)),
        ilike(projects.code, like(filter.q)),
        ilike(customers.name, like(filter.q)),
      ),
    );
  }
  return getDb()
    .select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
      status: projects.status,
      health: projects.health,
      priority: projects.priority,
      customerId: projects.customerId,
      customer: customers.name,
      owner: users.name,
      targetDate: projects.targetDate,
      headline: projects.headline,
      lastActivityAt: projects.lastActivityAt,
      stepsDone: sql<number>`(select count(*)::int from ${projectSteps} where ${projectSteps.projectId} = ${projects.id} and ${projectSteps.status} = 'done')`,
      stepsCounted: sql<number>`(select count(*)::int from ${projectSteps} where ${projectSteps.projectId} = ${projects.id} and ${projectSteps.status} <> 'not_applicable')`,
      stepsBlocked: sql<number>`(select count(*)::int from ${projectSteps} where ${projectSteps.projectId} = ${projects.id} and ${projectSteps.status} = 'blocked')`,
    })
    .from(projects)
    .innerJoin(customers, eq(customers.id, projects.customerId))
    .leftJoin(users, eq(users.id, projects.ownerId))
    .where(and(...where))
    .orderBy(asc(projects.status), desc(projects.updatedAt))
    .limit(Math.min(filter.limit ?? 50, 200));
}
