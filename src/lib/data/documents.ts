import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import {
  activity,
  contacts,
  customers,
  documentLines,
  documents,
  items,
  projects,
  settings,
  users,
  xeroPayments,
  xeroSyncLog,
  type Document,
} from "@/lib/db/schema";
import { canSeeCustomer, canSeeDocumentOf, documentScope, getAccess } from "@/lib/access";
import { buildCopyLines, basedOnRemark, type DraftLine } from "@/lib/sales/copy";
import { copyCounter, type DocType } from "@/lib/sales/doc-types";
import { isoDate } from "@/lib/utils";

/**
 * Reads for sales and purchasing documents. Every list is filtered by
 * customerScope on the partner, and every single read checks the partner, so
 * a restricted person sees exactly the documents of the partners granted to
 * them — and a 404 for anything else.
 */

export const PAGE_SIZE = 50;

export type DocumentFilters = {
  q?: string;
  status?: string;
  owner?: string;
  partner?: string;
  project?: string;
  fulfilment?: string;
  overdue?: string;
  xero?: string;
  page?: string;
};

export async function listDocuments(type: DocType, filters: DocumentFilters, userId: string) {
  const access = await getAccess();
  const where: SQL[] = [eq(documents.type, type)];
  const scope = documentScope(access);
  if (scope) where.push(scope);

  // Default view: what is still in play.
  const status = filters.status ?? "live";
  if (status === "live") where.push(inArray(documents.status, ["draft", "open"]));
  else if (status !== "all") where.push(eq(documents.status, status as Document["status"]));

  if (filters.owner === "me") where.push(eq(documents.ownerId, userId));
  else if (filters.owner) where.push(eq(documents.ownerId, filters.owner));
  if (filters.partner) where.push(eq(documents.partnerId, filters.partner));
  if (filters.project) where.push(eq(documents.projectId, filters.project));
  if (filters.fulfilment) where.push(eq(documents.fulfilment, filters.fulfilment));
  if (filters.overdue === "1") {
    where.push(
      eq(documents.status, "open"),
      sql`${documents.amountDue} > 0`,
      lt(documents.dueDate, isoDate()),
    );
  }
  if (filters.xero === "problems") {
    where.push(inArray(documents.xeroSyncState, ["failed", "blocked"]));
  }
  if (filters.q) {
    const like = `%${filters.q}%`;
    where.push(
      or(
        ilike(documents.number, like),
        ilike(documents.partnerName, like),
        ilike(documents.reference, like),
        ilike(documents.title, like),
      )!,
    );
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const db = getDb();
  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        doc: documents,
        ownerName: users.name,
        ownerPhoto: users.photo,
      })
      .from(documents)
      .leftJoin(users, eq(users.id, documents.ownerId))
      .where(and(...where))
      .orderBy(desc(documents.docDate), desc(documents.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(...where)),
  ]);

  return { rows, count, page };
}

export type ListRow = Awaited<ReturnType<typeof listDocuments>>["rows"][number];

/** One document with everything its page shows, or null if not visible. */
export async function getDocument(id: string) {
  const db = getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  if (!doc) return null;
  if (!canSeeDocumentOf(await getAccess(), doc)) return null;

  const [lines, [partner], [owner], [project], [salesOrder]] = await Promise.all([
    db
      .select({ line: documentLines, xeroItemId: items.xeroItemId })
      .from(documentLines)
      .leftJoin(items, eq(items.id, documentLines.itemId))
      .where(eq(documentLines.documentId, id))
      .orderBy(asc(documentLines.position)),
    db
      .select({
        id: customers.id,
        name: customers.name,
        xeroContactId: customers.xeroContactId,
        isCustomer: customers.isCustomer,
        isSupplier: customers.isSupplier,
      })
      .from(customers)
      .where(eq(customers.id, doc.partnerId)),
    doc.ownerId
      ? db.select({ id: users.id, name: users.name, photo: users.photo }).from(users).where(eq(users.id, doc.ownerId))
      : Promise.resolve([]),
    doc.projectId
      ? db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, doc.projectId))
      : Promise.resolve([]),
    doc.salesOrderId
      ? db
          .select({ id: documents.id, number: documents.number, type: documents.type })
          .from(documents)
          .where(eq(documents.id, doc.salesOrderId))
      : Promise.resolve([]),
  ]);

  return {
    doc,
    lines: lines.map((l) => ({ ...l.line, inXero: Boolean(l.xeroItemId) })),
    partner: partner ?? null,
    owner: owner ?? null,
    project: project ?? null,
    salesOrder: salesOrder ?? null,
  };
}

