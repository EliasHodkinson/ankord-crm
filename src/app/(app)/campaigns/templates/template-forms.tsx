"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Archive, Loader2, Megaphone } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { SelectField, TextField } from "@/components/app/form-kit";
import { archiveTemplate, createTemplate } from "@/lib/actions/campaigns";

export function NewTemplateForm({ starters }: { starters: { value: string; label: string }[] }) {
  return (
    <ActionForm action={createTemplate}>
      <div className="flex flex-wrap items-end gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
        <div className="min-w-56 flex-1">
          <TextField name="name" label="New template" placeholder="Monthly client update" required />
        </div>
        <div className="w-56">
          <SelectField name="starter" label="Starting from" defaultValue="newsletter" options={starters} />
        </div>
        <SubmitButton pendingLabel="Creating…">Create and edit</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function TemplateMenu({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Link
        href={`/campaigns/new?template=${id}`}
        title="Start a campaign from this"
        aria-label="Start a campaign from this"
        className="grid size-7 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
      >
        <Megaphone className="size-3.5" />
      </Link>
      <button
        type="button"
        title="Archive"
        aria-label="Archive this template"
        disabled={pending}
        onClick={() => {
          if (window.confirm("Archive this template? Campaigns made from it are not affected.")) {
            start(async () => {
              await archiveTemplate(id);
            });
          }
        }}
        className="grid size-7 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}
      </button>
    </div>
  );
}
