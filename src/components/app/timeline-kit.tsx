"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { TIMING_DOT, TIMING_TEXT, timingNote } from "./step-chip";
import { ClearBlockerButton, stepStatusLabel, stepStatusMeta } from "./step-status";
import {
  blockerOf,
  parseDay,
  positionOn,
  startOfToday,
  timingOf,
  type PlacedStep,
  type Span,
  type Tick,
} from "@/lib/runbook-views";
import { cn, formatDate } from "@/lib/utils";

/**
 * The pieces every timeline is made of — one runbook's, or the whole
 * portfolio's. A row is a label column and a track; everything on a track is
 * positioned as a percentage of the axis, so the same rows work whether the
 * track is squeezed to fit the card or stretched to a scrollable width.
 */

/** Sticky, so the labels stay put while a wide track scrolls under them. */
export const LABEL_COL =
  "sticky left-0 z-[1] w-56 shrink-0 bg-[var(--surface)] pr-3";

/** A label and its track. */
export function TimelineRow({
  label,
  children,
  className,
  trackClassName,
}: {
  label: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  trackClassName?: string;
}) {
  return (
    // The label stretches to the row's full height so its background hides
    // the gridlines scrolling under it, padding included.
    <div className={cn("flex items-stretch", className)}>
      <div className={cn(LABEL_COL, "flex items-center")}>{label}</div>
      <div className={cn("relative flex-1 self-center", trackClassName)}>{children}</div>
    </div>
  );
}

/**
 * Axis, gridlines, the today rule, and the rows on top of them.
 *
 * `trackWidth` (px) fixes the track for a zoomable, scrolling timeline; left
 * out, the track shares the card's width with a sensible minimum. `above` sits
 * between the axis labels and the rows and is aligned to the same axis — the
 * portfolio's trends band goes there.
 */
export const TimelineFrame = forwardRef<
  HTMLDivElement,
  {
    axis: Span;
    ticks: Tick[];
    trackWidth?: number;
    above?: React.ReactNode;
    children: React.ReactNode;
  }
>(function TimelineFrame({ axis, ticks, trackWidth, above, children }, ref) {
  const today = startOfToday();
  const todayAt = positionOn(axis, today);
  const todayInRange =
    today.getTime() >= axis.start.getTime() && today.getTime() <= axis.end.getTime();

  return (
    <div ref={ref} className="overflow-x-auto scrollbar-slim">
      <div
        className={trackWidth ? undefined : "min-w-[760px]"}
        // 224px is the label column (w-56).
        style={trackWidth ? { width: 224 + trackWidth } : undefined}
      >
        <TimelineRow label={null} trackClassName="h-9">
          {ticks.map((tick) => (
            <span
              key={tick.at.toISOString()}
              className="absolute bottom-0 -translate-x-1/2 text-[11px] whitespace-nowrap text-[var(--text-faint)] tabular"
              style={{ left: `${positionOn(axis, tick.at)}%` }}
            >
              {tick.label}
            </span>
          ))}
          {todayInRange ? (
            <span
              className="absolute top-0 -translate-x-1/2 rounded px-1 text-[10px] font-semibold whitespace-nowrap text-[var(--accent)] tabular"
              style={{ left: `${todayAt}%` }}
            >
              Today
            </span>
          ) : null}
        </TimelineRow>

        <div className="relative">
          {/* Gridlines and the today rule, behind every row */}
          <div aria-hidden className="pointer-events-none absolute inset-0 flex">
            {/* Stays put under the sticky labels and hides the lines scrolling past. */}
            <div className="sticky left-0 z-[1] w-56 shrink-0 bg-[var(--surface)]" />
            <div className="relative flex-1">
              {ticks.map((tick) => (
                <span
                  key={tick.at.toISOString()}
                  className="absolute inset-y-0 w-px bg-[var(--chart-grid)]"
                  style={{ left: `${positionOn(axis, tick.at)}%` }}
                />
              ))}
              {todayInRange ? (
                <span
                  className="absolute inset-y-0 w-px bg-[var(--accent-mark)]"
                  style={{ left: `${todayAt}%` }}
                />
              ) : null}
            </div>
          </div>

          {above}
          <div className="relative flex flex-col">{children}</div>
        </div>
      </div>
    </div>
  );
});

