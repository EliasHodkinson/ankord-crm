import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb, withTransaction, type Tx } from "@/lib/db";
import { customers, documentLines, documents, items, settings, type Document } from "@/lib/db/schema";
import { logActivity } from "@/lib/actions/shared";
import { baseLinesOf, recomputeCounters, recomputeFulfilment } from "@/lib/actions/documents-core";
import { typeLabel } from "@/lib/sales/doc-types";
import { applyInvoice, applyPurchaseOrder, applyQuote } from "../pull";
import { linkBillByReference } from "@/lib/purchasing/link";
import { replacePayments } from "../payments";
import { totalsAgree, type ImportedDoc } from "./map";
import { IMPORT_SOURCES } from "./sources";
import type { DocPlan, DocPreviewRow, ImportReport, ImportScope, ImportSourceKey } from "./scope";

/**
 * Bringing Xero quotes and invoices into The Gangway (spec Q11), so work
 * started in Xero carries on here: an accepted quote converts to a sales
 * order, an open invoice is approved, paid and followed here.
 *
 * The rules:
 * - **Keyed by Xero's ID.** `documents.xeroId` is unique, so running the
 *   import again finds what it brought in last time and updates it.
 * - **Never pushes.** An imported document lands `synced`, with
 *   `xeroPushedVersion = version`: Xero already has exactly this, and the push
 *   engine only claims `pending`, `stale`, `failed` or `blocked`. Nothing here
 *   calls push, queue or history notes. Editing it afterwards is an ordinary
 *   edit and pushes like one — that is the workflow carrying on.
 * - **Waits for its contact.** A document whose Xero contact is not linked to
 *   a business partner is not imported; it is shown as waiting until the
 *   contact is matched on the contacts screen.
 * - **Xero's lines only while untouched.** Re-importing refreshes the lines of
 *   a document still exactly as imported. Once someone has edited it here, or
 *   drawn a sales order or invoice from it, Gangway owns its lines (§8.6) and
 *   only Xero's status, money and payments are refreshed — the pull's rules.
 */

type Existing = Pick<Document, "id" | "importedAt" | "updatedAt" | "xeroSyncState"> & {
  hasChildren: boolean;
};

/** Untouched since the import wrote it, and nothing drawn from it. */
function isPristineImport(doc: Existing): boolean {
  return (
    doc.importedAt !== null &&
    doc.updatedAt.getTime() <= doc.importedAt.getTime() &&
    doc.xeroSyncState === "synced" &&
    !doc.hasChildren
  );
}

async function existingByXeroId(xeroIds: string[]): Promise<Map<string, Existing>> {
  if (!xeroIds.length) return new Map();
  const rows = await getDb()
    .select({
      id: documents.id,
      xeroId: documents.xeroId,
      importedAt: documents.importedAt,
      updatedAt: documents.updatedAt,
      xeroSyncState: documents.xeroSyncState,
      hasChildren: sql<boolean>`exists (
        select 1 from document_lines c
        join document_lines l on l.id = c.base_line_id
        where l.document_id = documents.id)`,
    })
    .from(documents)
    .where(inArray(documents.xeroId, xeroIds));
  return new Map(rows.map((r) => [r.xeroId!, r]));
}

async function partnersByContact(contactIds: string[]) {
  if (!contactIds.length) return new Map<string, { id: string; name: string }>();
  const rows = await getDb()
    .select({ id: customers.id, name: customers.name, xeroContactId: customers.xeroContactId })
    .from(customers)
    .where(inArray(customers.xeroContactId, contactIds));
  return new Map(rows.map((r) => [r.xeroContactId!, { id: r.id, name: r.name }]));
}

function planFor(doc: ImportedDoc, partner: { id: string } | undefined, existing: Existing | undefined): { plan: DocPlan; note: string | null } {
  if (existing) {
    if (isPristineImport(existing)) return { plan: "update", note: null };
    const what =
      doc.type === "quote" || doc.type === "purchase_order"
        ? "its Xero status is"
        : "its Xero status, amounts and payments are";
    return {
      plan: "refresh",
      note: existing.importedAt
        ? `Worked on here since it was imported, so only ${what} refreshed.`
        : `Made in The Gangway, so only ${what} refreshed.`,
    };
  }
  if (doc.currency !== "AUD") return { plan: "currency", note: `In ${doc.currency}. The Gangway works in AUD only.` };
  if (!partner) return { plan: "waiting", note: `Match ${doc.contactName} to a business partner first.` };
  return { plan: "create", note: null };
}

async function fetchWithPlans(source: ImportSourceKey, scope: ImportScope) {
  const docs = await IMPORT_SOURCES[source].list(scope);
  const [existing, partners] = await Promise.all([
    existingByXeroId(docs.map((d) => d.xeroId)),
    partnersByContact([...new Set(docs.map((d) => d.contactId).filter((id): id is string => Boolean(id)))]),
  ]);
  return docs.map((doc) => {
    const partner = doc.contactId ? partners.get(doc.contactId) : undefined;
    const prior = existing.get(doc.xeroId);
    return { doc, partner, existing: prior, ...planFor(doc, partner, prior) };
  });
}

