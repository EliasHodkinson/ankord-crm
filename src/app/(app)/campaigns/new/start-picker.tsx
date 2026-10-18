"use client";

import * as React from "react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { TextField } from "@/components/app/form-kit";
import { createCampaign } from "@/lib/actions/campaigns";
import { cn } from "@/lib/utils";
import { PreviewThumb } from "../editor/preview-frame";

type Choice = { value: string; name: string; description: string; html: string };

/** Starting points as cards — Ankor'd starters, the team's own, and past campaigns to copy. */
export function StartPicker({
  starters,
  saved,
  copies,
  initial,
}: {
  starters: Choice[];
  saved: Choice[];
  copies: Choice[];
  initial: string;
}) {
  const [source, setSource] = React.useState(initial);

  const group = (title: string, hint: string, choices: Choice[]) =>
    choices.length ? (
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--text)]">{title}</h2>
          <p className="text-[12px] text-[var(--text-muted)]">{hint}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {choices.map((c) => {
            const on = source === c.value;
            // A copied campaign is a plain duplicate: name and audience come with it.
            return (
              <label
                key={c.value}
                className={cn(
                  "group cursor-pointer overflow-hidden rounded-[10px] border bg-[var(--surface)] shadow-[var(--shadow-sm)] transition-colors",
                  on
                    ? "border-[var(--color-sunrise-400)] ring-2 ring-[var(--color-sunrise-200)] dark:ring-[var(--color-sunrise-800)]"
                    : "border-[var(--border)] hover:border-[var(--color-coastal-300)]",
                )}
              >
                <input
                  type="radio"
                  name="source"
                  value={c.value}
                  checked={on}
                  onChange={() => setSource(c.value)}
                  className="sr-only"
                />
                <PreviewThumb html={c.html} className="border-b border-[var(--border-soft)] bg-[var(--surface-3)]" />
                <div className="px-3.5 py-3">
                  <p className="text-[13px] font-semibold text-[var(--text)]">{c.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-[var(--text-muted)]">{c.description}</p>
                </div>
              </label>
            );
          })}
        </div>
      </section>
    ) : null;

  return (
    <ActionForm action={createCampaign} className="flex flex-col gap-8">
      <div className="flex max-w-xl flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <TextField id="campaign-name" name="name" label="Campaign name" placeholder="November newsletter" hint="For you — recipients never see it." required autoFocus />
        </div>
        <SubmitButton pendingLabel="Creating…">Start editing</SubmitButton>
      </div>
      {group("Ankor'd starters", "Written in the house style, ready to adapt.", starters)}
      {group("Your templates", "Saved by the team.", saved)}
      {group("Copy a past campaign", "Same content, a fresh send.", copies)}
    </ActionForm>
  );
}
