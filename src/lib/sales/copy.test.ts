import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCopyLines, remainingOn, type SourceLine } from "./copy";
import { copyCounter } from "./doc-types";
import { lineState, salesOrderFulfilment } from "./fulfilment";

const line = (over: Partial<SourceLine>): SourceLine => ({
  id: over.id ?? "l1",
  rowType: "item",
  itemId: "i1",
  itemCode: "BC-500",
  unit: "ea",
  tracksStock: true,
  description: "Business cards",
  note: null,
  quantity: "500",
  unitPrice: "0.3",
  discountPercent: "0",
  accountCode: "200",
  taxType: "OUTPUT",
  taxRate: "10",
  ...over,
});

test("copy offers what is left on each line, and links back to it", () => {
  const out = buildCopyLines([line({ qtyConverted: "200" })], "qtyConverted");
  assert.equal(out.length, 1);
  assert.equal(out[0].quantity, "300.0000");
  assert.equal(out[0].maxQuantity, "300.0000");
  assert.equal(out[0].baseLineId, "l1");
  assert.equal(out[0].accountCode, "200");
});

test("fully drawn lines and alternatives are not copied; text rows are", () => {
  const out = buildCopyLines(
    [
      line({ id: "t", rowType: "text", description: "Print" }),
      line({ id: "a", qtyConverted: "500" }),
      line({ id: "b", rowType: "alternative" }),
      line({ id: "c", quantity: "2" }),
    ],
    "qtyConverted",
  );
  assert.deepEqual(out.map((l) => l.rowType), ["text", "item"]);
  assert.equal(out[1].baseLineId, "c");
  assert.equal(out[0].baseLineId, null);
});

test("a subtotal with nothing above it is dropped", () => {
  const out = buildCopyLines(
    [
      line({ id: "a", qtyInvoiced: "500" }),
      line({ id: "s1", rowType: "subtotal" }),
      line({ id: "b" }),
      line({ id: "s2", rowType: "subtotal" }),
    ],
    "qtyInvoiced",
  );
  assert.deepEqual(out.map((l) => l.rowType), ["item", "subtotal"]);
});

test("remaining never goes negative", () => {
  assert.equal(remainingOn(line({ qtyInvoiced: "600" }), "qtyInvoiced"), "0.0000");
});

test("copy paths name the counter they consume", () => {
  assert.equal(copyCounter("quote", "sales_order"), "qtyConverted");
  assert.equal(copyCounter("quote", "invoice"), "qtyConverted");
  assert.equal(copyCounter("sales_order", "invoice"), "qtyInvoiced");
  assert.equal(copyCounter("sales_order", "invoice", true), "qtyInvoiced");
  assert.equal(copyCounter("invoice", "sales_order"), null);
  assert.equal(copyCounter("sales_order", "quote"), null);
});

const so = (over: Partial<Parameters<typeof lineState>[0]>) => ({
  rowType: "item",
  tracksStock: true,
  quantity: "500",
  qtyOrdered: "0",
  qtyAllocated: "0",
  qtyInvoiced: "0",
  qtyDelivered: "0",
  ...over,
});

test("line state follows the counters", () => {
  assert.equal(lineState(so({})), "to_order");
  assert.equal(lineState(so({ qtyOrdered: "500" })), "on_order");
  assert.equal(lineState(so({ qtyOrdered: "200", qtyAllocated: "300" })), "on_order");
  assert.equal(lineState(so({ qtyAllocated: "500" })), "ready");
  assert.equal(lineState(so({ qtyInvoiced: "500" })), "invoiced");
  assert.equal(lineState(so({ qtyInvoiced: "500", qtyDelivered: "500" })), "done");
  assert.equal(lineState(so({ tracksStock: false })), "to_invoice");
  assert.equal(lineState(so({ tracksStock: false, qtyInvoiced: "500" })), "done");
});

test("an order's fulfilment rolls up its worst line", () => {
  assert.equal(salesOrderFulfilment([so({}), so({ qtyAllocated: "500" })]), "to_order");
  assert.equal(salesOrderFulfilment([so({ qtyOrdered: "500" }), so({ qtyAllocated: "500" })]), "on_order");
  assert.equal(salesOrderFulfilment([so({ qtyAllocated: "500" }), so({ tracksStock: false })]), "ready");
  assert.equal(
    salesOrderFulfilment([so({ qtyAllocated: "500" }), so({ tracksStock: false, qtyInvoiced: "500" })]),
    "part_invoiced",
  );
  assert.equal(
    salesOrderFulfilment([so({ qtyInvoiced: "500", qtyDelivered: "500" }), so({ tracksStock: false, qtyInvoiced: "500" })]),
    "invoiced",
  );
});
