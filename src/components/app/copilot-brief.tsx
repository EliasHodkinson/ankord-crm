"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, FileText, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { writeCustomerBrief } from "@/lib/actions/brief";
import { relativeTime } from "@/lib/utils";

/**
 * Writes a plain-English summary of this record into its SharePoint folder so
 * Copilot can answer questions about it.
 *
 * Copilot grounds on the tenant and cannot see the database, so without this
 * file it knows a partner's documents and emails but nothing about their
 * status, their people or what happens next.
 */
export function CopilotBrief({
  customerId,
  writtenAt,
  hasFolder,
}: {
  customerId: string;
  writtenAt: Date | null;
  /** No folder means nowhere to put it. */
  hasFolder: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  if (!hasFolder) {
    return (
      <p className="text-[12px] leading-5 text-[var(--text-muted)]">
        Create the SharePoint folder first — the brief is written inside it.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-5 text-[var(--text-muted)]">
        Writes <code className="font-mono text-[11px]">_internal/_Brief.md</code> into
        their SharePoint folder: who they are, their people, projects, recent
        conversations and open follow-ups. Copilot reads the tenant but not the CRM,
        so this is how it learns any of that.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={writtenAt ? "secondary" : "primary"}
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const outcome = await writeCustomerBrief(customerId);
              setResult({
                ok: outcome.ok,
                message: outcome.message ?? (outcome.ok ? "Written." : "That didn't work."),
              });
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : writtenAt ? <FileText /> : <Sparkles />}
          {pending ? "Writing…" : writtenAt ? "Rewrite the brief" : "Write the brief"}
        </Button>

        {writtenAt ? (
          <Badge tone="neutral">Last written {relativeTime(writtenAt)}</Badge>
        ) : null}
      </div>

      {writtenAt ? (
        <p className="text-[11px] leading-4 text-[var(--text-faint)]">
          Rewritten automatically whenever this record is edited. Logging a call or
          adding a follow-up does not rewrite it — use the button after those.
        </p>
      ) : null}

      {result ? (
        <p
          role="status"
          className={`inline-flex items-start gap-1.5 text-[12px] leading-5 ${
            result.ok ? "text-[var(--text-muted)]" : "text-[var(--danger)]"
          }`}
        >
          {result.ok ? (
            <Check className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          )}
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
