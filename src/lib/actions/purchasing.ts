"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, withTransaction } from "@/lib/db";
import {
  customers,
  documentLines,
  documents,
  items,
  settings,
  shipments,
  stockAdjustments,
  stockAllocations,
  type Document,
} from "@/lib/db/schema";
import { ReadOnlyError, requireMember, requireUser } from "@/lib/auth/session";
import { AccessDenied, assertCustomer, documentScope, getAccess } from "@/lib/access";
import { priceItems } from "@/lib/data/items";
import { taxRateMap } from "@/lib/data/xero-cache";
import { availableStock } from "@/lib/data/stock";
import { DOC_TYPES, docHref, documentTitle, typeLabel } from "@/lib/sales/doc-types";
import { carrierLabel, isCarrier, trackingUrl } from "@/lib/sales/carriers";
import { formatQty, num, toScaled } from "@/lib/sales/money";
import { computeTotals } from "@/lib/sales/totals";
import { HISTORY } from "@/lib/xero/mapping";
import { queueHistoryNote } from "@/lib/xero/push";
import { notesLater, pushLater, pushNow } from "@/lib/xero/queue";
import { formatDate, isoDate } from "@/lib/utils";
import { LinkRefusal, linkBillToPurchaseOrder, linkPurchaseOrderToSales } from "@/lib/purchasing/link";
import { createReceipt, copiedLine, describe, insertCopiedLines, ReceiptRefusal } from "@/lib/purchasing/receipts";
import { allocateNumber, recomputeCounters, refreshStockFlags } from "./documents-core";
import { fail, fromZod, logActivity, optionalDate, optionalText, type ActionState } from "./shared";

/**
 * Writes for purchasing and stock (spec §6, §4.5), and the delivery slice of
 * §5.5: raising POs from a sales order, receiving goods, allocating and
 * releasing stock, couriers' shipments, linking documents made in Xero,
 * reserve invoices ("goods to follow") and delivering against them.
 *
 * Same rules as actions/documents.ts: staff only (`requireMember`), the
 * partner asserted, one transaction per write, Xero after the commit, and
 * activity logged without `touchRecords` — paperwork is not a conversation.
 */

class Refusal extends Error {}

async function guarded(run: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof Refusal ||
      error instanceof LinkRefusal ||
      error instanceof ReadOnlyError ||
      error instanceof AccessDenied
    ) {
      return fail(error.message);
    }
    throw error;
  }
}

async function loadDoc(id: string, type?: Document["type"]): Promise<Document> {
  const [doc] = await getDb().select().from(documents).where(eq(documents.id, id));
  if (!doc || (type && doc.type !== type)) throw new Refusal("That document no longer exists.");
  await assertCustomer(doc.partnerId);
  return doc;
}

const label = (doc: Pick<Document, "type" | "number" | "isReserve" | "status">) =>
  doc.number ? `${typeLabel(doc.type, doc.isReserve)} ${doc.number}` : documentTitle(doc);

function revalidate(...docs: (Pick<Document, "id" | "type" | "partnerId"> | null | undefined)[]) {
  for (const doc of docs) {
    if (!doc) continue;
    revalidatePath(DOC_TYPES[doc.type].base);
    revalidatePath(docHref(doc));
    revalidatePath(`/customers/${doc.partnerId}`);
  }
  revalidatePath("/sales/items", "layout");
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

/**
 * A form that makes a document lands back on the page it belongs to, with
 * the outcome as the page's "saved" banner. Redirecting on the server, after
 * the revalidation, means the form page is never re-rendered half-way.
 */
function landOn(result: ActionState): ActionState {
  if (result.ok && result.data?.href) {
    redirect(`${result.data.href}?saved=${encodeURIComponent(result.message ?? "Saved.")}`);
  }
  return result;
}

function parseJson<T>(formData: FormData, key: string, schema: z.ZodType<T>): T | ActionState {
  try {
    const parsed = schema.safeParse(JSON.parse(String(formData.get(key) ?? "[]")));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the lines.");
    return parsed.data;
  } catch {
    return fail("The lines could not be read. Reload and try again.");
  }
}
const isState = (v: unknown): v is ActionState => typeof v === "object" && v !== null && "ok" in v;

const qty = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(/,/g, ""))
  .refine((v) => v === "" || /^\d*(\.\d*)?$/.test(v), "Quantities must be numbers.")
  .transform((v) => (v === "" || v === "." ? "0" : v));

