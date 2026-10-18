"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, withTransaction, type Tx } from "@/lib/db";
import {
  customers,
  documentLines,
  documents,
  items,
  pinnedFiles,
  projects,
  type Document,
  type DocumentLine,
} from "@/lib/db/schema";
import { getGraphToken, GraphAuthError, ReadOnlyError, requireMember } from "@/lib/auth/session";
import { AccessDenied, assertCustomer, assertProject, customerScope, getAccess } from "@/lib/access";
import { partnerDefaults, type PartnerDefaults } from "@/lib/data/documents";
import { priceItems, type PricedItem } from "@/lib/data/items";
import { taxRateMap } from "@/lib/data/xero-cache";
import {
  copyCounter,
  DOC_TYPES,
  docHref,
  documentTitle,
  isXeroType,
  LOCAL_SERIES,
  typeLabel,
  type Counter,
  type DocType,
} from "@/lib/sales/doc-types";
import { formatQty, num, toScaled } from "@/lib/sales/money";
import { lineProblems, linesInput, type LineInput } from "@/lib/sales/schemas";
import { computeTotals } from "@/lib/sales/totals";
import { addDays } from "@/lib/sales/dates";
import { HISTORY } from "@/lib/xero/mapping";
import { pullDocuments } from "@/lib/xero/pull";
import { flushHistoryNotes, pushDocument, queueHistoryNote } from "@/lib/xero/push";
import { notesLater, pushLater, pushNow } from "@/lib/xero/queue";
import { createXeroContactFor } from "@/lib/xero/contacts";
import { XeroAuthError } from "@/lib/xero/auth";
import { XeroApiError, xeroPdf } from "@/lib/xero/client";
import { safeFolderName, uploadFile } from "@/lib/graph/sharepoint";
import { allocateNumber, baseLinesOf, recomputeCounters } from "./documents-core";
import {
  fail,
  fromZod,
  logActivity,
  optionalDate,
  optionalText,
  optionalUuid,
  type ActionState,
} from "./shared";

/**
 * Writes for sales documents (spec §4.6). Every action:
 * - needs an admin or staff member (`requireMember`): viewers and restricted
 *   people read only;
 * - asserts the partner (and project) it touches, so the rule still holds if
 *   writing is ever opened to restricted people;
 * - writes locally in one transaction, then talks to Xero after the commit;
 * - logs activity against the partner and project, and never calls
 *   touchRecords — paperwork is not a conversation.
 */

/** A refusal worded for the person, thrown inside a transaction to roll it back. */
class Refusal extends Error {}

async function guarded(run: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof Refusal ||
      error instanceof ReadOnlyError ||
      error instanceof AccessDenied
    ) {
      return fail(error.message);
    }
    throw error;
  }
}

async function loadDoc(id: string): Promise<Document> {
  const [doc] = await getDb().select().from(documents).where(eq(documents.id, id));
  if (!doc) throw new Refusal("That document no longer exists.");
  await assertCustomer(doc.partnerId);
  return doc;
}

function revalidateDoc(doc: Pick<Document, "id" | "type" | "partnerId" | "projectId">) {
  revalidatePath(DOC_TYPES[doc.type].base);
  revalidatePath(docHref(doc));
  revalidatePath(`/customers/${doc.partnerId}`);
  if (doc.projectId) revalidatePath(`/projects/${doc.projectId}`);
}

async function record(doc: Pick<Document, "id" | "partnerId" | "projectId">, verb: string, summary: string) {
  await logActivity({
    entityType: "document",
    entityId: doc.id,
    customerId: doc.partnerId,
    projectId: doc.projectId,
    verb,
    summary,
  });
}

const label = (doc: Pick<Document, "type" | "number" | "isReserve">) =>
  doc.number ? `${typeLabel(doc.type, doc.isReserve)} ${doc.number}` : documentTitle(doc);

/* ── save ────────────────────────────────────────────────────────── */

const headerSchema = z.object({
  partnerId: z.uuid("Choose who this is for."),
  contactId: optionalUuid,
  reference: optionalText,
  docDate: z.iso.date("Give the document a date."),
  dueDate: optionalDate,
  termsDays: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? null : v),
    z.coerce.number().int().min(0, "Terms can't be negative.").max(365).nullable(),
  ),
  shipToText: optionalText,
  ownerId: optionalUuid,
  projectId: optionalUuid,
  amountsAre: z.enum(["exclusive", "inclusive", "no_tax"]).default("exclusive"),
  title: optionalText,
  summary: optionalText,
  terms: optionalText,
  remarks: optionalText,
  internalNotes: optionalText,
  version: z.coerce.number().int().optional(),
});

/** Fields an approved invoice may still change: none of them reach the money. */
const LOCKED_INVOICE_FIELDS = ["ownerId", "projectId", "internalNotes", "reference"] as const;

function editable(doc: Document): "all" | "header" | "none" {
  if (doc.status === "cancelled") return "none";
  switch (doc.type) {
    case "quote":
      return doc.status === "closed" ? "none" : "all";
    case "sales_order":
      return doc.status === "closed" ? "none" : "all";
    case "invoice":
      return doc.status === "draft" ? "all" : "header";
    default:
      return "none";
  }
}

type BaseLine = DocumentLine & { docType: DocType; docNumber: string | null; docPartner: string; docSalesOrder: string | null; docStatus: Document["status"] };

/**
 * Creates or updates a document. Bound with its type and id (null for new),
 * and an optional source document for copy-to and the reserve flag.
 */
