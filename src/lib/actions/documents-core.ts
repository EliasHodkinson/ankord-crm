import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { documentLines, documents, items, numberSeries, stockAllocations } from "@/lib/db/schema";
import type { Tx } from "@/lib/db";
import { reserveFulfilment, salesOrderFulfilment } from "@/lib/sales/fulfilment";
import { num } from "@/lib/sales/money";
import { autoAllocation, consumeAllocations, purchaseState, stillToAllocate } from "@/lib/sales/purchasing";

/**
 * The machinery every document write shares. Deliberately **not** a
 * `"use server"` module: nothing here may become a public endpoint. Every
 * function takes the caller's transaction, so a write and everything it
 * implies land together or not at all.
 */

/** Next number in a local series: "SO-00017". Inside the write transaction. */
export async function allocateNumber(tx: Tx, key: string): Promise<string> {
  const [row] = await tx
    .update(numberSeries)
    .set({ nextValue: sql`${numberSeries.nextValue} + 1` })
    .where(eq(numberSeries.key, key))
    .returning({
      prefix: numberSeries.prefix,
      value: sql<number>`${numberSeries.nextValue} - 1`,
      padTo: numberSeries.padTo,
    });
  if (!row) throw new Error(`There is no number series for ${key}.`);
  return `${row.prefix}${String(row.value).padStart(row.padTo, "0")}`;
}

/** A child line counts unless its document is cancelled. Drafts count too. */
const sumChildren = (types: string, extra = sql``) => sql`
  coalesce((
    select sum(c.quantity) from document_lines c
    join documents d on d.id = c.document_id
    where c.base_line_id = document_lines.id
      and d.status <> 'cancelled'
      and d.type in (${sql.raw(types)})
      ${extra}
  ), 0)`;

/**
 * Recalculates the derived counters on the given source lines from the
 * documents drawn against them (spec §4.4), then the status and fulfilment of
 * the documents those lines belong to. Idempotent: running it twice is
 * harmless, so every write that adds, changes or cancels a linked line just
 * calls it with the base lines it touched.
 *
 * Returns the documents whose Xero-visible state changed (a quote that closed
 * as accepted), so the caller can queue their push after the commit.
 */
export async function recomputeCounters(tx: Tx, lineIds: (string | null | undefined)[]) {
  const ids = await withUpstream(tx, lineIds);
  if (ids.length === 0) return { changed: [] as string[] };

  await tx.execute(sql`
    update document_lines set
      qty_converted = case when p.type = 'quote'
        then ${sumChildren("'sales_order','invoice'")} else 0 end,
      qty_invoiced = case when p.type = 'sales_order'
        then ${sumChildren("'invoice'")} else 0 end,
      qty_delivered = case
        -- services are never delivered; only goods are counted out
        when p.type = 'sales_order' and document_lines.tracks_stock then
          -- a normal invoice delivers once it is approved…
          ${sumChildren("'invoice'", sql`and d.is_reserve = false and d.status in ('open','closed')`)}
          -- …and a reserve invoice's goods go out on a delivery against it
          + coalesce((
              select sum(g.quantity) from document_lines c
              join documents d on d.id = c.document_id
                and d.type = 'invoice' and d.status <> 'cancelled'
              join document_lines g on g.base_line_id = c.id
              join documents gd on gd.id = g.document_id
                and gd.type = 'delivery' and gd.status <> 'cancelled'
              where c.base_line_id = document_lines.id
            ), 0)
        when p.type = 'invoice' and p.is_reserve then ${sumChildren("'delivery'")}
        else 0 end,
      -- ordered: PO lines raised for this line. A sales-order line, or a
      -- reserve-invoice line with no order behind it.
      qty_ordered = case when p.type = 'sales_order' or (p.type = 'invoice' and p.is_reserve) then coalesce((
          select sum(c.quantity) from document_lines c
          join documents d on d.id = c.document_id
          where c.source_line_id = document_lines.id
            and d.type = 'purchase_order' and d.status <> 'cancelled'
        ), 0) else 0 end,
      qty_received = case when p.type = 'purchase_order'
        then ${sumChildren("'goods_receipt'")} else 0 end,
      qty_billed = case when p.type = 'purchase_order'
        then ${sumChildren("'bill'")} else 0 end
    from documents p
    where p.id = document_lines.document_id
      and ${inArray(documentLines.id, ids)}
  `);

  // What has gone out consumes what was set aside, then what is still set
  // aside is what the line shows as allocated.
  await recomputeConsumption(tx, ids);

  const owners = await tx
    .selectDistinct({ id: documentLines.documentId })
    .from(documentLines)
    .where(inArray(documentLines.id, ids));

  const changed: string[] = [];
  for (const { id } of owners) {
    if (await recomputeFulfilment(tx, id)) changed.push(id);
  }
  return { changed };
}

