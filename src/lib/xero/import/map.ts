import { computeTotals, type AmountsMode } from "../../sales/totals";
import { fromScaled, toCents, toScaled } from "../../sales/money";

/**
 * Xero documents → the shape The Gangway stores. Pure, so it is tested
 * without Xero or a database.
 *
 * This is the reverse of lib/xero/mapping.ts, and only as faithful as Xero
 * lets it be: Xero has no alternative or subtotal rows, so a line with no
 * quantity and no price comes back as a text row, and everything else as an
 * item row. Totals are recomputed with Gangway's own arithmetic (which follows
 * Xero's, D8); Xero's figure is kept alongside so a difference is visible on
 * the document rather than hidden.
 *
 * Purchasing (phase B) adds `PurchaseOrders` and ACCPAY bills by writing a
 * normaliser beside `normaliseQuote` / `normaliseInvoice` that returns the
 * same `ImportedDoc`, and a status rule in `gangwayState`.
 */

export type ImportDocType = "quote" | "invoice" | "purchase_order" | "bill";

export type RawLineItem = {
  LineItemID?: string;
  Description?: string;
  Quantity?: number;
  UnitAmount?: number;
  ItemCode?: string;
  AccountCode?: string;
  TaxType?: string;
  TaxAmount?: number;
  LineAmount?: number;
  DiscountRate?: number;
  DiscountAmount?: number;
};

type RawContactRef = { ContactID?: string; Name?: string };

export type RawPayment = {
  PaymentID?: string;
  Date?: string;
  Amount?: number;
  Reference?: string;
  Status?: string;
  Account?: { Code?: string };
};

export type RawQuote = {
  QuoteID: string;
  QuoteNumber?: string;
  Reference?: string;
  Title?: string;
  Summary?: string;
  Terms?: string;
  Contact?: RawContactRef;
  Date?: string;
  DateString?: string;
  ExpiryDate?: string;
  ExpiryDateString?: string;
  Status?: string;
  CurrencyCode?: string;
  LineAmountTypes?: string;
  LineItems?: RawLineItem[];
  Total?: number;
  UpdatedDateUTC?: string;
};

export type RawInvoice = {
  InvoiceID: string;
  InvoiceNumber?: string;
  Type?: string;
  Reference?: string;
  Contact?: RawContactRef;
  Date?: string;
  DateString?: string;
  DueDate?: string;
  DueDateString?: string;
  Status?: string;
  CurrencyCode?: string;
  LineAmountTypes?: string;
  LineItems?: RawLineItem[];
  Total?: number;
  AmountPaid?: number;
  AmountDue?: number;
  Payments?: RawPayment[];
  UpdatedDateUTC?: string;
};

export type ImportedLine = {
  rowType: "item" | "text";
  itemCode: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  accountCode: string | null;
  taxType: string | null;
  taxRate: string;
  lineAmount: string;
  taxAmount: string;
};

export type ImportedPayment = {
  xeroPaymentId: string;
  date: string | null;
  amount: string;
  reference: string | null;
  accountCode: string | null;
  status: string | null;
};

export type GangwayState = {
  status: "draft" | "open" | "closed" | "cancelled";
  quoteOutcome: "accepted" | "declined" | null;
};

export type ImportedDoc = {
  type: ImportDocType;
  xeroId: string;
  number: string | null;
  xeroStatus: string;
  state: GangwayState;
  contactId: string | null;
  contactName: string;
  docDate: string | null;
  dueDate: string | null;
  reference: string | null;
  title: string | null;
  summary: string | null;
  terms: string | null;
  currency: string;
  amountsAre: AmountsMode;
  lines: ImportedLine[];
  subtotal: string;
  taxTotal: string;
  total: string;
  xeroTotal: string | null;
  amountPaid: string;
  amountDue: string;
  payments: ImportedPayment[];
  xeroUpdatedAt: Date | null;
};

/** Statuses Xero calls dead. These are never offered for import. */
export const DEAD_STATUSES: ReadonlySet<string> = new Set(["DELETED", "VOIDED"]);

/** What "open" means per source, for the default (no date range) import. */
export const OPEN_STATUSES: Record<"quote" | "invoice", string[]> = {
  quote: ["DRAFT", "SENT", "ACCEPTED"],
  invoice: ["DRAFT", "SUBMITTED", "AUTHORISED"],
};

