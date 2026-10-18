import "server-only";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, withTransaction, type Tx } from "@/lib/db";
import { documentLines, documents, shipments, type Document, type DocumentLine } from "@/lib/db/schema";
import { allocateFromReceipt, allocateNumber, recomputeCounters, refreshStockFlags } from "@/lib/actions/documents-core";
import { logActivity } from "@/lib/actions/shared";
import { DOC_TYPES, docHref } from "@/lib/sales/doc-types";
import { formatQty, num, toScaled } from "@/lib/sales/money";
import { computeTotals } from "@/lib/sales/totals";
import { HISTORY } from "@/lib/xero/mapping";
import { queueHistoryNote } from "@/lib/xero/push";
import { notesLater } from "@/lib/xero/queue";
import { formatDate } from "@/lib/utils";

/**
 * Booking goods in (spec §6.4), shared by "Receive" on a PO and by a bill
 * saved with "Goods arrived with this invoice". Server-only and not
 * "use server": callers check the person and the PO first.
 */

export class ReceiptRefusal extends Error {}

/** "1 × MAT-900, 2 × Banner" for history notes. */
export function describe(lines: { quantity: string; itemCode: string | null; description: string }[]) {
  const parts = lines.map((l) => `${formatQty(l.quantity)} × ${l.itemCode ?? (l.description.split("\n")[0] || "item")}`);
  const text = parts.slice(0, 4).join(", ");
  return parts.length > 4 ? `${text} and ${parts.length - 4} more` : text;
}

/** A line copied into a receipt or delivery: the same goods, the counted quantity. */
export function copiedLine(source: DocumentLine, quantity: string, position: number, documentId: string) {
  return {
    documentId,
    position,
    rowType: "item" as const,
    itemId: source.itemId,
    itemCode: source.itemCode,
    unit: source.unit,
    tracksStock: source.tracksStock,
    description: source.description,
    note: source.note,
    quantity,
    unitPrice: source.unitPrice,
    discountPercent: source.discountPercent,
    accountCode: source.accountCode,
    taxType: source.taxType,
    taxRate: source.taxRate,
    baseLineId: source.id,
  };
}

export async function insertCopiedLines(tx: Tx, doc: Document, rows: ReturnType<typeof copiedLine>[]) {
  const totals = computeTotals(rows, doc.amountsAre);
  await tx.insert(documentLines).values(
    rows.map((row, i) => ({ ...row, lineAmount: totals.lines[i].lineAmount, taxAmount: totals.lines[i].taxAmount })),
  );
  await tx
    .update(documents)
    .set({ subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total })
    .where(eq(documents.id, doc.id));
}

async function record(doc: Pick<Document, "id" | "partnerId" | "projectId">, verb: string, summary: string) {
  await logActivity({ entityType: "document", entityId: doc.id, customerId: doc.partnerId, projectId: doc.projectId, verb, summary });
}

function revalidate(...docs: Pick<Document, "id" | "type" | "partnerId">[]) {
  for (const doc of docs) {
    revalidatePath(DOC_TYPES[doc.type].base);
    revalidatePath(docHref(doc));
    revalidatePath(`/customers/${doc.partnerId}`);
  }
  revalidatePath("/sales/items", "layout");
}

/**
 * The receipt itself, shared by "Receive" and a bill entered with "Goods
 * arrived with this invoice". Its own transaction; notes and revalidation
 * after the commit.
 */
