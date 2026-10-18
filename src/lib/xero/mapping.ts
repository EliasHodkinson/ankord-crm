import { formatMoney, fromScaled, toScaled } from "../sales/money";

/**
 * Gangway documents → Xero payloads. Pure, so it is tested without Xero.
 *
 * Gangway owns lines and quantities; Xero owns numbers, status and money. So a
 * payload never carries QuoteNumber or InvoiceNumber (Xero assigns them), and
 * rows Xero has no concept of — alternatives, text, subtotals — go across as
 * description-only lines, which carry no amount and leave the totals equal.
 */

export type MapLine = {
  rowType: "item" | "alternative" | "text" | "subtotal";
  description: string;
  note: string | null;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  accountCode: string | null;
  taxType: string | null;
  /** Set only when the item exists in Xero, so ItemCode never points at nothing. */
  xeroItemCode: string | null;
  lineAmount: string;
  /** On a subtotal row, the sum it shows. */
  subtotalValue?: string | null;
};

export type MapDoc = {
  id: string;
  type: "quote" | "invoice" | "purchase_order" | "bill";
  status: "draft" | "open" | "closed" | "cancelled";
  quoteOutcome: "accepted" | "declined" | "expired" | null;
  xeroId: string | null;
  xeroStatus: string | null;
  xeroContactId: string;
  reference: string | null;
  docDate: string;
  dueDate: string | null;
  amountsAre: "exclusive" | "inclusive" | "no_tax";
  title: string | null;
  summary: string | null;
  terms: string | null;
  /** The sales order this traces to, if any — goes into Reference. */
  salesOrderNumber: string | null;
  /**
   * Brought in from Xero rather than created by a push. It was never created
   * from here, so it needs no lost-create marker on its Reference.
   */
  imported?: boolean;
  /* Purchasing (phase B). */
  shipToText?: string | null;
  contactName?: string | null;
  remarks?: string | null;
  /** Bills: the supplier's own invoice number, which is Xero's InvoiceNumber on ACCPAY. */
  supplierInvoiceNumber?: string | null;
  /** Bills: the PO it was entered against, which goes into Reference. */
  purchaseOrderNumber?: string | null;
  /** Partner name, for a PO raised for a sales order ("SO-00017 · Maple Street"). */
  customerName?: string | null;
  /** POs: every line fully billed here, so Xero's PO should be BILLED. */
  fullyBilled?: boolean;
  brandingThemeId: string | null;
};

export type XeroLineItem = {
  Description: string;
  Quantity?: number;
  UnitAmount?: number;
  DiscountRate?: number;
  AccountCode?: string;
  TaxType?: string;
  ItemCode?: string;
};

const LINE_AMOUNT_TYPES = {
  exclusive: "Exclusive",
  inclusive: "Inclusive",
  no_tax: "NoTax",
} as const;

/** Xero's Reference field limit on invoices. */
export const REFERENCE_LIMIT = 255;

/** Numbers as Xero wants them: JSON numbers, at most four places. */
const n4 = (value: string) => Number(fromScaled(toScaled(value)));

function description(line: MapLine): string {
  const text = line.description.trim();
  const note = line.note?.trim();
  return note ? `${text}\n${note}` : text;
}

export function toLineItems(lines: MapLine[], amountsAre: MapDoc["amountsAre"]): XeroLineItem[] {
  return lines.map((line): XeroLineItem => {
    switch (line.rowType) {
      case "alternative":
        return { Description: `Optional: ${description(line)} — ${formatMoney(line.lineAmount)}` };
      case "text":
        return { Description: description(line) };
      case "subtotal":
        return { Description: `Subtotal ${formatMoney(line.subtotalValue ?? "0")}` };
      case "item": {
        const item: XeroLineItem = {
          Description: description(line),
          Quantity: n4(line.quantity),
          UnitAmount: n4(line.unitPrice),
        };
        if (toScaled(line.discountPercent) > BigInt(0)) item.DiscountRate = n4(line.discountPercent);
        if (line.accountCode) item.AccountCode = line.accountCode;
        if (amountsAre !== "no_tax" && line.taxType) item.TaxType = line.taxType;
        if (line.xeroItemCode) item.ItemCode = line.xeroItemCode;
        return item;
      }
    }
  });
}

