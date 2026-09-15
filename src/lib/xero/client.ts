import "server-only";
import { getXeroSession, XeroAuthError } from "./auth";
import { XERO_API_BASE } from "./config";

/**
 * Read-only Xero Accounting API access.
 *
 * Two things about Xero's JSON that catch people out, both handled here:
 *
 * 1. Dates come back as `/Date(1518685950940+0000)/`, a .NET serialisation
 *    artefact, not ISO 8601. Some resources also carry a `DateString`; where
 *    they do it is preferred, and `parseXeroDate` handles the other form.
 * 2. Money arrives as a JSON number, so it is read as a number and formatted
 *    once at the edge rather than trusted as a pre-formatted string.
 */

export class XeroApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "XeroApiError";
  }

  /** Xero allows 60 calls a minute per tenant; this is that ceiling. */
  get isRateLimited() {
    return this.status === 429;
  }
}

async function xeroFetch<T>(path: string): Promise<T> {
  const { accessToken, tenantId } = await getXeroSession();

  const res = await fetch(`${XERO_API_BASE}${path}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "xero-tenant-id": tenantId,
      accept: "application/json",
    },
    cache: "no-store",
  });

  if (res.status === 401) {
    // The token was accepted at refresh time but rejected here — the grant has
    // been revoked in Xero rather than merely expired.
    throw new XeroAuthError("Xero rejected the connection. Reconnect it in Settings.", true);
  }
  if (!res.ok) {
    throw new XeroApiError(
      res.status,
      res.status === 429
        ? "Xero is rate limiting us. Try again in a minute."
        : `Xero returned ${res.status}.`,
    );
  }

  return (await res.json()) as T;
}

/** `/Date(1518685950940+0000)/` → Date. Returns null on anything unexpected. */
export function parseXeroDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const dotNet = /\/Date\((-?\d+)/.exec(value);
  if (dotNet) return new Date(Number(dotNet[1]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* ── contacts ─────────────────────────────────────────────────────── */

export type XeroContactSummary = {
  contactId: string;
  name: string;
  email: string | null;
  isCustomer: boolean;
  isSupplier: boolean;
};

type RawContact = {
  ContactID: string;
  Name: string;
  EmailAddress?: string;
  IsCustomer?: boolean;
  IsSupplier?: boolean;
  Balances?: {
    AccountsReceivable?: { Outstanding?: number; Overdue?: number };
    AccountsPayable?: { Outstanding?: number; Overdue?: number };
  };
};

/**
 * Contacts matching a search term. Xero's SearchTerm covers name, contact
 * number and email address, which is what someone types when linking.
 */
export async function searchXeroContacts(term: string): Promise<XeroContactSummary[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];

  const data = await xeroFetch<{ Contacts?: RawContact[] }>(
    `/Contacts?searchTerm=${encodeURIComponent(trimmed)}&page=1&pageSize=25&summaryOnly=true`,
  );

  return (data.Contacts ?? []).map((c) => ({
    contactId: c.ContactID,
    name: c.Name,
    email: c.EmailAddress?.trim() || null,
    isCustomer: Boolean(c.IsCustomer),
    isSupplier: Boolean(c.IsSupplier),
  }));
}

export type XeroBalances = {
  receivableOutstanding: number;
  receivableOverdue: number;
  payableOutstanding: number;
  payableOverdue: number;
};

export type XeroContactDetail = XeroContactSummary & { balances: XeroBalances };

/**
 * One contact including its balances.
 *
 * Balances are only returned when a contact is fetched by id — they are absent
 * from the list endpoint, which is why linking stores the id rather than
 * re-searching by name each time.
 */
export async function getXeroContact(contactId: string): Promise<XeroContactDetail | null> {
  const data = await xeroFetch<{ Contacts?: RawContact[] }>(`/Contacts/${contactId}`);
  const c = data.Contacts?.[0];
  if (!c) return null;

  const ar = c.Balances?.AccountsReceivable ?? {};
  const ap = c.Balances?.AccountsPayable ?? {};

  return {
    contactId: c.ContactID,
    name: c.Name,
    email: c.EmailAddress?.trim() || null,
    isCustomer: Boolean(c.IsCustomer),
    isSupplier: Boolean(c.IsSupplier),
    balances: {
      receivableOutstanding: ar.Outstanding ?? 0,
      receivableOverdue: ar.Overdue ?? 0,
      payableOutstanding: ap.Outstanding ?? 0,
      payableOverdue: ap.Overdue ?? 0,
    },
  };
}

/* ── invoices and bills ───────────────────────────────────────────── */

export type XeroInvoice = {
  invoiceId: string;
  number: string | null;
  /** ACCREC is money in (a sales invoice); ACCPAY is money out (a bill). */
  direction: "invoice" | "bill";
  status: string;
  date: Date | null;
  dueDate: Date | null;
  total: number;
  amountDue: number;
  amountPaid: number;
  currency: string | null;
  /**
   * Settled here rather than at render time: "now" must be evaluated once, on
   * the server, or the component stops being a pure function of its props.
   */
  overdue: boolean;
};

type RawInvoice = {
  InvoiceID: string;
  InvoiceNumber?: string;
  Type?: string;
  Status?: string;
  Date?: string;
  DateString?: string;
  DueDate?: string;
  DueDateString?: string;
  Total?: number;
  AmountDue?: number;
  AmountPaid?: number;
  CurrencyCode?: string;
};

/**
 * Invoices and bills for one contact, newest first.
 *
 * Drafts and deleted documents are excluded — they are not money owed and
 * would only make the history harder to read.
 */
export async function getXeroInvoices(
  contactId: string,
  limit = 20,
): Promise<XeroInvoice[]> {
  const where = encodeURIComponent(
    `Contact.ContactID==Guid("${contactId}") AND Status!="DELETED" AND Status!="VOIDED" AND Status!="DRAFT"`,
  );
  const data = await xeroFetch<{ Invoices?: RawInvoice[] }>(
    `/Invoices?where=${where}&order=${encodeURIComponent("Date DESC")}&page=1`,
  );

  const now = Date.now();

  return (data.Invoices ?? []).slice(0, limit).map((i) => {
    const dueDate = parseXeroDate(i.DueDateString ?? i.DueDate);
    const amountDue = i.AmountDue ?? 0;
    return {
      invoiceId: i.InvoiceID,
      number: i.InvoiceNumber?.trim() || null,
      direction: i.Type === "ACCPAY" ? ("bill" as const) : ("invoice" as const),
      status: i.Status ?? "UNKNOWN",
      date: parseXeroDate(i.DateString ?? i.Date),
      dueDate,
      total: i.Total ?? 0,
      amountDue,
      amountPaid: i.AmountPaid ?? 0,
      currency: i.CurrencyCode ?? null,
      overdue: amountDue > 0 && dueDate !== null && dueDate.getTime() < now,
    };
  });
}