/**
 * Status and fulfilment of one source document from its lines' counters.
 * Auto-closes when finished, and re-opens a document that was auto-closed
 * once a child is cancelled. Returns true when Xero needs to hear about it.
 */
export async function recomputeFulfilment(tx: Tx, documentId: string): Promise<boolean> {
  const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId));
  if (!doc || doc.status === "cancelled") return false;

  const lines = await tx
    .select()
    .from(documentLines)
    .where(and(eq(documentLines.documentId, documentId), eq(documentLines.rowType, "item")));

  const now = new Date();
  const autoClose = { status: "closed" as const, closedAt: now, closedBy: "auto" as const };
  const reopen = { status: "open" as const, closedAt: null, closedBy: null };
  const autoClosed = doc.status === "closed" && doc.closedBy === "auto";

  switch (doc.type) {
    case "quote": {
      const converted = lines.some((l) => num(l.qtyConverted) > 0);
      const full = lines.length > 0 && lines.every((l) => num(l.qtyConverted) >= num(l.quantity));
      // Converting a quote is its customer accepting it.
      const outcome = converted ? ("accepted" as const) : doc.quoteOutcome;
      if (full && doc.status !== "closed") {
        await tx
          .update(documents)
          .set({ ...autoClose, quoteOutcome: "accepted", updatedAt: now })
          .where(eq(documents.id, documentId));
        return true;
      }
      if (!full && autoClosed) {
        await tx.update(documents).set({ ...reopen, updatedAt: now }).where(eq(documents.id, documentId));
        return false;
      }
      if (converted && (doc.status === "draft" || outcome !== doc.quoteOutcome)) {
        await tx
          .update(documents)
          .set({ status: "open", quoteOutcome: outcome, updatedAt: now })
          .where(eq(documents.id, documentId));
        return true;
      }
      return false;
    }

    case "sales_order": {
      const fulfilment = salesOrderFulfilment(lines);
      const done =
        lines.length > 0 &&
        lines.every(
          (l) =>
            num(l.qtyInvoiced) >= num(l.quantity) &&
            (!l.tracksStock || num(l.qtyDelivered) >= num(l.quantity)),
        );
      const patch =
        done && doc.status === "open" ? autoClose : !done && autoClosed ? reopen : {};
      await tx
        .update(documents)
        .set({ fulfilment, ...patch })
        .where(eq(documents.id, documentId));
      return false;
    }

    case "invoice": {
      if (!doc.isReserve) return false;
      await tx
        .update(documents)
        .set({ fulfilment: reserveFulfilment(lines) })
        .where(eq(documents.id, documentId));
      return false;
    }

    case "purchase_order": {
      // A PO imported as BILLED in Xero was billed there, bill imported or not.
      const state = purchaseState(lines, doc.xeroStatus === "BILLED");
      const patch =
        state.complete && doc.status === "open" ? autoClose : !state.complete && autoClosed ? reopen : {};
      await tx
        .update(documents)
        .set({ fulfilment: state.fulfilment, ...patch })
        .where(eq(documents.id, documentId));
      // Fully billed here: Xero's PO should say BILLED, as it does when a bill
      // is copied from a PO in Xero itself.
      const billed = lines.length > 0 && lines.every((l) => num(l.qtyBilled) >= num(l.quantity));
      return billed && doc.xeroId !== null && doc.xeroStatus !== "BILLED";
    }

    default:
      return false;
  }
}

/** Every base line the given documents' lines were drawn from. */
export async function baseLinesOf(tx: Tx, documentIds: string[]): Promise<string[]> {
  if (documentIds.length === 0) return [];
  const rows = await tx
    .select({ baseLineId: documentLines.baseLineId })
    .from(documentLines)
    .where(inArray(documentLines.documentId, documentIds));
  return rows.map((r) => r.baseLineId).filter((id): id is string => Boolean(id));
}

/**
 * The given lines plus the lines upstream of them whose counters they feed:
 * each line's base (what it was drawn from) and source (the sales line a PO
 * line was raised for), and their bases in turn — a delivery line moves its
 * reserve-invoice line and, through it, the sales-order line.
 */
async function withUpstream(tx: Tx, lineIds: (string | null | undefined)[]): Promise<string[]> {
  const ids = new Set(lineIds.filter((id): id is string => Boolean(id)));
  let frontier = [...ids];
  for (let depth = 0; depth < 2 && frontier.length; depth++) {
    const rows = await tx
      .select({ base: documentLines.baseLineId, source: documentLines.sourceLineId })
      .from(documentLines)
      .where(inArray(documentLines.id, frontier));
    frontier = [];
    for (const r of rows) {
      for (const id of [r.base, r.source]) {
        if (id && !ids.has(id)) {
          ids.add(id);
          frontier.push(id);
        }
      }
    }
  }
  return [...ids];
}

/**
 * Re-spreads what each demand line (sales-order line, or reserve-invoice
 * line) has delivered over its active allocations, oldest first, and sets
 * the line's `qtyAllocated` to what is still set aside and not yet gone out.
 */
