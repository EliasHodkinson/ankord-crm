"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, FileText, Loader2, RefreshCw, UploadCloud, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataRow } from "@/components/ui/field";
import { StatusBadge, XERO_SYNC } from "@/components/ui/status";
import {
  createXeroContactForDocument,
  refreshFromXero,
  retryXeroPush,
  saveXeroPdfToSharePoint,
} from "@/lib/actions/documents";
import type { ActionState } from "@/lib/actions/shared";
import { formatMoney } from "@/lib/sales/money";
import { cn, formatDateTime } from "@/lib/utils";

/**
 * Where a document stands with Xero, and the fixes for when it is stuck.
 * Every message here says what to do next, not just what went wrong.
 */
export function XeroDocPanel({
  documentId,
  syncState,
  error,
  number,
  xeroStatus,
  xeroUrl,
  inXero,
  syncedAt,
  partner,
  canWrite,
  mismatch,
}: {
  documentId: string;
  syncState: string;
  error: string | null;
  number: string | null;
  xeroStatus: string | null;
  xeroUrl: string | null;
  inXero: boolean;
  syncedAt: Date | null;
  partner: { id: string; name: string; linked: boolean };
  canWrite: boolean;
  /** Xero's total differs from ours: someone edited it in Xero. */
  mismatch: { xero: string; ours: string } | null;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ActionState | null>(null);

  const act = (name: string, fn: () => Promise<ActionState>) => {
    setBusy(name);
    setResult(null);
    start(async () => {
      const outcome = await fn();
      setResult(outcome);
      setBusy(null);
      router.refresh();
    });
  };

  const spinner = (name: string) => (busy === name ? <Loader2 className="animate-spin" /> : null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge map={XERO_SYNC} value={syncState} dot />
        {xeroStatus ? (
          <span className="font-mono text-[11px] tracking-[0.04em] text-[var(--text-muted)]">{xeroStatus}</span>
        ) : null}
      </div>

      <dl className="divide-y divide-[var(--border-soft)]">
        <DataRow label="Xero number">
          {number ?? <span className="text-[var(--text-faint)]">Draft · not in Xero yet</span>}
        </DataRow>
        <DataRow label="Last synced">{syncedAt ? formatDateTime(syncedAt) : "—"}</DataRow>
      </dl>

      {error ? (
        <p
          role="alert"
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-5",
            syncState === "blocked"
              ? "border-[var(--warn)]/30 bg-[var(--warn-bg)] text-[var(--warn)]"
              : "border-[var(--danger)]/30 bg-[var(--danger-bg)] text-[var(--danger)]",
          )}
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {mismatch ? (
        <p className="flex items-start gap-2 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--warn)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Changed in Xero ({formatMoney(mismatch.xero)} there, {formatMoney(mismatch.ours)} here). Re-push to
          overwrite it, or edit here to match.
        </p>
      ) : null}

      {!partner.linked ? (
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
          <p className="text-[12px] leading-5 text-[var(--text-muted)]">
            {partner.name} isn&apos;t linked to a Xero contact, so Xero can&apos;t take this yet.
          </p>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => act("contact", () => createXeroContactForDocument(documentId))}
              >
                {spinner("contact") ?? <UserPlus />}
                Create in Xero
              </Button>
              <Link
                href={`/customers/${partner.id}#xero`}
                className="inline-flex h-8 items-center px-2 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)] hover:underline underline-offset-2"
              >
                Link an existing contact
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {xeroUrl ? (
          <a
            href={xeroUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-medium text-[var(--text)] shadow-[var(--shadow-sm)] hover:bg-[var(--surface-2)]"
          >
            <ExternalLink className="size-4" />
            Open in Xero
          </a>
        ) : null}
        {canWrite && (syncState === "failed" || syncState === "blocked" || syncState === "pending" || mismatch) ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => act("retry", () => retryXeroPush(documentId))}
          >
            {spinner("retry") ?? <UploadCloud />}
            {mismatch ? "Re-push" : "Retry"}
          </Button>
        ) : null}
        {inXero && canWrite ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => act("refresh", () => refreshFromXero(documentId))}
          >
            {spinner("refresh") ?? <RefreshCw />}
            Refresh from Xero
          </Button>
        ) : null}
      </div>

      {inXero ? (
        <div className="flex flex-wrap gap-2 border-t border-[var(--border-soft)] pt-3">
          <a
            href={`/api/documents/${documentId}/xero-pdf`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-2 px-1 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <FileText className="size-4" />
            View Xero&apos;s PDF
          </a>
          {canWrite ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => act("pdf", () => saveXeroPdfToSharePoint(documentId))}
            >
              {spinner("pdf") ?? <UploadCloud />}
              Save PDF to SharePoint
            </Button>
          ) : null}
        </div>
      ) : null}

      {result?.message ? (
        <p
          role={result.ok ? "status" : "alert"}
          className={cn("text-[12px]", result.ok ? "text-[var(--ok)]" : "text-[var(--danger)]")}
        >
          {result.message}
        </p>
      ) : null}

      <p className="text-[11px] leading-4 text-[var(--text-faint)]">
        Xero numbers it and sends it. Send it from Xero; The Gangway reads the status back.
      </p>
    </div>
  );
}