export async function saveDocument(
  type: DocType,
  documentId: string | null,
  options: { isReserve?: boolean } | undefined,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireMember();
    if (!DOC_TYPES[type].available) return fail("That kind of document is not available yet.");

    const parsed = headerSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fromZod(parsed.error);
    const header = parsed.data;

    let rawLines: unknown;
    try {
      rawLines = JSON.parse(String(formData.get("lines") ?? "[]"));
    } catch {
      return fail("The lines could not be read. Reload and try again.");
    }
    const linesParsed = linesInput.safeParse(rawLines);
    if (!linesParsed.success) return fail(linesParsed.error.issues[0]?.message ?? "Check the lines.");
    const lines = linesParsed.data;

    await assertCustomer(header.partnerId);
    if (header.projectId) await assertProject(header.projectId);

    const existing = documentId ? await loadDoc(documentId) : null;
    if (existing && existing.type !== type) return fail("That document is a different kind.");
    const mode = existing ? editable(existing) : "all";
    if (mode === "none") {
      return fail(`${label(existing!)} is ${existing!.status} and can't be edited.`);
    }

    if (mode === "header") return saveLockedHeader(existing!, header);

    const problem = lineProblems(lines, { isQuote: type === "quote", amountsAre: header.amountsAre });
    if (problem) return fail(problem);

    const db = getDb();
    const [partner] = await db.select().from(customers).where(eq(customers.id, header.partnerId));
    if (!partner) return fail("That business partner no longer exists.");
    const side = DOC_TYPES[type].side;
    if (side === "customer" && !partner.isCustomer) {
      return fail(`${partner.name} isn't marked as a customer. Tick Customer on their record first.`, {
        partnerId: [`Mark ${partner.name} as a customer?`],
      });
    }
    if (side === "supplier" && !partner.isSupplier) {
      return fail(`${partner.name} isn't marked as a supplier. Tick Supplier on their record first.`, {
        partnerId: [`Mark ${partner.name} as a supplier?`],
      });
    }

    if (header.projectId) {
      const [project] = await db
        .select({ customerId: projects.customerId })
        .from(projects)
        .where(eq(projects.id, header.projectId));
      if (!project) return fail("That project no longer exists.");
    }

    let dueDate = header.dueDate;
    if (type === "invoice") {
      const terms = header.termsDays ?? partner.termsDays ?? 14;
      dueDate = dueDate ?? addDays(header.docDate, terms);
    }
    if (DOC_TYPES[type].dueRequired && !dueDate) {
      return fail(`Set the ${DOC_TYPES[type].dueLabel?.toLowerCase()}.`, {
        dueDate: ["Required"],
      });
    }

    // Snapshots that the client is not trusted for: item codes, units, stock
    // tracking and tax rates.
    const itemIds = [...new Set(lines.map((l) => l.itemId).filter((id): id is string => Boolean(id)))];
    const [priced, rates] = await Promise.all([priceItems(itemIds, side), taxRateMap()]);
    for (const id of itemIds) {
      if (!priced.has(id)) return fail("One of the items no longer exists. Remove it and try again.");
    }

    const contact = header.contactId
      ? partnerContact(await partnerDefaults(header.partnerId, side), header.contactId)
      : null;

    const isReserve = type === "invoice" ? (existing?.isReserve ?? Boolean(options?.isReserve)) : false;

    const result = await withTransaction(async (tx) => {
      const prepared = prepareLines(lines, priced, rates, header.amountsAre);
      const bases = await lockBaseLines(tx, lines, header.partnerId);
      const salesOrderId = traceSalesOrder(bases) ?? existing?.salesOrderId ?? null;

      if (bases.size && existing === null) {
        // Copied documents take their tax treatment from the source.
        const sourceModes = new Set(
          await Promise.all(
            [...new Set([...bases.values()].map((b) => b.documentId))].map(async (id) => {
              const [d] = await tx.select({ m: documents.amountsAre }).from(documents).where(eq(documents.id, id));
              return d?.m;
            }),
          ),
        );
        if (sourceModes.size === 1 && !sourceModes.has(header.amountsAre)) {
          throw new Refusal("Amounts are locked to the document this was copied from.");
        }
      }

      const fields = {
        partnerId: header.partnerId,
        partnerName: partner.name,
        contactId: contact?.id ?? null,
        contactName: contact?.name ?? null,
        contactEmail: contact?.email ?? null,
        reference: header.reference,
        docDate: header.docDate,
        dueDate,
        termsDays: header.termsDays,
        shipToText: header.shipToText,
        ownerId: header.ownerId,
        projectId: header.projectId,
        amountsAre: header.amountsAre,
        title: type === "quote" ? header.title : null,
        summary: type === "quote" ? header.summary : null,
        terms: type === "quote" ? header.terms : null,
        remarks: header.remarks,
        internalNotes: header.internalNotes,
        subtotal: prepared.totals.subtotal,
        taxTotal: prepared.totals.taxTotal,
        total: prepared.totals.total,
        updatedAt: new Date(),
      };

      let doc: Document;
      let touchedBases: string[] = [];

      if (!existing) {
        const number = LOCAL_SERIES[type] ? await allocateNumber(tx, LOCAL_SERIES[type]!) : null;
        [doc] = await tx
          .insert(documents)
          .values({
            ...fields,
            type,
            number,
            isReserve,
            salesOrderId,
            status: "draft",
            xeroSyncState: isXeroType(type) ? "pending" : "local_only",
            createdById: user.id,
          })
          .returning();
        if (prepared.rows.length) {
          await tx.insert(documentLines).values(
            prepared.rows.map((row, position) => ({ ...row, documentId: doc.id, position })),
          );
        }
        touchedBases = [...bases.keys()];
      } else {
        const [locked] = await tx
          .select()
          .from(documents)
          .where(eq(documents.id, existing.id))
          .for("update");
        if (header.version !== undefined && locked.version !== header.version) {
          throw new Refusal("This document changed after you opened it. Reload to see the latest.");
        }

        const current = await tx
          .select()
          .from(documentLines)
          .where(eq(documentLines.documentId, existing.id));
        const byId = new Map(current.map((l) => [l.id, l]));
        const keep = new Set(lines.map((l) => l.id).filter(Boolean) as string[]);

        // Guards: nothing drawn-from may be deleted, or shrink below what was drawn.
        const childCounts = await childrenOf(tx, current.map((l) => l.id));
        for (const [index, line] of current.entries()) {
          if (!keep.has(line.id) && childCounts.has(line.id)) {
            throw new Refusal(
              `"${line.description || line.itemCode || `Line ${index + 1}`}" has already been drawn into another document, so it can't be removed.`,
            );
          }
        }
        for (const [position, input] of lines.entries()) {
          if (!input.id) continue;
          const before = byId.get(input.id);
          if (!before) throw new Refusal("A line was removed by someone else. Reload and try again.");
          const drawn = largestCounter(before);
          if (drawn > 0 && num(input.quantity) < drawn) {
            throw new Refusal(
              `Line ${position + 1} already has ${formatQty(drawn)} drawn from it, so its quantity can't go below that.`,
            );
          }
          if ((before.baseLineId ?? null) !== (input.baseLineId ?? null)) {
            throw new Refusal(`Line ${position + 1} can't be re-linked to a different source.`);
          }
        }

        const removed = current.filter((l) => !keep.has(l.id)).map((l) => l.id);
        if (removed.length) await tx.delete(documentLines).where(inArray(documentLines.id, removed));

        for (const [position, row] of prepared.rows.entries()) {
          const id = lines[position].id;
          if (id) {
            await tx
              .update(documentLines)
              .set({ ...row, position })
              .where(and(eq(documentLines.id, id), eq(documentLines.documentId, existing.id)));
          } else {
            await tx.insert(documentLines).values({ ...row, documentId: existing.id, position });
          }
        }

        const nextState =
          existing.xeroSyncState === "local_only"
            ? "local_only"
            : existing.xeroId
              ? "stale"
              : "pending";
        [doc] = await tx
          .update(documents)
          .set({ ...fields, version: sql`${documents.version} + 1`, xeroSyncState: nextState })
          .where(eq(documents.id, existing.id))
          .returning();

        touchedBases = [
          ...bases.keys(),
          ...current.map((l) => l.baseLineId).filter((id): id is string => Boolean(id)),
        ];
      }

      const { changed } = await recomputeCounters(tx, touchedBases);
      await assertWithinBases(tx, bases, type, isReserve);
      // The document's own counters and fulfilment move with its quantities too.
      const own = await tx
        .select({ id: documentLines.id })
        .from(documentLines)
        .where(eq(documentLines.documentId, doc.id));
      await recomputeCounters(tx, own.map((r) => r.id));

      return { doc, changed, sources: [...new Set([...bases.values()].map((b) => b.documentId))] };
    });

    const { doc } = result;
    await record(
      doc,
      existing ? "document_updated" : "document_created",
      existing ? `Updated ${label(doc)}` : `Created ${label(doc)}${doc.partnerName ? ` for ${doc.partnerName}` : ""}`,
    );

    // A quote converted here gets a note in Xero, and its new status pushed.
    if (!existing) {
      for (const sourceId of result.sources) {
        const [source] = await getDb().select().from(documents).where(eq(documents.id, sourceId));
        if (source?.type === "quote") {
          await queueHistoryNote(
            source.id,
            HISTORY.quoteConverted(type === "sales_order" ? `sales order ${doc.number}` : "an invoice"),
          );
          await record(source, "document_converted", `Converted into ${label(doc)}`);
        }
      }
    }
    for (const id of new Set([...result.changed, ...result.sources])) {
      const [d] = await getDb().select({ type: documents.type, xeroId: documents.xeroId }).from(documents).where(eq(documents.id, id));
      if (d && isXeroType(d.type)) {
        if (!result.changed.includes(id)) {
          // Only a note to write; the status did not move.
          if (d.xeroId) notesLater(id);
          continue;
        }
        await getDb()
          .update(documents)
          .set({ xeroSyncState: d.xeroId ? "stale" : "pending" })
          .where(and(eq(documents.id, id), ne(documents.xeroSyncState, "local_only")));
        pushLater(id);
      }
    }

    let message = "Saved.";
    if (isXeroType(type)) {
      if (!existing || !existing.xeroId) {
        const outcome = await pushNow(doc.id);
        if (outcome?.state === "synced") message = "Saved and sent to Xero as a draft.";
        else if (outcome?.message) message = `Saved. Not in Xero yet: ${outcome.message}`;
        else message = "Saved. Xero is taking a moment; the number will appear shortly.";
      } else {
        pushLater(doc.id);
      }
    }

    revalidateDoc(doc);
    for (const id of result.sources) revalidatePath(`${DOC_TYPES.quote.base}/${id}`, "page");
    return { ok: true, message, data: { id: doc.id, href: docHref(doc) } };
  });
}

