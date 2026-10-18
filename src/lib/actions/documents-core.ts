import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { documentLines, documents, numberSeries } from "@/lib/db/schema";
import type { Tx } from "@/lib/db";
import { reserveFulfilment, salesOrderFulfilment } from "@/lib/sales/fulfilment";
import { num } from "@/lib/sales/money";

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
  const ids = [...new Set(lineIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return { changed: [] as string[] };

  await tx.execute(sql`
    update document_lines set
      qty_converted = case when p.type = 'quote'
        then ${sumChildren("'sales_order','invoice'")} else 0 end,
      qty_invoiced = case when p.type = 'sales_order'
        then ${sumChildren("'invoice'")} else 0 end,
      qty_delivered = case
        when p.type = 'sales_order' then
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
      qty_ordered = case when p.type = 'sales_order' then coalesce((
          select sum(c.quantity) from document_lines c
          join documents d on d.id = c.document_id
          where c.source_line_id = document_lines.id
            and d.type = 'purchase_order' and d.status <> 'cancelled'
        ), 0) else 0 end,
      qty_allocated = case when p.type = 'sales_order' then coalesce((
          select sum(a.quantity - a.consumed) from stock_allocations a
          where a.sales_order_line_id = document_lines.id and a.released_at is null
        ), 0) else 0 end,
      qty_received = case when p.type = 'purchase_order'
        then ${sumChildren("'goods_receipt'")} else 0 end,
      qty_billed = case when p.type = 'purchase_order'
        then ${sumChildren("'bill'")} else 0 end
    from documents p
    where p.id = document_lines.document_id
      and ${inArray(documentLines.id, ids)}
  `);

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
      const stock = lines;
      const received = stock.every((l) => num(l.qtyReceived) >= num(l.quantity));
      const anyReceived = stock.some((l) => num(l.qtyReceived) > 0);
      const billed = stock.every((l) => num(l.qtyBilled) >= num(l.quantity));
      const fulfilment = received ? "received" : anyReceived ? "part_received" : "to_receive";
      const done = stock.length > 0 && received && billed;
      const patch =
        done && doc.status === "open" ? autoClose : !done && autoClosed ? reopen : {};
      await tx.update(documents).set({ fulfilment, ...patch }).where(eq(documents.id, documentId));
      return false;
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
