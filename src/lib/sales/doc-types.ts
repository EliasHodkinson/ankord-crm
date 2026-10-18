/**
 * Per-type configuration for sales and purchasing documents. Client-safe: the
 * list, detail and editor components are one implementation configured from
 * here, and the server reads the same rules.
 */

export type DocType =
  | "quote"
  | "sales_order"
  | "invoice"
  | "delivery"
  | "purchase_order"
  | "goods_receipt"
  | "bill";

/** The derived counter on a source line that a copy-to consumes. */
export type Counter =
  | "qtyConverted"
  | "qtyOrdered"
  | "qtyAllocated"
  | "qtyInvoiced"
  | "qtyDelivered"
  | "qtyReceived"
  | "qtyBilled";

export type DocTypeConfig = {
  label: string;
  plural: string;
  /** Route base for list, new, detail and edit. */
  base: string;
  /** Saved-view entity key. */
  entity: string;
  /** Who the partner is. */
  side: "customer" | "supplier";
  /** Xero resource, or null for Gangway-only documents. */
  xero: "Quotes" | "Invoices" | "PurchaseOrders" | null;
  /** What `dueDate` means on this type, and whether it is required. */
  dueLabel: string | null;
  dueRequired: boolean;
  /** Which row types the editor offers. */
  rows: ("item" | "alternative" | "text" | "subtotal")[];
  /** Built in this phase. Later phases flip theirs on. */
  available: boolean;
  /** Made by an action of its own (Receive, Deliver), never in the editor. */
  recordOnly?: boolean;
};

export const DOC_TYPES: Record<DocType, DocTypeConfig> = {
  quote: {
    label: "Quote",
    plural: "Quotes",
    base: "/sales/quotes",
    entity: "quotes",
    side: "customer",
    xero: "Quotes",
    dueLabel: "Valid until",
    dueRequired: true,
    rows: ["item", "alternative", "text", "subtotal"],
    available: true,
  },
  sales_order: {
    label: "Sales order",
    plural: "Sales orders",
    base: "/sales/orders",
    entity: "sales_orders",
    side: "customer",
    xero: null,
    dueLabel: "Delivery date",
    dueRequired: true,
    rows: ["item", "text", "subtotal"],
    available: true,
  },
  invoice: {
    label: "Invoice",
    plural: "Invoices",
    base: "/sales/invoices",
    entity: "invoices",
    side: "customer",
    xero: "Invoices",
    dueLabel: "Due date",
    dueRequired: false,
    rows: ["item", "text", "subtotal"],
    available: true,
  },
  delivery: {
    label: "Delivery",
    plural: "Deliveries",
    base: "/sales/deliveries",
    entity: "deliveries",
    side: "customer",
    recordOnly: true,
    xero: null,
    dueLabel: null,
    dueRequired: false,
    rows: ["item"],
    available: true,
  },
  purchase_order: {
    label: "Purchase order",
    plural: "Purchase orders",
    base: "/purchasing/orders",
    entity: "purchase_orders",
    side: "supplier",
    xero: "PurchaseOrders",
    dueLabel: "Delivery date",
    dueRequired: true,
    rows: ["item", "text", "subtotal"],
    available: true,
  },
  goods_receipt: {
    label: "Goods receipt",
    plural: "Receipts",
    base: "/purchasing/receipts",
    entity: "receipts",
    side: "supplier",
    recordOnly: true,
    xero: null,
    dueLabel: null,
    dueRequired: false,
    rows: ["item"],
    available: true,
  },
  bill: {
    label: "Bill",
    plural: "Bills",
    base: "/purchasing/bills",
    entity: "bills",
    side: "supplier",
    xero: "Invoices",
    dueLabel: "Due date",
    dueRequired: false,
    rows: ["item", "text"],
    available: true,
  },
};

export const isXeroType = (type: DocType) => DOC_TYPES[type].xero !== null;

/** Local numbering series key per Gangway-only type. */
export const LOCAL_SERIES: Partial<Record<DocType, string>> = {
  sales_order: "sales_order",
  goods_receipt: "goods_receipt",
  delivery: "delivery",
};

/**
 * Copy-to paths: from an open document, to what, consuming which counter on
 * the source line. Raising a PO from a sales order is not here — it links by
 * `sourceLineId` and does not consume the line (phase B, §6.2).
 */
export const COPY_TO: Partial<Record<DocType, { to: DocType; reserve?: boolean; counter: Counter }[]>> = {
  quote: [
    { to: "sales_order", counter: "qtyConverted" },
    { to: "invoice", counter: "qtyConverted" },
  ],
  sales_order: [
    { to: "invoice", counter: "qtyInvoiced" },
    { to: "invoice", reserve: true, counter: "qtyInvoiced" },
  ],
  invoice: [{ to: "delivery", counter: "qtyDelivered" }],
  purchase_order: [
    { to: "goods_receipt", counter: "qtyReceived" },
    { to: "bill", counter: "qtyBilled" },
  ],
};

/** The counter a copy from `from` into `to` consumes, or null if not allowed. */
export function copyCounter(from: DocType, to: DocType, reserve = false): Counter | null {
  return COPY_TO[from]?.find((p) => p.to === to && Boolean(p.reserve) === reserve)?.counter ?? null;
}

/**
 * "QU-0042", or until Xero has numbered it: "Draft quote", or for one that is
 * already approved or sent, "Invoice (not in Xero yet)".
 */
export function documentTitle(doc: {
  type: DocType;
  number: string | null;
  isReserve?: boolean;
  status?: string;
}) {
  if (doc.number) return doc.number;
  const label = doc.type === "invoice" && doc.isReserve ? "Reserve invoice" : DOC_TYPES[doc.type].label;
  if (doc.status && doc.status !== "draft") return `${label} (not in Xero yet)`;
  return `Draft ${label.toLowerCase()}`;
}

/** The label for one document, reserve invoices included. */
export function typeLabel(type: DocType, isReserve = false) {
  return type === "invoice" && isReserve ? "Reserve invoice" : DOC_TYPES[type].label;
}

export function docHref(doc: { type: DocType; id: string }) {
  return `${DOC_TYPES[doc.type].base}/${doc.id}`;
}

/** Most lines a document may have (EduCom's cap, kept). */
export const MAX_LINES = 300;