function partnerContact(defaults: PartnerDefaults | null, contactId: string) {
  return defaults?.contacts.find((c) => c.id === contactId) ?? null;
}

async function saveLockedHeader(doc: Document, header: z.infer<typeof headerSchema>) {
  if (header.version !== undefined && header.version !== doc.version) {
    return fail("This document changed after you opened it. Reload to see the latest.");
  }
  const patch: Partial<Document> = {};
  for (const key of LOCKED_INVOICE_FIELDS) patch[key] = header[key] as never;
  // A paid invoice is locked in Xero too; only Gangway-side fields change.
  const reachesXero = doc.status === "open" && patch.reference !== doc.reference;
  if (doc.status !== "open") patch.reference = doc.reference;

  const [saved] = await getDb()
    .update(documents)
    .set({
      ...patch,
      version: sql`${documents.version} + 1`,
      updatedAt: new Date(),
      ...(reachesXero ? { xeroSyncState: "stale" as const } : {}),
    })
    .where(eq(documents.id, doc.id))
    .returning();
  if (reachesXero) pushLater(doc.id);
  await record(saved, "document_updated", `Updated ${label(saved)}`);
  revalidateDoc(saved);
  return { ok: true, message: "Saved. The lines are locked now it's approved.", data: { id: doc.id, href: docHref(doc) } };
}

