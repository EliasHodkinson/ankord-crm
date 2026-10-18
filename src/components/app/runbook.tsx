"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronRight, ExternalLink, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import {
  ActionForm,
  SaveIndicator,
  SubmitButton,
  useRetainedValue,
} from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { RichText } from "./rich-text";
import { ClearBlockerButton, StatusControl } from "./step-status";
import { StepChecklist } from "./step-checklist";
import { addStep, setStepStatus, updateStepDetail } from "@/lib/actions/projects";
import { stepTagTone } from "@/components/ui/status";
import { blockerOf } from "@/lib/runbook-views";
import type { ProjectRecord, ProjectStepRecord } from "@/lib/data/projects";
import type { TeamMember } from "@/lib/data/common";
import { cn, formatDate } from "@/lib/utils";

export function Runbook({
  project,
  team,
}: {
  project: ProjectRecord;
  team: TeamMember[];
}) {
  // Set by the board, calendar and timeline when you click a step there.
  const focusId = useSearchParams().get("step");

  return (
    <div className="flex flex-col gap-6">
      {project.phases.map((phase) => (
        <PhaseSection
          key={phase.id}
          phase={phase}
          steps={project.steps.filter((s) => s.phaseId === phase.id)}
          projectId={project.id}
          team={team}
          focusId={focusId}
        />
      ))}
    </div>
  );
}

function PhaseSection({
  phase,
  steps,
  projectId,
  team,
  focusId,
}: {
  phase: ProjectRecord["phases"][number];
  steps: ProjectStepRecord[];
  projectId: string;
  team: TeamMember[];
  focusId: string | null;
}) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const done = steps.filter((s) => s.status === "done").length;
  const counted = steps.filter((s) => s.status !== "not_applicable").length;
  const blockers = steps.filter((s) => blockerOf(s)).length;

  // A step asked for by the board, calendar or timeline is never left hidden
  // inside a collapsed phase. Adjusted during render, as in StepRow.
  const holdsFocus = steps.some((s) => s.id === focusId);
  const [heldFocus, setHeldFocus] = useState(holdsFocus);
  if (holdsFocus !== heldFocus) {
    setHeldFocus(holdsFocus);
    if (holdsFocus) setOpen(true);
  }

  return (
    <section className="flex flex-col gap-2.5">
      {/* The whole header is the button: nothing inside it is interactive. */}
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "-mx-2 flex w-[calc(100%+1rem)] cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md px-2 py-1 text-left",
            "transition-colors duration-150 hover:bg-[var(--surface-2)]",
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-4 shrink-0 self-center text-[var(--text-faint)] transition-transform duration-150",
              open && "rotate-90",
            )}
          />
          <span className="text-[13px] font-semibold text-[var(--color-coastal-600)] tabular dark:text-[var(--color-coastal-300)]">
            {phase.num}
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.015em] text-[var(--text)]">
            {phase.label}
          </span>
          <span className="text-[12px] font-normal text-[var(--text-faint)] tabular">
            {done}/{counted} done
          </span>
          {blockers > 0 ? (
            <span className="text-[12px] font-normal text-[var(--danger)] tabular">
              {blockers} {blockers === 1 ? "blocker" : "blockers"}
            </span>
          ) : null}
        </button>
      </h3>

      {open ? (
        <div id={bodyId} className="flex flex-col gap-2.5">
          {phase.description ? (
            <p className="max-w-[75ch] text-[13px] leading-6 text-[var(--text-muted)]">
              {phase.description}
            </p>
          ) : null}

          <ol className="flex flex-col gap-1.5">
            {steps.map((step) => (
              <StepRow
                key={step.id}
                step={step}
                projectId={projectId}
                team={team}
                focused={step.id === focusId}
              />
            ))}
          </ol>

          <AddStep projectId={projectId} phaseId={phase.id} />
        </div>
      ) : null}
    </section>
  );
}

