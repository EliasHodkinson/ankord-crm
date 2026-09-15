"use client";

import { useId, useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  Loader2,
  MinusCircle,
  OctagonAlert,
  Plus,
} from "lucide-react";
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
import { addStep, setStepStatus, updateStepDetail } from "@/lib/actions/projects";
import type { ProjectRecord, ProjectStepRecord } from "@/lib/data/projects";
import type { TeamMember } from "@/lib/data/common";
import { cn, formatDate } from "@/lib/utils";

const STATUS_ORDER = ["todo", "in_progress", "blocked", "done", "not_applicable"] as const;

const STATUS_META = {
  todo: { label: "To do", icon: CircleDashed, className: "text-[var(--text-faint)]" },
  in_progress: { label: "In progress", icon: Loader2, className: "text-[var(--info)]" },
  blocked: { label: "Blocked", icon: OctagonAlert, className: "text-[var(--danger)]" },
  done: { label: "Done", icon: Check, className: "text-[var(--ok)]" },
  not_applicable: { label: "N/A", icon: MinusCircle, className: "text-[var(--text-faint)]" },
} as const;

export function Runbook({
  project,
  team,
}: {
  project: ProjectRecord;
  team: TeamMember[];
}) {
  return (
    <div className="flex flex-col gap-6">
      {project.phases.map((phase) => {
        const steps = project.steps.filter((s) => s.phaseId === phase.id);
        const done = steps.filter((s) => s.status === "done").length;
        const counted = steps.filter((s) => s.status !== "not_applicable").length;

        return (
          <section key={phase.id} className="flex flex-col gap-2.5">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[13px] font-semibold text-[var(--color-coastal-600)] tabular dark:text-[var(--color-coastal-300)]">
                {phase.num}
              </span>
              <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-[var(--text)]">
                {phase.label}
              </h3>
              <span className="text-[12px] text-[var(--text-faint)] tabular">
                {done}/{counted} done
              </span>
            </header>

            {phase.description ? (
              <p className="max-w-[75ch] text-[13px] leading-6 text-[var(--text-muted)]">
                {phase.description}
              </p>
            ) : null}

            <ol className="flex flex-col gap-1.5">
              {steps.map((step) => (
                <StepRow key={step.id} step={step} projectId={project.id} team={team} />
              ))}
            </ol>

            <AddStep projectId={project.id} phaseId={phase.id} />
          </section>
        );
      })}
    </div>
  );
}

function StepRow({
  step,
  projectId,
  team,
}: {
  step: ProjectStepRecord;
  projectId: string;
  team: TeamMember[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const uid = useId();

  return (
    <li
      className={cn(
        "overflow-hidden rounded-lg border bg-[var(--surface)] transition-colors duration-150",
        step.status === "blocked"
          ? "border-[var(--danger)]/35"
          : step.status === "done"
            ? "border-[var(--border-soft)]"
            : "border-[var(--border)]",
        pending && "opacity-70",
      )}
    >
      <div className="flex items-start gap-2 p-2.5">
        <StatusControl
          status={step.status}
          pending={pending}
          onChange={(next) => start(() => void setStepStatus(step.id, next, projectId))}
        />

        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 text-left"
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
              <Badge tone={tagTone(step.tag)}>{step.tag}</Badge>
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

        <ChevronRight
          aria-hidden
          className={cn(
            "mt-1 size-4 shrink-0 text-[var(--text-faint)] transition-transform duration-150",
            open && "rotate-90",
          )}
        />
      </div>

      {open ? (
        <div className="border-t border-[var(--border-soft)] bg-[var(--surface-2)] px-2.5 py-3.5 sm:px-11">
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

function StatusControl({
  status,
  pending,
  onChange,
}: {
  status: (typeof STATUS_ORDER)[number];
  pending: boolean;
  onChange: (next: string) => void;
}) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <div className="relative mt-0.5 shrink-0">
      <select
        aria-label={`Status — currently ${meta.label}`}
        value={status}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {STATUS_ORDER.map((value) => (
          <option key={value} value={value}>
            {STATUS_META[value].label}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className={cn(
          "grid size-6 place-items-center rounded-full border transition-colors duration-150",
          status === "done"
            ? "border-[var(--ok)] bg-[var(--ok-bg)]"
            : status === "blocked"
              ? "border-[var(--danger)] bg-[var(--danger-bg)]"
              : "border-[var(--border)] bg-[var(--surface)]",
          meta.className,
        )}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Icon className={cn("size-3.5", status === "in_progress" && "animate-none")} />
        )}
      </span>
    </div>
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

/** Runbook tags are free text; these are the ones worth colouring. */
function tagTone(tag: string): React.ComponentProps<typeof Badge>["tone"] {
  const t = tag.toUpperCase();
  if (["CRITICAL", "URGENT", "SECURITY", "LAUNCH"].includes(t)) return "danger";
  if (["BLOCKER", "DEPENDS ON INCUMBENT", "MONITOR"].includes(t)) return "warn";
  if (["SIGN-OFF", "MILESTONE", "QUICK WIN"].includes(t)) return "accent";
  if (["VERIFY", "CONFIRM", "AUDIT", "CLOSE OUT"].includes(t)) return "ok";
  return "neutral";
}