export async function createReceipt(input: {
  po: Document;
  receiving: { lineId: string; quantity: string }[];
  docDate: string;
  reference: string | null;
  remarks: string | null;
  userId: string;
  shipmentIds?: string[];
}): Promise<Document> {
  const { po } = input;
  const result = await withTransaction(async (tx) => {
    await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, po.id)).for("update");
    await refreshStockFlags(tx, [po.id]);
    const poLines = await tx.select().from(documentLines).where(eq(documentLines.documentId, po.id));
    const byId = new Map(poLines.map((l) => [l.id, l]));

    for (const c of input.receiving) {
      const line = byId.get(c.lineId);
      if (!line || line.rowType !== "item") throw new ReceiptRefusal("A line no longer exists on this order. Reload and try again.");
      const left = num(line.quantity) - num(line.qtyReceived);
      if (toScaled(c.quantity) > toScaled(String(Math.max(0, left)))) {
        throw new ReceiptRefusal(
          `Only ${formatQty(Math.max(0, left))} left to receive on "${line.description || line.itemCode || "a line"}".`,
        );
      }
    }

    const number = await allocateNumber(tx, "goods_receipt");
    const [receipt] = await tx
      .insert(documents)
      .values({
        type: "goods_receipt",
        number,
        status: "open",
        partnerId: po.partnerId,
        partnerName: po.partnerName,
        reference: input.reference,
        docDate: input.docDate,
        ownerId: input.userId,
        projectId: po.projectId,
        salesOrderId: po.salesOrderId,
        amountsAre: po.amountsAre,
        remarks: input.remarks,
        issuedAt: new Date(),
        xeroSyncState: "local_only",
        createdById: input.userId,
      })
      .returning();
    const rows = input.receiving.map((c, i) => copiedLine(byId.get(c.lineId)!, c.quantity, i, receipt.id));
    await insertCopiedLines(tx, receipt, rows);
    await recomputeCounters(tx, input.receiving.map((c) => c.lineId));
    const demand = await allocateFromReceipt(tx, receipt.id, input.userId);

    if (input.shipmentIds?.length) {
      await tx
        .update(shipments)
        .set({ receiptId: receipt.id })
        .where(and(inArray(shipments.id, input.shipmentIds), eq(shipments.documentId, po.id), isNull(shipments.receiptId)));
    }

    const [after] = await tx.select().from(documents).where(eq(documents.id, po.id));
    return { receipt, rows, demand, fullyReceived: after?.fulfilment === "received" };
  });

  const { receipt, rows, fullyReceived } = result;
  await queueHistoryNote(po.id, HISTORY.received(describe(rows), receipt.number!, formatDate(input.docDate), fullyReceived));
  if (po.xeroId) notesLater(po.id);
  await record(receipt, "goods_received", `Received ${describe(rows)} against ${po.number ?? "a purchase order"}`);
  await record(po, "goods_received", `Received ${describe(rows)} (${receipt.number})`);
  const demandDocs = result.demand.length
    ? await getDb()
        .selectDistinct({ id: documents.id, type: documents.type, partnerId: documents.partnerId })
        .from(documentLines)
        .innerJoin(documents, eq(documents.id, documentLines.documentId))
        .where(inArray(documentLines.id, result.demand))
    : [];
  revalidate(po, receipt, ...demandDocs);
  return receipt;
}


/**
 * After a bill is saved from a PO with "Goods arrived with this invoice"
 * ticked: a receipt for the same lines, as far as each PO line still has
 * anything to receive, docketed with the supplier's invoice number.
 */
export async function receiveWithBill(bill: Document, userId: string): Promise<Document | null> {
  const lines = await getDb()
    .select({ baseLineId: documentLines.baseLineId, quantity: documentLines.quantity })
    .from(documentLines)
    .where(and(eq(documentLines.documentId, bill.id), eq(documentLines.rowType, "item")));
  const based = lines.filter((l) => l.baseLineId);
  if (based.length === 0) return null;
  const poLines = await getDb()
    .select()
    .from(documentLines)
    .where(inArray(documentLines.id, based.map((l) => l.baseLineId!)));
  const poId = poLines[0]?.documentId;
  if (!poId) return null;
  const [po] = await getDb().select().from(documents).where(eq(documents.id, poId));
  if (!po || po.partnerId !== bill.partnerId || po.status === "cancelled") return null;

  const left = new Map(poLines.map((l) => [l.id, Math.max(0, num(l.quantity) - num(l.qtyReceived))]));
  const receiving = based
    .map((l) => {
      const take = Math.min(num(l.quantity), left.get(l.baseLineId!) ?? 0);
      left.set(l.baseLineId!, (left.get(l.baseLineId!) ?? 0) - take);
      return { lineId: l.baseLineId!, quantity: String(take) };
    })
    .filter((r) => num(r.quantity) > 0);
  if (receiving.length === 0) return null;

  return createReceipt({
    po,
    receiving,
    docDate: bill.docDate,
    reference: bill.supplierInvoiceNumber,
    remarks: `Arrived with bill ${bill.supplierInvoiceNumber ?? ""}`.trim(),
    userId,
  });
}
