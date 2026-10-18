"use client";

import { useState, useTransition } from "react";
import { Check, CircleDashed, Loader2, MinusCircle, OctagonAlert } from "lucide-react";
import { STEP_BLOCKER, STEP_STATUS } from "@/components/ui/status";
import { clearStepBlocker } from "@/lib/actions/projects";
import { blockerOf } from "@/lib/runbook-views";
import { cn } from "@/lib/utils";

/**
 * The step status dial, shared by the runbook list and the board so the two
 * cannot drift. Wording and badge tone stay in `ui/status.tsx`; only the icon
 * and the ring colour live here.
 */

export const STEP_STATUS_ORDER = [
  "todo",
  "in_progress",
  "blocked",
  "done",
  "not_applicable",
] as const;

export type StepStatus = (typeof STEP_STATUS_ORDER)[number];

/**
 * Icon and tint per status. A constant map rather than a lookup function so
 * the component reference is stable across renders.
 */
export const STEP_STATUS_META = {
  todo: { icon: CircleDashed, tint: "text-[var(--text-faint)]" },
  in_progress: { icon: Loader2, tint: "text-[var(--info)]" },
  blocked: { icon: OctagonAlert, tint: "text-[var(--danger)]" },
  done: { icon: Check, tint: "text-[var(--ok)]" },
  not_applicable: { icon: MinusCircle, tint: "text-[var(--text-faint)]" },
} as const;

export function stepStatusMeta(status: string) {
  return STEP_STATUS_META[status as StepStatus] ?? STEP_STATUS_META.todo;
}

export function stepStatusLabel(status: string): string {
  return STEP_STATUS[status]?.label ?? status;
}

/**
 * A native select laid transparently over the dial: one tap changes the
 * status, and it stays keyboard-operable and screen-reader-announced without
 * a custom menu.
 */
export function StatusControl({
  status,
  pending,
  onChange,
  size = "md",
}: {
  status: string;
  pending: boolean;
  onChange: (next: StepStatus) => void;
  size?: "sm" | "md";
}) {
  const meta = stepStatusMeta(status);
  const Icon = meta.icon;

  return (
    <div className={cn("relative shrink-0", size === "md" && "mt-0.5")}>
      <select
        aria-label={`Status — currently ${stepStatusLabel(status)}`}
        value={status}
        disabled={pending}
        // Safe: the options below are the only values this can hold.
        onChange={(e) => onChange(e.target.value as StepStatus)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {STEP_STATUS_ORDER.map((value) => (
          <option key={value} value={value}>
            {stepStatusLabel(value)}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className={cn(
          "grid place-items-center rounded-full border transition-colors duration-150",
          size === "sm" ? "size-5" : "size-6",
          status === "done"
            ? "border-[var(--ok)] bg-[var(--ok-bg)]"
            : status === "blocked"
              ? "border-[var(--danger)] bg-[var(--danger-bg)]"
              : "border-[var(--border)] bg-[var(--surface)]",
          meta.tint,
        )}
      >
        {pending ? (
          <Loader2 className={cn("animate-spin", size === "sm" ? "size-3" : "size-3.5")} />
        ) : (
          <Icon className={size === "sm" ? "size-3" : "size-3.5"} />
        )}
      </span>
    </div>
  );
}

/**
 * The one way out of a blocker, on every view that shows one. Renders nothing
 * for a step that is not blocking. Stops the click there, so it can sit inside
 * a row that toggles or a card that links without setting either off.
 */
export function ClearBlockerButton({
  step,
  compact = false,
  className,
}: {
  step: { id: string; title: string; status: string; tag: string | null };
  /** Icon only, for the calendar and timeline where a word will not fit. */
  compact?: boolean;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const kind = blockerOf(step);
  if (!kind) return null;

  const label = `${STEP_BLOCKER.clear} — ${step.title}`;

  return (
    <button
      type="button"
      draggable={false}
      disabled={pending}
      aria-label={compact ? label : undefined}
      title={error ?? STEP_BLOCKER.clearHint}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await clearStepBlocker(step.id);
          if (!result.ok) setError(result.message ?? "That did not save.");
        });
      }}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border bg-[var(--surface)] font-medium",
        "transition-colors duration-150 disabled:cursor-wait disabled:opacity-60",
        kind === "blocked"
          ? "border-[var(--danger)]/35 text-[var(--danger)] hover:bg-[var(--danger-bg)]"
          : "border-[var(--warn)]/35 text-[var(--warn)] hover:bg-[var(--warn-bg)]",
        error && "border-[var(--danger)]",
        compact ? "size-4 justify-center" : "px-1.5 py-0.5 text-[11px] leading-4",
        className,
      )}
    >
      {pending ? (
        <Loader2 aria-hidden className={cn("animate-spin", compact ? "size-2.5" : "size-3")} />
      ) : (
        <Check aria-hidden className={compact ? "size-2.5" : "size-3"} />
      )}
      {compact ? null : STEP_BLOCKER.clear}
    </button>
  );
}
