"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { linkBill, linkPurchaseOrder, searchSalesForLink, unlinkPurchaseOrder, type LinkOption } from "@/lib/actions/purchasing";
import type { ActionState } from "@/lib/actions/shared";
import { docHref, typeLabel } from "@/lib/sales/doc-types";
import { formatMoney } from "@/lib/sales/money";
import { cn, formatDate } from "@/lib/utils";

/**
 * Joining documents that were made apart, usually in Xero before they were
 * imported: a PO to the sales order or invoice it was bought for, and a bill
 * to the PO it was entered against. Lines are paired by item, then by
 * description; the counters do the rest.
 */

function useRun() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<ActionState | null>(null);
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      setResult(null);
      const outcome = await fn();
      setResult(outcome);
      router.refresh();
    });
  return { pending, result, run };
}

function Result({ result }: { result: ActionState | null }) {
  if (!result?.message) return null;
  return (
    <p role={result.ok ? "status" : "alert"} className={cn("text-[12px]", result.ok ? "text-[var(--ok)]" : "text-[var(--danger)]")}>
      {result.message}
    </p>
  );
}

const optionTitle = (o: Pick<LinkOption, "type" | "number" | "isReserve">) =>
  `${typeLabel(o.type, o.isReserve)} ${o.number ?? "(draft)"}`;

/** On a PO: what it was raised for, or a search to say so. */
export function LinkSalesPanel({
  purchaseOrderId,
  linked,
  suggestions,
  canWrite,
}: {
  purchaseOrderId: string;
  linked: LinkOption[];
  /** Sales documents named in the PO's reference, offered first. */
  suggestions: LinkOption[];
  canWrite: boolean;
}) {
  const { pending, result, run } = useRun();
  const [term, setTerm] = React.useState("");
  const [options, setOptions] = React.useState<LinkOption[]>(suggestions);
  const [choice, setChoice] = React.useState<LinkOption | null>(null);
  const [searching, setSearching] = React.useState(false);

  React.useEffect(() => {
    if (!term.trim()) return;
    let live = true;
    const t = setTimeout(async () => {
      setSearching(true);
      const found = await searchSalesForLink(term);
      if (live) {
        setOptions(found);
        setSearching(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [term]);

  if (linked.length) {
    return (
      <div className="flex flex-col gap-2.5">
        <ul className="flex flex-col gap-1.5">
          {linked.map((o) => (
            <li key={o.id} className="flex items-baseline justify-between gap-2 text-[13px]">
              <Link href={docHref(o)} className="font-medium text-[var(--text)] hover:underline underline-offset-2">
                {optionTitle(o)}
              </Link>
              <span className="truncate text-[12px] text-[var(--text-muted)]">{o.partnerName}</span>
            </li>
          ))}
        </ul>
        <p className="text-[12px] leading-5 text-[var(--text-muted)]">
          What arrives on this order is allocated to {linked.length === 1 ? "it" : "them"} when it is received.
        </p>
        {canWrite ? (
          <div>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => unlinkPurchaseOrder(purchaseOrderId))}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Unlink
            </Button>
          </div>
        ) : null}
        <Result result={result} />
      </div>
    );
  }

  if (!canWrite) {
    return <p className="text-[13px] text-[var(--text-muted)]">Not linked to a sales order or invoice.</p>;
  }

  const willReserve = choice?.type === "invoice" && !choice.isReserve;

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[12px] leading-5 text-[var(--text-muted)]">
        Which sales order or invoice was this bought for? Linking it shows the order and its tracking there, and allocates the
        goods to it when they arrive.
      </p>
      <label className="relative block">
        <span className="sr-only">Find a sales order or invoice</span>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--text-faint)]" aria-hidden />
        <Input
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setChoice(null);
          }}
          placeholder="INV-0028, SO-00017 or customer…"
          className="pl-8"
        />
      </label>
      {options.length ? (
        <ul className="flex max-h-56 flex-col overflow-y-auto rounded-lg border border-[var(--border)] scrollbar-slim" role="listbox" aria-label="Sales documents">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={choice?.id === o.id}
                onClick={() => setChoice(o)}
                className={cn(
                  "flex w-full items-baseline justify-between gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--surface-2)]",
                  choice?.id === o.id && "bg-[var(--surface-2)]",
                )}
              >
                <span className="min-w-0">
                  <span className="block font-medium text-[var(--text)]">{optionTitle(o)}</span>
                  <span className="block truncate text-[12px] text-[var(--text-muted)]">
                    {o.partnerName} · {formatDate(o.docDate)}
                  </span>
                </span>
                <span className="tabular shrink-0 text-[12px] text-[var(--text-muted)]">{formatMoney(o.total)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : term.trim() && !searching ? (
        <p className="text-[12px] text-[var(--text-muted)]">Nothing open matches that.</p>
      ) : null}
      {choice ? (
        <div role="alertdialog" aria-label="Link" className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
          <p className="text-[13px] leading-5">
            Link to {optionTitle(choice)} for {choice.partnerName}?
            {willReserve
              ? ` ${choice.number} becomes a reserve invoice: the customer's invoice stays as it is in Xero, and the goods go out on a delivery from here once they arrive.`
              : ""}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => linkPurchaseOrder(purchaseOrderId, choice.id))}>
              {pending ? <Loader2 className="animate-spin" /> : <Link2 />}
              Link
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setChoice(null)}>
              Not now
            </Button>
          </div>
        </div>
      ) : null}
      <Result result={result} />
    </div>
  );
}

/** On a bill not yet entered against a PO: the supplier's POs to choose from. */
export function LinkBillPanel({ billId, options, canWrite }: { billId: string; options: LinkOption[]; canWrite: boolean }) {
  const { pending, result, run } = useRun();
  if (!canWrite) return <p className="text-[13px] text-[var(--text-muted)]">Not entered against a purchase order.</p>;
  if (options.length === 0) {
    return (
      <p className="text-[13px] leading-6 text-[var(--text-muted)]">
        Not entered against a purchase order, and this supplier has none open here. Import the PO from Xero to link it.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] leading-5 text-[var(--text-muted)]">Which purchase order is this bill for? Its lines count as billed there.</p>
      <ul className="flex flex-col gap-1">
        {options.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-2 text-[13px]">
            <Link href={docHref(o)} className="font-medium hover:underline underline-offset-2">
              {o.number ?? "Draft PO"}
            </Link>
            <span className="tabular text-[12px] text-[var(--text-muted)]">{formatMoney(o.total)}</span>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => linkBill(billId, o.id))}>
              Link
            </Button>
          </li>
        ))}
      </ul>
      <Result result={result} />
    </div>
  );
}