type PreparedRow = Omit<typeof documentLines.$inferInsert, "documentId" | "position">;

function prepareLines(
  lines: LineInput[],
  priced: Map<string, PricedItem>,
  rates: Map<string, string>,
  amountsAre: "exclusive" | "inclusive" | "no_tax",
) {
  const withRates = lines.map((l) => ({
    ...l,
    taxRate: amountsAre === "no_tax" || !l.taxType ? "0" : (rates.get(l.taxType) ?? "0"),
  }));
  const totals = computeTotals(withRates, amountsAre);
  const rows: PreparedRow[] = withRates.map((l, i) => {
    const item = l.itemId ? priced.get(l.itemId) : undefined;
    const isItem = l.rowType === "item" || l.rowType === "alternative";
    return {
      rowType: l.rowType,
      itemId: isItem ? (l.itemId ?? null) : null,
      itemCode: isItem ? (item?.code ?? null) : null,
      unit: isItem ? (item?.unit ?? null) : null,
      tracksStock: isItem ? (item?.tracksStock ?? false) : false,
      description: l.description.trim(),
      note: l.note ?? null,
      quantity: isItem ? l.quantity : "0",
      unitPrice: isItem ? l.unitPrice : "0",
      discountPercent: isItem ? l.discountPercent : "0",
      accountCode: isItem ? (l.accountCode ?? null) : null,
      taxType: isItem ? (l.taxType ?? null) : null,
      taxRate: l.taxRate,
      lineAmount: totals.lines[i].lineAmount,
      taxAmount: totals.lines[i].taxAmount,
      baseLineId: l.rowType === "item" ? (l.baseLineId ?? null) : null,
    };
  });
  return { rows, totals };
}

/**
 * Locks the source lines a save draws on (so two drafts cannot claim the
 * same quantity at once) and checks they belong to the same partner.
 */
async function lockBaseLines(tx: Tx, lines: LineInput[], partnerId: string) {
  const ids = [...new Set(lines.map((l) => l.baseLineId).filter((id): id is string => Boolean(id)))];
  const map = new Map<string, BaseLine>();
  if (ids.length === 0) return map;

  const rows = await tx
    .select({
      line: documentLines,
      docType: documents.type,
      docNumber: documents.number,
      docPartner: documents.partnerId,
      docSalesOrder: documents.salesOrderId,
      docStatus: documents.status,
    })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(inArray(documentLines.id, ids))
    .for("update", { of: documentLines });

  for (const r of rows) {
    if (r.docPartner !== partnerId) {
      throw new Refusal("Lines can only be drawn from documents for the same business partner.");
    }
    if (r.docStatus === "cancelled") {
      throw new Refusal(`${r.docNumber ?? "The source document"} has been cancelled.`);
    }
    map.set(r.line.id, {
      ...r.line,
      docType: r.docType,
      docNumber: r.docNumber,
      docPartner: r.docPartner,
      docSalesOrder: r.docSalesOrder,
      docStatus: r.docStatus,
    });
  }
  if (map.size !== ids.length) throw new Refusal("A source line no longer exists. Start the copy again.");
  return map;
}

function traceSalesOrder(bases: Map<string, BaseLine>): string | null {
  for (const b of bases.values()) {
    if (b.docType === "sales_order") return b.documentId;
    if (b.docSalesOrder) return b.docSalesOrder;
  }
  return null;
}