/** What an import would do, without doing it. Reads Xero; writes nothing anywhere. */
export async function previewDocuments(source: ImportSourceKey, scope: ImportScope): Promise<DocPreviewRow[]> {
  const rows = await fetchWithPlans(source, scope);
  return rows.map(({ doc, partner, existing, plan, note }) => ({
    xeroId: doc.xeroId,
    type: doc.type,
    number: doc.number,
    xeroStatus: doc.xeroStatus,
    contactId: doc.contactId,
    contactName: doc.contactName,
    partner: partner ?? null,
    existingId: existing?.id ?? null,
    docDate: doc.docDate,
    dueDate: doc.dueDate,
    total: doc.total,
    xeroTotal: doc.xeroTotal,
    amountDue: doc.amountDue,
    lineCount: doc.lines.length,
    paymentCount: doc.payments.length,
    totalsDiffer: !totalsAgree(doc),
    plan,
    note,
  }));
}

const addDays = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

type Context = {
  userId: string;
  itemsByCode: Map<string, { id: string; code: string; unit: string | null; tracksStock: boolean }>;
  quoteValidityDays: number;
  today: string;
};

function lineRows(doc: ImportedDoc, ctx: Context, documentId: string) {
  return doc.lines.map((line, position) => {
    const item = line.itemCode ? ctx.itemsByCode.get(line.itemCode.toLowerCase()) : undefined;
    return {
      documentId,
      position,
      rowType: line.rowType,
      itemId: item?.id ?? null,
      itemCode: item?.code ?? line.itemCode,
      unit: item?.unit ?? null,
      tracksStock: item?.tracksStock ?? false,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent,
      accountCode: line.accountCode,
      taxType: line.taxType,
      taxRate: line.taxRate,
      lineAmount: line.lineAmount,
      taxAmount: line.taxAmount,
    };
  });
}

/** The Xero-owned header: everything a re-import may overwrite on an untouched document. */
function headerFrom(doc: ImportedDoc, partner: { id: string; name: string }, ctx: Context, now: Date) {
  const docDate = doc.docDate ?? ctx.today;
  const closed = doc.state.status === "closed";
  return {
    number: doc.number,
    // A bill's number is the supplier's; it is unique per supplier, not overall.
    supplierInvoiceNumber: doc.type === "bill" ? doc.number : null,
    status: doc.state.status,
    quoteOutcome: doc.type === "quote" ? doc.state.quoteOutcome : null,
    partnerId: partner.id,
    partnerName: partner.name,
    reference: doc.reference,
    docDate,
    // A quote needs a valid-until; Xero's is optional.
    dueDate: doc.dueDate ?? (doc.type === "quote" ? addDays(docDate, ctx.quoteValidityDays) : null),
    amountsAre: doc.amountsAre,
    title: doc.title,
    summary: doc.summary,
    terms: doc.terms,
    ...(doc.type === "purchase_order"
      ? { shipToText: doc.shipToText ?? null, contactName: doc.attentionTo ?? null, remarks: doc.remarks ?? null }
      : {}),
    subtotal: doc.subtotal,
    taxTotal: doc.taxTotal,
    total: doc.total,
    amountPaid: doc.amountPaid,
    amountDue: doc.amountDue,
    issuedAt: doc.state.status === "draft" ? null : new Date(`${docDate}T00:00:00Z`),
    closedAt: closed ? now : null,
    closedBy: closed ? ("auto" as const) : null,
    xeroStatus: doc.xeroStatus,
    xeroSyncState: "synced" as const,
    xeroError: null,
    xeroAttempts: 0,
    xeroSyncedAt: now,
    xeroUpdatedAt: doc.xeroUpdatedAt,
    xeroTotal: doc.xeroTotal,
    importedAt: now,
    updatedAt: now,
  };
}

async function createDoc(tx: Tx, doc: ImportedDoc, partner: { id: string; name: string }, ctx: Context) {
  const now = new Date();
  const [row] = await tx
    .insert(documents)
    .values({
      ...headerFrom(doc, partner, ctx, now),
      type: doc.type,
      ownerId: ctx.userId,
      createdById: ctx.userId,
      version: 1,
      xeroId: doc.xeroId,
      xeroPushedVersion: 1,
    })
    .returning({ id: documents.id });
  const lines = lineRows(doc, ctx, row.id);
  if (lines.length) await tx.insert(documentLines).values(lines);
  await replacePayments(row.id, doc.payments, tx);
  return row.id;
}