export type DocumentDetail = NonNullable<Awaited<ReturnType<typeof getDocument>>>;

export type RelatedDoc = Pick<
  Document,
  | "id"
  | "type"
  | "number"
  | "status"
  | "isReserve"
  | "total"
  | "docDate"
  | "dueDate"
  | "quoteOutcome"
  | "closedBy"
  | "amountPaid"
  | "amountDue"
  | "xeroSyncState"
> & {
  /** base: drawn from it. child: drawn into it. ordered: a PO raised for it. for: what a PO was raised for. */
  relation: "base" | "child" | "ordered" | "for";
};

/** Documents this one was drawn from, and those drawn from it. */
export async function relatedDocuments(doc: Document): Promise<RelatedDoc[]> {
  const db = getDb();
  const self = alias(documentLines, "self");
  const base = alias(documentLines, "base");
  const child = alias(documentLines, "child");
  const cols = {
    id: documents.id,
    type: documents.type,
    number: documents.number,
    status: documents.status,
    isReserve: documents.isReserve,
    total: documents.total,
    docDate: documents.docDate,
    dueDate: documents.dueDate,
    quoteOutcome: documents.quoteOutcome,
    closedBy: documents.closedBy,
    amountPaid: documents.amountPaid,
    amountDue: documents.amountDue,
    xeroSyncState: documents.xeroSyncState,
  };

  const source = alias(documentLines, "source");
  const raised = alias(documentLines, "raised");
  const [bases, children, traced, ordered, raisedFor] = await Promise.all([
    db
      .selectDistinct(cols)
      .from(self)
      .innerJoin(base, eq(base.id, self.baseLineId))
      .innerJoin(documents, eq(documents.id, base.documentId))
      .where(eq(self.documentId, doc.id)),
    db
      .selectDistinct(cols)
      .from(self)
      .innerJoin(child, eq(child.baseLineId, self.id))
      .innerJoin(documents, eq(documents.id, child.documentId))
      .where(eq(self.documentId, doc.id)),
    doc.type === "sales_order"
      ? db.select(cols).from(documents).where(eq(documents.salesOrderId, doc.id))
      : Promise.resolve([]),
    db
      .selectDistinct(cols)
      .from(self)
      .innerJoin(raised, eq(raised.sourceLineId, self.id))
      .innerJoin(documents, eq(documents.id, raised.documentId))
      .where(eq(self.documentId, doc.id)),
    db
      .selectDistinct(cols)
      .from(self)
      .innerJoin(source, eq(source.id, self.sourceLineId))
      .innerJoin(documents, eq(documents.id, source.documentId))
      .where(eq(self.documentId, doc.id)),
  ]);

  const seen = new Set<string>();
  const out: RelatedDoc[] = [];
  for (const [list, relation] of [
    [bases, "base"],
    [raisedFor, "for"],
    [ordered, "ordered"],
    [children, "child"],
    [traced, "child"],
  ] as const) {
    for (const d of list) {
      if (seen.has(d.id) || d.id === doc.id) continue;
      seen.add(d.id);
      out.push({ ...d, relation });
    }
  }
  return out.sort((a, b) => a.docDate.localeCompare(b.docDate));
}

/** The document's own trail, newest first. */
export async function documentActivity(id: string) {
  return getDb()
    .select({
      id: activity.id,
      verb: activity.verb,
      summary: activity.summary,
      createdAt: activity.createdAt,
      actorName: users.name,
    })
    .from(activity)
    .leftJoin(users, eq(users.id, activity.actorId))
    .where(and(eq(activity.entityType, "document"), eq(activity.entityId, id)))
    .orderBy(desc(activity.createdAt))
    .limit(30);
}

