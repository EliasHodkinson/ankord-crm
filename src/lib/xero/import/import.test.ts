import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseAbn, normaliseName, suggestPartner, type PartnerForMatch } from "./match";
import { gangwayState, mapLines, normaliseInvoice, normaliseQuote, totalsAgree, xeroDay } from "./map";

const partners: PartnerForMatch[] = [
  { id: "p1", name: "Mister Minit Blacktown", legalName: null, abn: "16 620 992 029", email: "monkeypro@outlook.com.au", xeroContactId: "x-blacktown" },
  { id: "p2", name: "Mister Minit Mt Druitt", legalName: null, abn: "58 689 416 617", email: null, xeroContactId: null },
  { id: "p3", name: "Nelson Hotel Victoria", legalName: null, abn: "70669995760", email: null, xeroContactId: null },
  { id: "p4", name: "Sol Padel", legalName: "Sol Padel Pty Ltd", abn: null, email: "erin@solpadel.com.au", xeroContactId: null },
  { id: "p5", name: "Quokka Mousepads", legalName: null, abn: null, email: null, xeroContactId: null },
];

const rates = new Map([
  ["OUTPUT", "10"],
  ["EXEMPTOUTPUT", "0"],
]);

test("normalisers", () => {
  assert.equal(normaliseAbn("16 620 992 029"), "16620992029");
  assert.equal(normaliseAbn("123"), null);
  assert.equal(normaliseName("Mister Fixed Pty. Ltd."), "mister fixed");
  assert.equal(normaliseName("Quokka Mousepads & Playmats"), "quokka mousepads and playmats");
});

test("a stored ContactID wins outright", () => {
  const s = suggestPartner({ contactId: "x-blacktown", name: "Anything", taxNumber: null, email: null }, partners);
  assert.deepEqual(s, { partnerId: "p1", partnerName: "Mister Minit Blacktown", reason: "linked" });
});

test("ABN, then email, then name", () => {
  assert.equal(suggestPartner({ contactId: "n", name: "Nelson Hotel", taxNumber: "70 669 995 760", email: null }, partners)?.reason, "abn");
  assert.equal(suggestPartner({ contactId: "n", name: "Sol Padel Club", taxNumber: null, email: "ERIN@solpadel.com.au" }, partners)?.reason, "email");
  const byName = suggestPartner({ contactId: "n", name: "Sol Padel Pty Ltd", taxNumber: null, email: null }, partners);
  assert.equal(byName?.reason, "name");
  assert.equal(byName?.partnerId, "p4");
});

test("a partner linked to another contact is never suggested", () => {
  // Same ABN as Blacktown, but Blacktown already belongs to x-blacktown.
  assert.equal(
    suggestPartner({ contactId: "x-other", name: "Mister Minit Blacktown", taxNumber: "16620992029", email: "monkeypro@outlook.com.au" }, partners),
    null,
  );
});

test("near-identical names are not a match", () => {
  assert.equal(suggestPartner({ contactId: "n", name: "Mister Minit Penrith", taxNumber: null, email: null }, partners), null);
  assert.equal(suggestPartner({ contactId: "n", name: "Mister Fixed Pty Ltd", taxNumber: null, email: null }, partners), null);
});

test("Xero statuses map to Gangway's", () => {
  assert.deepEqual(gangwayState("quote", "ACCEPTED"), { status: "open", quoteOutcome: "accepted" });
  assert.deepEqual(gangwayState("quote", "INVOICED"), { status: "closed", quoteOutcome: "accepted" });
  assert.deepEqual(gangwayState("quote", "SENT"), { status: "open", quoteOutcome: null });
  assert.deepEqual(gangwayState("invoice", "PAID"), { status: "closed", quoteOutcome: null });
  assert.deepEqual(gangwayState("invoice", "AUTHORISED"), { status: "open", quoteOutcome: null });
  assert.deepEqual(gangwayState("invoice", "SUBMITTED"), { status: "draft", quoteOutcome: null });
  assert.equal(gangwayState("invoice", "VOIDED").status, "cancelled");
});

test("dates in both Xero forms", () => {
  assert.equal(xeroDay("2026-09-30T00:00:00", "/Date(1)/"), "2026-09-30");
  assert.equal(xeroDay(undefined, "/Date(1790726400000+0000)/"), "2026-09-30");
  assert.equal(xeroDay(undefined, undefined), null);
});

