/**
 * Deep links into Xero's own UI, where documents are sent from. Client-safe.
 *
 * The invoice link is Xero's long-standing one. The quote and purchase-order
 * links follow the same pattern and should be confirmed against the demo
 * company; if Xero has moved them, this is the one place to change.
 */
export function xeroWebUrl(type: string, xeroId: string | null): string | null {
  if (!xeroId) return null;
  switch (type) {
    case "invoice":
      return `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${xeroId}`;
    case "bill":
      return `https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=${xeroId}`;
    case "quote":
      return `https://go.xero.com/Accounts/Receivable/Quotes/View/${xeroId}`;
    case "purchase_order":
      return `https://go.xero.com/Accounts/Payable/PurchaseOrders/View/${xeroId}`;
    default:
      return null;
  }
}

export function xeroContactUrl(contactId: string | null): string | null {
  return contactId ? `https://go.xero.com/Contacts/View/${contactId}` : null;
}
