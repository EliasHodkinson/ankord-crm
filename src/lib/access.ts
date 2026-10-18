import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { and, eq, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import {
  activity,
  communications,
  contactFacts,
  contacts,
  customerGrants,
  customers,
  documents,
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
import { sectionsFrom, type Section } from "@/lib/sections";
import { DOC_TYPES, type DocType } from "@/lib/sales/doc-types";

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
 * An admin can narrow a restricted person further to some sections of the CRM
 * (lib/sections.ts). A section switched off behaves as if they held no
 * partners for that kind of record: lists come back empty, single records are
 * not found, and writes are refused. The checks for it live in the same
 * primitives below, so every caller — pages, actions, MCP tools — inherits it.
 *
 * The rules are enforced here, on the server, not by hiding buttons. The UI
 * hides what a person cannot use only so they are not offered dead ends.
 *
 * Denials in pages are notFound(): a restricted person cannot tell a record
 * they may not see from one that does not exist. Denials in actions throw.
 */

export type Access =
  | { userId: string; role: Exclude<AppRole, "restricted">; restricted: false }
  | {
      userId: string;
      role: "restricted";
      restricted: true;
      customerIds: string[];
      sections: Section[];
    };

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
    sections: sectionsFrom(user.sections),
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

/* ── sections ────────────────────────────────────────────────────── */

export function hasSection(access: Access, section: Section): boolean {
  return !access.restricted || access.sections.includes(section);
}

/** For the pages of a section — not found to someone it is switched off for. */
export async function requireSectionPage(section: Section): Promise<Access> {
  const access = await getAccess();
  if (!hasSection(access, section)) notFound();
  return access;
}

/** For actions and reads that belong to a section. */
export async function assertSection(section: Section): Promise<Access> {
  const access = await getAccess();
  if (!hasSection(access, section)) throw new AccessDenied();
  return access;
}

/** Which section a sales or purchasing document belongs to. */
export function docSection(type: DocType): Section {
  return DOC_TYPES[type].side === "supplier" ? "purchasing" : "sales";
}

/** Whether this person may see a document of this type for this partner. */
export function canSeeDocumentOf(access: Access, doc: { type: DocType; partnerId: string | null }) {
  return hasSection(access, docSection(doc.type)) && allows(access, doc.partnerId);
}

/* ── SQL filters for lists ───────────────────────────────────────── */

const NOTHING = sql`false`;

/** Nothing at all when the section is switched off; otherwise no filter. */
function sectionFilter(access: Access, section: Section): SQL | undefined {
  return hasSection(access, section) ? undefined : NOTHING;
}

/** Business partner lists: the partners granted, if the section is on. */
export function partnerScope(access: Access): SQL | undefined {
  return sectionFilter(access, "customers") ?? customerScope(access, customers.id);
}

/** Contact lists: contacts at the partners granted, if People is on. */
export function contactScope(access: Access): SQL | undefined {
  return sectionFilter(access, "contacts") ?? customerScope(access, contacts.customerId);
}

/** Project lists: the granted partners' projects, if Projects is on. */
export function projectListScope(access: Access): SQL | undefined {
  return sectionFilter(access, "projects") ?? customerScope(access, projects.customerId);
}

/**
 * Sales and purchasing documents: the granted partners' documents, of the
 * types whose section is on.
 */
export function documentScope(access: Access): SQL | undefined {
  if (!access.restricted) return undefined;
  const types = (Object.keys(DOC_TYPES) as DocType[]).filter((t) =>
    hasSection(access, docSection(t)),
  );
  if (!types.length) return NOTHING;
  return and(customerScope(access, documents.partnerId), inArray(documents.type, types));
}

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
  return access.customerIds.length && hasSection(access, "projects") ? inArray(column, visibleProjectIds(access)) : NOTHING;
}

/**
 * For rows that can hang off a customer, a project or both — communications,
 * tasks, activity. Visible when either link is visible. A row linked to
 * neither (or only to a lead) is not. With Projects switched off, a project
 * link no longer counts.
 */
export function linkedScope(
  access: Access,
  columns: { customerId: AnyPgColumn; projectId: AnyPgColumn },
): SQL | undefined {
  if (!access.restricted) return undefined;
  if (!access.customerIds.length) return NOTHING;
  if (!hasSection(access, "projects")) return inArray(columns.customerId, access.customerIds);
  return or(
    inArray(columns.customerId, access.customerIds),
    inArray(columns.projectId, visibleProjectIds(access)),
  );
}

/**
 * The activity trail (Overview). Linked rows as for linkedScope, less the
 * entries about a kind of record whose section is switched off. A document
 * entry does not say which side it is on, so it needs both.
 */
export function activityScope(access: Access): SQL | undefined {
  if (!access.restricted) return undefined;
  const hidden = [
    ...(hasSection(access, "sales") && hasSection(access, "purchasing") ? [] : ["document"]),
    ...(hasSection(access, "contacts") ? [] : ["contact"]),
    ...(hasSection(access, "projects") ? [] : ["project", "step"]),
    ...(hasSection(access, "tasks") ? [] : ["task"]),
  ];
  return and(
    linkedScope(access, { customerId: activity.customerId, projectId: activity.projectId }),
    hidden.length ? notInArray(activity.entityType, hidden) : undefined,
  );
}

/**
 * Follow-ups. Linked ones follow their record; an unlinked one belongs to
 * whoever it is assigned to or was written by, so a restricted person can still
 * keep their own to-do list.
 */
export function taskScope(access: Access): SQL | undefined {
  if (!access.restricted) return undefined;
  if (!hasSection(access, "tasks")) return NOTHING;
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
  if (!hasSection(access, "projects")) return false;
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
  await assertSection("contacts");
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
  await assertSection("contacts");
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
  // A partner's own register sits on its page.
  if (!row.projectId) await assertSection("customers");
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
 * customers and of those customers' projects — each only while its section
 * is switched on.
 */
async function visibleFolderRoots(access: Access & { restricted: true }) {
  if (!access.customerIds.length) return [];
  const db = getDb();
  const [customerFolders, projectFolders] = await Promise.all([
    hasSection(access, "customers")
      ? db
          .select({ driveId: customers.spDriveId, itemId: customers.spItemId })
          .from(customers)
          .where(inArray(customers.id, access.customerIds))
      : [],
    hasSection(access, "projects")
      ? db
          .select({ driveId: projects.spDriveId, itemId: projects.spItemId })
          .from(projects)
          .where(inArray(projects.customerId, access.customerIds))
      : [],
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
