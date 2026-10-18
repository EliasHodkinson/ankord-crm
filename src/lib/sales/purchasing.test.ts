import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoAllocation,
  consumeAllocations,
  matchLines,
  numbersIn,
  poEditProblem,
  purchaseState,
  shipmentState,
  shortfalls,
  stillToAllocate,
} from "./purchasing";
import { lineState, reserveLineState } from "./fulfilment";
import { trackingUrl } from "./carriers";
import { billPayload, billReference, purchaseOrderPayload, purchaseOrderStatusFor, type MapDoc } from "../xero/mapping";
import { normalisePurchaseOrder, gangwayState } from "../xero/import/map";

/* ── PO edit rules (§6.3) ───────────────────────────────────────── */

const poLine = (over: Partial<{ id: string; quantity: string; qtyReceived: string; qtyBilled: string }> = {}) => ({
  id: over.id ?? "p1",
  description: "Desk mat",
  quantity: over.quantity ?? "10",
  qtyReceived: over.qtyReceived ?? "0",
  qtyBilled: over.qtyBilled ?? "0",
});

test("a PO with nothing received or billed can change supplier, quantities and lines", () => {
  assert.equal(
    poEditProblem({ status: "open", supplierBefore: "a", supplierAfter: "b", before: [poLine()], after: [] }),
    null,
  );
});