function StepRow({
  step,
  projectId,
  team,
  focused = false,
}: {
  step: ProjectStepRecord;
  projectId: string;
  team: TeamMember[];
  focused?: boolean;
}) {
  const [open, setOpen] = useState(focused);
  const [pending, start] = useTransition();
  const uid = useId();
  const ref = useRef<HTMLLIElement>(null);

  /*
   * Arriving from the board, calendar or timeline: open the step and bring it
   * into view, rather than dropping the reader at the top of a 26-step
   * runbook. Adjusted during render rather than in an effect — the same row
   * stays mounted when `?step=` changes, so its initial state never re-runs.
   */
  const [wasFocused, setWasFocused] = useState(focused);
  if (focused !== wasFocused) {
    setWasFocused(focused);
    if (focused) setOpen(true);
  }

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);

  return (
    <li
      ref={ref}
      className={cn(
        "overflow-hidden rounded-lg border bg-[var(--surface)] transition-colors duration-150",
        step.status === "blocked"
          ? "border-[var(--danger)]/35"
          : step.status === "done"
            ? "border-[var(--border-soft)]"
            : "border-[var(--border)]",
        focused && "ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--surface)]",
        pending && "opacity-70",
      )}
    >
      {/*
        The whole header toggles. The title is the real button — it carries
        aria-expanded, takes focus and answers Enter and Space — and its click
        bubbles up to the row, so a click anywhere else on the row does the
        same. The controls sit in wrappers that stop their clicks there.
      */}
      <div
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex cursor-pointer items-start gap-2 p-2.5 transition-colors duration-150",
          "hover:bg-[var(--surface-2)]",
          "has-[[data-row-toggle]:focus-visible]:outline-2 has-[[data-row-toggle]:focus-visible]:-outline-offset-2 has-[[data-row-toggle]:focus-visible]:outline-[var(--ring)]",
        )}
      >
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          <StatusControl
            status={step.status}
            pending={pending}
            onChange={(next) => start(() => void setStepStatus(step.id, next, projectId))}
          />
        </div>

        <button
          type="button"
          data-row-toggle
          aria-expanded={open}
          aria-controls={`${uid}-body`}
          className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none"
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "text-[13px] font-medium",
                step.status === "done"
                  ? "text-[var(--text-muted)] line-through decoration-[var(--border)]"
                  : "text-[var(--text)]",
              )}
            >
              {step.title}
            </span>
            {step.tag ? (
              <Badge tone={stepTagTone(step.tag, step.status)}>{step.tag}</Badge>
            ) : null}
            {step.warning ? (
              <AlertTriangle
                className="size-3.5 text-[var(--warn)]"
                aria-label="Has a warning"
              />
            ) : null}
          </span>

          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--text-faint)]">
            {step.ownerLabel ? <span>{step.ownerLabel}</span> : null}
            {step.assignee ? (
              <span className="inline-flex items-center gap-1">
                <Avatar name={step.assignee.name} src={step.assignee.photo} size="xs" />
                {step.assignee.name}
              </span>
            ) : null}
            {step.dueDate ? <span>Due {formatDate(step.dueDate)}</span> : null}
            {step.status === "blocked" && step.blockedOn ? (
              <span className="text-[var(--danger)]">Waiting on {step.blockedOn}</span>
            ) : null}
            {step.notes ? <span>Has notes</span> : null}
          </span>
        </button>

        <ClearBlockerButton step={step} className="mt-0.5" />

        <ChevronRight
          aria-hidden
          className={cn(
            "mt-1 size-4 shrink-0 text-[var(--text-faint)] transition-transform duration-150",
            open && "rotate-90",
          )}
        />
      </div>

      {open ? (
        <div
          id={`${uid}-body`}
          className="border-t border-[var(--border-soft)] bg-[var(--surface-2)] px-2.5 py-3.5 sm:px-11"
        >
          {step.warning ? (
            <p className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-bg)] px-3 py-2.5 text-[13px] leading-6 text-[var(--warn)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{step.warning}</span>
            </p>
          ) : null}

          <RichText text={step.description} className="max-w-[78ch]" />

          {step.links.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-2">
              {step.links.map((link) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--color-coastal-600)] transition-colors hover:border-[var(--color-coastal-300)] hover:bg-[var(--surface-3)]"
                  >
                    {link.label}
                    <ExternalLink className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}

          <StepChecklist stepId={step.id} projectId={projectId} items={step.checklist} />

          <ActionForm
            action={updateStepDetail.bind(null, step.id)}
            className="mt-5 border-t border-[var(--border)] pt-4"
          >
            <input type="hidden" name="projectId" value={projectId} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Assigned to" htmlFor={`${uid}-assignee`}>
                <RetainedSelect
                  id={`${uid}-assignee`}
                  name="assigneeId"
                  fallback={step.assigneeId ?? ""}
                >
                  <option value="">Nobody yet</option>
                  {team.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </RetainedSelect>
              </Field>
              <Field label="Due" htmlFor={`${uid}-due`}>
                <RetainedInput
                  id={`${uid}-due`}
                  type="date"
                  name="dueDate"
                  fallback={step.dueDate ?? ""}
                />
              </Field>
              <Field
                label="Waiting on"
                htmlFor={`${uid}-blocked`}
                hint="Who or what is holding it up."
              >
                <RetainedInput
                  id={`${uid}-blocked`}
                  name="blockedOn"
                  fallback={step.blockedOn ?? ""}
                  placeholder="Incumbent provider"
                />
              </Field>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr]">
              <Field
                label="Tag"
                htmlFor={`${uid}-tag`}
                hint="Clear BLOCKER once it no longer holds the phase up."
              >
                <RetainedInput
                  id={`${uid}-tag`}
                  name="tag"
                  fallback={step.tag ?? ""}
                  placeholder="VERIFY"
                />
              </Field>
              <Field label="Warning" htmlFor={`${uid}-warning`} hint="Shown above the detail.">
                <RetainedTextarea
                  id={`${uid}-warning`}
                  name="warning"
                  rows={2}
                  fallback={step.warning ?? ""}
                />
              </Field>
            </div>

            <Field label="Working notes" htmlFor={`${uid}-notes`} className="mt-3">
              <RetainedTextarea
                id={`${uid}-notes`}
                name="notes"
                rows={3}
                fallback={step.notes ?? ""}
                placeholder="What was done, what came back, links to evidence."
              />
            </Field>

            <div className="mt-3 flex items-center gap-3">
              <SubmitButton size="sm" variant="secondary">
                Save step
              </SubmitButton>
              <SaveIndicator />
              {step.completedAt ? (
                <span className="ml-auto text-[11px] text-[var(--text-faint)]">
                  Completed {formatDate(step.completedAt)}
                </span>
              ) : null}
            </div>
          </ActionForm>
        </div>
      ) : null}
    </li>
  );
}

