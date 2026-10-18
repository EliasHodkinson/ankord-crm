"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import {
  StatusControl,
  STEP_STATUS_ORDER,
  stepStatusLabel,
  type StepStatus,
} from "./step-status";
import { useStepHref, TIMING_TEXT, timingNote } from "./step-chip";
import { setStepStatus } from "@/lib/actions/projects";
import { phaseRampVar, timingOf } from "@/lib/runbook-views";
import type { ProjectRecord, ProjectStepRecord } from "@/lib/data/projects";
import { cn, formatDate } from "@/lib/utils";

/**
 * The runbook as a board, one column per status. Dragging a card is the
 * fastest way to say "this moved on"; the dial on each card does the same
 * thing for anyone on a keyboard.
 */
export function RunbookBoard({ project }: { project: ProjectRecord }) {
  const [, startMove] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);

  // The card lands in its new column immediately; the server catches up.
  const [steps, applyMove] = useOptimistic(
    project.steps,
    (current, move: { id: string; status: StepStatus }) =>
      current.map((s) => (s.id === move.id ? { ...s, status: move.status } : s)),
  );

  const phaseIndex = new Map(project.phases.map((p, i) => [p.id, i]));

  function move(id: string, status: StepStatus) {
    startMove(async () => {
      applyMove({ id, status });
      await setStepStatus(id, status, project.id);
    });
  }

  function drop(status: StepStatus) {
    const id = dragging;
    setDragging(null);
    setOverColumn(null);
    if (!id) return;
    if (steps.find((s) => s.id === id)?.status === status) return;
    move(id, status);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-slim">
      {STEP_STATUS_ORDER.map((status) => {
        const cards = steps
          .filter((s) => s.status === status)
          .sort(
            (a, b) =>
              (phaseIndex.get(a.phaseId) ?? 0) - (phaseIndex.get(b.phaseId) ?? 0) ||
              a.position - b.position,
          );

        return (
          <section
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              setOverColumn(status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverColumn(null);
            }}
            onDrop={() => drop(status)}
            className={cn(
              "flex w-64 shrink-0 flex-col rounded-[10px] border transition-colors duration-150",
              overColumn === status && dragging
                ? "border-[var(--accent)] bg-[var(--color-sunrise-50)] dark:bg-[var(--color-sunrise-900)]/20"
                : "border-[var(--border)] bg-[var(--surface-2)]",
            )}
          >
            <header className="flex items-baseline justify-between gap-2 border-b border-[var(--border-soft)] px-3 py-2.5">
              <h3 className="text-[12px] font-semibold tracking-[0.02em] text-[var(--text)]">
                {stepStatusLabel(status)}
              </h3>
              <span className="text-[11px] text-[var(--text-muted)] tabular">
                {cards.length}
              </span>
            </header>

            <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
              {cards.map((step) => (
                <BoardCard
                  key={step.id}
                  step={step}
                  phase={project.phases[phaseIndex.get(step.phaseId) ?? 0]}
                  phaseIndex={phaseIndex.get(step.phaseId) ?? 0}
                  dragging={dragging === step.id}
                  onDragStart={() => setDragging(step.id)}
                  onDragEnd={() => {
                    setDragging(null);
                    setOverColumn(null);
                  }}
                  onStatus={(next) => move(step.id, next)}
                />
              ))}

              {cards.length === 0 ? (
                <p className="px-1 py-6 text-center text-[12px] text-[var(--text-faint)]">
                  {overColumn === status && dragging ? "Drop here" : "Nothing here"}
                </p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({
  step,
  phase,
  phaseIndex,
  dragging,
  onDragStart,
  onDragEnd,
  onStatus,
}: {
  step: ProjectStepRecord;
  phase: ProjectRecord["phases"][number] | undefined;
  phaseIndex: number;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onStatus: (next: StepStatus) => void;
}) {
  const stepHref = useStepHref();
  const timing = timingOf(step);
  const note = timingNote(timing);

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        // Firefox needs something on the transfer for the drag to begin.
        e.dataTransfer.setData("text/plain", step.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group cursor-grab rounded-lg border bg-[var(--surface)] p-2.5 shadow-[var(--shadow-sm)]",
        "transition-[opacity,border-color] duration-150 active:cursor-grabbing",
        "hover:border-[var(--color-coastal-300)]",
        dragging && "opacity-40",
        step.status === "blocked" ? "border-[var(--danger)]/40" : "border-[var(--border)]",
      )}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical
          aria-hidden
          className="mt-1 size-3.5 shrink-0 text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100"
        />
        <StatusControl
          status={step.status}
          pending={false}
          size="sm"
          onChange={onStatus}
        />
        <div className="min-w-0 flex-1">
          <Link
            href={stepHref(step.id)}
            scroll={false}
            draggable={false}
            className={cn(
              "block text-[12px] leading-4 font-medium underline-offset-2 hover:text-[var(--accent)] hover:underline",
              step.status === "done"
                ? "text-[var(--text-muted)] line-through decoration-[var(--border)]"
                : "text-[var(--text)]",
            )}
          >
            {step.title}
          </Link>
          {step.ownerLabel ? (
            <p className="mt-0.5 truncate text-[11px] text-[var(--text-faint)]">
              {step.ownerLabel}
            </p>
          ) : null}
        </div>
        {step.assignee ? (
          <Avatar name={step.assignee.name} src={step.assignee.photo} size="xs" />
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-5">
        {phase ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-faint)]">
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ background: phaseRampVar(phaseIndex) }}
            />
            {phase.num}
          </span>
        ) : null}
        {step.tag ? <Badge tone="neutral">{step.tag}</Badge> : null}
        {step.warning ? (
          <AlertTriangle
            className="size-3 text-[var(--warn)]"
            aria-label="Has a warning"
          />
        ) : null}
      </div>

      {step.dueDate ? (
        <p className={cn("mt-1.5 pl-5 text-[11px] tabular", TIMING_TEXT[timing])}>
          Due {formatDate(step.dueDate)}
          {note ? ` · ${note}` : ""}
        </p>
      ) : (
        <p className="mt-1.5 pl-5 text-[11px] text-[var(--text-faint)] italic">No date set</p>
      )}

      {step.status === "blocked" && step.blockedOn ? (
        <p className="mt-1 pl-5 text-[11px] text-[var(--danger)]">
          Waiting on {step.blockedOn}
        </p>
      ) : null}
    </article>
  );
}