/**
 * The marker that lets a lost create be found again: Gangway cannot know the
 * Xero number in advance, so it stamps its own id on the Reference.
 */
export const markerFor = (documentId: string) => `gw:${documentId.slice(0, 8)}`;

/**
 * Reference carries the job, so someone in Xero can tell which order a
 * document belongs to. Truncated from the front of the customer's part, never
 * the SO number or the marker.
 */
export function buildReference(
  parts: { customerRef: string | null; salesOrderNumber: string | null; marker?: string | null },
  limit = REFERENCE_LIMIT,
): string | null {
  const tail = [parts.salesOrderNumber, parts.marker].filter(Boolean).join(" · ");
  const head = parts.customerRef?.trim() ?? "";
  if (!head) return tail || null;
  if (!tail) return head.slice(0, limit);
  const room = limit - tail.length - 3;
  return room > 0 ? `${head.slice(0, room)} · ${tail}` : tail.slice(0, limit);
}

const QUOTE_RANK: Record<string, number> = {
  DRAFT: 0,
  SENT: 1,
  DECLINED: 2,
  ACCEPTED: 2,
  INVOICED: 3,
  DELETED: 4,
};

/**
 * The Xero quote status Gangway's state calls for. Never moves Xero
 * backwards: a quote someone sent from Xero is not pushed back to DRAFT just
 * because the pull has not caught up yet.
 */
export function quoteStatusFor(doc: Pick<MapDoc, "status" | "quoteOutcome" | "xeroStatus">): string {
  let wanted: string;
  // Xero has no "expired": a quote that lapsed here is left as Xero has it.
  if (doc.status !== "cancelled" && doc.quoteOutcome === "expired") return doc.xeroStatus ?? "DRAFT";
  if (doc.status === "cancelled") wanted = "DELETED";
  else if (doc.quoteOutcome === "declined") wanted = "DECLINED";
  else if (doc.quoteOutcome === "accepted" || doc.status === "closed") wanted = "ACCEPTED";
  else if (doc.status === "open") wanted = "SENT";
  else wanted = "DRAFT";

  const current = doc.xeroStatus ?? "DRAFT";
  if (wanted !== "DELETED" && (QUOTE_RANK[current] ?? 0) > (QUOTE_RANK[wanted] ?? 0)) {
    return current;
  }
  return wanted;
}

/** The Xero invoice status Gangway's state calls for. */
export function invoiceStatusFor(doc: Pick<MapDoc, "status" | "xeroStatus">): string {
  if (doc.status === "cancelled") {
    return !doc.xeroStatus || doc.xeroStatus === "DRAFT" ? "DELETED" : "VOIDED";
  }
  if (doc.status === "open" || doc.status === "closed") {
    // PAID is Xero's to set; asking for it would be refused.
    return doc.xeroStatus === "PAID" ? "PAID" : "AUTHORISED";
  }
  return "DRAFT";
}

export function quotePayload(doc: MapDoc, lines: MapLine[]) {
  return {
    ...(doc.xeroId ? { QuoteID: doc.xeroId } : {}),
    Contact: { ContactID: doc.xeroContactId },
    Date: doc.docDate,
    ...(doc.dueDate ? { ExpiryDate: doc.dueDate } : {}),
    Reference:
      buildReference({
        customerRef: doc.reference,
        salesOrderNumber: null,
        marker: doc.imported ? null : markerFor(doc.id),
      }) ?? undefined,
    ...(doc.title ? { Title: doc.title } : {}),
    ...(doc.summary ? { Summary: doc.summary } : {}),
    ...(doc.terms ? { Terms: doc.terms } : {}),
    LineAmountTypes: LINE_AMOUNT_TYPES[doc.amountsAre],
    CurrencyCode: "AUD",
    Status: quoteStatusFor(doc),
    LineItems: toLineItems(lines, doc.amountsAre),
    ...(doc.brandingThemeId ? { BrandingThemeID: doc.brandingThemeId } : {}),
  };
}

