"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { StepChip, useStepHref, TIMING_DOT, TIMING_TEXT, timingNote } from "./step-chip";
import { stepStatusLabel } from "./step-status";
import {
  axisOf,
  monthTickLabel,
  monthTicks,
  parseDay,
  phaseRampVar,
  positionOn,
  spanOf,
  startOfToday,
  timingOf,
  type PlacedStep,
  type Span,
} from "@/lib/runbook-views";
import type { ProjectRecord } from "@/lib/data/projects";
import { cn, formatDate } from "@/lib/utils";

const LABEL_COL = "w-56 shrink-0 pr-3";

/**
 * The runbook against a date axis.
 *
 * Phase bars are real spans — first to last due date of the steps inside them.
 * Individual steps carry a due date and nothing else, so each one is a marker
 * on its own row rather than a bar: drawing a length for a step would be
 * inventing a duration the runbook never recorded.
 */
export function RunbookTimeline({ project }: { project: ProjectRecord }) {
  const today = startOfToday();
  const stepHref = useStepHref();
  const steps: PlacedStep[] = project.steps;
  const axis = axisOf(steps, today);
  const undated = steps.filter((s) => !s.dueDate);

  if (!axis) {
    return (
      <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
        Give the steps due dates and the timeline draws itself.
      </p>
    );
  }

  const ticks = monthTicks(axis);
  const todayAt = positionOn(axis, today);
  const todayInRange =
    today.getTime() >= axis.start.getTime() && today.getTime() <= axis.end.getTime();

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto scrollbar-slim">
        <div className="min-w-[760px]">
          {/* Month axis */}
          <div className="flex items-end">
            <div className={LABEL_COL} />
            <div className="relative h-6 flex-1">
              {ticks.map((tick) => (
                <span
                  key={tick.toISOString()}
                  className="absolute bottom-0 -translate-x-1/2 text-[11px] whitespace-nowrap text-[var(--text-faint)] tabular"
                  style={{ left: `${positionOn(axis, tick)}%` }}
                >
                  {monthTickLabel(tick)}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            {/* Gridlines and the today rule, behind every row */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex"
            >
              <div className={LABEL_COL} />
              <div className="relative flex-1">
                {ticks.map((tick) => (
                  <span
                    key={tick.toISOString()}
                    className="absolute inset-y-0 w-px bg-[var(--chart-grid)]"
                    style={{ left: `${positionOn(axis, tick)}%` }}
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

            <div className="relative flex flex-col">
              {project.phases.map((phase, index) => {
                const phaseSteps = steps.filter((s) => s.phaseId === phase.id);
                const span = spanOf(phaseSteps);
                const colour = phaseRampVar(index);

                return (
                  <section key={phase.id}>
                    <PhaseRow
                      num={phase.num}
                      label={phase.label}
                      span={span}
                      axis={axis}
                      colour={colour}
                      count={phaseSteps.length}
                    />
                    {phaseSteps.map((step) => (
                      <StepRow
                        key={step.id}
                        step={step}
                        axis={axis}
                        colour={colour}
                        href={stepHref(step.id)}
                      />
                    ))}
                  </section>
                );
              })}
            </div>
          </div>

          {todayInRange ? (
            <div className="flex">
              <div className={LABEL_COL} />
              <div className="relative h-5 flex-1">
                <span
                  className="absolute top-0.5 -translate-x-1/2 rounded px-1 text-[10px] font-semibold whitespace-nowrap text-[var(--accent)] tabular"
                  style={{ left: `${todayAt}%` }}
                >
                  Today
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {undated.length > 0 ? (
        <section className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
          <h4 className="mb-1.5 text-[11px] font-semibold tracking-[0.02em] text-[var(--text-muted)]">
            Not on the timeline — no date set · {undated.length}
          </h4>
          <ul className="flex flex-col gap-1">
            {undated.map((step) => (
              <li key={step.id}>
                <StepChip step={step} href={stepHref(step.id)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function PhaseRow({
  num,
  label,
  span,
  axis,
  colour,
  count,
}: {
  num: string;
  label: string;
  span: Span | null;
  axis: Span;
  colour: string;
  count: number;
}) {
  const left = span ? positionOn(axis, span.start) : 0;
  const right = span ? positionOn(axis, span.end) : 0;

  return (
    <div className="flex items-center gap-0 pt-3 pb-1">
      <div className={cn(LABEL_COL, "flex items-baseline gap-2")}>
        <span className="text-[12px] font-semibold text-[var(--color-coastal-600)] tabular dark:text-[var(--color-coastal-300)]">
          {num}
        </span>
        <span className="truncate text-[13px] font-semibold text-[var(--text)]">
          {label}
        </span>
      </div>
      <div className="relative h-4 flex-1">
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
      </div>
    </div>
  );
}

function StepRow({
  step,
  axis,
  colour,
  href,
}: {
  step: PlacedStep;
  axis: Span;
  colour: string;
  href: string;
}) {
  const due = parseDay(step.dueDate);
  const timing = timingOf(step);
  const note = timingNote(timing);
  if (!due) return null;

  const at = positionOn(axis, due);
  // Keep the caption inside the track at both ends.
  const flip = at > 72;

  return (
    <div className="group flex items-center">
      <Link
        href={href}
        scroll={false}
        title={[
          step.title,
          stepStatusLabel(step.status),
          step.ownerLabel,
          `Due ${formatDate(step.dueDate)}`,
          note,
        ]
          .filter(Boolean)
          .join(" · ")}
        className={cn(
          LABEL_COL,
          "truncate py-1 text-[12px] leading-5 underline-offset-2",
          "hover:text-[var(--accent)] hover:underline",
          step.status === "done"
            ? "text-[var(--text-faint)] line-through decoration-[var(--border)]"
            : "text-[var(--text-muted)]",
        )}
      >
        {step.title}
      </Link>

      <div className="relative h-6 flex-1">
        {/* Leader line, so the eye can travel from the title to the marker. */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-1/2 border-t border-dotted border-[var(--border-soft)] opacity-0 transition-opacity group-hover:opacity-100"
        />
        <span
          className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5"
          style={
            flip
              ? { right: `${100 - at}%`, flexDirection: "row-reverse" }
              : { left: `${at}%` }
          }
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
          {step.warning ? (
            <AlertTriangle aria-hidden className="size-3 shrink-0 text-[var(--warn)]" />
          ) : null}
        </span>
      </div>
    </div>
  );
}
