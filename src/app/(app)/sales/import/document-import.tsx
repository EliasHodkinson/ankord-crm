"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DownloadCloud, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { IMPORT_DOC_PLAN, StatusBadge } from "@/components/ui/status";
import { importXeroDocuments } from "@/lib/actions/xero-import";
import type { ActionState } from "@/lib/actions/shared";
import { describeScope, type DocPreviewRow, type ImportScope, type ImportSourceKey } from "@/lib/xero/import/scope";
import { docHref } from "@/lib/sales/doc-types";
import { formatMoney, num } from "@/lib/sales/money";
import { cn, formatDate } from "@/lib/utils";

const IMPORTABLE = new Set(["create", "update", "refresh"]);

/**
 * Step 3: choose which quotes or invoices, see what would happen to each, and
 * import the ticked ones. The scope lives in the URL so the preview is a page
 * read like any other; the import itself is one action over the ticked IDs.
 */
const SOURCE_LABEL: Record<ImportSourceKey, string> = {
  quotes: "quotes",
  invoices: "invoices",
  purchase_orders: "purchase orders",
  bills: "bills",
};

const PLACEHOLDER: Record<ImportSourceKey, string> = {
  quotes: "QU-0012, QU-0015",
  invoices: "INV-0028, INV-0031",
  purchase_orders: "PO-0011, PO-0012",
  // A bill is found by the supplier's number, or by the PO in its reference.
  bills: "PO-0011 or the supplier's invoice number",
};

