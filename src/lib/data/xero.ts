import "server-only";
import { getXeroContact, getXeroInvoices, XeroApiError } from "@/lib/xero/client";
import { XeroAuthError } from "@/lib/xero/auth";
import type { XeroContactDetail, XeroInvoice } from "@/lib/xero/client";

export type XeroSnapshot = {
  contact: XeroContactDetail | null;
  invoices: XeroInvoice[];
  /** Set when Xero could not be reached; the page still renders without it. */
  error: string | null;
  /** True when the fix is "an admin needs to reconnect Xero in Settings". */
  needsReconnect: boolean;
};

const EMPTY: XeroSnapshot = {
  contact: null,
  invoices: [],
  error: null,
  needsReconnect: false,
};

/**
 * Everything the customer page shows from Xero, in one place.
 *
 * Xero is a third party on someone else's uptime, so a failure here degrades
 * the panel rather than the page: the CRM's own record must still open when
 * Xero is down, rate limiting, or disconnected.
 */
export async function readXeroSnapshot(
  xeroContactId: string | null,
): Promise<XeroSnapshot> {
  if (!xeroContactId) return EMPTY;

  try {
    // Both calls are needed and independent, so they go together rather than
    // in series — two round trips to Sydney is enough.
    const [contact, invoices] = await Promise.all([
      getXeroContact(xeroContactId),
      getXeroInvoices(xeroContactId),
    ]);
    return { contact, invoices, error: null, needsReconnect: false };
  } catch (error) {
    if (error instanceof XeroAuthError) {
      return { ...EMPTY, error: error.message, needsReconnect: error.needsReconnect };
    }
    if (error instanceof XeroApiError) {
      return { ...EMPTY, error: error.message, needsReconnect: false };
    }
    return { ...EMPTY, error: "Could not reach Xero." };
  }
}
