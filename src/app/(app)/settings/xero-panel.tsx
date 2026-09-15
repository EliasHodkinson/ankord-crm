"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, Link2, Loader2, Unlink } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { disconnectXeroAction } from "@/lib/actions/settings";
import { formatDate } from "@/lib/utils";

export type XeroState = {
  tenantName: string | null;
  tenantId: string | null;
  connectedAt: Date | null;
  refreshedAt: Date | null;
} | null;

/**
 * Connect or disconnect the company's Xero organisation.
 *
 * Deliberately shows when the connection was last refreshed: a Xero refresh
 * token dies 60 days after its last use, so a stale date is the early warning
 * that the link is about to break.
 */
export function XeroPanel({
  connection,
  configured,
  notice,
}: {
  connection: XeroState;
  /** Whether XERO_CLIENT_ID / SECRET are set on this deployment. */
  configured: boolean;
  notice: { kind: "connected" | "error"; detail: string } | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!configured) {
    return (
      <EmptyState
        compact
        title="Xero is not set up on this deployment"
        description="Add XERO_CLIENT_ID and XERO_CLIENT_SECRET to the Vercel project, then reload this page."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {notice ? (
        <p
          role="status"
          className={
            notice.kind === "connected"
              ? "flex items-start gap-2 rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--ok)]"
              : "flex items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--danger)]"
          }
        >
          {notice.kind === "connected" ? (
            <Check className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          )}
          {notice.detail}
        </p>
      ) : null}

      {connection ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Badge tone="ok" dot>
              Connected
            </Badge>
            <span className="text-[13px] font-medium text-[var(--text)]">
              {connection.tenantName ?? "Xero organisation"}
            </span>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-[var(--text-muted)]">
            <div>
              <dt className="inline text-[var(--text-faint)]">Connected </dt>
              <dd className="inline">
                {connection.connectedAt ? formatDate(connection.connectedAt) : "—"}
              </dd>
            </div>
            <div>
              <dt className="inline text-[var(--text-faint)]">Last refreshed </dt>
              <dd className="inline">
                {connection.refreshedAt ? formatDate(connection.refreshedAt) : "—"}
              </dd>
            </div>
          </dl>
          <p className="text-[11px] leading-4 text-[var(--text-faint)]">
            Xero access is read-only — the CRM never writes an invoice or edits a
            contact. The link lapses if it goes 60 days without being used.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await disconnectXeroAction();
                  setError(result.ok ? null : (result.message ?? "That didn't work."));
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : <Unlink />}
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <EmptyState
          compact
          title="Not connected to Xero"
          description="Link the Ankor'd Xero organisation to show account balances and invoice history against customers and suppliers."
          action={
            <ButtonLink href="/api/xero/connect" variant="primary" size="sm">
              <Link2 />
              Connect Xero
            </ButtonLink>
          }
        />
      )}

      {error ? (
        <p role="alert" className="text-[12px] text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
