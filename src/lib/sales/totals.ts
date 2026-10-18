import { centsToString, divRound, SCALE4, toScaled } from "./money";

/**
 * Document totals, following Xero's arithmetic exactly (D8): a line amount
 * rounded to the cent, then tax per line rounded to the cent, then sums.
 * Pure and shared by the editor preview and the server.
 *
 *   lineAmount = round2(quantity × unitPrice × (1 − discount/100))
 *   exclusive: tax = round2(lineAmount × rate/100);         total = Σ line + Σ tax
 *   inclusive: tax = round2(lineAmount × rate/(100+rate));  total = Σ line
 *   no_tax:    tax = 0
 */

export type AmountsMode = "exclusive" | "inclusive" | "no_tax";
export type Row = "item" | "alternative" | "text" | "subtotal";

export type TotalsLine = {
  rowType: Row;
  quantity: string | number;
  unitPrice: string | number;
  discountPercent?: string | number | null;
  taxRate?: string | number | null;
};

export type LineFigures = {
  /** Two places. Alternatives carry their amount for display but are not counted. */
  lineAmount: string;
  taxAmount: string;
  /** On a subtotal row: the item lines since the previous subtotal. */
  subtotalValue: string | null;
};

export type Totals = {
  lines: LineFigures[];
  subtotal: string;
  taxTotal: string;
  total: string;
};

const ZERO = BigInt(0);
const HUNDRED4 = BigInt(100) * SCALE4;

/** One line's amount and tax, in cents. */
export function lineCents(
  line: Pick<TotalsLine, "quantity" | "unitPrice" | "discountPercent" | "taxRate">,
  mode: AmountsMode,
): { amount: bigint; tax: bigint } {
  const q = toScaled(line.quantity);
  const p = toScaled(line.unitPrice);
  const keep = HUNDRED4 - toScaled(line.discountPercent ?? 0);
  // q·p·keep is at 10^4·10^4·10^4·100 per dollar; cents want ×100, so ÷10^12.
  const amount = divRound(q * p * keep, BigInt(10) ** BigInt(12));
  const rate = toScaled(line.taxRate ?? 0);
  let tax = ZERO;
  if (mode === "exclusive") tax = divRound(amount * rate, HUNDRED4);
  else if (mode === "inclusive") tax = divRound(amount * rate, HUNDRED4 + rate);
  return { amount, tax };
}

export function computeTotals(lines: TotalsLine[], mode: AmountsMode): Totals {
  let lineSum = ZERO;
  let taxSum = ZERO;
  let group = ZERO;

  const figures = lines.map((line): LineFigures => {
    if (line.rowType === "text") {
      return { lineAmount: "0.00", taxAmount: "0.00", subtotalValue: null };
    }
    if (line.rowType === "subtotal") {
      const value = group;
      group = ZERO;
      return { lineAmount: "0.00", taxAmount: "0.00", subtotalValue: centsToString(value) };
    }
    const { amount, tax } = lineCents(line, mode);
    if (line.rowType === "item") {
      lineSum += amount;
      taxSum += tax;
      group += amount;
    }
    return {
      lineAmount: centsToString(amount),
      taxAmount: centsToString(tax),
      subtotalValue: null,
    };
  });

  const total = mode === "inclusive" ? lineSum : lineSum + taxSum;
  const subtotal = mode === "inclusive" ? lineSum - taxSum : lineSum;

  return {
    lines: figures,
    subtotal: centsToString(subtotal),
    taxTotal: centsToString(taxSum),
    total: centsToString(total),
  };
}
