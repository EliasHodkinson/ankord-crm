import "server-only";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { documentLines, documents } from "@/lib/db/schema";
import { recomputeCounters, refreshStockFlags } from "@/lib/actions/documents-core";
import { matchLines, numbersIn } from "@/lib/sales/purchasing";

/**
 * Joining documents that were made apart — usually in Xero, before they were
 * imported — so the counters see them as one job:
 *
 * - a **bill** entered against a **PO** (its lines' `baseLineId` → PO lines),
 *   which moves the PO's `billed`;
 * - a **PO** raised for a **sales order or invoice** (its lines'
 *   `sourceLineId` → the sales lines), which moves their `ordered`, and lets
 *   the goods received on it be allocated to them.
 *
 * Server-only and not "use server": the actions and the import call these
 * inside their transactions, after their own access checks.
 */

export class LinkRefusal extends Error {}

type Line = typeof documentLines.$inferSelect;

async function itemLines(tx: Tx, documentId: string): Promise<Line[]> {
  return tx
    .select()
    .from(documentLines)
    .where(and(eq(documentLines.documentId, documentId), eq(documentLines.rowType, "item")))
    .orderBy(asc(documentLines.position));
}

/** Marks a document as worked on here, so a re-import refreshes only its status and money. */
async function touch(tx: Tx, documentId: string) {
  await tx
    .update(documents)
    .set({ updatedAt: new Date(), version: sql`${documents.version} + 1` })
    .where(eq(documents.id, documentId));
}

/**
 * Enters a bill against a PO: each bill line is based on a PO line, by the
 * given pairs or, when none are given, matched by item, then description,
 * then order. Lines left unpaired stay unlinked (freight, say).
 */
export async function linkBillToPurchaseOrder(
  tx: Tx,
  billId: string,
  poId: string,
  pairs?: Map<string, string | null>,
): Promise<{ linked: number }> {
  const [[bill], [po]] = await Promise.all([
    tx.select().from(documents).where(eq(documents.id, billId)).for("update"),
    tx.select().from(documents).where(eq(documents.id, poId)).for("update"),
  ]);
  if (!bill || bill.type !== "bill") throw new LinkRefusal("That bill no longer exists.");
  if (!po || po.type !== "purchase_order") throw new LinkRefusal("That purchase order no longer exists.");
  if (po.partnerId !== bill.partnerId) throw new LinkRefusal("A bill can only be entered against the same supplier's purchase order.");
  if (po.status === "cancelled") throw new LinkRefusal(`${po.number ?? "That purchase order"} has been cancelled.`);

  const [billLines, poLines] = await Promise.all([itemLines(tx, billId), itemLines(tx, poId)]);
  const map = pairs ?? matchLines(billLines, poLines);
  const poIds = new Set(poLines.map((l) => l.id));
  const before = billLines.map((l) => l.baseLineId);

  let linked = 0;
  for (const line of billLines) {
    const target = map.get(line.id) ?? null;
    if (target && !poIds.has(target)) throw new LinkRefusal("A line was matched to a line of a different purchase order.");
    if ((line.baseLineId ?? null) === target) {
      if (target) linked += 1;
      continue;
    }
    await tx.update(documentLines).set({ baseLineId: target }).where(eq(documentLines.id, line.id));
    if (target) linked += 1;
  }
  await tx
    .update(documents)
    .set({ salesOrderId: po.salesOrderId ?? bill.salesOrderId })
    .where(eq(documents.id, billId));
  await touch(tx, billId);
  await recomputeCounters(tx, [...before, ...map.values()]);
  return { linked };
}

/**
 * At import: a bill whose Reference names exactly one live PO of the same
 * supplier is entered against it. Anything less certain is left for a person
 * to link from the bill's page.
 */
export async function linkBillByReference(tx: Tx, billId: string): Promise<boolean> {
  const [bill] = await tx.select().from(documents).where(eq(documents.id, billId));
  if (!bill) return false;
  const numbers = numbersIn(bill.reference);
  if (numbers.length === 0) return false;
  const pos = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.type, "purchase_order"),
        eq(documents.partnerId, bill.partnerId),
        ne(documents.status, "cancelled"),
        inArray(sql`upper(${documents.number})`, numbers),
      ),
    );
  if (pos.length !== 1) return false;
  const { linked } = await linkBillToPurchaseOrder(tx, billId, pos[0].id);
  return linked > 0;
}

/**
 * Links a PO's lines to the sales lines they were bought for: lines of one
 * confirmed sales order, or of one invoice. An invoice that is not yet a
 * reserve invoice becomes one ("goods to follow") — the customer was billed,
 * and the goods go out on a delivery once they are here. Refused if any of
 * that invoice's goods have already gone out on a delivery.
 */
export async function linkPurchaseOrderToSales(
  tx: Tx,
  poId: string,
  salesId: string,
  pairs?: Map<string, string | null>,
): Promise<{ linked: number; madeReserve: boolean; sales: typeof documents.$inferSelect }> {
  const [[po], [sales]] = await Promise.all([
    tx.select().from(documents).where(eq(documents.id, poId)).for("update"),
    tx.select().from(documents).where(eq(documents.id, salesId)).for("update"),
  ]);
  if (!po || po.type !== "purchase_order") throw new LinkRefusal("That purchase order no longer exists.");
  if (po.status === "cancelled") throw new LinkRefusal(`${po.number ?? "That purchase order"} has been cancelled.`);
  if (!sales || (sales.type !== "sales_order" && sales.type !== "invoice")) {
    throw new LinkRefusal("A purchase order is linked to a sales order or an invoice.");
  }
  if (sales.status === "cancelled") throw new LinkRefusal(`${sales.number ?? "That document"} has been cancelled.`);
  if (sales.type === "sales_order" && sales.status !== "open") {
    throw new LinkRefusal(`Confirm ${sales.number} before ordering stock for it.`);
  }

  // Lines snapshot "tracks stock"; an item set to track stock since is seen now.
  await refreshStockFlags(tx, [poId, salesId]);

  let madeReserve = false;
  if (sales.type === "invoice" && !sales.isReserve) {
    madeReserve = true;
    await tx.update(documents).set({ isReserve: true }).where(eq(documents.id, salesId));
  }

  const [poLines, salesLines] = await Promise.all([itemLines(tx, poId), itemLines(tx, salesId)]);
  const map = pairs ?? matchLines(poLines, salesLines);
  const salesIds = new Set(salesLines.map((l) => l.id));
  const before = poLines.map((l) => l.sourceLineId);

  let linked = 0;
  for (const line of poLines) {
    const target = map.get(line.id) ?? null;
    if (target && !salesIds.has(target)) throw new LinkRefusal("A line was matched to a line of a different document.");
    if (target) linked += 1;
    if ((line.sourceLineId ?? null) !== target) {
      await tx.update(documentLines).set({ sourceLineId: target }).where(eq(documentLines.id, line.id));
    }
  }

  await tx
    .update(documents)
    .set({ salesOrderId: sales.type === "sales_order" ? sales.id : sales.salesOrderId })
    .where(eq(documents.id, poId));
  await touch(tx, poId);
  if (madeReserve) await touch(tx, salesId);

  // The sales lines' ordered figures, and — once reserve — the invoice's own
  // delivered and allocated, which no longer count the approval as delivery.
  await recomputeCounters(tx, [...before, ...map.values(), ...salesLines.map((l) => l.id)]);
  return { linked, madeReserve, sales: { ...sales, isReserve: sales.isReserve || madeReserve } };
}
