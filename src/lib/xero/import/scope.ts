/**
 * What a document import covers. Client-safe: the import screen builds it
 * from its form and the server parses it back from the query string.
 */

export const IMPORT_SOURCE_KEYS = ["quotes", "invoices", "purchase_orders", "bills"] as const;
export type ImportSourceKey = (typeof IMPORT_SOURCE_KEYS)[number];

export type ImportScope =
  /** The default: what is still live in Xero. */
  | { mode: "open" }
  /** Everything dated in a range, paid and accepted ones included. */
  | { mode: "range"; from: string; to: string }
  /** Particular documents: "INV-0028, INV-0031". */
  | { mode: "numbers"; numbers: string[] };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseScope(params: { mode?: string; from?: string; to?: string; numbers?: string }): ImportScope {
  if (params.mode === "range" && params.from && params.to && DAY.test(params.from) && DAY.test(params.to)) {
    return params.from <= params.to
      ? { mode: "range", from: params.from, to: params.to }
      : { mode: "range", from: params.to, to: params.from };
  }
  if (params.mode === "numbers") {
    const numbers = [
      ...new Set(
        (params.numbers ?? "")
          .split(/[\s,;]+/)
          .map((n) => n.trim().toUpperCase())
          .filter((n) => /^[A-Z0-9][A-Z0-9-]{0,40}$/.test(n)),
      ),
    ].slice(0, 25);
    if (numbers.length) return { mode: "numbers", numbers };
  }
  return { mode: "open" };
}

export function parseSource(value: string | undefined): ImportSourceKey {
  return (IMPORT_SOURCE_KEYS as readonly string[]).includes(value ?? "") ? (value as ImportSourceKey) : "quotes";
}

export function describeScope(scope: ImportScope): string {
  switch (scope.mode) {
    case "range":
      return `dated ${scope.from} to ${scope.to}`;
    case "numbers":
      return `matching ${scope.numbers.join(", ")}`;
    default:
      return "still open in Xero";
  }
}

/**
 * What the import will do with one Xero document:
 * - `create`: new here.
 * - `update`: imported before and untouched since — header, lines and money refreshed.
 * - `refresh`: already here and owned here — only Xero's status, money and payments.
 * - `waiting`: its contact is not matched to a business partner yet.
 * - `currency`: not in AUD; left out.
 */
export type DocPlan = "create" | "update" | "refresh" | "waiting" | "currency";

export type DocPreviewRow = {
  xeroId: string;
  type: "quote" | "invoice" | "purchase_order" | "bill";
  number: string | null;
  xeroStatus: string;
  contactId: string | null;
  contactName: string;
  partner: { id: string; name: string } | null;
  existingId: string | null;
  docDate: string | null;
  dueDate: string | null;
  total: string;
  xeroTotal: string | null;
  amountDue: string;
  lineCount: number;
  paymentCount: number;
  /** Gangway's arithmetic lands on a different total from Xero's. */
  totalsDiffer: boolean;
  plan: DocPlan;
  note: string | null;
};

export type ImportReport = {
  created: number;
  updated: number;
  refreshed: number;
  waiting: number;
  skipped: number;
  failed: string[];
  /** Partners whose pages should be revalidated. */
  touched: string[];
};