/**
 * The Gangway status a Xero status corresponds to (spec §4.6). Mirrors the
 * pull's rules (lib/xero/pull.ts) for a document seen for the first time.
 */
export function gangwayState(type: ImportDocType, xeroStatus: string): GangwayState {
  const s = xeroStatus.toUpperCase();
  if (DEAD_STATUSES.has(s)) return { status: "cancelled", quoteOutcome: null };
  if (type === "quote") {
    switch (s) {
      case "SENT":
        return { status: "open", quoteOutcome: null };
      // Accepted but not yet converted: open, so "Convert to sales order" leads.
      case "ACCEPTED":
        return { status: "open", quoteOutcome: "accepted" };
      // Xero says it was already invoiced there; nothing left to convert here.
      case "INVOICED":
        return { status: "closed", quoteOutcome: "accepted" };
      case "DECLINED":
        return { status: "closed", quoteOutcome: "declined" };
      default:
        return { status: "draft", quoteOutcome: null };
    }
  }
  switch (s) {
    case "AUTHORISED":
      return { status: "open", quoteOutcome: null };
    case "PAID":
      return { status: "closed", quoteOutcome: null };
    // SUBMITTED is "awaiting approval" in Xero; Gangway has no such state, and
    // the lines are still editable there, so it is a draft here.
    default:
      return { status: "draft", quoteOutcome: null };
  }
}

