import { formatQty, fromScaled, num, toScaled } from "./money";

/**
 * Purchasing rules that need no database: PO edit guards (spec §6.3), how
 * received stock is allocated and delivered stock consumes allocations
 * (§4.5), and where a shipment stands. Client-safe and pure, so the editor
 * can warn early and the tests can pin the rules down; the server runs the
 * same functions inside its transactions.
 */

/* ── PO edit rules (§6.3) ───────────────────────────────────────── */

export type PoLineCounters = {
  id: string;
  description: string;
  quantity: string;
  qtyReceived: string;
  qtyBilled: string;
};

/** The most that has been drawn from a PO line: it can't go below this. */
export const poLineFloor = (line: Pick<PoLineCounters, "qtyReceived" | "qtyBilled">) =>
  Math.max(num(line.qtyReceived), num(line.qtyBilled));

/**
 * Why a PO edit is refused, or null. `before` are the saved lines; `after`
 * the lines being saved, by id (new lines have none).
 */
export function poEditProblem(input: {
  status: "draft" | "open" | "closed" | "cancelled";
  supplierBefore: string;
  supplierAfter: string;
  before: PoLineCounters[];
  after: { id?: string | null; quantity: string }[];
}): string | null {
  if (input.status === "closed" || input.status === "cancelled") {
    return `This purchase order is ${input.status} and can't be edited.`;
  }
  const started = input.before.some((l) => poLineFloor(l) > 0);
  if (started && input.supplierBefore !== input.supplierAfter) {
    return "Goods have been received or billed against this order, so its supplier can't change.";
  }
  const kept = new Map(input.after.filter((l) => l.id).map((l) => [l.id!, l]));
  for (const [index, line] of input.before.entries()) {
    const floor = poLineFloor(line);
    if (floor === 0) continue;
    const name = line.description || `Line ${index + 1}`;
    const next = kept.get(line.id);
    if (!next) return `"${name}" has been received or billed, so it can't be removed.`;
    if (num(next.quantity) < floor) {
      return `"${name}" has ${formatQty(floor)} received or billed, so its quantity can't go below that.`;
    }
  }
  return null;
}

/* ── allocation (§4.5) ──────────────────────────────────────────── */

/** What a demand line still needs set aside: what is left to deliver, less what is already allocated. */
export function stillToAllocate(line: { quantity: string; qtyDelivered: string; qtyAllocated: string }): number {
  return Math.max(0, num(line.quantity) - num(line.qtyDelivered) - num(line.qtyAllocated));
}

/**
 * How much of a receipt line goes to the line its PO line was raised for:
 * the smaller of what arrived and what that line still needs. The rest stays
 * on hand, unallocated. Exact to four places.
 */
export function autoAllocation(received: string, need: number): string {
  const got = toScaled(received);
  const wanted = toScaled(String(need));
  const take = got < wanted ? got : wanted;
  return take > BigInt(0) ? fromScaled(take) : "0";
}

/**
 * Spreads what has gone out over a line's active allocations, oldest first,
 * so each allocation's `consumed` says how much of it has been delivered.
 * Returns the consumed figure per allocation id.
 */
export function consumeAllocations(
  allocations: { id: string; quantity: string }[],
  delivered: string,
): Map<string, string> {
  let left = toScaled(delivered);
  const out = new Map<string, string>();
  for (const a of allocations) {
    const quantity = toScaled(a.quantity);
    const take = left <= BigInt(0) ? BigInt(0) : left < quantity ? left : quantity;
    out.set(a.id, fromScaled(take));
    left -= take;
  }
  return out;
}

/**
 * The shortfall warning on a normal invoice (§4.5): lines going out with less
 * allocated than is being invoiced. Empty when everything is covered.
 */
export function shortfalls(
  lines: { label: string; quantity: string; allocated: string; tracksStock: boolean }[],
): { label: string; quantity: number; allocated: number }[] {
  return lines
    .filter((l) => l.tracksStock && num(l.allocated) < num(l.quantity))
    .map((l) => ({ label: l.label, quantity: num(l.quantity), allocated: num(l.allocated) }));
}

/* ── receipt and bill independence ──────────────────────────────── */

/**
 * A PO's received/billed position, which the two documents move
 * independently: bill first, receipt first, or both at once all land here.
 */
export function purchaseState(lines: { tracksStock: boolean; quantity: string; qtyReceived: string; qtyBilled: string }[], billedInXero = false) {
  // Goods are what is received. A PO with no stock lines at all (an item not
  // set to track stock) is still received line by line.
  const goods = lines.filter((l) => l.tracksStock);
  const stock = goods.length ? goods : lines;
  const received = stock.every((l) => num(l.qtyReceived) >= num(l.quantity));
  const anyReceived = stock.some((l) => num(l.qtyReceived) > 0);
  const billed = billedInXero || (lines.length > 0 && lines.every((l) => num(l.qtyBilled) >= num(l.quantity)));
  return {
    fulfilment: stock.length === 0 ? null : received ? ("received" as const) : anyReceived ? ("part_received" as const) : ("to_receive" as const),
    received,
    billed,
    /** Received and billed: the PO closes by itself. */
    complete: lines.length > 0 && received && billed,
  };
}

/* ── shipments ──────────────────────────────────────────────────── */

export type ShipmentState = "in_transit" | "overdue" | "arrived";

/** A shipment is in transit until a receipt closes it or the PO is fully received. */
export function shipmentState(
  shipment: { receiptId: string | null; eta: string | null },
  poReceived: boolean,
  today: string,
): ShipmentState {
  if (shipment.receiptId || poReceived) return "arrived";
  if (shipment.eta && shipment.eta < today) return "overdue";
  return "in_transit";
}

/* ── linking imported documents ─────────────────────────────────── */

type MatchLine = { id: string; itemCode: string | null; description: string; quantity: string };

const plain = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Pairs the item lines of a document with the lines of the one it belongs to
 * (a bill's lines with its PO's, a PO's with the invoice it was raised for):
 * same item code first, then the same description, then whatever is left in
 * order. Each parent line takes children only up to its quantity. Returns
 * child id → parent id; a child with no fitting parent is left out.
 */
export function matchLines(children: MatchLine[], parents: MatchLine[]): Map<string, string> {
  const room = new Map(parents.map((p) => [p.id, toScaled(p.quantity)]));
  const out = new Map<string, string>();
  const fits = (child: MatchLine, parent: MatchLine) => (room.get(parent.id) ?? BigInt(0)) >= toScaled(child.quantity);
  const take = (child: MatchLine, parent: MatchLine) => {
    out.set(child.id, parent.id);
    room.set(parent.id, (room.get(parent.id) ?? BigInt(0)) - toScaled(child.quantity));
  };
  const rules: ((c: MatchLine, p: MatchLine) => boolean)[] = [
    (c, p) => Boolean(c.itemCode) && c.itemCode!.toLowerCase() === p.itemCode?.toLowerCase(),
    (c, p) => plain(c.description) !== "" && plain(c.description) === plain(p.description),
    () => true,
  ];
  for (const rule of rules) {
    for (const child of children) {
      if (out.has(child.id)) continue;
      const parent = parents.find((p) => rule(child, p) && fits(child, p));
      if (parent) take(child, parent);
    }
  }
  return out;
}

/** Document numbers mentioned in free text ("PO-0011", "INV-0028"), upper-cased. */
export function numbersIn(text: string | null | undefined): string[] {
  return [...new Set((text ?? "").toUpperCase().match(/\b[A-Z]{2,4}-\d{2,8}\b/g) ?? [])];
}