/** The latest Xero total mismatch for a document, if it is newer than its last sync. */
export async function lastXeroProblem(id: string) {
  const [row] = await getDb()
    .select()
    .from(xeroSyncLog)
    .where(and(eq(xeroSyncLog.entityId, id), eq(xeroSyncLog.action, "total_mismatch")))
    .orderBy(desc(xeroSyncLog.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Payments Xero holds against an invoice or bill, newest first. Read-only:
 * they are recorded in Xero and copied here by the import and the pull.
 */
export async function documentPayments(id: string) {
  return getDb()
    .select()
    .from(xeroPayments)
    .where(and(eq(xeroPayments.documentId, id), sql`coalesce(${xeroPayments.status}, 'AUTHORISED') <> 'DELETED'`))
    .orderBy(desc(xeroPayments.date));
}

/* ── defaults for new documents ──────────────────────────────────── */

export type PartnerDefaults = {
  id: string;
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
  termsDays: number;
  shipTo: string | null;
  contacts: { id: string; name: string; email: string | null; isPrimary: boolean }[];
};

/** What choosing a partner fills in: contacts, ship-to, terms. */
export async function partnerDefaults(
  partnerId: string,
  side: "customer" | "supplier",
): Promise<PartnerDefaults | null> {
  if (!(await canSeeCustomer(partnerId))) return null;
  const db = getDb();
  const [[c], people, [config]] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, partnerId)),
    db
      .select()
      .from(contacts)
      .where(and(eq(contacts.customerId, partnerId), sql`${contacts.archivedAt} is null`))
      .orderBy(desc(contacts.isPrimary), asc(contacts.firstName)),
    db.select().from(settings).where(eq(settings.id, "singleton")),
  ]);
  if (!c) return null;

  const address = [
    c.addressLine1,
    c.addressLine2,
    [c.suburb, c.state, c.postcode].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: c.id,
    name: c.name,
    isCustomer: c.isCustomer,
    isSupplier: c.isSupplier,
    termsDays:
      side === "customer"
        ? (c.termsDays ?? config?.customerTermsDays ?? 14)
        : (c.supplierTermsDays ?? config?.supplierTermsDays ?? 30),
    shipTo: address || null,
    contacts: people.map((p) => ({
      id: p.id,
      name: [p.firstName, p.lastName].filter(Boolean).join(" "),
      email: p.email,
      isPrimary: p.isPrimary,
    })),
  };
}

export type EditorHeader = {
  partnerId: string | null;
  partnerName: string | null;
  contactId: string | null;
  reference: string | null;
  docDate: string;
  dueDate: string | null;
  termsDays: number | null;
  shipToText: string | null;
  ownerId: string | null;
  projectId: string | null;
  amountsAre: "exclusive" | "inclusive" | "no_tax";
  title: string | null;
  summary: string | null;
  terms: string | null;
  remarks: string | null;
  internalNotes: string | null;
  isReserve: boolean;
  /** Bills: the supplier's own invoice number. */
  supplierInvoiceNumber?: string | null;
};

export type CopyDraft = {
  header: EditorHeader;
  lines: DraftLine[];
  source: { id: string; type: DocType; number: string | null };
  salesOrderId: string | null;
};

/**
 * A new document prefilled from an open source document (copy-to), or null
 * if the copy is not allowed or nothing is left to copy.
 */