export function DocumentImport({
  source,
  scope,
  rows,
  problem,
  canWrite,
}: {
  source: ImportSourceKey;
  scope: ImportScope;
  rows: DocPreviewRow[];
  problem: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNav] = React.useTransition();
  const [importing, startImport] = React.useTransition();
  const [result, setResult] = React.useState<ActionState | null>(null);

  const [mode, setMode] = React.useState(scope.mode);
  const [from, setFrom] = React.useState(scope.mode === "range" ? scope.from : "");
  const [to, setTo] = React.useState(scope.mode === "range" ? scope.to : "");
  const [numbers, setNumbers] = React.useState(scope.mode === "numbers" ? scope.numbers.join(", ") : "");

  const importable = rows.filter((r) => IMPORTABLE.has(r.plan));
  const [ticked, setTicked] = React.useState<Set<string>>(() => new Set(importable.map((r) => r.xeroId)));
  // A new preview starts with everything importable ticked.
  const key = rows.map((r) => `${r.xeroId}:${r.plan}`).join("|");
  const [seenKey, setSeenKey] = React.useState(key);
  if (key !== seenKey) {
    setSeenKey(key);
    setTicked(new Set(importable.map((r) => r.xeroId)));
  }

  const params = () => {
    const next = new URLSearchParams({ tab: "documents", source });
    if (mode === "range" && from && to) {
      next.set("mode", "range");
      next.set("from", from);
      next.set("to", to);
    }
    if (mode === "numbers" && numbers.trim()) {
      next.set("mode", "numbers");
      next.set("numbers", numbers.trim());
    }
    return next;
  };

  /** The preview on screen — what the ticked rows came from — not the form's unsaved edits. */
  const shownParams = () => {
    const shown: Record<string, string> = { source, mode: scope.mode };
    if (scope.mode === "range") Object.assign(shown, { from: scope.from, to: scope.to });
    if (scope.mode === "numbers") shown.numbers = scope.numbers.join(",");
    return shown;
  };

  const go = (next: URLSearchParams) => startNav(() => router.replace(`${pathname}?${next}`, { scroll: false }));

  const chosen = importable.filter((r) => ticked.has(r.xeroId));
  const label = SOURCE_LABEL[source];
  const waiting = rows.filter((r) => r.plan === "waiting");

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setResult(null);
          go(params());
        }}
      >
        <label className="flex flex-col gap-1 text-[12px] font-medium text-[var(--text-muted)]">
          Documents
          <Select
            value={source}
            onChange={(e) => {
              const next = params();
              next.set("source", e.target.value);
              setResult(null);
              go(next);
            }}
            className="h-8 text-[13px]"
          >
            <option value="quotes">Quotes</option>
            <option value="invoices">Invoices</option>
            <option value="purchase_orders">Purchase orders</option>
            <option value="bills">Bills</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-[var(--text-muted)]">
          Which
          <Select value={mode} onChange={(e) => setMode(e.target.value as ImportScope["mode"])} className="h-8 text-[13px]">
            <option value="open">Open in Xero</option>
            <option value="range">Dated between…</option>
            <option value="numbers">By number…</option>
          </Select>
        </label>
        {mode === "range" ? (
          <>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-[var(--text-muted)]">
              From
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required className="h-8 text-[13px]" />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-[var(--text-muted)]">
              To
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} required className="h-8 text-[13px]" />
            </label>
          </>
        ) : null}
        {mode === "numbers" ? (
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-[12px] font-medium text-[var(--text-muted)]">
            Numbers
            <Input
              value={numbers}
              onChange={(e) => setNumbers(e.target.value)}
              placeholder={PLACEHOLDER[source]}
              required
              className="h-8 text-[13px]"
            />
          </label>
        ) : null}
        <Button type="submit" size="sm" variant="secondary" disabled={navigating}>
          {navigating ? <Loader2 className="animate-spin" /> : <Search />}
          Preview
        </Button>
      </form>

      {problem ? (
        <p role="alert" className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2 text-[13px] text-[var(--danger)]">
          Could not read Xero: {problem}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[72ch] text-[13px] leading-5 text-[var(--text-muted)]">
          {rows.length} {rows.length === 1 ? label.slice(0, -1) : label} {describeScope(scope)}.{" "}
          {mode === "open" && scope.mode === "open"
            ? `Paid and finished ${label} are left out — choose a date range or numbers to bring those in.`
            : null}
          {waiting.length ? ` ${waiting.length} wait for their contact to be matched.` : null}
        </p>
        {canWrite ? (
          <span className="flex flex-wrap items-center gap-2">
            {result?.message ? (
              <span role={result.ok ? "status" : "alert"} className={cn("text-[12px]", result.ok ? "text-[var(--ok)]" : "text-[var(--danger)]")}>
                {result.message}
              </span>
            ) : null}
            <Button
              variant="primary"
              disabled={importing || chosen.length === 0}
              onClick={() =>
                startImport(async () => {
                  setResult(await importXeroDocuments(shownParams(), chosen.map((r) => r.xeroId)));
                  router.refresh();
                })
              }
            >
              {importing ? <Loader2 className="animate-spin" /> : <DownloadCloud />}
              Import {chosen.length} {chosen.length === 1 ? label.slice(0, -1) : label}
            </Button>
          </span>
        ) : null}
      </div>

      {rows.length === 0 && !problem ? (
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState
            compact
            title={`No ${label} ${describeScope(scope)}`}
            description="Try a date range, or type the numbers you are after."
          />
        </div>
      ) : rows.length ? (
        <TableShell>
          <Table>
            <thead>
              <tr>
                <Th className="w-10">
                  {canWrite && importable.length ? (
                    <input
                      type="checkbox"
                      aria-label={`Tick every ${label.slice(0, -1)} that can be imported`}
                      checked={chosen.length === importable.length}
                      onChange={(e) => setTicked(new Set(e.target.checked ? importable.map((r) => r.xeroId) : []))}
                      className="size-4 accent-[var(--accent)]"
                    />
                  ) : null}
                </Th>
                <Th>Number</Th>
                <Th>Contact</Th>
                <Th>Date</Th>
                <Th>In Xero</Th>
                <Th numeric>Total</Th>
                {source === "invoices" || source === "bills" ? <Th numeric>Due</Th> : null}
                <Th>Import</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const can = IMPORTABLE.has(row.plan);
                return (
                  <Tr key={row.xeroId}>
                    <Td>
                      {canWrite && can ? (
                        <input
                          type="checkbox"
                          aria-label={`Import ${row.number ?? "this document"}`}
                          checked={ticked.has(row.xeroId)}
                          onChange={(e) => {
                            const next = new Set(ticked);
                            if (e.target.checked) next.add(row.xeroId);
                            else next.delete(row.xeroId);
                            setTicked(next);
                          }}
                          className="size-4 accent-[var(--accent)]"
                        />
                      ) : null}
                    </Td>
                    <Td className="font-medium tabular">
                      {row.existingId ? (
                        <Link href={docHref({ type: row.type, id: row.existingId })} className="hover:underline underline-offset-2">
                          {row.number ?? "Draft"}
                        </Link>
                      ) : (
                        (row.number ?? "Draft")
                      )}
                    </Td>
                    <Td>
                      {row.partner ? (
                        <Link href={`/customers/${row.partner.id}`} className="hover:underline underline-offset-2">
                          {row.partner.name}
                        </Link>
                      ) : (
                        <span>{row.contactName}</span>
                      )}
                    </Td>
                    <Td className="tabular text-[12px] text-[var(--text-muted)]">{formatDate(row.docDate)}</Td>
                    <Td>
                      <Badge tone="neutral">{row.xeroStatus.charAt(0) + row.xeroStatus.slice(1).toLowerCase()}</Badge>
                    </Td>
                    <Td numeric>
                      {formatMoney(row.total)}
                      {row.totalsDiffer ? (
                        <span className="block text-[11px] text-[var(--warn)]">Xero: {formatMoney(row.xeroTotal)}</span>
                      ) : null}
                    </Td>
                    {source === "invoices" || source === "bills" ? (
                      <Td numeric className={num(row.amountDue) === 0 ? "text-[var(--text-faint)]" : undefined}>
                        {formatMoney(row.amountDue)}
                      </Td>
                    ) : null}
                    <Td>
                      <span className="flex flex-col items-start gap-1">
                        <StatusBadge map={IMPORT_DOC_PLAN} value={row.plan} />
                        {row.plan === "waiting" ? (
                          <Link
                            href={`/sales/import?tab=contacts&show=all&q=${encodeURIComponent(row.contactName)}`}
                            className="text-[12px] text-[var(--accent)] hover:underline underline-offset-2"
                          >
                            Match {row.contactName}
                          </Link>
                        ) : row.note ? (
                          <span className="max-w-[34ch] text-[12px] leading-4 text-[var(--text-muted)]">{row.note}</span>
                        ) : null}
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableShell>
      ) : null}
    </div>
  );
}