/** After the counters are recomputed: nothing may be drawn past what is left. */
async function assertWithinBases(tx: Tx, bases: Map<string, BaseLine>, type: DocType, isReserve: boolean) {
  if (bases.size === 0) return;
  const fresh = await tx
    .select()
    .from(documentLines)
    .where(inArray(documentLines.id, [...bases.keys()]));
  for (const line of fresh) {
    const base = bases.get(line.id)!;
    const counter = copyCounter(base.docType, type, isReserve);
    if (!counter) {
      throw new Refusal(`A ${typeLabel(type).toLowerCase()} can't be drawn from a ${typeLabel(base.docType).toLowerCase()}.`);
    }
    if (toScaled(line[counter]) > toScaled(line.quantity)) {
      const all = await tx
        .select({ id: documentLines.id })
        .from(documentLines)
        .where(eq(documentLines.documentId, line.documentId))
        .orderBy(asc(documentLines.position));
      const n = all.findIndex((l) => l.id === line.id) + 1;
      // What was left before this save claimed some of it.
      const mine = await tx
        .select({ q: sql<string>`coalesce(sum(${documentLines.quantity}), 0)` })
        .from(documentLines)
        .where(eq(documentLines.baseLineId, line.id));
      const left = num(line.quantity) - (num(line[counter]) - num(mine[0]?.q ?? 0));
      throw new Refusal(
        `Only ${formatQty(Math.max(0, left))} left to ${verbFor(counter)} on ${base.docNumber ?? "the source"} line ${n}.`,
      );
    }
  }
}

function verbFor(counter: Counter) {
  return counter === "qtyConverted"
    ? "convert"
    : counter === "qtyInvoiced"
      ? "invoice"
      : counter === "qtyDelivered"
        ? "deliver"
        : counter === "qtyReceived"
          ? "receive"
          : "bill";
}

function largestCounter(line: DocumentLine): number {
  return Math.max(
    num(line.qtyConverted),
    num(line.qtyInvoiced),
    num(line.qtyDelivered),
    num(line.qtyOrdered),
    num(line.qtyReceived),
    num(line.qtyBilled),
  );
}

/** Line ids among `lineIds` that have live children drawn from them. */
async function childrenOf(tx: Tx, lineIds: string[]): Promise<Set<string>> {
  if (lineIds.length === 0) return new Set();
  const rows = await tx
    .select({ baseLineId: documentLines.baseLineId })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(inArray(documentLines.baseLineId, lineIds), ne(documents.status, "cancelled")));
  return new Set(rows.map((r) => r.baseLineId!));
}

/** Live documents drawn from this one, for "Cancel GR-00009 first". */
async function liveChildren(documentId: string) {
  const db = getDb();
  const own = await db
    .select({ id: documentLines.id })
    .from(documentLines)
    .where(eq(documentLines.documentId, documentId));
  if (own.length === 0) return [];
  return db
    .selectDistinct({ id: documents.id, type: documents.type, number: documents.number, isReserve: documents.isReserve })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(
      and(
        inArray(documentLines.baseLineId, own.map((l) => l.id)),
        ne(documents.status, "cancelled"),
      ),
    );
}

/* ── status changes ──────────────────────────────────────────────── */

/** Approve a draft invoice: AUTHORISED in Xero, lines locked, goods delivered. */
export async function approveDocument(id: string): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    const doc = await loadDoc(id);
    if (doc.type !== "invoice") return fail("Only invoices are approved here.");
    if (doc.status !== "draft") return fail(`${label(doc)} is already approved.`);

    const saved = await withTransaction(async (tx) => {
      const [row] = await tx
        .update(documents)
        .set({
          status: "open",
          issuedAt: new Date(),
          version: sql`${documents.version} + 1`,
          xeroSyncState: doc.xeroId ? "stale" : "pending",
          updatedAt: new Date(),
        })
        .where(and(eq(documents.id, id), eq(documents.status, "draft")))
        .returning();
      if (!row) throw new Refusal("Someone else changed this invoice. Reload to see the latest.");
      // A normal invoice delivers its stock lines when it is posted (§5.3).
      // Phase B adds allocation consumption and the shortfall warning here.
      await recomputeCounters(tx, await baseLinesOf(tx, [id]));
      return row;
    });

    if (saved.isReserve) {
      const [order] = saved.salesOrderId
        ? await getDb().select({ number: documents.number }).from(documents).where(eq(documents.id, saved.salesOrderId))
        : [];
      await queueHistoryNote(
        id,
        `Reserve invoice: goods to follow. Delivery tracked in The Gangway${order?.number ? ` (${order.number})` : ""}.`,
      );
    }
    await record(saved, "document_approved", `Approved ${label(saved)}`);
    const outcome = saved.xeroId ? (pushLater(id), null) : await pushNow(id);
    revalidateDoc(saved);
    return {
      ok: true,
      message:
        outcome && outcome.state !== "synced"
          ? `Approved. Not in Xero yet: ${outcome.message ?? "it will be retried."}`
          : "Approved. Send it from Xero.",
    };
  });
}

/** Mark a quote accepted or declined (usually this arrives from Xero instead). */
export async function setQuoteOutcome(id: string, outcome: "accepted" | "declined"): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    const doc = await loadDoc(id);
    if (doc.type !== "quote") return fail("Only quotes are accepted or declined.");
    if (doc.status === "cancelled") return fail("That quote was deleted.");

    const [saved] = await getDb()
      .update(documents)
      .set(
        outcome === "accepted"
          ? { quoteOutcome: "accepted", status: doc.status === "closed" ? "closed" : "open", issuedAt: doc.issuedAt ?? new Date() }
          : { quoteOutcome: "declined", status: "closed", closedAt: new Date(), closedBy: "person" },
      )
      .where(eq(documents.id, id))
      .returning();
    await getDb()
      .update(documents)
      .set({ xeroSyncState: saved.xeroId ? "stale" : "pending", version: sql`${documents.version} + 1` })
      .where(eq(documents.id, id));
    pushLater(id);
    await record(saved, `quote_${outcome}`, `Marked ${label(saved)} ${outcome}`);
    revalidateDoc(saved);
    return { ok: true, message: outcome === "accepted" ? "Marked accepted." : "Marked declined." };
  });
}

