/**
 * Xero connection constants, kept out of the `"use server"` modules so the
 * settings page and the connect button can import them too.
 */

export const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
export const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
export const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";

/**
 * What The Gangway asks Xero for.
 *
 * Since the sales and purchasing work (docs/sales-erp-spec.md), Gangway
 * **writes** to Xero: it creates quotes, invoices, purchase orders, bills and
 * items as drafts, adds history notes, and creates a contact when an
 * organisation has none. It still never edits an existing contact, and it
 * never records a payment — payments are made in Xero and read back.
 *
 * `offline_access` is what yields a refresh token — without it the connection
 * dies thirty minutes after it is made.
 *
 * **These must be the granular scopes.** Xero split the broad ones on
 * 2 March 2026, and an app created on or after that date cannot use the old
 * names at all — requesting them fails the authorize call outright with
 * `invalid_scope`, before the user ever sees a consent screen:
 *
 *   accounting.transactions → accounting.invoices (invoices, bills, quotes,
 *                             purchase orders, items, their history),
 *                             accounting.payments, …
 *   accounting.reports.read → one scope per report; aged is the one that
 *                             carries receivables and payables
 *
 * If Xero refuses one of these names at connect time, this list is the only
 * place to change.
 */
export const XERO_SCOPES = [
  "offline_access",
  "accounting.contacts",
  "accounting.invoices",
  "accounting.settings.read",
  "accounting.payments.read",
  "accounting.reports.aged.read",
] as const;

/** Without these, nothing can be pushed; the settings page asks for a reconnect. */
export const XERO_WRITE_SCOPES = [
  "accounting.invoices",
  "accounting.contacts",
  "accounting.settings.read",
] as const;

/** Which of the write scopes a stored grant lacks. A null grant lacks them all. */
export function missingXeroScopes(granted: string | null | undefined): string[] {
  const have = new Set((granted ?? "").split(/\s+/).filter(Boolean));
  return XERO_WRITE_SCOPES.filter((s) => !have.has(s));
}

export const XERO_SCOPE_STRING = XERO_SCOPES.join(" ");

/** Xero's own limits, worth honouring rather than discovering. */
export const XERO_RATE_LIMIT = {
  perMinute: 60,
  perDay: 5000,
} as const;

export function xeroConfigured(): boolean {
  return Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);
}

export function xeroRedirectUri(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/xero/callback`;
}
