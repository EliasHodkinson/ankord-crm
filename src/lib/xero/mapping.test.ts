import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReference,
  invoicePayload,
  invoiceStatusFor,
  itemPayload,
  markerFor,
  quotePayload,
  quoteStatusFor,
  toLineItems,
  type MapDoc,
  type MapLine,
} from "./mapping";

const doc: MapDoc = {
  id: "0b6f2a7c-1111-2222-3333-444455556666",
  type: "quote",
  status: "draft",
  quoteOutcome: null,
  xeroId: null,
  xeroStatus: null,
  xeroContactId: "c0ffee00-0000-0000-0000-000000000001",
  reference: "PO 7781",
  docDate: "2026-10-18",
  dueDate: "2026-11-17",
  amountsAre: "exclusive",
  title: "Business cards",
  summary: null,
  terms: null,
  salesOrderNumber: null,
  brandingThemeId: null,
};

const line = (over: Partial<MapLine> = {}): MapLine => ({
  rowType: "item",
  description: "Business cards",
  note: null,
  quantity: "500.0000",
  unitPrice: "0.3000",
  discountPercent: "0.0000",
  accountCode: "200",
  taxType: "OUTPUT",
  xeroItemCode: null,
  lineAmount: "150.00",
  ...over,
});

test("item rows carry quantity, price, account and tax; notes join the description", () => {
  const [li] = toLineItems([line({ note: "Matt laminate", discountPercent: "5", xeroItemCode: "BC-500" })], "exclusive");
  assert.deepEqual(li, {
    Description: "Business cards\nMatt laminate",
    Quantity: 500,
    UnitAmount: 0.3,
    DiscountRate: 5,
    AccountCode: "200",
    TaxType: "OUTPUT",
    ItemCode: "BC-500",
  });
});

test("alternatives, text and subtotals go as description-only lines with no amount", () => {
  const items = toLineItems(
    [
      line({ rowType: "alternative", lineAmount: "50.00", description: "Spot UV" }),
      line({ rowType: "text", description: "Printing" }),
      line({ rowType: "subtotal", subtotalValue: "150.00" }),
    ],
    "exclusive",
  );
  assert.deepEqual(items, [
    { Description: "Optional: Spot UV — $50.00" },
    { Description: "Printing" },
    { Description: "Subtotal $150.00" },
  ]);
});

test("no-tax documents send no TaxType", () => {
  const [li] = toLineItems([line()], "no_tax");
  assert.equal(li.TaxType, undefined);
});

test("the quote reference carries the marker that finds a lost create", () => {
  const payload = quotePayload(doc, [line()]);
  assert.equal(payload.Reference, `PO 7781 · ${markerFor(doc.id)}`);
  assert.equal(markerFor(doc.id), "gw:0b6f2a7c");
  assert.equal("QuoteNumber" in payload, false);
  assert.equal(payload.Status, "DRAFT");
  assert.equal(payload.LineAmountTypes, "Exclusive");
  assert.equal(payload.ExpiryDate, "2026-11-17");
});

test("the invoice reference carries the sales order, and never a number", () => {
  const payload = invoicePayload({ ...doc, type: "invoice", salesOrderNumber: "SO-00017" }, [line()]);
  assert.equal(payload.Reference, "PO 7781 · SO-00017");
  assert.equal(payload.Type, "ACCREC");
  assert.equal("InvoiceNumber" in payload, false);
  const bare = invoicePayload({ ...doc, type: "invoice", reference: null, salesOrderNumber: "SO-00017" }, [line()]);
  assert.equal(bare.Reference, "SO-00017");
});

test("long references are cut from the customer's part, never the SO number", () => {
  const ref = buildReference({ customerRef: "x".repeat(300), salesOrderNumber: "SO-00017" });
  assert.ok(ref!.length <= 255);
  assert.ok(ref!.endsWith(" · SO-00017"));
});

test("quote status never moves Xero backwards", () => {
  assert.equal(quoteStatusFor({ status: "draft", quoteOutcome: null, xeroStatus: "SENT" }), "SENT");
  assert.equal(quoteStatusFor({ status: "open", quoteOutcome: "accepted", xeroStatus: "SENT" }), "ACCEPTED");
  assert.equal(quoteStatusFor({ status: "closed", quoteOutcome: "accepted", xeroStatus: "INVOICED" }), "INVOICED");
  assert.equal(quoteStatusFor({ status: "closed", quoteOutcome: "declined", xeroStatus: "SENT" }), "DECLINED");
  assert.equal(quoteStatusFor({ status: "closed", quoteOutcome: "expired", xeroStatus: "SENT" }), "SENT");
  assert.equal(quoteStatusFor({ status: "cancelled", quoteOutcome: null, xeroStatus: "SENT" }), "DELETED");
});

test("invoice status: drafts delete, approved ones void", () => {
  assert.equal(invoiceStatusFor({ status: "draft", xeroStatus: "DRAFT" }), "DRAFT");
  assert.equal(invoiceStatusFor({ status: "open", xeroStatus: "DRAFT" }), "AUTHORISED");
  assert.equal(invoiceStatusFor({ status: "cancelled", xeroStatus: "DRAFT" }), "DELETED");
  assert.equal(invoiceStatusFor({ status: "cancelled", xeroStatus: "AUTHORISED" }), "VOIDED");
});

test("items go to Xero untracked, with their accounts and tax", () => {
  const payload = itemPayload({
    code: "BC-500",
    name: "Business cards (500)",
    description: "500 business cards",
    purchaseDescription: null,
    isSold: true,
    isPurchased: true,
    salePrice: "150.0000",
    purchasePrice: null,
    salesAccountCode: "200",
    purchaseAccountCode: "310",
    salesTaxType: "OUTPUT",
    purchaseTaxType: "INPUT",
    xeroItemId: null,
  });
  assert.equal(payload.IsTrackedAsInventory, false);
  assert.deepEqual(payload.SalesDetails, { UnitPrice: 150, AccountCode: "200", TaxType: "OUTPUT" });
  assert.deepEqual(payload.PurchaseDetails, { AccountCode: "310", TaxType: "INPUT" });
});

test("an imported quote keeps its Reference as Xero had it", () => {
  const payload = quotePayload({ ...doc, xeroId: "q-1", imported: true }, []);
  assert.equal(payload.Reference, "PO 7781");
});
