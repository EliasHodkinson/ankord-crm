import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/lib/db";
import { documentLines, documents, shipments, stockAdjustments, stockAllocations, users } from "@/lib/db/schema";
import { num } from "@/lib/sales/money";

/**
 * Stock as quantities (spec §4.5, D4), derived — never stored:
 *
 *   on hand   = received − delivered + adjusted
 *   allocated = Σ active allocations not yet delivered
 *   available = on hand − allocated
 *
 * Received is goods-receipt lines; delivered is approved normal invoices plus
 * deliveries. An invoice imported from Xero is not counted out: its goods
 * left before The Gangway counted stock, and were never counted in either.
 */

export type StockFigures = {
  received: number;
  delivered: number;
  adjusted: number;
  onHand: number;
  allocated: number;
  available: number;
};

type Reader = Pick<ReturnType<typeof getDb>, "execute"> | Tx;

export async function availableStock(db: Reader, itemIds: string[]): Promise<Map<string, StockFigures>> {
  const out = new Map<string, StockFigures>();
  if (itemIds.length === 0) return out;
  const ids = sql.join(itemIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await db.execute<{ item_id: string; received: string; delivered: string; adjusted: string; allocated: string }>(sql`
    select i.id as item_id,
      coalesce((select sum(l.quantity) from document_lines l join documents d on d.id = l.document_id
        where l.item_id = i.id and d.type = 'goods_receipt' and d.status <> 'cancelled'), 0) as received,
      coalesce((select sum(l.quantity) from document_lines l join documents d on d.id = l.document_id
        where l.item_id = i.id and l.tracks_stock and (
          (d.type = 'invoice' and d.is_reserve = false and d.status in ('open','closed') and d.imported_at is null)
          or (d.type = 'delivery' and d.status <> 'cancelled'))), 0) as delivered,
      coalesce((select sum(a.quantity) from stock_adjustments a where a.item_id = i.id), 0) as adjusted,
      coalesce((select sum(a.quantity - a.consumed) from stock_allocations a
        where a.item_id = i.id and a.released_at is null), 0) as allocated
    from items i where i.id in (${ids})
  `);
  for (const r of rows.rows) {
    const onHand = num(r.received) - num(r.delivered) + num(r.adjusted);
    const allocated = num(r.allocated);
    out.set(r.item_id, {
      received: num(r.received),
      delivered: num(r.delivered),
      adjusted: num(r.adjusted),
      onHand,
      allocated,
      available: onHand - allocated,
    });
  }
  return out;
}

export async function stockFor(itemIds: string[]) {
  return availableStock(getDb(), itemIds);
}

/** Recent stock movements of one item, for its page: receipts, deliveries, adjustments. */
export async function stockMovements(itemId: string) {
  const db = getDb();
  const [moves, adjustments] = await Promise.all([
    db
      .select({
        id: documentLines.id,
        quantity: documentLines.quantity,
        documentId: documents.id,
        type: documents.type,
        number: documents.number,
        partnerName: documents.partnerName,
        docDate: documents.docDate,
        isReserve: documents.isReserve,
      })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .where(
        and(
          eq(documentLines.itemId, itemId),
          sql`${documents.status} <> 'cancelled'`,
          sql`(${documents.type} in ('goods_receipt','delivery')
            or (${documents.type} = 'invoice' and ${documents.isReserve} = false and ${documents.status} in ('open','closed')
                and ${documents.importedAt} is null and ${documentLines.tracksStock}))`,
        ),
      )
      .orderBy(desc(documents.docDate))
      .limit(30),
    db
      .select({
        id: stockAdjustments.id,
        quantity: stockAdjustments.quantity,
        reason: stockAdjustments.reason,
        createdAt: stockAdjustments.createdAt,
        by: users.name,
      })
      .from(stockAdjustments)
      .leftJoin(users, eq(users.id, stockAdjustments.createdById))
      .where(eq(stockAdjustments.itemId, itemId))
      .orderBy(desc(stockAdjustments.createdAt))
      .limit(30),
  ]);
  return { moves, adjustments };
}

/** Active allocations on a document's lines, with where they came from. */
export async function allocationsFor(documentId: string) {
  return getDb()
    .select({
      id: stockAllocations.id,
      lineId: stockAllocations.salesOrderLineId,
      quantity: stockAllocations.quantity,
      consumed: stockAllocations.consumed,
      createdAt: stockAllocations.createdAt,
      receiptNumber: sql<string | null>`(select d.number from document_lines r join documents d on d.id = r.document_id where r.id = stock_allocations.receipt_line_id)`,
      receiptId: sql<string | null>`(select r.document_id from document_lines r where r.id = stock_allocations.receipt_line_id)`,
    })
    .from(stockAllocations)
    .innerJoin(documentLines, eq(documentLines.id, stockAllocations.salesOrderLineId))
    .where(and(eq(documentLines.documentId, documentId), isNull(stockAllocations.releasedAt)))
    .orderBy(asc(stockAllocations.createdAt));
}

export async function shipmentsFor(purchaseOrderId: string) {
  return getDb()
    .select({
      shipment: shipments,
      receiptNumber: documents.number,
    })
    .from(shipments)
    .leftJoin(documents, eq(documents.id, shipments.receiptId))
    .where(eq(shipments.documentId, purchaseOrderId))
    .orderBy(asc(shipments.createdAt));
}

export type LineTracking = {
  poId: string;
  poNumber: string | null;
  poStatus: string;
  poFulfilment: string | null;
  quantity: string;
  received: string;
  shipments: {
    id: string;
    carrier: string;
    trackingNumber: string | null;
    trackingUrl: string | null;
    eta: string | null;
    shippedOn: string | null;
    receiptId: string | null;
  }[];
};

/**
 * For a sales order or invoice: per line, the PO lines raised for it and
 * those POs' shipments — what the lines table shows as "Shipped, in transit"
 * with the tracking link.
 */
export async function trackingForSales(documentId: string): Promise<Map<string, LineTracking[]>> {
  const db = getDb();
  const rows = await db
    .select({
      salesLineId: documentLines.sourceLineId,
      poId: documents.id,
      poNumber: documents.number,
      poStatus: documents.status,
      poFulfilment: documents.fulfilment,
      quantity: documentLines.quantity,
      received: documentLines.qtyReceived,
    })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(
      and(
        eq(documents.type, "purchase_order"),
        sql`${documents.status} <> 'cancelled'`,
        sql`${documentLines.sourceLineId} in (select id from document_lines where document_id = ${documentId})`,
      ),
    );
  const out = new Map<string, LineTracking[]>();
  if (rows.length === 0) return out;
  const poIds = [...new Set(rows.map((r) => r.poId))];
  const sent = await db
    .select()
    .from(shipments)
    .where(inArray(shipments.documentId, poIds))
    .orderBy(asc(shipments.createdAt));
  for (const r of rows) {
    const list = out.get(r.salesLineId!) ?? [];
    list.push({
      poId: r.poId,
      poNumber: r.poNumber,
      poStatus: r.poStatus,
      poFulfilment: r.poFulfilment,
      quantity: r.quantity,
      received: r.received,
      shipments: sent
        .filter((s) => s.documentId === r.poId)
        .map((s) => ({
          id: s.id,
          carrier: s.carrier,
          trackingNumber: s.trackingNumber,
          trackingUrl: s.trackingUrl,
          eta: s.eta,
          shippedOn: s.shippedOn,
          receiptId: s.receiptId,
        })),
    });
    out.set(r.salesLineId!, list);
  }
  return out;
}

/**
 * Documents with a shipment still in transit, for list chips: POs directly,
 * and the sales orders and invoices whose lines they were raised for.
 */
export async function inTransitAmong(documentIds: string[]): Promise<Set<string>> {
  if (documentIds.length === 0) return new Set();
  const ids = sql.join(documentIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await getDb().execute<{ id: string }>(sql`
    select distinct x.id from (
      select po.id from documents po
      where po.id in (${ids})
      union all
      select s.document_id as id from document_lines s
      join document_lines pl on pl.source_line_id = s.id
      join documents po on po.id = pl.document_id
      where s.document_id in (${ids})
    ) x
    where exists (
      select 1 from shipments sh
      join documents po on po.id = sh.document_id
      where sh.receipt_id is null and po.status <> 'cancelled' and coalesce(po.fulfilment, '') <> 'received'
        and (po.id = x.id or po.id in (
          select pl.document_id from document_lines pl
          join document_lines s on s.id = pl.source_line_id
          where s.document_id = x.id))
    )
  `);
  return new Set(rows.rows.map((r) => r.id));
}