/** Confirm a draft sales order. */
export async function confirmOrder(id: string): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    const doc = await loadDoc(id);
    if (doc.type !== "sales_order") return fail("Only sales orders are confirmed.");
    if (doc.status !== "draft") return fail(`${label(doc)} is already confirmed.`);
    const saved = await withTransaction(async (tx) => {
      const [row] = await tx
        .update(documents)
        .set({ status: "open", issuedAt: new Date(), version: sql`${documents.version} + 1` })
        .where(eq(documents.id, id))
        .returning();
      const own = await tx.select({ id: documentLines.id }).from(documentLines).where(eq(documentLines.documentId, id));
      await recomputeCounters(tx, own.map((l) => l.id));
      return row;
    });
    await record(saved, "document_confirmed", `Confirmed ${label(saved)}`);
    revalidateDoc(saved);
    return { ok: true, message: "Order confirmed." };
  });
}

/**
 * Delete a draft with nothing drawn from it. A Xero-type draft that is
 * already in Xero is cancelled instead (keeping its number) and deleted in
 * Xero; one that never reached Xero simply goes.
 */
export async function deleteDocument(id: string): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    const doc = await loadDoc(id);
    if (doc.status !== "draft") return fail("Only drafts can be deleted. Cancel it instead.");
    const children = await liveChildren(id);
    if (children.length) return fail(`Delete ${label(children[0])} first.`);

    if (doc.xeroId) {
      await withTransaction(async (tx) => {
        await tx
          .update(documents)
          .set({
            status: "cancelled",
            cancelledAt: new Date(),
            cancelReason: "Deleted",
            xeroSyncState: "stale",
            version: sql`${documents.version} + 1`,
          })
          .where(eq(documents.id, id));
        await recomputeCounters(tx, await baseLinesOf(tx, [id]));
      });
      pushLater(id);
    } else {
      await withTransaction(async (tx) => {
        const bases = await baseLinesOf(tx, [id]);
        await tx.delete(documents).where(eq(documents.id, id));
        await recomputeCounters(tx, bases);
      });
    }
    await record(doc, "document_deleted", `Deleted ${label(doc)}`);
    revalidateDoc(doc);
    return { ok: true, message: "Deleted.", data: { href: DOC_TYPES[doc.type].base } };
  });
}

/** Close an open quote or sales order by hand. Xero is not changed. */
export async function closeDocument(id: string): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    const doc = await loadDoc(id);
    if (!["quote", "sales_order"].includes(doc.type)) return fail("That document closes by itself.");
    if (doc.status !== "open" && doc.status !== "draft") return fail(`${label(doc)} is ${doc.status}.`);
    const [saved] = await getDb()
      .update(documents)
      .set({
        status: "closed",
        closedAt: new Date(),
        closedBy: "person",
        // A quote closed by hand without an answer has lapsed.
        ...(doc.type === "quote" && !doc.quoteOutcome ? { quoteOutcome: "expired" as const } : {}),
        version: sql`${documents.version} + 1`,
      })
      .where(eq(documents.id, id))
      .returning();
    if (saved.type === "quote" && saved.xeroId) {
      await queueHistoryNote(id, "Closed in The Gangway; nothing more will be converted from it.");
      notesLater(id);
    }
    await record(saved, "document_closed", `Closed ${label(saved)}`);
    revalidateDoc(saved);
    return { ok: true, message: "Closed." };
  });
}

export async function reopenDocument(id: string): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    const doc = await loadDoc(id);
    if (doc.status !== "closed" || doc.closedBy !== "person") {
      return fail("Only a document closed by hand can be reopened.");
    }
    const [saved] = await getDb()
      .update(documents)
      .set({
        status: "open",
        closedAt: null,
        closedBy: null,
        ...(doc.type === "quote" && doc.quoteOutcome === "expired" ? { quoteOutcome: null } : {}),
        version: sql`${documents.version} + 1`,
      })
      .where(eq(documents.id, id))
      .returning();
    await record(saved, "document_reopened", `Reopened ${label(saved)}`);
    revalidateDoc(saved);
    return { ok: true, message: "Reopened." };
  });
}

/**
 * Cancel (void) a live document. Refused while anything drawn from it is
 * live, and for an invoice while it has payments — those are removed in Xero
 * first (EduCom's rule).
 */
export async function cancelDocument(id: string, reason?: string): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireMember();
    const doc = await loadDoc(id);
    if (doc.status === "cancelled") return fail("Already cancelled.");
    if (doc.status === "closed" && doc.type !== "invoice") return fail(`${label(doc)} is closed. Reopen it first.`);
    if (doc.status === "draft") return fail("Drafts are deleted rather than cancelled.");
    if (doc.type === "invoice" && toScaled(doc.amountPaid, 2) > BigInt(0)) {
      return fail(`${label(doc)} has payments applied. Remove them in Xero first.`);
    }
    const children = await liveChildren(id);
    if (children.length) return fail(`Cancel ${label(children[0])} first.`);

    const saved = await withTransaction(async (tx) => {
      const [row] = await tx
        .update(documents)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledById: user.id,
          cancelReason: reason?.trim() || null,
          version: sql`${documents.version} + 1`,
          xeroSyncState: !isXeroType(doc.type) ? "local_only" : doc.xeroId ? "stale" : "local_only",
        })
        .where(eq(documents.id, id))
        .returning();
      await recomputeCounters(tx, await baseLinesOf(tx, [id]));
      return row;
    });

    if (saved.xeroId) pushLater(id);
    // Quotes it drew from reopen; let Xero hear about any that changed.
    await record(saved, "document_cancelled", `Cancelled ${label(saved)}${reason ? `: ${reason}` : ""}`);
    revalidateDoc(saved);
    return {
      ok: true,
      message: doc.type === "invoice" ? "Voided here, and in Xero shortly." : "Cancelled.",
    };
  });
}

