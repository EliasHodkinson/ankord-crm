import { num } from "./money";

/**
 * Where a sales-order line stands — "so I can see it either needs to be
 * ordered or has been". Derived from the counters, never stored per line.
 * Client-safe; the server rolls the same answer up into documents.fulfilment.
 */

export type LineState = "to_order" | "on_order" | "ready" | "to_invoice" | "invoiced" | "done";

export type CounterLine = {
  rowType: string;
  tracksStock: boolean;
  quantity: string | number;
  qtyOrdered: string | number;
  qtyAllocated: string | number;
  qtyInvoiced: string | number;
  qtyDelivered: string | number;
};

export function lineState(line: CounterLine): LineState {
  const quantity = num(line.quantity);
  const invoiced = num(line.qtyInvoiced);
  const delivered = num(line.qtyDelivered);

  if (invoiced >= quantity) {
    return !line.tracksStock || delivered >= quantity ? "done" : "invoiced";
  }
  // Services are never ordered or allocated: they are simply still to invoice.
  if (!line.tracksStock) return "to_invoice";

  const needed = quantity - delivered;
  const allocated = num(line.qtyAllocated);
  if (allocated >= needed) return "ready";
  if (num(line.qtyOrdered) + allocated >= needed) return "on_order";
  return "to_order";
}

export type SalesOrderFulfilment = "to_order" | "on_order" | "ready" | "part_invoiced" | "invoiced";

/** The one word for the whole order, shown in lists and filtered on. */
export function salesOrderFulfilment(lines: CounterLine[]): SalesOrderFulfilment | null {
  const items = lines.filter((l) => l.rowType === "item");
  if (items.length === 0) return null;
  const states = items.map(lineState);
  if (states.includes("to_order")) return "to_order";
  if (states.includes("on_order")) return "on_order";
  if (states.every((s) => s === "invoiced" || s === "done")) return "invoiced";
  if (items.some((l) => num(l.qtyInvoiced) > 0)) return "part_invoiced";
  return "ready";
}

/** A reserve invoice is closed off once every stock line is delivered. */
export function reserveFulfilment(
  lines: { rowType: string; tracksStock: boolean; quantity: string | number; qtyDelivered: string | number }[],
): "to_deliver" | "delivered" | null {
  const stock = lines.filter((l) => l.rowType === "item" && l.tracksStock);
  if (stock.length === 0) return null;
  return stock.every((l) => num(l.qtyDelivered) >= num(l.quantity)) ? "delivered" : "to_deliver";
}