/** A phase's span as a bar: first to last due date of the steps inside it. */
export function PhaseRow({
  num,
  label,
  span,
  axis,
  colour,
  count,
  indent = false,
}: {
  num: string;
  label: string;
  span: Span | null;
  axis: Span;
  colour: string;
  count: number;
  indent?: boolean;
}) {
  const left = span ? positionOn(axis, span.start) : 0;
  const right = span ? positionOn(axis, span.end) : 0;

  return (
    <TimelineRow
      className="pt-3 pb-1"
      trackClassName="h-4"
      label={
        <span className={cn("flex items-baseline gap-2", indent && "pl-5")}>
          <span className="text-[12px] font-semibold text-[var(--color-coastal-600)] tabular dark:text-[var(--color-coastal-300)]">
            {num}
          </span>
          <span className="truncate text-[13px] font-semibold text-[var(--text)]">{label}</span>
        </span>
      }
    >
      {span ? (
        <span
          title={`${label} · ${formatDate(span.start)} to ${formatDate(span.end)} · ${count} steps`}
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full"
          style={{
            left: `${left}%`,
            // Never thinner than the rounded cap, or a one-day phase vanishes.
            width: `max(0.5rem, ${right - left}%)`,
            background: colour,
          }}
        />
      ) : null}
    </TimelineRow>
  );
}

/**
 * A step carries a due date and nothing else, so it is a marker on its own
 * row rather than a bar: drawing a length would invent a duration the runbook
 * never recorded.
 */
export function StepRow({
  step,
  axis,
  colour,
  href,
  indent = false,
}: {
  step: PlacedStep;
  axis: Span;
  colour: string;
  href: string;
  indent?: boolean;
}) {
  const due = parseDay(step.dueDate);
  const timing = timingOf(step);
  const note = timingNote(timing);
  const blocked = blockerOf(step) === "blocked";
  if (!due) return null;
  const BlockedIcon = stepStatusMeta("blocked").icon;

  const at = positionOn(axis, due);
  // Keep the caption inside the track at both ends.
  const flip = at > 72;

  return (
    <div className="group flex items-center">
      <div className={LABEL_COL}>
        <Link
          href={href}
          scroll={false}
          title={[step.title, stepStatusLabel(step.status), step.ownerLabel, `Due ${formatDate(step.dueDate)}`, note]
            .filter(Boolean)
            .join(" · ")}
          className={cn(
            "block truncate py-1 text-[12px] leading-5 underline-offset-2",
            "hover:text-[var(--accent)] hover:underline",
            indent && "pl-5",
            step.status === "done"
              ? "text-[var(--text-faint)] line-through decoration-[var(--border)]"
              : "text-[var(--text-muted)]",
          )}
        >
          {step.title}
        </Link>
      </div>

      <div className="relative h-6 flex-1">
        {/* Leader line, so the eye can travel from the title to the marker. */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-1/2 border-t border-dotted border-[var(--border-soft)] opacity-0 transition-opacity group-hover:opacity-100"
        />
        <span
          className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5"
          style={flip ? { right: `${100 - at}%`, flexDirection: "row-reverse" } : { left: `${at}%` }}
        >
          <span
            aria-hidden
            className={cn(
              "size-2.5 shrink-0 -translate-x-1/2 rounded-full ring-2 ring-[var(--surface)]",
              flip && "translate-x-1/2",
              timing === "upcoming" ? "" : TIMING_DOT[timing],
            )}
            style={timing === "upcoming" ? { background: colour } : undefined}
          />
          <span
            className={cn(
              "text-[10px] whitespace-nowrap tabular",
              TIMING_TEXT[timing],
              flip ? "-translate-x-1.5" : "-translate-x-1",
            )}
          >
            {formatDate(step.dueDate, "day")}
            {note ? ` · ${note}` : ""}
          </span>
          {blocked ? <BlockedIcon aria-hidden className="size-3 shrink-0 text-[var(--danger)]" /> : null}
          {step.warning ? <AlertTriangle aria-hidden className="size-3 shrink-0 text-[var(--warn)]" /> : null}
          <ClearBlockerButton step={step} compact />
        </span>
      </div>
    </div>
  );
}
