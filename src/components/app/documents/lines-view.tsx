import { Badge } from "@/components/ui/badge";
import { LINE_STATE, StatusBadge } from "@/components/ui/status";
import type { DocumentLine } from "@/lib/db/schema";
import { lineState } from "@/lib/sales/fulfilment";
import { formatMoney, formatPrice, formatQty, num } from "@/lib/sales/money";
import { computeTotals } from "@/lib/sales/totals";
import { cn } from "@/lib/utils";

/**
 * A document's lines, read-only. On a sales order this is the reason the
 * order exists: ordered, allocated, invoiced and delivered per line, and the
 * state chip that says whether it still needs ordering.
 */
export function LinesView({
  type,
  lines,
  amountsAre,
}: {
  type: string;
  lines: DocumentLine[];
  amountsAre: "exclusive" | "inclusive" | "no_tax";
}) {
  const totals = computeTotals(lines, amountsAre);
  const fulfilment = type === "sales_order";
  const converted = type === "quote";

  const th = "border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[11px] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase";
  const td = "border-b border-[var(--border-soft)] px-3 py-2 align-top";

  return (
    <div className="overflow-x-auto scrollbar-slim">
      <table className="w-full min-w-[46rem] border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={cn(th, "text-left")}>Item</th>
            <th className={cn(th, "text-right")}>Qty</th>
            {fulfilment ? (
              <>
                <th className={cn(th, "text-right")} title="On purchase orders">Ordered</th>
                <th className={cn(th, "text-right")}>Allocated</th>
                <th className={cn(th, "text-right")}>Invoiced</th>
                <th className={cn(th, "text-right")}>Delivered</th>
                <th className={cn(th, "text-left")}>State</th>
              </>
            ) : null}
            {converted ? <th className={cn(th, "text-right")}>Converted</th> : null}
            <th className={cn(th, "text-right")}>Price</th>
            {fulfilment ? null : <th className={cn(th, "text-right")}>Disc</th>}
            <th className={cn(th, "text-right")}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const columns = 4 + (fulfilment ? 5 : 1) + (converted ? 1 : 0);
            const span = columns - 1;
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
                  <td className={cn(td, "text-[12px] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase")} colSpan={span}>
                    Subtotal
                  </td>
                  <td className={cn(td, "tabular text-right font-semibold")}>
                    {formatMoney(totals.lines[i].subtotalValue ?? "0")}
                  </td>
                </tr>
              );
            }
            const alternative = line.rowType === "alternative";
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
                </td>
                <td className={cn(td, "tabular text-right")}>
                  {formatQty(line.quantity)}
                  {line.unit ? <span className="ml-1 text-[11px] text-[var(--text-faint)]">{line.unit}</span> : null}
                </td>
                {fulfilment ? (
                  <>
                    <Counter value={line.qtyOrdered} muted={!line.tracksStock} />
                    <Counter value={line.qtyAllocated} muted={!line.tracksStock} />
                    <Counter value={line.qtyInvoiced} />
                    <Counter value={line.qtyDelivered} muted={!line.tracksStock} />
                    <td className={td}>
                      <StatusBadge map={LINE_STATE} value={lineState(line)} />
                    </td>
                  </>
                ) : null}
                {converted ? <Counter value={line.qtyConverted} /> : null}
                <td className={cn(td, "tabular text-right")}>{formatPrice(line.unitPrice)}</td>
                {fulfilment ? null : (
                  <td className={cn(td, "tabular text-right text-[var(--text-muted)]")}>
                    {num(line.discountPercent) ? `${formatQty(line.discountPercent)}%` : "—"}
                  </td>
                )}
                <td className={cn(td, "tabular text-right")}>{formatMoney(totals.lines[i].lineAmount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
