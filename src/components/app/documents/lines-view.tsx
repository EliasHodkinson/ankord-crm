import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LINE_STATE, RESERVE_LINE_STATE, SHIPMENT_STATE, StatusBadge } from "@/components/ui/status";
import type { DocumentLine } from "@/lib/db/schema";
import type { LineTracking } from "@/lib/data/stock";
import { carrierLabel } from "@/lib/sales/carriers";
import { lineState, reserveLineState } from "@/lib/sales/fulfilment";
import { formatMoney, formatPrice, formatQty, num } from "@/lib/sales/money";
import { shipmentState } from "@/lib/sales/purchasing";
import { computeTotals } from "@/lib/sales/totals";
import { cn, formatDate } from "@/lib/utils";

/**
 * A document's lines, read-only, with the counters that matter for its type:
 * - sales order: ordered, allocated, invoiced, delivered and the state chip
 *   that says whether it still needs ordering;
 * - reserve invoice: ordered, allocated, delivered — the goods to follow;
 * - purchase order: received and billed;
 * - receipt and delivery: just what moved.
 * Lines bought on a PO show its shipment under the description, with the
 * courier's tracking link.
 */

type Column = { key: string; label: string; title?: string };

export function LinesView({
  type,
  lines,
  amountsAre,
  isReserve = false,
  tracking,
  demand,
  today,
}: {
  type: string;
  lines: DocumentLine[];
  amountsAre: "exclusive" | "inclusive" | "no_tax";
  isReserve?: boolean;
  /** Sales line id → the PO lines raised for it and their shipments. */
  tracking?: Record<string, LineTracking[]>;
  /** Reserve-invoice line id → ordered and allocated, from its sales-order line when it has one. */
  demand?: Record<string, { ordered: string; allocated: string }>;
  today: string;
}) {
  const totals = computeTotals(lines, amountsAre);
  const reserve = type === "invoice" && isReserve;
  const movement = type === "goods_receipt" || type === "delivery";

  const counters: Column[] =
    type === "sales_order"
      ? [
          { key: "ordered", label: "Ordered", title: "On purchase orders" },
          { key: "allocated", label: "Allocated" },
          { key: "invoiced", label: "Invoiced" },
          { key: "delivered", label: "Delivered" },
        ]
      : reserve
        ? [
            { key: "ordered", label: "Ordered", title: "On purchase orders" },
            { key: "allocated", label: "Allocated" },
            { key: "delivered", label: "Delivered" },
          ]
        : type === "purchase_order"
          ? [
              { key: "received", label: "Received" },
              { key: "billed", label: "Billed" },
            ]
          : type === "quote"
            ? [{ key: "converted", label: "Converted" }]
            : [];
  const showState = type === "sales_order" || reserve;
  const showMoney = !movement;
  const showDiscount = showMoney && type !== "sales_order" && !reserve;

  const th = "border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[11px] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase";
  const td = "border-b border-[var(--border-soft)] px-3 py-2 align-top";
  const columns = 2 + counters.length + (showState ? 1 : 0) + (showMoney ? 2 : 0) + (showDiscount ? 1 : 0);

  const value = (line: DocumentLine, key: string): string => {
    switch (key) {
      case "ordered":
        return reserve ? (demand?.[line.id]?.ordered ?? line.qtyOrdered) : line.qtyOrdered;
      case "allocated":
        return reserve ? (demand?.[line.id]?.allocated ?? line.qtyAllocated) : line.qtyAllocated;
      case "invoiced":
        return line.qtyInvoiced;
      case "delivered":
        return line.qtyDelivered;
      case "received":
        return line.qtyReceived;
      case "billed":
        return line.qtyBilled;
      default:
        return line.qtyConverted;
    }
  };
  const stockOnly = (key: string) => ["ordered", "allocated", "delivered"].includes(key);

  return (
    <div className="overflow-x-auto scrollbar-slim">
      <table className={cn("w-full border-collapse text-[13px]", movement ? "min-w-[28rem]" : "min-w-[46rem]")}>
        <thead>
          <tr>
            <th className={cn(th, "min-w-56 text-left")}>Item</th>
            <th className={cn(th, "text-right")}>Qty</th>
            {counters.map((c) => (
              <th key={c.key} className={cn(th, "text-right")} title={c.title}>
                {c.label}
              </th>
            ))}
            {showState ? <th className={cn(th, "text-left")}>State</th> : null}
            {showMoney ? <th className={cn(th, "text-right")}>Price</th> : null}
            {showDiscount ? <th className={cn(th, "text-right")}>Disc</th> : null}
            {showMoney ? <th className={cn(th, "text-right")}>Amount</th> : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            if (line.rowType === "text") {
              return (
                <tr key={line.id} className="bg-[var(--surface-2)]">
                  <td className={cn(td, "font-medium")} colSpan={columns}>
                    {line.description}
                  </td>
                </tr>
              );
            }
            if (line.rowType === "subtotal") {
              return (
                <tr key={line.id} className="bg-[var(--surface-2)]">
                  <td className={cn(td, "text-[12px] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase")} colSpan={columns - 1}>
                    Subtotal
                  </td>
                  <td className={cn(td, "tabular text-right font-semibold")}>
                    {formatMoney(totals.lines[i].subtotalValue ?? "0")}
                  </td>
                </tr>
              );
            }
            const alternative = line.rowType === "alternative";
            const bought = tracking?.[line.id];
            return (
              <tr key={line.id} className={alternative ? "text-[var(--text-muted)]" : undefined}>
                <td className={td}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {line.itemCode ? (
                      <span className="font-mono text-[11px] text-[var(--text-muted)]">{line.itemCode}</span>
                    ) : null}
                    {alternative ? <Badge tone="neutral">Optional</Badge> : null}
                    {line.tracksStock ? null : line.itemCode ? <Badge tone="muted">Service</Badge> : null}
                  </div>
                  <p className="whitespace-pre-line">{line.description}</p>
                  {line.note ? <p className="text-[12px] text-[var(--text-muted)]">{line.note}</p> : null}
                  {bought?.length ? <Bought rows={bought} today={today} /> : null}
                </td>
                <td className={cn(td, "tabular text-right")}>
                  {formatQty(line.quantity)}
                  {line.unit ? <span className="ml-1 text-[11px] text-[var(--text-faint)]">{line.unit}</span> : null}
                </td>
                {counters.map((c) => (
                  <Counter key={c.key} value={value(line, c.key)} muted={stockOnly(c.key) && !line.tracksStock} />
                ))}
                {showState ? (
                  <td className={td}>
                    {type === "sales_order" ? (
                      <StatusBadge map={LINE_STATE} value={lineState(line)} />
                    ) : line.tracksStock ? (
                      <StatusBadge
                        map={RESERVE_LINE_STATE}
                        value={reserveLineState({
                          quantity: line.quantity,
                          qtyDelivered: line.qtyDelivered,
                          qtyOrdered: value(line, "ordered"),
                          qtyAllocated: value(line, "allocated"),
                        })}
                      />
                    ) : (
                      <span className="text-[12px] text-[var(--text-faint)]">Service</span>
                    )}
                  </td>
                ) : null}
                {showMoney ? <td className={cn(td, "tabular text-right")}>{formatPrice(line.unitPrice)}</td> : null}
                {showDiscount ? (
                  <td className={cn(td, "tabular text-right text-[var(--text-muted)]")}>
                    {num(line.discountPercent) ? `${formatQty(line.discountPercent)}%` : "—"}
                  </td>
                ) : null}
                {showMoney ? <td className={cn(td, "tabular text-right")}>{formatMoney(totals.lines[i].lineAmount)}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "PO-0011 · Shipped, in transit · StarTrack ABC123 ↗ · ETA 22 Oct", per PO line raised for this one. */
function Bought({ rows, today }: { rows: LineTracking[]; today: string }) {
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {rows.map((r) => {
        const received = num(r.received) >= num(r.quantity);
        const open = r.shipments.filter((s) => shipmentState(s, received, today) !== "arrived");
        return (
          <li key={r.poId} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-[var(--text-muted)]">
            <Link href={`/purchasing/orders/${r.poId}`} className="font-medium text-[var(--text)] hover:underline underline-offset-2">
              {r.poNumber ?? "Draft PO"}
            </Link>
            {received ? (
              <StatusBadge map={SHIPMENT_STATE} value="arrived" />
            ) : open.length ? (
              open.map((s) => (
                <span key={s.id} className="flex flex-wrap items-center gap-1">
                  <StatusBadge map={SHIPMENT_STATE} value={shipmentState(s, false, today)} />
                  {s.trackingUrl ? (
                    <a
                      href={s.trackingUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline underline-offset-2"
                    >
                      {carrierLabel(s.carrier)} {s.trackingNumber}
                      <ExternalLink className="size-3" aria-hidden />
                      <span className="sr-only">(opens the courier&apos;s tracking page)</span>
                    </a>
                  ) : (
                    <span>
                      {carrierLabel(s.carrier)} {s.trackingNumber}
                    </span>
                  )}
                  {s.eta ? <span>ETA {formatDate(s.eta, "day")}</span> : null}
                </span>
              ))
            ) : (
              <span>
                On order{num(r.received) > 0 ? `, ${formatQty(r.received)} of ${formatQty(r.quantity)} received` : ""}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Counter({ value, muted }: { value: string; muted?: boolean }) {
  return (
    <td
      className={cn(
        "tabular border-b border-[var(--border-soft)] px-3 py-2 text-right align-top",
        num(value) === 0 || muted ? "text-[var(--text-faint)]" : "text-[var(--text)]",
      )}
    >
      {muted ? "—" : formatQty(value)}
    </td>
  );
}