function AddStep({ projectId, phaseId }: { projectId: string; phaseId: string }) {
  const [open, setOpen] = useState(false);
  const uid = useId();

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-[var(--text-faint)]"
        onClick={() => setOpen(true)}
      >
        <Plus />
        Add a step
      </Button>
    );
  }

  return (
    <ActionForm
      action={addStep}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
      onSuccess={() => setOpen(false)}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="phaseId" value={phaseId} />
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Step" htmlFor={`${uid}-title`} required>
          <RetainedInput
            id={`${uid}-title`}
            name="title"
            required
            placeholder="What needs doing"
          />
        </Field>
        <Field label="Tag" htmlFor={`${uid}-tag`}>
          <RetainedInput id={`${uid}-tag`} name="tag" placeholder="VERIFY" />
        </Field>
        <Field label="Owner" htmlFor={`${uid}-owner`}>
          <RetainedInput id={`${uid}-owner`} name="ownerLabel" placeholder="Ankor'd" />
        </Field>
      </div>
      <Field label="Detail" htmlFor={`${uid}-desc`} className="mt-3">
        <RetainedTextarea id={`${uid}-desc`} name="description" rows={3} />
      </Field>
      <div className="mt-3 flex items-center gap-2">
        <SubmitButton size="sm">Add step</SubmitButton>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}

/*
 * Small wrappers that fall back to whatever was typed on a failed submit
 * before falling back to the stored value.
 */

function RetainedInput({
  name,
  fallback,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { name: string; fallback?: string }) {
  return <Input name={name} defaultValue={useRetainedValue(name) ?? fallback} {...props} />;
}

function RetainedTextarea({
  name,
  fallback,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  name: string;
  fallback?: string;
}) {
  return (
    <Textarea name={name} defaultValue={useRetainedValue(name) ?? fallback} {...props} />
  );
}

function RetainedSelect({
  name,
  fallback,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { name: string; fallback?: string }) {
  return <Select name={name} defaultValue={useRetainedValue(name) ?? fallback} {...props} />;
}