/* ── raise purchase orders from a sales order (§6.2) ─────────────── */

const raiseRow = z.object({
  lineId: z.uuid(),
  quantity: qty,
  unitPrice: qty,
  supplierId: z.uuid("Choose a supplier for every line you are ordering."),
});

const raiseHeader = z.object({
  dueDate: z.iso.date("Set the delivery date."),
  remarks: optionalText,
  deliverToCustomer: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
});

/**
 * One draft PO per supplier for the chosen sales-order lines, in one
 * transaction. Each PO line points at the SO line it is for (`sourceLineId`),
 * which moves the line to "On order". Then each PO is sent to Xero.
 */
export async function raisePurchaseOrders(
  salesOrderId: string,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  return landOn(await guarded(async () => {
    const { user } = await requireMember();
    const order = await loadDoc(salesOrderId, "sales_order");
    if (order.status !== "open") return fail(`Confirm ${label(order)} before ordering stock for it.`);

    const header = raiseHeader.safeParse(Object.fromEntries(formData));
    if (!header.success) return fromZod(header.error);
    const rows = parseJson(formData, "rows", z.array(raiseRow).max(300));
    if (isState(rows)) return rows;
    const chosen = rows.filter((r) => num(r.quantity) > 0);
    if (chosen.length === 0) return fail("Tick at least one line to order.");

    const supplierIds = [...new Set(chosen.map((r) => r.supplierId))];
    if (supplierIds.length > 20) return fail("At most 20 suppliers at a time. Raise the rest in a second go.");
    for (const id of supplierIds) await assertCustomer(id);

    const db = getDb();
    const [suppliers, soLines, [config], rates] = await Promise.all([
      db.select().from(customers).where(inArray(customers.id, supplierIds)),
      db.select().from(documentLines).where(eq(documentLines.documentId, salesOrderId)),
      db.select().from(settings).where(eq(settings.id, "singleton")),
      taxRateMap(),
    ]);
    const byId = new Map(soLines.map((l) => [l.id, l]));
    for (const s of suppliers) {
      if (!s.isSupplier) return fail(`${s.name} isn't marked as a supplier. Tick Supplier on their record first.`);
    }
    for (const r of chosen) {
      const line = byId.get(r.lineId);
      if (!line || line.rowType !== "item") return fail("A line no longer exists on this order. Reload and try again.");
    }
    const priced = await priceItems(
      [...new Set(chosen.map((r) => byId.get(r.lineId)!.itemId).filter((id): id is string => Boolean(id)))],
      "supplier",
    );

    const shipTo = header.data.deliverToCustomer ? order.shipToText : (config?.deliveryAddress ?? null);
    const reference = `${order.number} · ${order.partnerName}`;

    const created = await withTransaction(async (tx) => {
      const out: Document[] = [];
      for (const supplierId of supplierIds) {
        const supplier = suppliers.find((s) => s.id === supplierId)!;
        const mine = chosen.filter((r) => r.supplierId === supplierId);
        const lines = mine.map((r, position) => {
          const so = byId.get(r.lineId)!;
          const item = so.itemId ? priced.get(so.itemId) : undefined;
          const taxType = item?.taxType ?? config?.defaultPurchaseTaxType ?? null;
          return {
            position,
            rowType: "item" as const,
            itemId: so.itemId,
            itemCode: so.itemCode,
            unit: so.unit,
            tracksStock: so.tracksStock,
            description: so.description,
            note: so.note,
            quantity: r.quantity,
            unitPrice: r.unitPrice,
            discountPercent: "0",
            accountCode: item?.accountCode ?? null,
            taxType,
            taxRate: taxType ? (rates.get(taxType) ?? "0") : "0",
            sourceLineId: so.id,
          };
        });
        const totals = computeTotals(lines, "exclusive");
        const [po] = await tx
          .insert(documents)
          .values({
            type: "purchase_order",
            status: "draft",
            partnerId: supplier.id,
            partnerName: supplier.name,
            reference,
            docDate: isoDate(),
            dueDate: header.data.dueDate,
            termsDays: supplier.supplierTermsDays,
            shipToText: shipTo,
            ownerId: user.id,
            projectId: order.projectId,
            salesOrderId: order.id,
            amountsAre: "exclusive",
            remarks: header.data.remarks,
            subtotal: totals.subtotal,
            taxTotal: totals.taxTotal,
            total: totals.total,
            xeroSyncState: "pending",
            createdById: user.id,
          })
          .returning();
        await tx.insert(documentLines).values(
          lines.map((l, i) => ({
            ...l,
            documentId: po.id,
            lineAmount: totals.lines[i].lineAmount,
            taxAmount: totals.lines[i].taxAmount,
          })),
        );
        out.push(po);
      }
      await recomputeCounters(tx, chosen.map((r) => r.lineId));
      return out;
    });

    for (const po of created) {
      await queueHistoryNote(po.id, HISTORY.poRaised(order.number ?? "a sales order", order.partnerName));
      await record(po, "document_created", `Raised a purchase order to ${po.partnerName} for ${order.number}`);
    }
    await record(order, "purchase_orders_raised", `Raised ${created.length} purchase order${created.length === 1 ? "" : "s"}`);
    // One after another, each getting its Xero number as it lands.
    let numbered = 0;
    for (const po of created) {
      const outcome = await pushNow(po.id);
      if (outcome?.state === "synced") numbered += 1;
    }
    revalidate(order, ...created);
    const what = `${created.length} purchase order${created.length === 1 ? "" : "s"}`;
    return {
      ok: true,
      message:
        numbered === created.length
          ? `Raised ${what} as drafts in Xero. Approve and send them from Xero.`
          : `Raised ${what}. ${created.length - numbered} not in Xero yet; they will be retried.`,
      data: { href: created.length === 1 ? docHref(created[0]) : docHref(order) },
    };
  }));
}

