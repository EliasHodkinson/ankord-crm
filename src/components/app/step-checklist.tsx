"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { AlertTriangle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import {
  addChecklistItem,
  removeChecklistItem,
  toggleChecklistItem,
} from "@/lib/actions/projects";
import { cn } from "@/lib/utils";

type Item = { id: string; title: string; done: boolean };

/**
 * A step's checklist — the same list as the Planner task's checklist when the
 * project is linked, so ticking an item here ticks it there and vice versa.
 */
export function StepChecklist({
  stepId,
  projectId,
  items,
}: {
  stepId: string;
  projectId: string;
  items: Item[];
}) {
  const uid = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [shown, apply] = useOptimistic(
    items,
    (current: Item[], change: { id: string; done?: boolean; remove?: boolean }) =>
      change.remove
        ? current.filter((i) => i.id !== change.id)
        : current.map((i) => (i.id === change.id ? { ...i, done: Boolean(change.done) } : i)),
  );

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, optimistic?: Parameters<typeof apply>[0]) {
    setError(null);
    start(async () => {
      if (optimistic) apply(optimistic);
      const res = await fn();
      if (!res.ok) setError(res.message ?? "That didn't save.");
    });
  }

  const done = shown.filter((i) => i.done).length;

  return (
    <div className="mt-4">
      <p className="text-[12px] font-medium text-[var(--text-muted)]">
        Checklist
        {shown.length > 0 ? (
          <span className="ml-1.5 font-normal text-[var(--text-faint)] tabular">
            {done}/{shown.length}
          </span>
        ) : null}
      </p>

      {shown.length > 0 ? (
        <ul className="mt-1.5 flex flex-col">
          {shown.map((item) => (
            <li key={item.id} className="group flex items-center gap-2 py-1">
              <input
                id={`${uid}-${item.id}`}
                type="checkbox"
                checked={item.done}
                onChange={(e) =>
                  run(
                    () => toggleChecklistItem(stepId, projectId, item.id, e.target.checked),
                    { id: item.id, done: e.target.checked },
                  )
                }
                className="size-3.5 accent-[var(--color-coastal-600)]"
              />
              <label
                htmlFor={`${uid}-${item.id}`}
                className={cn(
                  "min-w-0 flex-1 text-[13px]",
                  item.done
                    ? "text-[var(--text-muted)] line-through decoration-[var(--border)]"
                    : "text-[var(--text)]",
                )}
              >
                {item.title}
              </label>
              <button
                type="button"
                aria-label={`Remove "${item.title}"`}
                onClick={() =>
                  run(() => removeChecklistItem(stepId, projectId, item.id), {
                    id: item.id,
                    remove: true,
                  })
                }
                className="rounded p-0.5 text-[var(--text-faint)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-[var(--danger)] focus-visible:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="mt-1.5 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const title = draft;
          setDraft("");
          run(() => addChecklistItem(stepId, projectId, title));
        }}
      >
        <Input
          aria-label="New checklist item"
          value={draft}
          maxLength={100}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a checklist item"
          className="h-8 text-[13px]"
        />
        <Button type="submit" size="sm" variant="ghost" disabled={pending || !draft.trim()}>
          <Plus />
          Add
        </Button>
      </form>

      {error ? (
        <p role="alert" className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--danger)]">
          <AlertTriangle className="size-3" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
