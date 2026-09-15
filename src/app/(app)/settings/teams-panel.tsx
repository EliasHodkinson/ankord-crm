"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, Loader2, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { sendTestNotification } from "@/lib/actions/settings";

/**
 * Checks the Teams webhook without waiting for a lead to reach Proposal.
 *
 * Two buttons because the two routes are two different flows. The channel flow
 * is the Workflows template as it comes; direct messages need a second flow
 * whose action posts to a chat instead. Either can be set up without the other,
 * so each needs its own check.
 */
export function TeamsPanel({
  configured,
  directMessages,
}: {
  configured: boolean;
  /** Whether a second flow exists for direct messages. */
  directMessages: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  if (!configured) {
    return (
      <EmptyState
        compact
        title="No webhook configured"
        description="Add TEAMS_WEBHOOK_URL to the Vercel project and redeploy. Until then, notifications are silently off — nothing errors."
      />
    );
  }

  function test(toSelf: boolean) {
    start(async () => {
      const outcome = await sendTestNotification(toSelf);
      setResult({
        ok: outcome.ok,
        message: outcome.message ?? (outcome.ok ? "Sent." : "That didn't work."),
      });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="ok" dot>
          Channel
        </Badge>
        {directMessages ? (
          <Badge tone="ok" dot>
            Direct messages
          </Badge>
        ) : (
          <Badge tone="warn">Direct messages go to the channel</Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => test(false)}>
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          Test the channel
        </Button>
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => test(true)}>
          {pending ? <Loader2 className="animate-spin" /> : <MessageSquare />}
          Test a direct message
        </Button>
      </div>

      {result ? (
        <p
          role="status"
          className={
            result.ok
              ? "flex items-start gap-2 rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--ok)]"
              : "flex items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--danger)]"
          }
        >
          {result.ok ? (
            <Check className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          )}
          {result.message}
        </p>
      ) : null}

      <p className="text-[11px] leading-4 text-[var(--text-faint)]">
        Two flows, one each. The channel flow is the Workflows template as it
        comes. Direct messages need a second flow whose URL goes in{" "}
        <code className="font-mono">TEAMS_DM_WEBHOOK_URL</code>; without it they
        fall back to the channel rather than disappearing.
      </p>
    </div>
  );
}