/* ── goods receipts (§6.4) ───────────────────────────────────────── */

const receiveHeader = z.object({
  docDate: z.iso.date("Give the receipt a date."),
  reference: optionalText,
  remarks: optionalText,
});
const countRow = z.object({ lineId: z.uuid(), quantity: qty });

/**
 * Books goods in against a PO: a GR- receipt, received counters, and the
 * stock allocated to the sales lines it was ordered for. Shipments ticked as
 * arrived are closed by this receipt. Xero's PO gets a "Received …" note.
 */
export async function receiveGoods(
  purchaseOrderId: string,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  return landOn(await guarded(async () => {
    const { user } = await requireMember();
    const po = await loadDoc(purchaseOrderId, "purchase_order");
    if (po.status === "cancelled") return fail(`${label(po)} has been cancelled.`);
    if (po.status === "draft") return fail(`Approve ${label(po)} before receiving against it.`);

    const header = receiveHeader.safeParse(Object.fromEntries(formData));
    if (!header.success) return fromZod(header.error);
    const counts = parseJson(formData, "lines", z.array(countRow).max(300));
    if (isState(counts)) return counts;
    const receiving = counts.filter((c) => num(c.quantity) > 0);
    if (receiving.length === 0) return fail("Enter what arrived on at least one line.");
    const shipmentIds = formData.getAll("shipmentId").map(String).filter(Boolean);

    const receipt = await createReceipt({
      po,
      receiving,
      docDate: header.data.docDate,
      reference: header.data.reference,
      remarks: header.data.remarks,
      userId: user.id,
      shipmentIds,
    }).catch((error) => {
      if (error instanceof ReceiptRefusal) throw new Refusal(error.message);
      throw error;
    });
    return { ok: true, message: `Received on ${receipt.number}.`, data: { href: docHref(po) } };
  }));
}

/* ── allocation (§4.5) ───────────────────────────────────────────── */