async function updateDoc(tx: Tx, id: string, doc: ImportedDoc, partner: { id: string; name: string }, ctx: Context) {
  const now = new Date();
  // Locked and re-checked: someone may have started editing since the preview.
  const [locked] = await tx
    .select({ updatedAt: documents.updatedAt, importedAt: documents.importedAt })
    .from(documents)
    .where(eq(documents.id, id))
    .for("update");
  if (!locked?.importedAt || locked.updatedAt.getTime() > locked.importedAt.getTime()) return false;

  await tx
    .update(documents)
    .set({
      ...headerFrom(doc, partner, ctx, now),
      // Bumped so an editor opened before the refresh is told to reload.
      version: sql`${documents.version} + 1`,
      xeroPushedVersion: sql`${documents.version} + 1`,
    })
    .where(eq(documents.id, id));
  // A bill's lines may be entered against a PO; the PO's counters follow the
  // replaced lines, and the link is made again from the Reference.
  const before = await baseLinesOf(tx, [id]);
  await tx.delete(documentLines).where(eq(documentLines.documentId, id));
  const lines = lineRows(doc, ctx, id);
  if (lines.length) await tx.insert(documentLines).values(lines);
  await replacePayments(id, doc.payments, tx);
  if (doc.type === "bill") await linkBillByReference(tx, id);
  await recomputeCounters(tx, before);
  if (doc.type === "purchase_order") await recomputeFulfilment(tx, id);
  return true;
}

/** Status, money and payments only — the pull's rules, for a document Gangway owns. */
async function refreshDoc(id: string, doc: ImportedDoc) {
  const [current] = await getDb().select().from(documents).where(eq(documents.id, id));
  if (!current) return;
  const common = {
    Status: doc.xeroStatus,
    Total: doc.xeroTotal !== null ? Number(doc.xeroTotal) : undefined,
    UpdatedDateUTC: doc.xeroUpdatedAt?.toISOString(),
  };
  if (doc.type === "quote") {
    await applyQuote(current, { QuoteID: doc.xeroId, QuoteNumber: doc.number ?? undefined, ...common });
  } else if (doc.type === "purchase_order") {
    await applyPurchaseOrder(current, { PurchaseOrderID: doc.xeroId, PurchaseOrderNumber: doc.number ?? undefined, ...common });
  } else {
    await applyInvoice(current, {
      InvoiceID: doc.xeroId,
      InvoiceNumber: doc.number ?? undefined,
      AmountPaid: Number(doc.amountPaid),
      AmountDue: Number(doc.amountDue),
      ...common,
    });
    await replacePayments(id, doc.payments);
  }
}

/**
 * Runs the import for one source and scope. `only`, when given, limits it to
 * those Xero IDs (the rows someone ticked). Each document is its own
 * transaction, so one bad record never stops the rest.
 */
export async function importDocuments(
  source: ImportSourceKey,
  scope: ImportScope,
  userId: string,
  only?: string[],
): Promise<ImportReport> {
  const db = getDb();
  const rows = (await fetchWithPlans(source, scope)).filter((r) => !only || only.includes(r.doc.xeroId));

  const codes = [...new Set(rows.flatMap((r) => r.doc.lines.map((l) => l.itemCode).filter((c): c is string => Boolean(c))))];
  const [catalogue, [config]] = await Promise.all([
    codes.length
      ? db
          .select({ id: items.id, code: items.code, unit: items.unit, tracksStock: items.tracksStock })
          .from(items)
          .where(inArray(sql`lower(${items.code})`, codes.map((c) => c.toLowerCase())))
      : Promise.resolve([]),
    db.select({ quoteValidityDays: settings.quoteValidityDays }).from(settings).where(eq(settings.id, "singleton")),
  ]);
  const ctx: Context = {
    userId,
    itemsByCode: new Map(catalogue.map((i) => [i.code.toLowerCase(), i])),
    quoteValidityDays: config?.quoteValidityDays ?? 30,
    today: new Date().toISOString().slice(0, 10),
  };

  const report: ImportReport = { created: 0, updated: 0, refreshed: 0, waiting: 0, skipped: 0, failed: [], touched: [] };

  for (const { doc, partner, existing, plan } of rows) {
    const name = `${typeLabel(doc.type)} ${doc.number ?? doc.xeroId.slice(0, 8)}`;
    try {
      if (plan === "waiting") report.waiting += 1;
      else if (plan === "currency") report.skipped += 1;
      else if (plan === "create" && partner) {
        const id = await withTransaction(async (tx) => {
          const created = await createDoc(tx, doc, partner, ctx);
          // A bill whose Reference names one of this supplier's POs here is
          // entered against it, so the PO counts it as billed.
          if (doc.type === "bill") await linkBillByReference(tx, created);
          // A PO's "to receive" and auto-close come from its counters.
          if (doc.type === "purchase_order") await recomputeFulfilment(tx, created);
          return created;
        });
        await logActivity({
          entityType: "document",
          entityId: id,
          customerId: partner.id,
          verb: "document_imported",
          summary: `Imported ${name} from Xero`,
        });
        report.created += 1;
        report.touched.push(partner.id);
      } else if (plan === "update" && existing && partner) {
        const done = await withTransaction((tx) => updateDoc(tx, existing.id, doc, partner, ctx));
        if (done) report.updated += 1;
        else {
          await refreshDoc(existing.id, doc);
          report.refreshed += 1;
        }
        report.touched.push(partner.id);
      } else if (existing) {
        await refreshDoc(existing.id, doc);
        report.refreshed += 1;
      }
    } catch (error) {
      report.failed.push(`${name}: ${error instanceof Error ? error.message : "could not be imported"}`);
    }
  }
  report.touched = [...new Set(report.touched)];
  return report;
}
