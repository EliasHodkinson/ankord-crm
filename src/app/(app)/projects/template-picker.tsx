"use client";

import { useState } from "react";
import { Check, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

export type TemplateOption = {
  key: string;
  name: string;
  description: string;
  phases: number;
  steps: number;
};

/** Radio cards, not a dropdown — the choice sets up the whole project. */
export function TemplatePicker({ options }: { options: TemplateOption[] }) {
  const [selected, setSelected] = useState(options[0]?.key ?? "blank");

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-[13px] font-semibold tracking-[0.02em] text-[var(--text-muted)]">
        Start from
      </legend>
      <div className="grid gap-2.5 sm:grid-cols-3">
        {options.map((option) => (
          <label
            key={option.key}
            className={cn(
              "relative flex cursor-pointer flex-col gap-1.5 rounded-[10px] border p-3.5",
              "transition-colors duration-150",
              selected === option.key
                ? "border-[var(--accent)] bg-[var(--color-sunrise-50)] dark:bg-[var(--color-sunrise-900)]/25"
                : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--color-coastal-300)]",
            )}
          >
            <input
              type="radio"
              name="templateKey"
              value={option.key}
              checked={selected === option.key}
              onChange={() => setSelected(option.key)}
              className="sr-only"
            />
            <span className="flex items-start justify-between gap-2">
              <span className="text-[13px] font-semibold text-[var(--text)]">
                {option.name}
              </span>
              {selected === option.key ? (
                <Check className="size-4 shrink-0 text-[var(--accent)]" />
              ) : null}
            </span>
            <span className="text-[12px] leading-5 text-[var(--text-muted)]">
              {option.description}
            </span>
            <span className="mt-auto inline-flex items-center gap-1.5 pt-1.5 text-[11px] text-[var(--text-faint)]">
              <ListChecks className="size-3.5" />
              {option.steps === 0
                ? "Empty — add your own"
                : `${option.phases} phases · ${option.steps} steps`}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