async function demandLine(lineId: string) {
  const [row] = await getDb()
    .select({ line: documentLines, doc: documents })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(eq(documentLines.id, lineId));
  if (!row) throw new Refusal("That line no longer exists.");
  await assertCustomer(row.doc.partnerId);
  const isDemand = row.doc.type === "sales_order" || (row.doc.type === "invoice" && row.doc.isReserve);
  if (!isDemand) throw new Refusal("Stock is allocated to sales-order lines and reserve-invoice lines.");
  if (row.doc.status === "cancelled") throw new Refusal(`${label(row.doc)} has been cancelled.`);
  if (row.doc.type === "sales_order" && row.doc.status !== "open") throw new Refusal(`${label(row.doc)} isn't open.`);
  return row;
}

/** Sets on-hand stock aside for a line, up to what it still needs and what is available. */
export async function allocateStock(lineId: string, quantity: string): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireMember();
    const { line, doc } = await demandLine(lineId);
    if (!line.tracksStock || !line.itemId) return fail("Only stock items are allocated.");
    const amount = qty.safeParse(quantity);
    if (!amount.success || num(amount.data) <= 0) return fail("Enter how many to allocate.");

    await withTransaction(async (tx) => {
      const [fresh] = await tx.select().from(documentLines).where(eq(documentLines.id, lineId)).for("update");
      const need = num(fresh.quantity) - num(fresh.qtyDelivered) - num(fresh.qtyAllocated);
      if (num(amount.data) > need) throw new Refusal(`This line needs only ${formatQty(Math.max(0, need))} more.`);
      // Lock the item's allocations so two people can't take the same stock.
      await tx.execute(sql`select id from items where id = ${line.itemId} for update`);
      const [stock] = (await availableStock(tx, [line.itemId!])).values();
      const available = num(stock?.available);
      if (num(amount.data) > available) {
        throw new Refusal(`Only ${formatQty(Math.max(0, available))} available. The rest is allocated elsewhere or not here yet.`);
      }
      await tx.insert(stockAllocations).values({
        salesOrderLineId: lineId,
        itemId: line.itemId!,
        quantity: amount.data,
        createdById: user.id,
      });
      await recomputeCounters(tx, [lineId]);
    });
    await record(doc, "stock_allocated", `Allocated ${formatQty(amount.data)} × ${line.itemCode ?? line.description} from stock`);
    revalidate(doc);
    return { ok: true, message: "Allocated." };
  });
}

/** Puts an allocation back to available. Whatever of it has already gone out stays. */
export async function releaseAllocation(allocationId: string): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireMember();
    const [allocation] = await getDb().select().from(stockAllocations).where(eq(stockAllocations.id, allocationId));
    if (!allocation || allocation.releasedAt) return fail("That allocation was already released.");
    const { doc, line } = await demandLine(allocation.salesOrderLineId);

    await withTransaction(async (tx) => {
      if (num(allocation.consumed) > 0) {
        // Part of it was delivered: keep that part, release the rest.
        await tx.update(stockAllocations).set({ quantity: allocation.consumed }).where(eq(stockAllocations.id, allocationId));
      } else {
        await tx
          .update(stockAllocations)
          .set({ releasedAt: new Date(), releasedById: user.id })
          .where(eq(stockAllocations.id, allocationId));
      }
      await recomputeCounters(tx, [allocation.salesOrderLineId]);
    });
    await record(doc, "stock_released", `Released ${formatQty(num(allocation.quantity) - num(allocation.consumed))} × ${line.itemCode ?? line.description} back to stock`);
    revalidate(doc);
    return { ok: true, message: "Released back to stock." };
  });
}

/* ── shipments (courier tracking) ────────────────────────────────── */

const shipmentSchema = z.object({
  carrier: z.string().refine(isCarrier, "Choose the courier."),
  trackingNumber: optionalText,
  trackingUrl: optionalText,
  shippedOn: optionalDate,
  eta: optionalDate,
  notes: optionalText,
});

/**
 * Records (or corrects) a supplier's dispatch against a PO. A new shipment
 * adds a note to the Xero PO so anyone there sees it is on its way.
 */
