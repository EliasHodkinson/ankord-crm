import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTotals, type TotalsLine } from "./totals";
import { toScaled, fromScaled, divRound } from "./money";

const item = (quantity: string, unitPrice: string, taxRate = "10", discountPercent = "0"): TotalsLine => ({
  rowType: "item",
  quantity,
  unitPrice,
  taxRate,
  discountPercent,
});

test("exclusive: tax is added per line, rounded to the cent", () => {
  const t = computeTotals([item("500", "0.3", "10"), item("1", "150", "10")], "exclusive");
  assert.equal(t.lines[0].lineAmount, "150.00");
  assert.equal(t.lines[0].taxAmount, "15.00");
  assert.equal(t.subtotal, "300.00");
  assert.equal(t.taxTotal, "30.00");
  assert.equal(t.total, "330.00");
});

test("inclusive: tax is carved out of the line, total is the sum of lines", () => {
  const t = computeTotals([item("1", "110", "10"), item("3", "33.33", "10")], "inclusive");
  assert.equal(t.lines[0].taxAmount, "10.00");
  // 99.99 × 10/110 = 9.09
  assert.equal(t.lines[1].lineAmount, "99.99");
  assert.equal(t.lines[1].taxAmount, "9.09");
  assert.equal(t.total, "209.99");
  assert.equal(t.taxTotal, "19.09");
  assert.equal(t.subtotal, "190.90");
});

test("no tax: tax is zero whatever the line says", () => {
  const t = computeTotals([item("2", "49.995", "10")], "no_tax");
  assert.equal(t.lines[0].lineAmount, "99.99");
  assert.equal(t.taxTotal, "0.00");
  assert.equal(t.total, "99.99");
});

test("discounts apply before rounding, and half a cent rounds away from zero", () => {
  // 3 × 3.35 × 0.95 = 9.5475 → 9.55
  const t = computeTotals([item("3", "3.35", "10", "5")], "exclusive");
  assert.equal(t.lines[0].lineAmount, "9.55");
  // 9.55 × 10% = 0.955 → 0.96
  assert.equal(t.lines[0].taxAmount, "0.96");
  assert.equal(t.total, "10.51");
});

test("four-place quantities and prices are exact", () => {
  const t = computeTotals([item("0.3333", "12.3456", "10")], "exclusive");
  // 0.3333 × 12.3456 = 4.11478848 → 4.11
  assert.equal(t.lines[0].lineAmount, "4.11");
});

test("alternatives, text and subtotal rows are not counted; subtotals add up their group", () => {
  const t = computeTotals(
    [
      item("1", "100"),
      { rowType: "alternative", quantity: "1", unitPrice: "50", taxRate: "10" },
      item("2", "25"),
      { rowType: "subtotal", quantity: "0", unitPrice: "0" },
      { rowType: "text", quantity: "0", unitPrice: "0" },
      item("1", "10"),
      { rowType: "subtotal", quantity: "0", unitPrice: "0" },
    ],
    "exclusive",
  );
  assert.equal(t.lines[1].lineAmount, "50.00");
  assert.equal(t.lines[3].subtotalValue, "150.00");
  assert.equal(t.lines[6].subtotalValue, "10.00");
  assert.equal(t.subtotal, "160.00");
  assert.equal(t.total, "176.00");
});

test("decimal helpers round and format without floats", () => {
  assert.equal(fromScaled(toScaled("1.23456")), "1.2346");
  assert.equal(fromScaled(toScaled("-1.5"), 4), "-1.5000");
  assert.equal(divRound(BigInt(5), BigInt(10)), BigInt(1));
  assert.equal(divRound(BigInt(-5), BigInt(10)), BigInt(-1));
  assert.equal(divRound(BigInt(4), BigInt(10)), BigInt(0));
});
