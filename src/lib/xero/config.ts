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
 */
export const XERO_SCOPES = [
  "offline_access",
  "accounting.contacts.read",
  "accounting.transactions.read",
  "accounting.reports.read",
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
