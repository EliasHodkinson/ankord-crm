/**
 * Xero connection constants, kept out of the `"use server"` modules so the
 * settings page and the connect button can import them too.
 */

export const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
export const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
export const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";

/**
 * Read-only throughout. The CRM shows what Xero knows; it never writes an
 * invoice or edits a contact, so no `.write` scope is requested.
 *
 * `offline_access` is what yields a refresh token — without it the connection
 * dies thirty minutes after it is made.
 *
 * **These must be the granular scopes.** Xero split the broad ones on
 * 2 March 2026, and an app created on or after that date cannot use the old
 * names at all — requesting them fails the authorize call outright with
 * `invalid_scope`, before the user ever sees a consent screen:
 *
 *   accounting.transactions.read → accounting.invoices.read (and payments,
 *                                  banktransactions, manualjournals)
 *   accounting.reports.read      → one scope per report; aged is the one
 *                                  that carries receivables and payables
 *
 * Only what is actually displayed is requested. Invoices carry AmountDue and
 * AmountPaid, so accounting.payments.read is not needed to show a balance.
 */
export const XERO_SCOPES = [
  "offline_access",
  "accounting.contacts.read",
  "accounting.invoices.read",
  "accounting.reports.aged.read",
] as const;

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