async function recomputeConsumption(tx: Tx, lineIds: string[]) {
  if (lineIds.length === 0) return;
  const lines = await tx
    .select({ id: documentLines.id, qtyDelivered: documentLines.qtyDelivered, type: documents.type, isReserve: documents.isReserve })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(inArray(documentLines.id, lineIds));
  const demand = lines.filter((l) => l.type === "sales_order" || (l.type === "invoice" && l.isReserve));
  const others = lines.filter((l) => !demand.includes(l)).map((l) => l.id);
  if (others.length) {
    await tx.update(documentLines).set({ qtyAllocated: "0" }).where(inArray(documentLines.id, others));
  }
  if (demand.length === 0) return;

  const allocations = await tx
    .select()
    .from(stockAllocations)
    .where(and(inArray(stockAllocations.salesOrderLineId, demand.map((l) => l.id)), isNull(stockAllocations.releasedAt)))
    .orderBy(asc(stockAllocations.createdAt), asc(stockAllocations.id));

  for (const line of demand) {
    const mine = allocations.filter((a) => a.salesOrderLineId === line.id);
    const consumed = consumeAllocations(mine, line.qtyDelivered);
    let held = 0;
    for (const a of mine) {
      const next = consumed.get(a.id) ?? "0";
      if (num(next) !== num(a.consumed)) {
        await tx.update(stockAllocations).set({ consumed: next }).where(eq(stockAllocations.id, a.id));
      }
      held += num(a.quantity) - num(next);
    }
    await tx
      .update(documentLines)
      .set({ qtyAllocated: String(Math.max(0, Math.round(held * 10_000) / 10_000)) })
      .where(eq(documentLines.id, line.id));
  }
}

/**
 * Auto-allocation on receipt (§4.5): each received stock line goes, as far as
 * it covers it, to the sales line its PO line was raised for. Run after the
 * receipt's counters are recomputed. Returns the demand lines it touched.
 */
export async function allocateFromReceipt(tx: Tx, receiptId: string, userId: string | null): Promise<string[]> {
  const received = await tx
    .select({
      id: documentLines.id,
      itemId: documentLines.itemId,
      quantity: documentLines.quantity,
      tracksStock: documentLines.tracksStock,
      demandId: sql<string | null>`(select po.source_line_id from document_lines po where po.id = document_lines.base_line_id)`,
    })
    .from(documentLines)
    .where(and(eq(documentLines.documentId, receiptId), eq(documentLines.rowType, "item")));

  const touched: string[] = [];
  for (const line of received) {
    if (!line.tracksStock || !line.itemId || !line.demandId) continue;
    const [demand] = await tx
      .select({
        quantity: documentLines.quantity,
        qtyDelivered: documentLines.qtyDelivered,
        qtyAllocated: documentLines.qtyAllocated,
        status: documents.status,
      })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .where(eq(documentLines.id, line.demandId))
      .for("update", { of: documentLines });
    if (!demand || demand.status === "cancelled") continue;
    const take = autoAllocation(line.quantity, stillToAllocate(demand));
    if (num(take) <= 0) continue;
    await tx.insert(stockAllocations).values({
      salesOrderLineId: line.demandId,
      itemId: line.itemId,
      quantity: take,
      receiptLineId: line.id,
      createdById: userId,
    });
    await recomputeConsumption(tx, [line.demandId]);
    touched.push(line.demandId);
  }
  return touched;
}

/**
 * Re-reads "tracks stock" from the items onto the given documents' lines.
 * Lines snapshot it when written; an item switched to tracking stock later
 * (an imported item, say) is picked up here when a document is linked or
 * marked goods to follow — a paid invoice included.
 */
export async function refreshStockFlags(tx: Tx, documentIds: string[]) {
  if (documentIds.length === 0) return;
  await tx.execute(sql`
    update document_lines l set tracks_stock = i.tracks_stock
    from ${items} i, documents d
    where i.id = l.item_id and d.id = l.document_id
      and d.status <> 'cancelled'
      and l.tracks_stock is distinct from i.tracks_stock
      and ${inArray(sql`l.document_id`, documentIds)}
  `);
}

/**
 * An item switched to (or from) tracking stock: its lines on live documents
 * follow, and their counters with them — an order line of goods counts as
 * delivered and can be allocated; a service line cannot.
 */
export async function followItemStockFlag(tx: Tx, itemId: string) {
  const changed = await tx.execute<{ id: string }>(sql`
    update document_lines l set tracks_stock = i.tracks_stock
    from ${items} i, documents d
    where i.id = ${itemId} and l.item_id = i.id and d.id = l.document_id
      and d.status in ('draft','open')
      and l.tracks_stock is distinct from i.tracks_stock
    returning l.id`);
  await recomputeCounters(tx, changed.rows.map((r) => r.id));
}
