"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { StepChip, useStepHref } from "./step-chip";
import { CalendarGrid, CalendarNav } from "./calendar-kit";
import {
  addMonths,
  defaultMonth,
  groupByDay,
  monthGrid,
  monthKeyOf,
  monthLabel,
  parseMonthKey,
  startOfToday,
  type PlacedStep,
} from "@/lib/runbook-views";
import type { ProjectRecord } from "@/lib/data/projects";

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
      <CalendarNav
        title={monthLabel(current)}
        unit="month"
        onMove={(delta) => goto(addMonths(current, delta))}
        onToday={() => goto(monthKeyOf(today))}
      />

      <CalendarGrid
        days={monthGrid(current)}
        itemsOn={(key) => byDay.get(key) ?? []}
        inMonth={(day) => !!monthOf && day.getMonth() === monthOf.getMonth()}
        render={(step) => <StepChip key={step.id} step={step} href={stepHref(step.id)} />}
      />

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
