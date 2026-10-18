"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { allocateStock, releaseAllocation } from "@/lib/actions/purchasing";
import type { ActionState } from "@/lib/actions/shared";
import { formatQty, num } from "@/lib/sales/money";
import { cn } from "@/lib/utils";

/**
 * Stock set aside for this order's (or reserve invoice's) lines: what came in
 * on a receipt for it, and what was taken from the shelf by hand. "Allocate
 * from stock" offers the smaller of what the line still needs and what is
 * available; Release puts an allocation back.
 */

export type AllocationLine = {
  id: string;
  label: string;
  /** Still to set aside: left to deliver, less what is allocated. */
  need: number;
  available: number;
};

export type AllocationRow = {
  id: string;
  lineId: string;
  quantity: string;
  consumed: string;
  receiptId: string | null;
  receiptNumber: string | null;
};

export function AllocationsPanel({
  lines,
  allocations,
  canWrite,
}: {
  lines: AllocationLine[];
  allocations: AllocationRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ActionState | null>(null);
  const [amounts, setAmounts] = React.useState<Record<string, string>>({});

  const go = (key: string, fn: () => Promise<ActionState>) => {
    setBusy(key);
    setResult(null);
    start(async () => {
      const outcome = await fn();
      setResult(outcome);
      setBusy(null);
      router.refresh();
    });
  };

  const name = (lineId: string) => lines.find((l) => l.id === lineId)?.label ?? "Line";
  const live = allocations.filter((a) => num(a.quantity) > num(a.consumed));
  const open = lines.filter((l) => l.need > 0);

  return (
    <div className="flex flex-col gap-3">
      {live.length ? (
        <ul className="flex flex-col divide-y divide-[var(--border-soft)]">
          {live.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-1.5 text-[13px] first:pt-0">
              <span className="min-w-0">
                <span className="tabular font-medium">{formatQty(num(a.quantity) - num(a.consumed))}</span> × {name(a.lineId)}
                <span className="block text-[12px] text-[var(--text-muted)]">
                  {a.receiptId ? (
                    <>
                      From{" "}
                      <Link href={`/purchasing/receipts/${a.receiptId}`} className="hover:underline underline-offset-2">
                        {a.receiptNumber}
                      </Link>
                    </>
                  ) : (
                    "From stock on hand"
                  )}
                </span>
              </span>
              {canWrite ? (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => go(a.id, () => releaseAllocation(a.id))}>
                  {busy === a.id ? <Loader2 className="animate-spin" /> : null}
                  Release
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-[var(--text-muted)]">Nothing set aside yet. Received stock is allocated here automatically.</p>
      )}

      {canWrite && open.some((l) => l.available > 0) ? (
        <div className="flex flex-col gap-2 border-t border-[var(--border-soft)] pt-3">
          <p className="text-[12px] font-semibold tracking-[0.02em] text-[var(--text-muted)]">Allocate from stock</p>
          {open
            .filter((l) => l.available > 0)
            .map((l) => {
              const suggested = Math.min(l.need, l.available);
              const value = amounts[l.id] ?? formatQty(suggested);
              return (
                <div key={l.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-1">
                    {l.label}
                    <span className="block text-[12px] text-[var(--text-muted)]">
                      Needs {formatQty(l.need)} · {formatQty(l.available)} available
                    </span>
                  </span>
                  <Input
                    aria-label={`Allocate ${l.label}`}
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => setAmounts((m) => ({ ...m, [l.id]: e.target.value }))}
                    className="tabular h-8 w-20 text-right"
                  />
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => go(l.id, () => allocateStock(l.id, value))}>
                    {busy === l.id ? <Loader2 className="animate-spin" /> : null}
                    Allocate
                  </Button>
                </div>
              );
            })}
        </div>
      ) : null}

      {result?.message ? (
        <p role={result.ok ? "status" : "alert"} className={cn("text-[12px]", result.ok ? "text-[var(--ok)]" : "text-[var(--danger)]")}>
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