export function invoicePayload(doc: MapDoc, lines: MapLine[]) {
  return {
    ...(doc.xeroId ? { InvoiceID: doc.xeroId } : {}),
    Type: "ACCREC",
    Contact: { ContactID: doc.xeroContactId },
    Date: doc.docDate,
    ...(doc.dueDate ? { DueDate: doc.dueDate } : {}),
    Reference:
      buildReference({ customerRef: doc.reference, salesOrderNumber: doc.salesOrderNumber }) ??
      undefined,
    LineAmountTypes: LINE_AMOUNT_TYPES[doc.amountsAre],
    CurrencyCode: "AUD",
    Status: invoiceStatusFor(doc),
    LineItems: toLineItems(lines, doc.amountsAre),
    ...(doc.brandingThemeId ? { BrandingThemeID: doc.brandingThemeId } : {}),
  };
}

/** Status-only update — voiding or deleting needs nothing else. */
export function invoiceStatusPayload(doc: Pick<MapDoc, "xeroId" | "status" | "xeroStatus">) {
  return { InvoiceID: doc.xeroId, Status: invoiceStatusFor(doc) };
}

/** The Xero item payload. Always untracked: Gangway counts stock, Xero does not (D4). */
export function itemPayload(item: {
  code: string;
  name: string;
  description: string | null;
  purchaseDescription: string | null;
  isSold: boolean;
  isPurchased: boolean;
  salePrice: string | null;
  purchasePrice: string | null;
  salesAccountCode: string | null;
  purchaseAccountCode: string | null;
  salesTaxType: string | null;
  purchaseTaxType: string | null;
  xeroItemId: string | null;
}) {
  const details = (price: string | null, account: string | null, tax: string | null) => ({
    ...(price !== null ? { UnitPrice: n4(price) } : {}),
    ...(account ? { AccountCode: account } : {}),
    ...(tax ? { TaxType: tax } : {}),
  });
  return {
    ...(item.xeroItemId ? { ItemID: item.xeroItemId } : {}),
    Code: item.code.slice(0, 30),
    Name: item.name.slice(0, 50),
    ...(item.description ? { Description: item.description } : {}),
    ...(item.purchaseDescription ? { PurchaseDescription: item.purchaseDescription } : {}),
    IsSold: item.isSold,
    IsPurchased: item.isPurchased,
    IsTrackedAsInventory: false,
    ...(item.isSold
      ? { SalesDetails: details(item.salePrice, item.salesAccountCode, item.salesTaxType) }
      : {}),
    ...(item.isPurchased
      ? {
          PurchaseDetails: details(
            item.purchasePrice,
            item.purchaseAccountCode,
            item.purchaseTaxType,
          ),
        }
      : {}),
  };
}

/** "Converted to sales order SO-00017 in The Gangway." and friends. */
export const HISTORY = {
  quoteConverted: (target: string) => `Converted to ${target} in The Gangway.`,
  poRaised: (salesNumber: string, customer: string) => `Raised for ${salesNumber} (${customer}) in The Gangway.`,
  shipped: (what: string) => `Shipped: ${what}. Tracked in The Gangway.`,
  received: (what: string, receipt: string, day: string, full: boolean) =>
    `Received ${what} (${receipt}) on ${day}.${full ? " Fully received." : ""}`,
  delivered: (what: string, delivery: string, day: string, full: boolean) =>
    `Delivered ${what} (${delivery}) on ${day}.${full ? " All goods delivered." : ""}`,
  goodsToFollow: (salesNumber: string | null) =>
    `Reserve invoice: goods to follow. Delivery tracked in The Gangway${salesNumber ? ` (${salesNumber})` : ""}.`,
  cancelled: (number: string) => `${number} cancelled in The Gangway.`,
  created: (documentId: string) => `Created in The Gangway (gw:${documentId}).`,
} as const;

/* ── purchasing (phase B) ────────────────────────────────────────── */

