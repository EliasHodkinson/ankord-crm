import type { Counter } from "./doc-types";
import { fromScaled, toScaled } from "./money";

/**
 * Copy-to (quote → order → invoice), as a pure function so it is tested.
 *
 * Rules carried over from EduCom and SAP:
 * - only item rows with room left on the counter are offered, each defaulting
 *   to what is left;
 * - alternatives are not copied; text rows are;
 * - a subtotal row with no item row above it (since the last subtotal) is
 *   dropped;
 * - each copied line points back at its source with `baseLineId`.
 */

export type SourceLine = {
  id: string;
  rowType: "item" | "alternative" | "text" | "subtotal";
  itemId: string | null;
  itemCode: string | null;
  unit: string | null;
  tracksStock: boolean;
  description: string;
  note: string | null;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  accountCode: string | null;
  taxType: string | null;
  taxRate: string;
} & Partial<Record<Counter, string>>;

export type DraftLine = Omit<SourceLine, "id" | Counter> & {
  baseLineId: string | null;
  /** What is still open on the source line — the ceiling for this copy. */
  maxQuantity: string | null;
};

/** What is left on a source line for one counter, at four places. */
export function remainingOn(line: SourceLine, counter: Counter): string {
  const left = toScaled(line.quantity) - toScaled(line[counter] ?? "0");
  return fromScaled(left > BigInt(0) ? left : BigInt(0));
}

export function buildCopyLines(lines: SourceLine[], counter: Counter): DraftLine[] {
  const out: DraftLine[] = [];
  let itemSinceSubtotal = false;

  for (const line of lines) {
    if (line.rowType === "alternative") continue;

    if (line.rowType === "subtotal") {
      if (!itemSinceSubtotal) continue;
      itemSinceSubtotal = false;
      out.push(copyOf(line, null, null));
      continue;
    }

    if (line.rowType === "text") {
      out.push(copyOf(line, null, null));
      continue;
    }

    const left = remainingOn(line, counter);
    if (toScaled(left) <= BigInt(0)) continue;
    itemSinceSubtotal = true;
    out.push({ ...copyOf(line, line.id, left), quantity: left });
  }

  // Trailing text rows that only introduced items which were not copied are
  // harmless; a document with no item rows at all is not — the caller checks.
  return out;
}

function copyOf(line: SourceLine, baseLineId: string | null, max: string | null): DraftLine {
  return {
    rowType: line.rowType,
    itemId: line.itemId,
    itemCode: line.itemCode,
    unit: line.unit,
    tracksStock: line.tracksStock,
    description: line.description,
    note: line.note,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
    accountCode: line.accountCode,
    taxType: line.taxType,
    taxRate: line.taxRate,
    baseLineId,
    maxQuantity: max,
  };
}

/** The sentence a copied document's remarks open with. */
export function basedOnRemark(source: { type: string; number: string | null }): string {
  const ref = source.number ?? "a draft";
  return source.type === "quote"
    ? `Based on Quote ${ref}.`
    : source.type === "sales_order"
      ? `From sales order ${ref}.`
      : `From ${ref}.`;
}