/** Same-type copy, no links, full quantities, as a new draft. */
export async function duplicateDocument(id: string): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireMember();
    const doc = await loadDoc(id);
    if (!DOC_TYPES[doc.type].available) return fail("That kind of document can't be duplicated yet.");

    const copy = await withTransaction(async (tx) => {
      const lines = await tx
        .select()
        .from(documentLines)
        .where(eq(documentLines.documentId, id))
        .orderBy(asc(documentLines.position));
      const number = LOCAL_SERIES[doc.type] ? await allocateNumber(tx, LOCAL_SERIES[doc.type]!) : null;
      const [row] = await tx
        .insert(documents)
        .values({
          type: doc.type,
          number,
          status: "draft",
          isReserve: doc.isReserve,
          partnerId: doc.partnerId,
          partnerName: doc.partnerName,
          contactId: doc.contactId,
          contactName: doc.contactName,
          contactEmail: doc.contactEmail,
          reference: doc.reference,
          docDate: new Date().toISOString().slice(0, 10),
          dueDate: doc.dueDate,
          termsDays: doc.termsDays,
          shipToText: doc.shipToText,
          ownerId: doc.ownerId,
          projectId: doc.projectId,
          amountsAre: doc.amountsAre,
          title: doc.title,
          summary: doc.summary,
          terms: doc.terms,
          remarks: doc.remarks,
          subtotal: doc.subtotal,
          taxTotal: doc.taxTotal,
          total: doc.total,
          xeroSyncState: isXeroType(doc.type) ? "pending" : "local_only",
          createdById: user.id,
        })
        .returning();
      if (lines.length) {
        await tx.insert(documentLines).values(
          lines.map((l) => ({
            documentId: row.id,
            position: l.position,
            rowType: l.rowType,
            itemId: l.itemId,
            itemCode: l.itemCode,
            unit: l.unit,
            tracksStock: l.tracksStock,
            description: l.description,
            note: l.note,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent,
            accountCode: l.accountCode,
            taxType: l.taxType,
            taxRate: l.taxRate,
            lineAmount: l.lineAmount,
            taxAmount: l.taxAmount,
          })),
        );
      }
      return row;
    });

    await record(copy, "document_created", `Duplicated ${label(doc)} as a new draft`);
    if (isXeroType(copy.type)) await pushNow(copy.id);
    revalidateDoc(copy);
    return { ok: true, message: "Duplicated.", data: { id: copy.id, href: docHref(copy) } };
  });
}

/* ── the Xero panel ──────────────────────────────────────────────── */

/** Push again now. Clears a failure so it is tried at once. */
export async function retryXeroPush(id: string): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    const doc = await loadDoc(id);
    if (!isXeroType(doc.type)) return fail("This document stays in The Gangway; it never goes to Xero.");
    if (doc.xeroSyncState === "synced") return { ok: true, message: "Already up to date in Xero." };
    await getDb()
      .update(documents)
      .set({ xeroSyncState: doc.xeroSyncState === "pushing" ? "pushing" : doc.xeroId ? "stale" : "pending" })
      .where(eq(documents.id, id));
    const outcome = await pushDocument(id, { timeoutMs: 8_000 });
    revalidateDoc(doc);
    return outcome.state === "synced"
      ? { ok: true, message: "Up to date in Xero." }
      : fail(outcome.message ?? "Xero did not take it. Try again shortly.");
  });
}

/** Re-read one document (or every live one) from Xero. */
export async function refreshFromXero(id?: string): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    try {
      if (id) {
        const doc = await loadDoc(id);
        if (!doc.xeroId) return fail("It isn't in Xero yet.");
        await pullDocuments({ ids: [id] });
        await flushHistoryNotes(id).catch(() => undefined);
        revalidateDoc(doc);
      } else {
        await pullDocuments({});
        revalidatePath("/sales", "layout");
      }
      return { ok: true, message: "Refreshed from Xero." };
    } catch (error) {
      if (error instanceof XeroAuthError || error instanceof XeroApiError) return fail(error.message);
      throw error;
    }
  });
}

/** Create the partner in Xero from a blocked document, then push it. */
export async function createXeroContactForDocument(id: string): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    const doc = await loadDoc(id);
    try {
      const result = await createXeroContactFor(doc.partnerId);
      if (!result.ok) return fail(result.message);
      await logActivity({
        entityType: "customer",
        entityId: doc.partnerId,
        customerId: doc.partnerId,
        verb: "xero_linked",
        summary: `Created ${result.name} in Xero and linked it`,
      });
      // Everything that was waiting on the link can go now.
      await getDb()
        .update(documents)
        .set({ xeroSyncState: "pending" })
        .where(and(eq(documents.partnerId, doc.partnerId), eq(documents.xeroSyncState, "blocked")));
      const outcome = await pushDocument(id, { timeoutMs: 8_000 });
      revalidateDoc(doc);
      return outcome.state === "synced"
        ? { ok: true, message: `Created ${result.name} in Xero, and sent this across.` }
        : { ok: true, message: `Created ${result.name} in Xero. ${outcome.message ?? ""}`.trim() };
    } catch (error) {
      if (error instanceof XeroAuthError || error instanceof XeroApiError) return fail(error.message);
      throw error;
    }
  });
}

