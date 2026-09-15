"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { Building2, Clock, FolderKanban, Pencil, Target, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { deleteTask, setTaskStatus, snoozeTask, updateTask } from "@/lib/actions/tasks";
import { BUCKET_LABEL, BUCKET_ORDER, bucketOf, type TaskBucket } from "@/lib/tasks";
import { cn, formatDate } from "@/lib/utils";

export type TaskItem = {
  id: string;
  title: string;
  detail: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  assigneeName: string | null;
  assigneePhoto: string | null;
  customerId: string | null;
  customerName: string | null;
  projectId: string | null;
  projectName: string | null;
  leadId: string | null;
  leadName: string | null;
};

const BUCKET_TONE: Record<TaskBucket, "danger" | "accent" | "neutral" | "muted" | "ok"> = {
  overdue: "danger",
  today: "accent",
  soon: "neutral",
  later: "muted",
  someday: "muted",
  done: "ok",
};

/**
 * A follow-up list that behaves like a to-do list: tick it and it goes, with
 * no page reload and no dialog in the way.
 */
export function TaskList({
  tasks,
  revalidate,
  showOwner = false,
  grouped = true,
  emptyTitle = "Nothing to chase",
  emptyDescription = "Follow-ups you set on a lead, customer or project land here, sorted by when they are due.",
}: {
  tasks: TaskItem[];
  revalidate: string;
  showOwner?: boolean;
  grouped?: boolean;
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
}) {
  const [, start] = useTransition();
  // Ticking a task removes it straight away rather than after a round trip.
  const [visible, hide] = useOptimistic(tasks, (current, id: string) =>
    current.filter((t) => t.id !== id),
  );

  if (visible.length === 0) {
    return <EmptyState compact title={emptyTitle} description={emptyDescription} />;
  }

  if (!grouped) {
    return (
      <ul className="flex flex-col divide-y divide-[var(--border-soft)]">
        {visible.map((task) => (
          <Row
            key={task.id}
            task={task}
            revalidate={revalidate}
            showOwner={showOwner}
            onComplete={() => start(() => hide(task.id))}
          />
        ))}
      </ul>
    );
  }

  const groups = BUCKET_ORDER.map((bucket) => ({
    bucket,
    items: visible.filter((t) => bucketOf(t) === bucket),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {groups.map(({ bucket, items }) => (
        <section key={bucket}>
          <h3 className="mb-1.5 flex items-center gap-2 px-1 text-[12px] font-semibold text-[var(--text-muted)]">
            {BUCKET_LABEL[bucket]}
            <Badge tone={BUCKET_TONE[bucket]}>{items.length}</Badge>
          </h3>
          <ul className="flex flex-col divide-y divide-[var(--border-soft)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            {items.map((task) => (
              <Row
                key={task.id}
                task={task}
                revalidate={revalidate}
                showOwner={showOwner}
                onComplete={() => start(() => hide(task.id))}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({
  task,
  revalidate,
  showOwner,
  onComplete,
}: {
  task: TaskItem;
  revalidate: string;
  showOwner: boolean;
  onComplete: () => void;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bucket = bucketOf(task);
  const done = task.status === "done";

  if (editing) {
    return (
      <li className={cn("px-3 py-2.5", pending && "opacity-50")}>
        <form
          className="flex flex-col gap-2"
          action={(formData) =>
            start(async () => {
              const result = await updateTask(
                task.id,
                {
                  title: String(formData.get("title") ?? ""),
                  detail: (String(formData.get("detail") ?? "").trim() || null) as string | null,
                  priority: String(formData.get("priority") ?? "normal"),
                  dueDate: (String(formData.get("dueDate") ?? "").trim() || null) as string | null,
                },
                revalidate,
              );
              if (result.ok) {
                setEditing(false);
                setError(null);
              } else {
                setError(result.message ?? "That didn't work.");
              }
            })
          }
        >
          <Input
            name="title"
            defaultValue={task.title}
            aria-label="Follow-up"
            autoFocus
            className="text-[13px]"
          />
          <Input
            name="detail"
            defaultValue={task.detail ?? ""}
            aria-label="Detail"
            placeholder="Detail (optional)"
            className="text-[12px]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              name="dueDate"
              defaultValue={task.dueDate ?? ""}
              aria-label="Due date"
              className="h-8 w-auto text-[12px]"
            />
            <Select
              name="priority"
              defaultValue={task.priority}
              aria-label="Priority"
              className="h-8 w-auto min-w-24 text-[12px]"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
            <Button type="submit" variant="primary" size="sm" disabled={pending} className="ml-auto">
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-[11px] text-[var(--danger)]">
              {error}
            </p>
          ) : null}
        </form>
      </li>
    );
  }

  const link = task.projectId
    ? { href: `/projects/${task.projectId}`, label: task.projectName, icon: FolderKanban }
    : task.customerId
      ? { href: `/customers/${task.customerId}`, label: task.customerName, icon: Building2 }
      : task.leadId
        ? { href: `/leads/${task.leadId}`, label: task.leadName, icon: Target }
        : null;

  return (
    <li className={cn("group/task flex items-start gap-2.5 px-3 py-2.5", pending && "opacity-50")}>
      <input
        type="checkbox"
        checked={done}
        aria-label={done ? `Reopen "${task.title}"` : `Mark "${task.title}" done`}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          if (next) onComplete();
          start(() => void setTaskStatus(task.id, next, revalidate));
        }}
        className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
      />

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[13px] leading-5",
            done ? "text-[var(--text-muted)] line-through" : "text-[var(--text)]",
          )}
        >
          {task.title}
          {task.priority === "urgent" ? (
            <Badge tone="danger" className="ml-1.5 align-middle">
              Urgent
            </Badge>
          ) : task.priority === "high" ? (
            <Badge tone="warn" className="ml-1.5 align-middle">
              High
            </Badge>
          ) : null}
        </p>

        {task.detail ? (
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-[var(--text-muted)]">
            {task.detail}
          </p>
        ) : null}

        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-faint)]">
          {task.dueDate ? (
            <span className={bucket === "overdue" ? "font-medium text-[var(--danger)]" : ""}>
              {bucket === "today" ? "Today" : formatDate(task.dueDate)}
            </span>
          ) : null}
          {link?.label ? (
            <Link
              href={link.href}
              className="inline-flex items-center gap-1 hover:text-[var(--text)] hover:underline underline-offset-2"
            >
              <link.icon className="size-3" />
              {link.label}
            </Link>
          ) : null}
          {showOwner && task.assigneeName ? (
            <span className="inline-flex items-center gap-1">
              <Avatar name={task.assigneeName} src={task.assigneePhoto} size="xs" />
              {task.assigneeName}
            </span>
          ) : null}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/task:opacity-100 focus-within:opacity-100">
        {!done ? (
          <button
            type="button"
            title="Edit this follow-up"
            aria-label={`Edit "${task.title}"`}
            disabled={pending}
            onClick={() => setEditing(true)}
            className="rounded p-1 text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
          >
            <Pencil className="size-3.5" />
          </button>
        ) : null}
        {!done ? (
          <button
            type="button"
            title="Push the due date out one week from today"
            aria-label={`Push "${task.title}" out a week`}
            disabled={pending}
            onClick={() => start(() => void snoozeTask(task.id, 7, revalidate))}
            className="rounded p-1 text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
          >
            <Clock className="size-3.5" />
          </button>
        ) : null}
        {confirming ? (
          <span className="flex items-center gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => {
                onComplete();
                start(() => void deleteTask(task.id, revalidate));
              }}
              className="font-medium text-[var(--danger)] hover:underline underline-offset-2"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-[var(--text-muted)] hover:underline underline-offset-2"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label={`Delete "${task.title}"`}
            onClick={() => setConfirming(true)}
            className="rounded p-1 text-[var(--text-faint)] transition-colors hover:text-[var(--danger)]"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </li>
  );
}