test("lines: description-only rows become text, totals follow Xero", () => {
  const mapped = mapLines(
    [
      { Description: "Custom printed desk mat 900×400", Quantity: 1, UnitAmount: 189.5, AccountCode: "200", TaxType: "OUTPUT", ItemCode: "MAT-900", LineAmount: 189.5, TaxAmount: 18.95 },
      { Description: "Artwork supplied by customer" },
      { Description: "Freight", Quantity: 1, UnitAmount: 15, DiscountAmount: 1.5, TaxType: "OUTPUT", AccountCode: "200" },
    ],
    "exclusive",
    rates,
  );
  assert.equal(mapped.lines[0].rowType, "item");
  assert.equal(mapped.lines[0].itemCode, "MAT-900");
  assert.equal(mapped.lines[1].rowType, "text");
  assert.equal(mapped.lines[2].discountPercent, "10.0000");
  assert.equal(mapped.subtotal, "203.00");
  assert.equal(mapped.taxTotal, "20.30");
  assert.equal(mapped.total, "223.30");
});

test("an unknown tax type's rate is read back from Xero's amounts", () => {
  const mapped = mapLines(
    [{ Description: "Old rate", Quantity: 2, UnitAmount: 50, TaxType: "OUTPUT2", LineAmount: 100, TaxAmount: 10 }],
    "exclusive",
    rates,
  );
  assert.equal(mapped.lines[0].taxRate, "10.00");
  assert.equal(mapped.total, "110.00");
});

test("a paid invoice keeps Xero's money and payments", () => {
  const doc = normaliseInvoice(
    {
      InvoiceID: "inv-28",
      InvoiceNumber: "INV-0028",
      Type: "ACCREC",
      Status: "PAID",
      Contact: { ContactID: "c-fixed", Name: "Mister Fixed Pty Ltd" },
      DateString: "2026-09-30T00:00:00",
      DueDateString: "2026-10-14T00:00:00",
      LineAmountTypes: "Inclusive",
      LineItems: [{ Description: "Desk mat", Quantity: 1, UnitAmount: 220, TaxType: "OUTPUT", AccountCode: "200", LineAmount: 220, TaxAmount: 20 }],
      Total: 220,
      AmountPaid: 220,
      AmountDue: 0,
      Payments: [{ PaymentID: "pay-1", Date: "/Date(1790985600000+0000)/", Amount: 220, Reference: "EFT" }],
    },
    rates,
  );
  assert.equal(doc.type, "invoice");
  assert.equal(doc.state.status, "closed");
  assert.equal(doc.amountsAre, "inclusive");
  assert.equal(doc.total, "220.00");
  assert.equal(doc.taxTotal, "20.00");
  assert.equal(doc.amountPaid, "220.00");
  assert.equal(doc.amountDue, "0.00");
  assert.equal(doc.payments.length, 1);
  assert.equal(doc.payments[0].date, "2026-10-03");
  assert.ok(totalsAgree(doc));
});

test("ACCPAY is recognised as a bill, for phase B", () => {
  const doc = normaliseInvoice({ InvoiceID: "b1", Type: "ACCPAY", Status: "AUTHORISED" }, rates);
  assert.equal(doc.type, "bill");
  assert.equal(doc.state.status, "open");
});

test("a quote's expiry becomes its valid-until date", () => {
  const doc = normaliseQuote(
    {
      QuoteID: "q1",
      QuoteNumber: "QU-0012",
      Status: "ACCEPTED",
      Contact: { ContactID: "c1", Name: "Sol Padel" },
      DateString: "2026-10-01T00:00:00",
      ExpiryDateString: "2026-10-31T00:00:00",
      LineAmountTypes: "EXCLUSIVE",
      Title: "Court signage",
      LineItems: [{ Description: "Banner", Quantity: 3, UnitAmount: 100, TaxType: "OUTPUT", LineAmount: 300 }],
      Total: 330,
    },
    rates,
  );
  assert.equal(doc.dueDate, "2026-10-31");
  assert.equal(doc.state.quoteOutcome, "accepted");
  assert.equal(doc.total, "330.00");
  assert.equal(doc.title, "Court signage");
});