export async function saveShipment(
  purchaseOrderId: string,
  shipmentId: string | null,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireMember();
    const po = await loadDoc(purchaseOrderId, "purchase_order");
    if (po.status === "cancelled") return fail(`${label(po)} has been cancelled.`);

    const parsed = shipmentSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fromZod(parsed.error);
    const s = parsed.data;
    if (s.carrier !== "other" && !s.trackingNumber) {
      return fail("Enter the tracking or consignment number.", { trackingNumber: ["Required"] });
    }
    const url = trackingUrl(s.carrier, s.trackingNumber, s.trackingUrl);
    if (s.carrier === "other" && s.trackingUrl && !url) {
      return fail("The tracking link should start with https://", { trackingUrl: ["Not a web address"] });
    }
    if (s.shippedOn && s.eta && s.eta < s.shippedOn) {
      return fail("The ETA is before the ship date.", { eta: ["Check the date"] });
    }

    const values = {
      carrier: s.carrier,
      trackingNumber: s.trackingNumber?.replace(/\s+/g, "") ?? null,
      trackingUrl: url,
      shippedOn: s.shippedOn,
      eta: s.eta,
      notes: s.notes,
    };
    const db = getDb();
    if (shipmentId) {
      const [row] = await db
        .update(shipments)
        .set(values)
        .where(and(eq(shipments.id, shipmentId), eq(shipments.documentId, po.id)))
        .returning();
      if (!row) return fail("That shipment no longer exists.");
    } else {
      await db.insert(shipments).values({ ...values, documentId: po.id, createdById: user.id });
      const what = [
        carrierLabel(s.carrier),
        values.trackingNumber,
        s.shippedOn ? `sent ${formatDate(s.shippedOn)}` : null,
        s.eta ? `ETA ${formatDate(s.eta)}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      await queueHistoryNote(po.id, HISTORY.shipped(what));
      if (po.xeroId) notesLater(po.id);
    }
    // Worked on here: a re-import refreshes only its status.
    await db.update(documents).set({ updatedAt: new Date() }).where(eq(documents.id, po.id));
    await record(po, "shipment_saved", `${shipmentId ? "Updated" : "Added"} ${carrierLabel(s.carrier)} shipment${values.trackingNumber ? ` ${values.trackingNumber}` : ""}`);
    await revalidateLinked(po);
    return { ok: true, message: shipmentId ? "Shipment updated." : "Shipment added. Xero's PO gets a note." };
  });
}

export async function deleteShipment(shipmentId: string): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    const [row] = await getDb().select().from(shipments).where(eq(shipments.id, shipmentId));
    if (!row) return fail("That shipment was already removed.");
    const po = await loadDoc(row.documentId, "purchase_order");
    await getDb().delete(shipments).where(eq(shipments.id, shipmentId));
    await record(po, "shipment_removed", `Removed ${carrierLabel(row.carrier)} shipment${row.trackingNumber ? ` ${row.trackingNumber}` : ""}`);
    await revalidateLinked(po);
    return { ok: true, message: "Shipment removed." };
  });
}

/** The PO, and the sales documents whose lines it was raised for (they show its tracking). */
async function revalidateLinked(po: Document) {
  const rows = await getDb().execute<{ id: string; type: Document["type"]; partner_id: string }>(sql`
    select distinct d.id, d.type, d.partner_id from document_lines pl
    join document_lines s on s.id = pl.source_line_id
    join documents d on d.id = s.document_id
    where pl.document_id = ${po.id}`);
  revalidate(po, ...rows.rows.map((r) => ({ id: r.id, type: r.type, partnerId: r.partner_id })));
}

/* ── linking what was made in Xero ───────────────────────────────── */

/**
 * Links a PO to the sales order or invoice it was raised for, pairing lines by
 * item, then description. An invoice becomes a reserve invoice: its goods go
 * out on a delivery once received.
 */
export async function linkPurchaseOrder(purchaseOrderId: string, salesId: string): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    const po = await loadDoc(purchaseOrderId, "purchase_order");
    const sales = await loadDoc(salesId);
    const result = await withTransaction((tx) => linkPurchaseOrderToSales(tx, po.id, sales.id));
    if (result.linked === 0) {
      return fail(`None of ${label(po)}'s lines match a line on ${label(sales)}. Check the items are the same.`);
    }
    if (result.madeReserve) {
      await queueHistoryNote(sales.id, HISTORY.goodsToFollow(null));
      if (sales.xeroId) notesLater(sales.id);
      await record(sales, "goods_to_follow", `Marked goods to follow; ordered on ${po.number ?? "a purchase order"}`);
    }
    await record(po, "document_linked", `Linked to ${label(sales)}`);
    revalidate(po, sales);
    return {
      ok: true,
      message: result.madeReserve
        ? `Linked. ${label(sales)} is now a reserve invoice: deliver it once the goods arrive.`
        : `Linked ${result.linked} line${result.linked === 1 ? "" : "s"} to ${label(sales)}.`,
    };
  });
}