/** Re-queue blocked documents for a partner after it is linked to Xero. */
export async function requeuePartnerDocuments(partnerId: string): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    await assertCustomer(partnerId);
    const rows = await getDb()
      .update(documents)
      .set({ xeroSyncState: "pending" })
      .where(and(eq(documents.partnerId, partnerId), eq(documents.xeroSyncState, "blocked")))
      .returning({ id: documents.id });
    for (const { id } of rows) pushLater(id);
    return { ok: true, message: rows.length ? `Sending ${rows.length} to Xero.` : "Nothing was waiting." };
  });
}

/** Fetch Xero's PDF and file it in the partner's (or project's) SharePoint folder. */
export async function saveXeroPdfToSharePoint(id: string): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireMember();
    const doc = await loadDoc(id);
    const resource = DOC_TYPES[doc.type].xero;
    if (!resource || !doc.xeroId) return fail("It isn't in Xero yet, so there is no PDF to save.");

    const db = getDb();
    const [project] = doc.projectId
      ? await db.select().from(projects).where(eq(projects.id, doc.projectId))
      : [];
    const [partner] = await db.select().from(customers).where(eq(customers.id, doc.partnerId));
    const folder = project?.spDriveId && project.spItemId ? project : partner;
    if (!folder?.spDriveId || !folder.spItemId) {
      return fail(`${partner?.name ?? "This partner"} has no SharePoint folder yet. Connect one on their record.`);
    }

    try {
      const pdf = await xeroPdf(resource, doc.xeroId);
      const name = safeFolderName(`${typeLabel(doc.type, doc.isReserve)} ${doc.number ?? doc.id.slice(0, 8)} - ${doc.partnerName}.pdf`);
      const token = await getGraphToken();
      const uploaded = await uploadFile(
        token,
        folder.spDriveId,
        folder.spItemId,
        new File([pdf], name, { type: "application/pdf" }),
      );
      await db
        .insert(pinnedFiles)
        .values({
          customerId: project ? null : doc.partnerId,
          projectId: project ? project.id : null,
          driveId: folder.spDriveId,
          itemId: uploaded.id,
          name: uploaded.name,
          webUrl: uploaded.webUrl,
          mimeType: "application/pdf",
          sizeBytes: uploaded.size ?? null,
          label: label(doc),
          pinnedById: user.id,
        })
        .onConflictDoNothing();
      await record(doc, "document_pdf_saved", `Saved ${label(doc)} PDF to SharePoint`);
      revalidateDoc(doc);
      return { ok: true, message: `Saved ${uploaded.name} to SharePoint.`, data: { href: uploaded.webUrl } };
    } catch (error) {
      if (error instanceof XeroAuthError || error instanceof XeroApiError) return fail(error.message);
      if (error instanceof GraphAuthError) return fail(error.message);
      throw error;
    }
  });
}

/* ── pickers ─────────────────────────────────────────────────────── */

export type PartnerOption = { id: string; name: string; suburb: string | null; linked: boolean };

/** Type-ahead over business partners on one side, within the person's grants. */
export async function searchPartners(term: string, side: "customer" | "supplier"): Promise<PartnerOption[]> {
  await requireMember();
  const access = await getAccess();
  const like = `%${term.trim()}%`;
  const rows = await getDb()
    .select({ id: customers.id, name: customers.name, suburb: customers.suburb, xero: customers.xeroContactId })
    .from(customers)
    .where(
      and(
        side === "customer" ? eq(customers.isCustomer, true) : eq(customers.isSupplier, true),
        sql`${customers.archivedAt} is null`,
        term.trim() ? sql`(${customers.name} ilike ${like} or ${customers.legalName} ilike ${like})` : undefined,
        customerScope(access, customers.id),
      ),
    )
    .orderBy(asc(customers.name))
    .limit(12);
  return rows.map((r) => ({ id: r.id, name: r.name, suburb: r.suburb, linked: Boolean(r.xero) }));
}

/** Contacts, ship-to and terms for a chosen partner. */
export async function loadPartnerDefaults(partnerId: string, side: "customer" | "supplier") {
  await requireMember();
  return partnerDefaults(partnerId, side);
}

/** Type-ahead over items, priced for one side. */
export async function searchItems(term: string, side: "customer" | "supplier"): Promise<PricedItem[]> {
  await requireMember();
  await getAccess();
  const like = `%${term.trim()}%`;
  const rows = await getDb()
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        sql`${items.archivedAt} is null`,
        side === "customer" ? eq(items.isSold, true) : eq(items.isPurchased, true),
        term.trim()
          ? sql`(${items.code} ilike ${like} or ${items.name} ilike ${like} or ${items.description} ilike ${like})`
          : undefined,
      ),
    )
    .orderBy(asc(items.code))
    .limit(12);
  const priced = await priceItems(rows.map((r) => r.id), side);
  return rows.map((r) => priced.get(r.id)!).filter(Boolean);
}