test("the supplier is locked after the first receipt or bill", () => {
  for (const before of [poLine({ qtyReceived: "1" }), poLine({ qtyBilled: "1" })]) {
    const problem = poEditProblem({ status: "open", supplierBefore: "a", supplierAfter: "b", before: [before], after: [{ id: "p1", quantity: "10" }] });
    assert.match(problem ?? "", /supplier can't change/);
  }
});

test("a quantity can't drop below what was received or billed, and such a line can't go", () => {
  const before = [poLine({ qtyReceived: "4", qtyBilled: "6" })];
  assert.match(
    poEditProblem({ status: "open", supplierBefore: "a", supplierAfter: "a", before, after: [{ id: "p1", quantity: "5" }] }) ?? "",
    /can't go below/,
  );
  assert.equal(poEditProblem({ status: "open", supplierBefore: "a", supplierAfter: "a", before, after: [{ id: "p1", quantity: "6" }] }), null);
  assert.match(poEditProblem({ status: "open", supplierBefore: "a", supplierAfter: "a", before, after: [] }) ?? "", /can't be removed/);
});

test("closed and cancelled POs can't be edited", () => {
  for (const status of ["closed", "cancelled"] as const) {
    assert.ok(poEditProblem({ status, supplierBefore: "a", supplierAfter: "a", before: [], after: [] }));
  }
});

/* ── receipts, allocation and consumption (§4.5) ────────────────── */

test("a receipt allocates the smaller of what arrived and what the line still needs", () => {
  assert.equal(autoAllocation("500", 300), "300.0000");
  assert.equal(autoAllocation("200", 300), "200.0000");
  assert.equal(autoAllocation("5", 0), "0");
  assert.equal(stillToAllocate({ quantity: "500", qtyDelivered: "100", qtyAllocated: "150" }), 250);
});

test("deliveries consume allocations oldest first", () => {
  const a = [
    { id: "a1", quantity: "300" },
    { id: "a2", quantity: "200" },
  ];
  assert.deepEqual([...consumeAllocations(a, "350").entries()], [
    ["a1", "300.0000"],
    ["a2", "50.0000"],
  ]);
  assert.deepEqual([...consumeAllocations(a, "0").values()], ["0.0000", "0.0000"]);
  // More out than was allocated: every allocation is used up, the rest is the shortfall.
  assert.deepEqual([...consumeAllocations(a, "900").values()], ["300.0000", "200.0000"]);
});

test("the shortfall warning names lines with less allocated than is going out", () => {
  const short = shortfalls([
    { label: "BC-500", quantity: "500", allocated: "300", tracksStock: true },
    { label: "DESIGN", quantity: "2", allocated: "0", tracksStock: false },
    { label: "MAT-900", quantity: "1", allocated: "1", tracksStock: true },
  ]);
  assert.deepEqual(short, [{ label: "BC-500", quantity: 500, allocated: 300 }]);
});

/* ── bill and receipt independence ──────────────────────────────── */

const stock = (qtyReceived: string, qtyBilled: string) => ({ tracksStock: true, quantity: "10", qtyReceived, qtyBilled });

test("bill first, receive later: billed but open until the goods arrive", () => {
  const billed = purchaseState([stock("0", "10")]);
  assert.deepEqual([billed.fulfilment, billed.billed, billed.complete], ["to_receive", true, false]);
  const done = purchaseState([stock("10", "10")]);
  assert.deepEqual([done.fulfilment, done.complete], ["received", true]);
});

test("two partial receipts, then the bill", () => {
  assert.equal(purchaseState([stock("4", "0")]).fulfilment, "part_received");
  const received = purchaseState([stock("10", "0")]);
  assert.deepEqual([received.fulfilment, received.complete], ["received", false]);
  assert.equal(purchaseState([stock("10", "10")]).complete, true);
});

test("bill with the goods: received and billed at once", () => {
  assert.equal(purchaseState([stock("10", "10")]).complete, true);
});

test("a PO Xero calls BILLED counts as billed without a bill here (an imported PO)", () => {
  assert.equal(purchaseState([stock("10", "0")], true).complete, true);
  assert.equal(purchaseState([stock("0", "0")], true).complete, false);
});

test("a PO of items that don't track stock is still received line by line", () => {
  const lines = [{ tracksStock: false, quantity: "1", qtyReceived: "0", qtyBilled: "1" }];
  assert.equal(purchaseState(lines).fulfilment, "to_receive");
  assert.equal(purchaseState([{ ...lines[0], qtyReceived: "1" }]).complete, true);
});

/* ── line states ────────────────────────────────────────────────── */

const soLine = (over: Partial<Parameters<typeof lineState>[0]> = {}) => ({
  rowType: "item",
  tracksStock: true,
  quantity: "500",
  qtyOrdered: "0",
  qtyAllocated: "0",
  qtyInvoiced: "0",
  qtyDelivered: "0",
  ...over,
});

test("lineState walks to order → on order → ready → invoiced → done", () => {
  assert.equal(lineState(soLine()), "to_order");
  assert.equal(lineState(soLine({ qtyOrdered: "500" })), "on_order");
  assert.equal(lineState(soLine({ qtyOrdered: "500", qtyAllocated: "500" })), "ready");
  assert.equal(lineState(soLine({ qtyInvoiced: "500" })), "invoiced");
  assert.equal(lineState(soLine({ qtyInvoiced: "500", qtyDelivered: "500" })), "done");
  assert.equal(lineState(soLine({ tracksStock: false })), "to_invoice");
});

test("a reserve-invoice line goes to order → on order → ready → delivered", () => {
  const l = { quantity: "1", qtyOrdered: "0", qtyAllocated: "0", qtyDelivered: "0" };
  assert.equal(reserveLineState(l), "to_order");
  assert.equal(reserveLineState({ ...l, qtyOrdered: "1" }), "on_order");
  assert.equal(reserveLineState({ ...l, qtyOrdered: "1", qtyAllocated: "1" }), "ready");
  assert.equal(reserveLineState({ ...l, qtyDelivered: "1" }), "delivered");
});

/* ── shipments and tracking links ───────────────────────────────── */

test("a shipment is in transit until a receipt closes it, and overdue past its ETA", () => {
  assert.equal(shipmentState({ receiptId: null, eta: "2026-10-25" }, false, "2026-10-20"), "in_transit");
  assert.equal(shipmentState({ receiptId: null, eta: "2026-10-19" }, false, "2026-10-20"), "overdue");
  assert.equal(shipmentState({ receiptId: "gr", eta: null }, false, "2026-10-20"), "arrived");
  assert.equal(shipmentState({ receiptId: null, eta: null }, true, "2026-10-20"), "arrived");
});

test("tracking links are built from the carrier, or taken as typed for Other", () => {
  assert.equal(trackingUrl("auspost", "33 AB 1234"), "https://auspost.com.au/mypost/track/details/33AB1234");
  assert.match(trackingUrl("startrack", "ABC123") ?? "", /startrack\.com\.au.*ABC123$/);
  assert.match(trackingUrl("tnt", "123") ?? "", /tnt\.com.*cons=123$/);
  assert.equal(trackingUrl("auspost", ""), null);
  assert.equal(trackingUrl("other", "X1", "https://track.example.com/X1"), "https://track.example.com/X1");
  assert.equal(trackingUrl("other", "X1", "javascript:alert(1)"), null);
});

/* ── linking imported documents ─────────────────────────────────── */

test("lines pair by item code, then description, then what is left — within quantity", () => {
  const parents = [
    { id: "p1", itemCode: "MAT-900", description: "Desk mat", quantity: "1" },
    { id: "p2", itemCode: null, description: "Freight", quantity: "1" },
  ];
  const pairs = matchLines(
    [
      { id: "c1", itemCode: null, description: "freight ", quantity: "1" },
      { id: "c2", itemCode: "mat-900", description: "Mat blanks", quantity: "1" },
      { id: "c3", itemCode: "MAT-900", description: "Second mat", quantity: "1" },
    ],
    parents,
  );
  assert.equal(pairs.get("c2"), "p1");
  assert.equal(pairs.get("c1"), "p2");
  // Nothing left on either parent for a third line.
  assert.equal(pairs.has("c3"), false);
});

test("document numbers are found in references", () => {
  assert.deepEqual(numbersIn("For INV-0028 / po-0011 desk mat"), ["INV-0028", "PO-0011"]);
  assert.deepEqual(numbersIn(null), []);
});

/* ── Xero payloads for purchasing ───────────────────────────────── */

const po: MapDoc = {
  id: "0b6f2a7c-aaaa-2222-3333-444455556666",
  type: "purchase_order",
  status: "draft",
  quoteOutcome: null,
  xeroId: null,
  xeroStatus: null,
  xeroContactId: "c0ffee00-0000-0000-0000-000000000002",
  reference: "SO-00017 · Maple Street Kitchens",
  docDate: "2026-10-18",
  dueDate: "2026-10-25",
  amountsAre: "exclusive",
  title: null,
  summary: null,
  terms: null,
  salesOrderNumber: "SO-00017",
  customerName: "Maple Street Kitchens",
  brandingThemeId: null,
  shipToText: "4 Station St\nPenrith NSW 2750",
  contactName: "Sam",
  remarks: "Leave at reception",
};

test("a PO goes to Xero with its job reference, marker, delivery details and no number", () => {
  const payload = purchaseOrderPayload(po, []);
  assert.equal(payload.Reference, "SO-00017 · Maple Street Kitchens · gw:0b6f2a7c");
  assert.equal(payload.DeliveryDate, "2026-10-25");
  assert.equal(payload.DeliveryAddress, "4 Station St\nPenrith NSW 2750");
  assert.equal(payload.AttentionTo, "Sam");
  assert.equal(payload.DeliveryInstructions, "Leave at reception");
  assert.equal(payload.Status, "DRAFT");
  assert.equal("PurchaseOrderNumber" in payload, false);
});

test("PO status: approved is AUTHORISED, fully billed is BILLED, never back from BILLED, cancelled is DELETED", () => {
  assert.equal(purchaseOrderStatusFor({ status: "open", xeroStatus: "DRAFT" }), "AUTHORISED");
  assert.equal(purchaseOrderStatusFor({ status: "open", xeroStatus: "AUTHORISED", fullyBilled: true }), "BILLED");
  assert.equal(purchaseOrderStatusFor({ status: "open", xeroStatus: "BILLED" }), "BILLED");
  assert.equal(purchaseOrderStatusFor({ status: "cancelled", xeroStatus: "AUTHORISED" }), "DELETED");
});

test("a bill is ACCPAY under the supplier's number, referencing its PO once", () => {
  const bill = { ...po, type: "bill" as const, reference: "PO-0031", purchaseOrderNumber: "PO-0031", supplierInvoiceNumber: "4471" };
  const payload = billPayload(bill, []);
  assert.equal(payload.Type, "ACCPAY");
  assert.equal(payload.InvoiceNumber, "4471");
  assert.equal(payload.Reference, "PO-0031");
  assert.equal(billReference({ reference: "Mats", purchaseOrderNumber: "PO-0031" }), "Mats · PO-0031");
});

test("an imported PO keeps Xero's number and delivery details; BILLED is still open here", () => {
  const doc = normalisePurchaseOrder(
    {
      PurchaseOrderID: "po-id",
      PurchaseOrderNumber: "PO-0011",
      Status: "BILLED",
      Contact: { ContactID: "c", Name: "Quokka" },
      DateString: "2026-09-28T00:00:00",
      DeliveryDateString: "2026-10-10T00:00:00",
      DeliveryAddress: "Ankor'd",
      AttentionTo: "Elias",
      LineAmountTypes: "Exclusive",
      LineItems: [{ Description: "Mat", Quantity: 1, UnitAmount: 41.25, ItemCode: "MAT-900", TaxType: "INPUT", AccountCode: "310" }],
      Total: 45.38,
    },
    new Map([["INPUT", "10"]]),
  );
  assert.equal(doc.number, "PO-0011");
  assert.equal(doc.dueDate, "2026-10-10");
  assert.deepEqual(doc.state, { status: "open", quoteOutcome: null });
  assert.equal(doc.total, "45.38");
  assert.equal(doc.attentionTo, "Elias");
  assert.deepEqual(gangwayState("purchase_order", "DRAFT"), { status: "draft", quoteOutcome: null });
});