/** Removes a PO's links to sales lines. Refused once anything received on it was allocated. */
export async function unlinkPurchaseOrder(purchaseOrderId: string): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    const po = await loadDoc(purchaseOrderId, "purchase_order");
    await withTransaction(async (tx) => {
      const lines = await tx.select().from(documentLines).where(eq(documentLines.documentId, po.id));
      const sources = lines.map((l) => l.sourceLineId).filter((id): id is string => Boolean(id));
      if (sources.length === 0) throw new Refusal("It isn't linked to anything.");
      const [held] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from stock_allocations a
        join document_lines r on r.id = a.receipt_line_id
        join document_lines pl on pl.id = r.base_line_id
        where pl.document_id = ${po.id} and a.released_at is null`).then((r) => r.rows);
      if (held && held.n > 0) throw new Refusal("Stock received on this order is allocated. Release it first.");
      await tx.update(documentLines).set({ sourceLineId: null }).where(eq(documentLines.documentId, po.id));
      await tx.update(documents).set({ updatedAt: new Date() }).where(eq(documents.id, po.id));
      await recomputeCounters(tx, sources);
    });
    await record(po, "document_unlinked", "Unlinked from its sales document");
    await revalidateLinked(po);
    revalidate(po);
    return { ok: true, message: "Unlinked." };
  });
}

/** Enters a bill (often imported) against a PO, pairing lines by item, then description. */
export async function linkBill(billId: string, purchaseOrderId: string): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    const bill = await loadDoc(billId, "bill");
    const po = await loadDoc(purchaseOrderId, "purchase_order");
    const { linked } = await withTransaction((tx) => linkBillToPurchaseOrder(tx, bill.id, po.id));
    if (linked === 0) return fail(`None of the bill's lines match a line on ${label(po)} with quantity left to bill.`);
    await record(bill, "document_linked", `Entered against ${label(po)}`);
    await record(po, "document_linked", `Bill ${bill.supplierInvoiceNumber ?? bill.number ?? ""} entered against it`.replace("  ", " "));
    // Fully billed here: Xero's PO moves to BILLED.
    const [after] = await getDb().select().from(documents).where(eq(documents.id, po.id));
    if (after?.xeroId && after.xeroStatus !== "BILLED") {
      await getDb().update(documents).set({ xeroSyncState: "stale" }).where(and(eq(documents.id, po.id), ne(documents.xeroSyncState, "local_only")));
      pushLater(po.id);
    }
    revalidate(bill, po);
    return { ok: true, message: `Entered against ${label(po)}.` };
  });
}

/* ── reserve invoices and deliveries (§5.4, §5.5) ────────────────── */

/**
 * "Goods to follow": the customer is invoiced now and the stock goes out
 * later, on a delivery. Turning it off again is allowed while nothing has
 * been delivered against it and nothing is on order or allocated for it.
 */
