"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepChip, useStepHref } from "./step-chip";
import {
  addMonths,
  dayKey,
  defaultMonth,
  groupByDay,
  isSameDay,
  monthGrid,
  monthKeyOf,
  monthLabel,
  parseMonthKey,
  startOfToday,
  WEEKDAY_LABELS,
  type PlacedStep,
} from "@/lib/runbook-views";
import type { ProjectRecord } from "@/lib/data/projects";
import { cn } from "@/lib/utils";

const CELLS_BEFORE_OVERFLOW = 3;

/**
 * The runbook on a month grid — what lands when, rather than what order it
 * goes in. The month lives in the URL so a link opens on the month you were
 * looking at.
 */
export function RunbookCalendar({
  project,
  month,
}: {
  project: ProjectRecord;
  month?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const stepHref = useStepHref();

  const today = startOfToday();
  const steps: PlacedStep[] = project.steps;
  const current =
    (parseMonthKey(month) ? month : undefined) ?? defaultMonth(steps, today);

  const byDay = groupByDay(steps);
  const grid = monthGrid(current);
  const monthOf = parseMonthKey(current);
  const undated = steps.filter((s) => !s.dueDate);

  function goto(next: string) {
    const params2 = new URLSearchParams(params.toString());
    params2.set("runbook", "calendar");
    if (next === defaultMonth(steps, today)) params2.delete("month");
    else params2.set("month", next);
    router.replace(`${pathname}?${params2}`, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-[var(--text)]">
          {monthLabel(current)}
        </h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous month"
            onClick={() => goto(addMonths(current, -1))}
          >
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => goto(monthKeyOf(today))}>
            Today
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next month"
            onClick={() => goto(addMonths(current, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
      </header>

      <div className="overflow-x-auto scrollbar-slim">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-7 gap-px">
            {WEEKDAY_LABELS.map((day) => (
              <div
                key={day}
                className="px-2 py-1.5 text-[11px] font-semibold tracking-[0.02em] text-[var(--text-faint)]"
              >
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--border-soft)]">
            {grid.map((day) => (
              <DayCell
                key={day.toISOString()}
                day={day}
                steps={byDay.get(dayKey(day)) ?? []}
                inMonth={!!monthOf && day.getMonth() === monthOf.getMonth()}
                isToday={isSameDay(day, today)}
                stepHref={stepHref}
              />
            ))}
          </div>
        </div>
      </div>

      {undated.length > 0 ? (
        <section className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
          <h4 className="mb-1.5 text-[11px] font-semibold tracking-[0.02em] text-[var(--text-muted)]">
            No date set · {undated.length}
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

function DayCell({
  day,
  steps,
  inMonth,
  isToday,
  stepHref,
}: {
  day: Date;
  steps: PlacedStep[];
  inMonth: boolean;
  isToday: boolean;
  stepHref: (id: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const overflow = steps.length - CELLS_BEFORE_OVERFLOW;
  const shown = expanded ? steps : steps.slice(0, CELLS_BEFORE_OVERFLOW);

  return (
    <div
      className={cn(
        "flex min-h-24 flex-col gap-1 p-1.5",
        inMonth ? "bg-[var(--surface)]" : "bg-[var(--surface-2)]",
      )}
    >
      <span
        className={cn(
          "self-start rounded-full px-1.5 text-[11px] leading-5 tabular",
          isToday
            ? "bg-[var(--accent)] font-semibold text-[var(--accent-fg)]"
            : inMonth
              ? "text-[var(--text-muted)]"
              : "text-[var(--text-faint)]",
        )}
      >
        {day.getDate()}
      </span>

      {shown.map((step) => (
        <StepChip key={step.id} step={step} href={stepHref(step.id)} />
      ))}

      {overflow > 0 && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="self-start px-1 text-[10px] font-medium text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
        >
          +{overflow} more
        </button>
      ) : null}
    </div>
  );
}