/** Xero's date forms → YYYY-MM-DD, as the date columns want. */
export function xeroDay(dateString?: string, dotNet?: string): string | null {
  if (dateString && /^\d{4}-\d{2}-\d{2}/.test(dateString)) return dateString.slice(0, 10);
  const match = /\/Date\((-?\d+)/.exec(dotNet ?? dateString ?? "");
  if (match) return new Date(Number(match[1])).toISOString().slice(0, 10);
  if (dotNet && /^\d{4}-\d{2}-\d{2}/.test(dotNet)) return dotNet.slice(0, 10);
  return null;
}

function xeroTimestamp(value?: string): Date | null {
  if (!value) return null;
  const match = /\/Date\((-?\d+)/.exec(value);
  if (match) return new Date(Number(match[1]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function amountsAreFrom(value?: string): AmountsMode {
  switch ((value ?? "").toUpperCase()) {
    case "INCLUSIVE":
      return "inclusive";
    case "NOTAX":
      return "no_tax";
    default:
      return "exclusive";
  }
}

const four = (value: number | string | undefined | null) => fromScaled(toScaled(value ?? 0));
const two = (value: number | string | undefined | null) => fromScaled(toCents(value ?? 0), 2);

/**
 * The rate a line was taxed at. The cached tax-rate table is the authority;
 * when a tax type is missing from it (a rate retired since), the rate is read
 * back from Xero's own amounts and rounded to two places.
 */
function rateFor(line: RawLineItem, mode: AmountsMode, rates: Map<string, string>): string {
  if (mode === "no_tax" || !line.TaxType) return "0";
  const known = rates.get(line.TaxType);
  if (known !== undefined) return known;
  const amount = line.LineAmount ?? 0;
  const tax = line.TaxAmount ?? 0;
  const base = mode === "inclusive" ? amount - tax : amount;
  if (!base || !tax) return "0";
  return (Math.round((tax / base) * 10_000) / 100).toFixed(2);
}

function discountFor(line: RawLineItem): string {
  if (line.DiscountRate) return four(line.DiscountRate);
  // Xero also allows a fixed discount; Gangway carries percentages, so it is
  // converted, to four places.
  const gross = (line.Quantity ?? 0) * (line.UnitAmount ?? 0);
  if (line.DiscountAmount && gross) return four(Math.round((line.DiscountAmount / gross) * 1_000_000) / 10_000);
  return "0";
}

/** Xero line items → Gangway rows, with Gangway's arithmetic applied. */
export function mapLines(
  raw: RawLineItem[],
  mode: AmountsMode,
  rates: Map<string, string>,
): { lines: ImportedLine[]; subtotal: string; taxTotal: string; total: string } {
  const rows = raw.map((line) => {
    const isText = !line.Quantity && !line.UnitAmount && !line.LineAmount;
    return {
      rowType: (isText ? "text" : "item") as ImportedLine["rowType"],
      itemCode: isText ? null : line.ItemCode?.trim() || null,
      description: (line.Description ?? "").trim(),
      quantity: isText ? "0" : four(line.Quantity ?? 1),
      unitPrice: isText ? "0" : four(line.UnitAmount ?? 0),
      discountPercent: isText ? "0" : discountFor(line),
      accountCode: isText ? null : line.AccountCode?.trim() || null,
      taxType: isText || mode === "no_tax" ? null : line.TaxType?.trim() || null,
      taxRate: isText ? "0" : rateFor(line, mode, rates),
    };
  });
  const totals = computeTotals(rows, mode);
  return {
    lines: rows.map((row, i) => ({
      ...row,
      lineAmount: totals.lines[i].lineAmount,
      taxAmount: totals.lines[i].taxAmount,
    })),
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
  };
}

export function mapPayments(raw: RawPayment[] | undefined): ImportedPayment[] {
  return (raw ?? [])
    .filter((p): p is RawPayment & { PaymentID: string } => Boolean(p.PaymentID))
    .map((p) => ({
      xeroPaymentId: p.PaymentID,
      date: xeroDay(undefined, p.Date),
      amount: two(p.Amount),
      reference: p.Reference?.trim() || null,
      accountCode: p.Account?.Code ?? null,
      status: p.Status ?? "AUTHORISED",
    }));
}

export function normaliseQuote(raw: RawQuote, rates: Map<string, string>): ImportedDoc {
  const mode = amountsAreFrom(raw.LineAmountTypes);
  const mapped = mapLines(raw.LineItems ?? [], mode, rates);
  const status = (raw.Status ?? "DRAFT").toUpperCase();
  return {
    type: "quote",
    xeroId: raw.QuoteID,
    number: raw.QuoteNumber?.trim() || null,
    xeroStatus: status,
    state: gangwayState("quote", status),
    contactId: raw.Contact?.ContactID ?? null,
    contactName: raw.Contact?.Name ?? "Unknown contact",
    docDate: xeroDay(raw.DateString, raw.Date),
    dueDate: xeroDay(raw.ExpiryDateString, raw.ExpiryDate),
    reference: raw.Reference?.trim() || null,
    title: raw.Title?.trim() || null,
    summary: raw.Summary?.trim() || null,
    terms: raw.Terms?.trim() || null,
    currency: raw.CurrencyCode ?? "AUD",
    amountsAre: mode,
    ...mapped,
    xeroTotal: raw.Total !== undefined ? two(raw.Total) : null,
    amountPaid: "0.00",
    amountDue: "0.00",
    payments: [],
    xeroUpdatedAt: xeroTimestamp(raw.UpdatedDateUTC),
  };
}

export function normaliseInvoice(raw: RawInvoice, rates: Map<string, string>): ImportedDoc {
  const mode = amountsAreFrom(raw.LineAmountTypes);
  const mapped = mapLines(raw.LineItems ?? [], mode, rates);
  const status = (raw.Status ?? "DRAFT").toUpperCase();
  const type: ImportDocType = raw.Type === "ACCPAY" ? "bill" : "invoice";
  return {
    type,
    xeroId: raw.InvoiceID,
    number: raw.InvoiceNumber?.trim() || null,
    xeroStatus: status,
    state: gangwayState(type, status),
    contactId: raw.Contact?.ContactID ?? null,
    contactName: raw.Contact?.Name ?? "Unknown contact",
    docDate: xeroDay(raw.DateString, raw.Date),
    dueDate: xeroDay(raw.DueDateString, raw.DueDate),
    reference: raw.Reference?.trim() || null,
    title: null,
    summary: null,
    terms: null,
    currency: raw.CurrencyCode ?? "AUD",
    amountsAre: mode,
    ...mapped,
    xeroTotal: raw.Total !== undefined ? two(raw.Total) : null,
    amountPaid: two(raw.AmountPaid),
    amountDue: two(raw.AmountDue ?? raw.Total),
    payments: mapPayments(raw.Payments),
    xeroUpdatedAt: xeroTimestamp(raw.UpdatedDateUTC),
  };
}

/** Whether Gangway's recomputed total agrees with Xero's to the cent. */
export function totalsAgree(doc: Pick<ImportedDoc, "total" | "xeroTotal">): boolean {
  return doc.xeroTotal === null || toCents(doc.total) === toCents(doc.xeroTotal);
}