export async function copyDraft(
  fromId: string,
  target: DocType,
  reserve: boolean,
): Promise<CopyDraft | { error: string } | null> {
  const detail = await getDocument(fromId);
  if (!detail) return null;
  const { doc, lines } = detail;

  const counter = copyCounter(doc.type, target, reserve);
  if (!counter) return { error: "That document cannot be copied into this one." };
  if (doc.status === "cancelled" || (doc.status === "closed" && doc.type !== "quote")) {
    return { error: `${doc.number ?? "That document"} is ${doc.status}, so nothing more can be drawn from it.` };
  }
  if (doc.type === "sales_order" && doc.status === "draft") {
    return { error: `Confirm ${doc.number} before invoicing it.` };
  }
  if (doc.type === "purchase_order" && doc.status === "draft") {
    return { error: `Approve ${doc.number ?? "the purchase order"} before entering a bill against it.` };
  }
  if (doc.type === "quote" && doc.status === "closed") {
    return { error: `Quote ${doc.number ?? ""} is closed. Reopen it to convert the rest.`.replace("  ", " ") };
  }

  const draftLines = buildCopyLines(lines, counter);
  if (!draftLines.some((l) => l.rowType === "item")) {
    return { error: `Everything on ${doc.number ?? "that document"} has already been drawn.` };
  }

  const [config] = await getDb().select().from(settings).where(eq(settings.id, "singleton"));
  const today = isoDate();
  const supplierSide = target === "bill" || target === "goods_receipt";
  const [partnerRow] = supplierSide
    ? await getDb().select({ terms: customers.supplierTermsDays }).from(customers).where(eq(customers.id, doc.partnerId))
    : [];
  const terms = supplierSide
    ? (partnerRow?.terms ?? config?.supplierTermsDays ?? 30)
    : (doc.termsDays ?? config?.customerTermsDays ?? 14);
  const due =
    target === "invoice" || target === "bill"
      ? isoDate(terms)
      : target === "sales_order"
        ? (doc.type === "quote" ? isoDate(14) : doc.dueDate)
        : doc.dueDate;

  return {
    source: { id: doc.id, type: doc.type, number: doc.number },
    salesOrderId: doc.type === "sales_order" ? doc.id : doc.salesOrderId,
    lines: draftLines,
    header: {
      partnerId: doc.partnerId,
      partnerName: doc.partnerName,
      contactId: doc.contactId,
      // A bill's reference is the PO it pays for.
      reference: target === "bill" ? doc.number : doc.reference,
      docDate: today,
      dueDate: due,
      termsDays: supplierSide ? terms : doc.termsDays,
      shipToText: doc.shipToText,
      ownerId: doc.ownerId,
      projectId: doc.projectId,
      amountsAre: doc.amountsAre,
      title: null,
      summary: null,
      terms: null,
      remarks: basedOnRemark(doc) || null,
      internalNotes: null,
      isReserve: reserve,
    },
  };
}

/* ── record pages and the rail ───────────────────────────────────── */

/** Recent documents of every type for one partner (customer page). */
export async function documentsForPartner(partnerId: string) {
  if (!(await canSeeCustomer(partnerId))) return [];
  return getDb()
    .select()
    .from(documents)
    .where(eq(documents.partnerId, partnerId))
    .orderBy(desc(documents.docDate), desc(documents.createdAt))
    .limit(40);
}

/** Documents filed against a project (the project's Commercials card). */
export async function documentsForProject(projectId: string) {
  const access = await getAccess();
  return getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.projectId, projectId), documentScope(access)))
    .orderBy(desc(documents.docDate))
    .limit(40);
}

/** Numbers for the rail: orders needing stock ordered, invoices overdue. */
export async function salesCounts(): Promise<{ toOrder: number; overdue: number; inTransit: number }> {
  const access = await getAccess();
  const scope = documentScope(access);
  const [row] = await getDb()
    .select({
      toOrder: sql<number>`count(*) filter (where ${documents.type} = 'sales_order' and ${documents.status} = 'open' and ${documents.fulfilment} = 'to_order')::int`,
      overdue: sql<number>`count(*) filter (where ${documents.type} = 'invoice' and ${documents.status} = 'open' and ${documents.amountDue} > 0 and ${documents.dueDate} < ${isoDate()})::int`,
      inTransit: sql<number>`count(*) filter (where ${documents.type} = 'purchase_order' and ${documents.status} = 'open'
        and coalesce(${documents.fulfilment}, '') <> 'received'
        and exists (select 1 from shipments s where s.document_id = ${documents.id} and s.receipt_id is null))::int`,
    })
    .from(documents)
    .where(and(inArray(documents.type, ["sales_order", "invoice", "purchase_order"]), scope));
  return row ?? { toOrder: 0, overdue: 0, inTransit: 0 };
}

/** Sync health for Settings: how many documents need a person. */
export async function xeroProblemCount(): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .where(
      and(
        inArray(documents.xeroSyncState, ["failed", "blocked"]),
        ne(documents.status, "cancelled"),
        isNotNull(documents.partnerId),
      ),
    );
  return row?.n ?? 0;
}
