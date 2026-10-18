"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { stepStatusLabel, stepStatusMeta } from "./step-status";
import { timingOf, type PlacedStep, type StepTiming } from "@/lib/runbook-views";
import { cn, formatDate } from "@/lib/utils";

/**
 * Pieces shared by the calendar and timeline: both place the same step on a
 * date and both hand you back to the runbook when you click it.
 */

/**
 * A link from any dated view back to the step itself — drops the view and its
 * position, and asks the runbook to open that one step.
 */
export function useStepHref(): (stepId: string) => string {
  const pathname = usePathname();
  const params = useSearchParams();

  return (stepId: string) => {
    const next = new URLSearchParams(params.toString());
    next.delete("runbook");
    next.delete("month");
    next.set("step", stepId);
    return `${pathname}?${next}`;
  };
}

/** State colour comes from the status tokens, never from a series colour. */
export const TIMING_TEXT: Record<StepTiming, string> = {
  done: "text-[var(--text-faint)]",
  overdue: "text-[var(--danger)]",
  today: "text-[var(--accent)]",
  upcoming: "text-[var(--text-muted)]",
  undated: "text-[var(--text-faint)]",
};

export const TIMING_DOT: Record<StepTiming, string> = {
  done: "bg-[var(--ok)]",
  overdue: "bg-[var(--danger)]",
  today: "bg-[var(--accent-mark)]",
  upcoming: "bg-[var(--text-faint)]",
  undated: "bg-[var(--text-faint)]",
};

export function timingNote(timing: StepTiming): string {
  if (timing === "overdue") return "Overdue";
  if (timing === "today") return "Due today";
  return "";
}

/**
 * One step as a compact chip, for a calendar cell or a timeline row. The title
 * attribute carries the full detail because the chip itself is clipped.
 */
export function StepChip({
  step,
  href,
  className,
  showDate = false,
}: {
  step: PlacedStep;
  href: string;
  className?: string;
  showDate?: boolean;
}) {
  const timing = timingOf(step);
  const Icon = stepStatusMeta(step.status).icon;
  const note = timingNote(timing);

  return (
    <Link
      href={href}
      scroll={false}
      title={[
        step.title,
        stepStatusLabel(step.status),
        step.ownerLabel,
        step.dueDate ? `Due ${formatDate(step.dueDate)}` : null,
        note,
        step.warning ? "Has a warning" : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      className={cn(
        "group flex w-full items-center gap-1 rounded-md border px-1.5 py-1 text-left",
        "transition-colors duration-150",
        timing === "overdue"
          ? "border-[var(--danger)]/35 bg-[var(--danger-bg)]"
          : timing === "today"
            ? "border-[var(--color-sunrise-300)] bg-[var(--color-sunrise-50)] dark:border-[var(--color-sunrise-700)] dark:bg-[var(--color-sunrise-900)]/25"
            : "border-[var(--border-soft)] bg-[var(--surface-2)]",
        "hover:border-[var(--color-coastal-300)] hover:bg-[var(--surface-3)]",
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-3 shrink-0",
          step.status === "done"
            ? "text-[var(--ok)]"
            : step.status === "blocked"
              ? "text-[var(--danger)]"
              : TIMING_TEXT[timing],
        )}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[11px] leading-4",
          step.status === "done"
            ? "text-[var(--text-faint)] line-through decoration-[var(--border)]"
            : "text-[var(--text)]",
        )}
      >
        {step.title}
      </span>
      {showDate && step.dueDate ? (
        <span className={cn("shrink-0 text-[10px] tabular", TIMING_TEXT[timing])}>
          {formatDate(step.dueDate, "day")}
        </span>
      ) : null}
      {step.warning ? (
        <AlertTriangle aria-hidden className="size-3 shrink-0 text-[var(--warn)]" />
      ) : null}
    </Link>
  );
}
