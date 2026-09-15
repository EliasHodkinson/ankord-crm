"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { deleteCommunication } from "@/lib/actions/communications";
import { cn } from "@/lib/utils";

/**
 * Unlinks a timeline entry. Only the person who logged it, or an admin, sees
 * this — the server action enforces the same rule.
 */
export function TimelineRemove({
  id,
  label,
  revalidate,
}: {
  id: string;
  label: string;
  revalidate: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2 text-[12px]">
        <span className="text-[var(--text-muted)]">Remove from the timeline?</span>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await deleteCommunication(id, revalidate);
              if (!result.ok) {
                setError(result.message ?? "That didn't work.");
                setConfirming(false);
              }
            })
          }
          className="inline-flex items-center gap-1 font-medium text-[var(--danger)] hover:underline underline-offset-2 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : null}
          Remove
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-[var(--text-muted)] hover:text-[var(--text)] hover:underline underline-offset-2"
        >
          Keep
        </button>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Remove "${label}" from the timeline`}
        onClick={() => setConfirming(true)}
        className={cn(
          "inline-flex items-center gap-1 rounded text-[12px] text-[var(--text-faint)]",
          "opacity-0 transition-opacity group-hover/entry:opacity-100 focus-visible:opacity-100",
          "hover:text-[var(--danger)]",
        )}
      >
        <Trash2 className="size-3" />
        Remove
      </button>
      {error ? (
        <span role="alert" className="text-[12px] text-[var(--danger)]">
          {error}
        </span>
      ) : null}
    </>
  );
}