export async function setGoodsToFollow(invoiceId: string, on: boolean): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    const invoice = await loadDoc(invoiceId, "invoice");
    if (invoice.status === "cancelled") return fail(`${label(invoice)} has been voided.`);
    if (invoice.isReserve === on) return { ok: true, message: on ? "Already goods to follow." : "Already a normal invoice." };

    await withTransaction(async (tx) => {
      await refreshStockFlags(tx, [invoice.id]);
      const lines = await tx.select().from(documentLines).where(eq(documentLines.documentId, invoice.id));
      if (on && !lines.some((l) => l.rowType === "item" && l.tracksStock)) {
        throw new Refusal(`None of its lines is physical goods. Tick "Physical goods" on the item first, then try again.`);
      }
      if (!on) {
        if (lines.some((l) => num(l.qtyDelivered) > 0)) throw new Refusal("Goods have been delivered against it. Cancel the delivery first.");
        if (lines.some((l) => num(l.qtyOrdered) > 0 || num(l.qtyAllocated) > 0)) {
          throw new Refusal("Stock is on order or allocated for it. Unlink the purchase order or release the stock first.");
        }
      }
      await tx
        .update(documents)
        .set({ isReserve: on, updatedAt: new Date(), version: sql`${documents.version} + 1` })
        .where(eq(documents.id, invoice.id));
      await recomputeCounters(tx, lines.map((l) => l.id));
    });

    if (on) {
      const [order] = invoice.salesOrderId
        ? await getDb().select({ number: documents.number }).from(documents).where(eq(documents.id, invoice.salesOrderId))
        : [];
      await queueHistoryNote(invoice.id, HISTORY.goodsToFollow(order?.number ?? null));
      if (invoice.xeroId) notesLater(invoice.id);
    }
    await record(invoice, on ? "goods_to_follow" : "goods_with_invoice", on ? "Marked goods to follow" : "Marked goods delivered with the invoice");
    revalidate(invoice);
    return { ok: true, message: on ? "Goods to follow: deliver them from here once they arrive." : "Back to a normal invoice." };
  });
}

const deliverHeader = z.object({ docDate: z.iso.date("Give the delivery a date."), remarks: optionalText, reference: optionalText });

/**
 * A DN- delivery against a reserve invoice (§5.5): the goods go out, the
 * allocations they came from are consumed, and the invoice moves towards
 * Delivered. Xero's invoice gets a note.
 */
export async function deliverGoods(
  invoiceId: string,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  return landOn(await guarded(async () => {
    const { user } = await requireMember();
    const invoice = await loadDoc(invoiceId, "invoice");
    if (!invoice.isReserve) return fail("Only a reserve invoice (goods to follow) is delivered separately.");
    if (invoice.status === "cancelled") return fail(`${label(invoice)} has been voided.`);
    if (invoice.status === "draft") return fail(`Approve ${label(invoice)} before delivering against it.`);

    const header = deliverHeader.safeParse(Object.fromEntries(formData));
    if (!header.success) return fromZod(header.error);
    const counts = parseJson(formData, "lines", z.array(countRow).max(300));
    if (isState(counts)) return counts;
    const going = counts.filter((c) => num(c.quantity) > 0);
    if (going.length === 0) return fail("Enter what is going out on at least one line.");

    const result = await withTransaction(async (tx) => {
      await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, invoice.id)).for("update");
      const lines = await tx.select().from(documentLines).where(eq(documentLines.documentId, invoice.id));
      const byId = new Map(lines.map((l) => [l.id, l]));
      for (const c of going) {
        const line = byId.get(c.lineId);
        if (!line || line.rowType !== "item" || !line.tracksStock) throw new Refusal("A line can't be delivered. Reload and try again.");
        const left = num(line.quantity) - num(line.qtyDelivered);
        if (toScaled(c.quantity) > toScaled(String(Math.max(0, left)))) {
          throw new Refusal(`Only ${formatQty(Math.max(0, left))} left to deliver on "${line.description || line.itemCode}".`);
        }
      }
      const number = await allocateNumber(tx, "delivery");
      const [delivery] = await tx
        .insert(documents)
        .values({
          type: "delivery",
          number,
          status: "open",
          partnerId: invoice.partnerId,
          partnerName: invoice.partnerName,
          contactId: invoice.contactId,
          contactName: invoice.contactName,
          contactEmail: invoice.contactEmail,
          reference: header.data.reference,
          docDate: header.data.docDate,
          shipToText: invoice.shipToText,
          ownerId: user.id,
          projectId: invoice.projectId,
          salesOrderId: invoice.salesOrderId,
          amountsAre: invoice.amountsAre,
          remarks: header.data.remarks,
          issuedAt: new Date(),
          xeroSyncState: "local_only",
          createdById: user.id,
        })
        .returning();
      const rows = going.map((c, i) => copiedLine(byId.get(c.lineId)!, c.quantity, i, delivery.id));
      await insertCopiedLines(tx, delivery, rows);
      await recomputeCounters(tx, going.map((c) => c.lineId));
      const [after] = await tx.select({ fulfilment: documents.fulfilment }).from(documents).where(eq(documents.id, invoice.id));
      return { delivery, rows, full: after?.fulfilment === "delivered" };
    });

    const { delivery, rows, full } = result;
    await queueHistoryNote(invoice.id, HISTORY.delivered(describe(rows), delivery.number!, formatDate(header.data.docDate), full));
    if (invoice.xeroId) notesLater(invoice.id);
    await record(delivery, "goods_delivered", `Delivered ${describe(rows)} against ${invoice.number ?? "a reserve invoice"}`);
    await record(invoice, "goods_delivered", `Delivered ${describe(rows)} (${delivery.number})`);
    revalidate(invoice, delivery);
    return { ok: true, message: `Delivered on ${delivery.number}.`, data: { href: docHref(invoice) } };
  }));
}

