"use client";

import { StepChip, useStepHref } from "./step-chip";
import { PhaseRow, StepRow, TimelineFrame } from "./timeline-kit";
import {
  axisOf,
  phaseRampVar,
  spanOf,
  startOfToday,
  ticksFor,
  type PlacedStep,
} from "@/lib/runbook-views";
import type { ProjectRecord } from "@/lib/data/projects";

/**
 * The runbook against a date axis.
 *
 * Phase bars are real spans — first to last due date of the steps inside them.
 * Individual steps carry a due date and nothing else, so each one is a marker
 * on its own row rather than a bar. The portfolio timeline on `/projects`
 * draws the same rows from `timeline-kit`.
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

  return (
    <div className="flex flex-col gap-3">
      <TimelineFrame axis={axis} ticks={ticksFor(axis, "month")}>
        {project.phases.map((phase, index) => {
          const phaseSteps = steps.filter((s) => s.phaseId === phase.id);
          const colour = phaseRampVar(index);

          return (
            <section key={phase.id}>
              <PhaseRow
                num={phase.num}
                label={phase.label}
                span={spanOf(phaseSteps)}
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
      </TimelineFrame>

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
