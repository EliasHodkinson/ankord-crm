"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  approveDocument,
  cancelDocument,
  closeDocument,
  confirmOrder,
  deleteDocument,
  duplicateDocument,
  reopenDocument,
  setQuoteOutcome,
} from "@/lib/actions/documents";
import type { ActionState } from "@/lib/actions/shared";
import { cn } from "@/lib/utils";

/**
 * The action bar on a document page: one primary next step (the single
 * Sunrise button in the view) and the rest as quieter buttons. Anything that
 * cannot be undone asks first, inline, naming the consequence.
 */

export type DocAction =
  | { kind: "link"; label: string; href: string; primary?: boolean }
  | {
      kind: "run";
      id:
        | "approve"
        | "accept"
        | "decline"
        | "confirm"
        | "delete"
        | "close"
        | "reopen"
        | "cancel"
        | "duplicate";
      label: string;
      primary?: boolean;
      /** Asked before running, when it is hard to undo. */
      confirm?: string;
      danger?: boolean;
    };

function run(id: Extract<DocAction, { kind: "run" }>["id"], documentId: string, reason?: string): Promise<ActionState> {
  switch (id) {
    case "approve":
      return approveDocument(documentId);
    case "accept":
      return setQuoteOutcome(documentId, "accepted");
    case "decline":
      return setQuoteOutcome(documentId, "declined");
    case "confirm":
      return confirmOrder(documentId);
    case "delete":
      return deleteDocument(documentId);
    case "close":
      return closeDocument(documentId);
    case "reopen":
      return reopenDocument(documentId);
    case "cancel":
      return cancelDocument(documentId, reason);
    case "duplicate":
      return duplicateDocument(documentId);
  }
}

export function DocumentActions({ documentId, actions }: { documentId: string; actions: DocAction[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [running, setRunning] = React.useState<string | null>(null);
  const [asking, setAsking] = React.useState<Extract<DocAction, { kind: "run" }> | null>(null);
  const [reason, setReason] = React.useState("");
  const [result, setResult] = React.useState<ActionState | null>(null);

  const go = (action: Extract<DocAction, { kind: "run" }>) => {
    setRunning(action.id);
    setResult(null);
    start(async () => {
      const outcome = await run(action.id, documentId, reason);
      setResult(outcome);
      setAsking(null);
      setRunning(null);
      if (outcome.ok && outcome.data?.href) router.push(outcome.data.href);
      else router.refresh();
    });
  };

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action) =>
          action.kind === "link" ? (
            <ButtonLink
              key={action.href}
              href={action.href}
              variant={action.primary ? "primary" : "secondary"}
              size="sm"
            >
              {action.label}
            </ButtonLink>
          ) : (
            <Button
              key={action.id}
              size="sm"
              variant={action.primary ? "primary" : action.danger ? "ghost" : "secondary"}
              className={cn(action.danger && "text-[var(--danger)] hover:text-[var(--danger)]")}
              disabled={pending}
              onClick={() => (action.confirm ? setAsking(action) : go(action))}
            >
              {running === action.id ? <Loader2 className="animate-spin" /> : null}
              {action.label}
            </Button>
          ),
        )}
      </div>

      {asking ? (
        <div
          role="alertdialog"
          aria-label={asking.label}
          className="flex flex-col gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
        >
          <p className="text-[13px] leading-5 text-[var(--text)]">{asking.confirm}</p>
          {asking.id === "cancel" ? (
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why? (optional)"
              aria-label="Reason"
              className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[13px]"
            />
          ) : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={asking.danger ? "danger" : "primary"}
              disabled={pending}
              onClick={() => go(asking)}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              {asking.label}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
              Not now
            </Button>
          </div>
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
    </div>
  );
}