/* ── stock adjustments (admin) ───────────────────────────────────── */

const adjustment = z.object({
  quantity: z
    .string()
    .trim()
    .refine((v) => /^-?\d+(\.\d+)?$/.test(v) && Number(v) !== 0, "Enter a quantity: positive to add, negative to take away."),
  reason: z.string().trim().min(3, "Say why — a stocktake, a breakage.").max(200),
});

/** A stocktake or breakage correction. Admin only. */
export async function adjustStock(itemId: string, _prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireUser();
    if (user.role !== "admin") return fail("Only an admin can correct stock.");
    const parsed = adjustment.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fromZod(parsed.error);
    const [item] = await getDb().select().from(items).where(eq(items.id, itemId));
    if (!item) return fail("That item no longer exists.");
    if (!item.tracksStock) return fail(`${item.code} isn't marked as physical goods.`);
    await getDb()
      .insert(stockAdjustments)
      .values({ itemId, quantity: parsed.data.quantity, reason: parsed.data.reason, createdById: user.id });
    await logActivity({
      entityType: "item",
      entityId: itemId,
      verb: "stock_adjusted",
      summary: `Adjusted ${item.code} by ${parsed.data.quantity}: ${parsed.data.reason}`,
    });
    revalidatePath(`/sales/items/${itemId}`);
    revalidatePath("/sales/items");
    return { ok: true, message: "Stock corrected." };
  });
}

/* ── pickers for the link panels ─────────────────────────────────── */

export type LinkOption = { id: string; type: Document["type"]; number: string | null; partnerName: string; docDate: string; total: string; isReserve: boolean };

/**
 * Sales orders and invoices a PO could have been raised for: open orders and
 * live invoices, newest first, matching the typed number or customer. Within
 * the person's grants.
 */
export async function searchSalesForLink(term: string): Promise<LinkOption[]> {
  await requireMember();
  const access = await getAccess();
  const like = `%${term.trim()}%`;
  return getDb()
    .select({
      id: documents.id,
      type: documents.type,
      number: documents.number,
      partnerName: documents.partnerName,
      docDate: documents.docDate,
      total: documents.total,
      isReserve: documents.isReserve,
    })
    .from(documents)
    .where(
      and(
        sql`(${documents.type} = 'sales_order' and ${documents.status} = 'open'
          or ${documents.type} = 'invoice' and ${documents.status} in ('open','closed'))`,
        term.trim() ? sql`(${documents.number} ilike ${like} or ${documents.partnerName} ilike ${like})` : undefined,
        documentScope(access),
      ),
    )
    .orderBy(sql`${documents.docDate} desc`)
    .limit(12);
}