/** Xero's limits on the PO text fields Gangway fills. */
const PO_LIMITS = { attention: 255, instructions: 500, address: 500 } as const;

/**
 * The Xero PO status Gangway's state calls for: approved is AUTHORISED, fully
 * billed here is BILLED, cancelled is DELETED. Never moves Xero back from
 * BILLED, which a bill entered in Xero sets.
 */
export function purchaseOrderStatusFor(doc: Pick<MapDoc, "status" | "xeroStatus" | "fullyBilled">): string {
  if (doc.status === "cancelled") return "DELETED";
  if (doc.status === "draft") return "DRAFT";
  if (doc.xeroStatus === "BILLED" || doc.fullyBilled) return "BILLED";
  return "AUTHORISED";
}

/**
 * A PO's Reference carries the job ("SO-00017 · Maple Street Kitchens"), or
 * whatever was typed, and Gangway's marker so a lost create can be found.
 */
export function purchaseOrderReference(doc: MapDoc): string | null {
  const job = doc.salesOrderNumber
    ? [doc.salesOrderNumber, doc.customerName].filter(Boolean).join(" · ")
    : null;
  const typed = doc.reference?.trim() || null;
  return buildReference({
    customerRef: typed && job && typed.includes(doc.salesOrderNumber!) ? null : typed,
    salesOrderNumber: typed && job && typed.includes(doc.salesOrderNumber!) ? typed : job,
    marker: doc.imported ? null : markerFor(doc.id),
  });
}

export function purchaseOrderPayload(doc: MapDoc, lines: MapLine[]) {
  return {
    ...(doc.xeroId ? { PurchaseOrderID: doc.xeroId } : {}),
    Contact: { ContactID: doc.xeroContactId },
    Date: doc.docDate,
    ...(doc.dueDate ? { DeliveryDate: doc.dueDate } : {}),
    ...(doc.shipToText ? { DeliveryAddress: doc.shipToText.slice(0, PO_LIMITS.address) } : {}),
    ...(doc.contactName ? { AttentionTo: doc.contactName.slice(0, PO_LIMITS.attention) } : {}),
    ...(doc.remarks ? { DeliveryInstructions: doc.remarks.slice(0, PO_LIMITS.instructions) } : {}),
    Reference: purchaseOrderReference(doc) ?? undefined,
    LineAmountTypes: LINE_AMOUNT_TYPES[doc.amountsAre],
    CurrencyCode: "AUD",
    Status: purchaseOrderStatusFor(doc),
    LineItems: toLineItems(lines, doc.amountsAre),
    ...(doc.brandingThemeId ? { BrandingThemeID: doc.brandingThemeId } : {}),
  };
}

/** A supplier bill (ACCPAY). Its InvoiceNumber is the supplier's; Reference is the PO. */
export function billPayload(doc: MapDoc, lines: MapLine[]) {
  return {
    ...(doc.xeroId ? { InvoiceID: doc.xeroId } : {}),
    Type: "ACCPAY",
    ...(doc.supplierInvoiceNumber ? { InvoiceNumber: doc.supplierInvoiceNumber } : {}),
    Contact: { ContactID: doc.xeroContactId },
    Date: doc.docDate,
    ...(doc.dueDate ? { DueDate: doc.dueDate } : {}),
    Reference: billReference(doc) ?? undefined,
    LineAmountTypes: LINE_AMOUNT_TYPES[doc.amountsAre],
    CurrencyCode: "AUD",
    Status: invoiceStatusFor(doc),
    LineItems: toLineItems(lines, doc.amountsAre),
  };
}

/** "PO-0031", plus anything else typed that does not already say it. */
export function billReference(doc: Pick<MapDoc, "reference" | "purchaseOrderNumber">): string | null {
  const typed = doc.reference?.trim() || null;
  const po = doc.purchaseOrderNumber ?? null;
  if (typed && po && typed.includes(po)) return typed.slice(0, REFERENCE_LIMIT);
  return buildReference({ customerRef: typed, salesOrderNumber: po });
}
