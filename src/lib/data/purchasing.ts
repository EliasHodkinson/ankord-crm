import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { documentLines, documents, type Document } from "@/lib/db/schema";
import { customerScope, getAccess } from "@/lib/access";
import { numbersIn, shortfalls } from "@/lib/sales/purchasing";

/**
 * Reads for the purchasing panels on a document's page. Each is scoped the
 * same way as the document lists: a restricted person only ever sees the
 * partners granted to them.
 */

const optionCols = {
  id: documents.id,
  type: documents.type,
  number: documents.number,
  partnerName: documents.partnerName,
  docDate: documents.docDate,
  total: documents.total,
  isReserve: documents.isReserve,
};

/** The sales orders and invoices a PO's lines were raised for. */
export async function salesLinksFor(purchaseOrderId: string) {
  const access = await getAccess();
  const source = alias(documentLines, "source");
  return getDb()
    .selectDistinct(optionCols)
    .from(documentLines)
    .innerJoin(source, eq(source.id, documentLines.sourceLineId))
    .innerJoin(documents, eq(documents.id, source.documentId))
    .where(and(eq(documentLines.documentId, purchaseOrderId), customerScope(access, documents.partnerId)));
}

/**
 * Sales documents a PO's reference or delivery instructions name ("For
 * INV-0028"), so linking an imported PO is one click when Xero says what it
 * was for.
 */
export async function suggestedSalesFor(po: Pick<Document, "reference" | "remarks">) {
  const numbers = numbersIn(`${po.reference ?? ""} ${po.remarks ?? ""}`).filter((n) => !n.startsWith("PO-"));
  if (numbers.length === 0) return [];
  const access = await getAccess();
  return getDb()
    .select(optionCols)
    .from(documents)
    .where(
      and(
        inArray(documents.type, ["sales_order", "invoice"]),
        sql`${documents.status} <> 'cancelled'`,
        inArray(sql`upper(${documents.number})`, numbers),
        customerScope(access, documents.partnerId),
      ),
    );
}

/** A supplier's live POs that a bill could be entered against. */
export async function billOptions(bill: Pick<Document, "partnerId">) {
  return getDb()
    .select(optionCols)
    .from(documents)
    .where(
      and(
        eq(documents.type, "purchase_order"),
        eq(documents.partnerId, bill.partnerId),
        inArray(documents.status, ["open", "closed"]),
      ),
    )
    .orderBy(asc(documents.docDate))
    .limit(20);
}

/**
 * For a reserve invoice drawn from a sales order: each line's ordered and
 * allocated figures live on the order line, so they are read from there.
 */
export async function demandCounters(invoiceId: string): Promise<Record<string, { ordered: string; allocated: string }>> {
  const rows = await getDb().execute<{ id: string; ordered: string; allocated: string }>(sql`
    select l.id, b.qty_ordered as ordered, b.qty_allocated as allocated
    from document_lines l
    join document_lines b on b.id = l.base_line_id
    join documents bd on bd.id = b.document_id and bd.type = 'sales_order'
    where l.document_id = ${invoiceId}`);
  return Object.fromEntries(rows.rows.map((r) => [r.id, { ordered: r.ordered, allocated: r.allocated }]));
}

/** The shortfall warning for a draft normal invoice (§4.5), as the approve button shows it. */
export async function draftShortfalls(invoiceId: string) {
  const rows = await getDb()
    .select({
      line: documentLines,
      allocated: sql<string>`coalesce((select b.qty_allocated from document_lines b where b.id = document_lines.base_line_id), 0)`,
    })
    .from(documentLines)
    .where(and(eq(documentLines.documentId, invoiceId), eq(documentLines.rowType, "item")));
  return shortfalls(
    rows.map(({ line, allocated }) => ({
      label: line.itemCode ?? (line.description.split("\n")[0] || "item"),
      quantity: line.quantity,
      allocated,
      tracksStock: line.tracksStock,
    })),
  );
}
