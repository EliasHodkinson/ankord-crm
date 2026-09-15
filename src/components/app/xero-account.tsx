"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Link2, Loader2, Search, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import {
  linkXeroContact,
  searchXeroForLink,
  unlinkXeroContact,
  type XeroSearchResult,
} from "@/lib/actions/xero";
import { cn, formatDate, money } from "@/lib/utils";

type Balances = {
  receivableOutstanding: number;
  receivableOverdue: number;
  payableOutstanding: number;
  payableOverdue: number;
};

type Invoice = {
  invoiceId: string;
  number: string | null;
  direction: "invoice" | "bill";
  status: string;
  date: Date | null;
  dueDate: Date | null;
  total: number;
  amountDue: number;
  amountPaid: number;
  overdue: boolean;
};

export type XeroAccountProps = {
  customerId: string;
  /** customer, supplier or both — decides which side of the ledger to lead with. */
  kind: "customer" | "supplier" | "both";
  linkedName: string | null;
  balances: Balances | null;
  invoices: Invoice[];
  error: string | null;
  needsReconnect: boolean;
  /** Whether Xero is connected at all on this deployment. */
  connected: boolean;
};

/** PAID and VOIDED read differently from one that is still owed. */
function statusTone(status: string, overdue: boolean) {
  if (status === "PAID") return "ok" as const;
  if (overdue) return "danger" as const;
  if (status === "AUTHORISED" || status === "SUBMITTED") return "neutral" as const;
  return "muted" as const;
}

export function XeroAccount(props: XeroAccountProps) {
  const {
    customerId,
    kind,
    linkedName,
    balances,
    invoices,
    error,
    needsReconnect,
    connected,
  } = props;

  const [pending, start] = useTransition();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<XeroSearchResult[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!connected) {
    return (
      <EmptyState
        compact
        title="Xero is not connected"
        description="An administrator can link the Ankor'd Xero organisation in Settings."
      />
    );
  }

  /* ── linked: show the account ──────────────────────────────────── */
  if (linkedName) {
    const showReceivable =
      kind !== "supplier" || (balances?.receivableOutstanding ?? 0) > 0;
    const showPayable = kind !== "customer" || (balances?.payableOutstanding ?? 0) > 0;

    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Badge tone="ok" dot>
            Linked
          </Badge>
          <span className="text-[13px] font-medium text-[var(--text)]">{linkedName}</span>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await unlinkXeroContact(customerId);
                setMessage(result.ok ? null : (result.message ?? "That didn't work."));
              })
            }
            className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)] disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Unlink className="size-3.5" />}
            Unlink
          </button>
        </div>

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--warn)]"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {error}
              {needsReconnect ? " An admin can reconnect it in Settings." : null}
            </span>
          </p>
        ) : null}

        {balances ? (
          <dl className="grid gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2">
            {showReceivable ? (
              <Figure
                label="They owe us"
                value={balances.receivableOutstanding}
                overdue={balances.receivableOverdue}
              />
            ) : null}
            {showPayable ? (
              <Figure
                label="We owe them"
                value={balances.payableOutstanding}
                overdue={balances.payableOverdue}
              />
            ) : null}
          </dl>
        ) : null}

        {invoices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-[11px] tracking-[0.09em] text-[var(--text-faint)] uppercase">
                  <th className="pb-1.5 font-semibold">Reference</th>
                  <th className="pb-1.5 font-semibold">Date</th>
                  <th className="pb-1.5 text-right font-semibold">Total</th>
                  <th className="pb-1.5 text-right font-semibold">Outstanding</th>
                  <th className="pb-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {invoices.map((inv) => {
                  const { overdue } = inv;
                  return (
                    <tr key={inv.invoiceId} className="border-t border-[var(--border-soft)]">
                      <td className="py-2 pr-3">
                        <span className="font-medium text-[var(--text)]">
                          {inv.number ?? "—"}
                        </span>
                        <span className="ml-1.5 text-[var(--text-faint)]">
                          {inv.direction === "bill" ? "Bill" : "Invoice"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-[var(--text-muted)]">
                        {formatDate(inv.date)}
                      </td>
                      <td className="py-2 pr-3 text-right text-[var(--text-muted)]">
                        {money(inv.total)}
                      </td>
                      <td
                        className={cn(
                          "py-2 pr-3 text-right",
                          overdue
                            ? "font-medium text-[var(--danger)]"
                            : "text-[var(--text-muted)]",
                        )}
                      >
                        {inv.amountDue > 0 ? money(inv.amountDue) : "—"}
                      </td>
                      <td className="py-2">
                        <Badge tone={statusTone(inv.status, overdue)}>
                          {overdue ? "Overdue" : inv.status.toLowerCase()}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : !error ? (
          <p className="text-[12px] text-[var(--text-muted)]">
            Nothing invoiced yet.
          </p>
        ) : null}

        {message ? (
          <p role="alert" className="text-[12px] text-[var(--danger)]">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  /* ── not linked: the picker ────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-5 text-[var(--text-muted)]">
        Link this record to its Xero contact to show what is owed and the
        invoice history here.
      </p>

      <form
        className="flex items-center gap-2"
        action={() =>
          start(async () => {
            const outcome = await searchXeroForLink(term);
            if (outcome.ok) {
              setResults(outcome.results);
              setMessage(null);
            } else {
              setResults(null);
              setMessage(outcome.message);
            }
          })
        }
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--text-faint)]" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search Xero by name or email…"
            aria-label="Search Xero contacts"
            className="pl-8"
          />
        </div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending || !term.trim()}>
          {pending ? <Loader2 className="animate-spin" /> : <Search />}
          Search
        </Button>
      </form>

      {results?.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          Nothing in Xero matched &ldquo;{term}&rdquo;.
        </p>
      ) : null}

      {results && results.length > 0 ? (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border border-[var(--border)] p-1 scrollbar-slim">
          {results.map((r) => (
            <li key={r.contactId}>
              <button
                type="button"
                disabled={pending || Boolean(r.takenBy)}
                onClick={() =>
                  start(async () => {
                    const result = await linkXeroContact(customerId, r.contactId, r.name);
                    setMessage(result.ok ? null : (result.message ?? "That didn't work."));
                  })
                }
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
              >
                <Link2 className="size-4 shrink-0 text-[var(--color-coastal-500)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--text)]">
                    {r.name}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--text-faint)]">
                    {r.takenBy
                      ? `Already linked to ${r.takenBy}`
                      : (r.email ?? "No email in Xero")}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  {r.isCustomer ? <Badge tone="neutral">Customer</Badge> : null}
                  {r.isSupplier ? <Badge tone="neutral">Supplier</Badge> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {message ? (
        <p
          role="alert"
          className="flex items-start gap-2 text-[12px] leading-5 text-[var(--danger)]"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {message}
        </p>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  overdue,
}: {
  label: string;
  value: number;
  overdue: number;
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-[var(--surface)] px-4 py-3">
      <dt className="text-[11px] font-semibold tracking-[0.09em] text-[var(--text-faint)] uppercase">
        {label}
      </dt>
      <dd className="text-[20px] leading-tight font-semibold tabular-nums text-[var(--text)]">
        {money(value)}
      </dd>
      {overdue > 0 ? (
        <dd className="text-[12px] font-medium tabular-nums text-[var(--danger)]">
          {money(overdue)} overdue
        </dd>
      ) : null}
    </div>
  );
}
