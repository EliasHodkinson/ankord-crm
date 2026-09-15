"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { SelectField, TextField } from "@/components/app/form-kit";
import { createTask } from "@/lib/actions/tasks";
import type { TeamMember } from "@/lib/data/common";
import { isoDate } from "@/lib/utils";

/**
 * One line to set a follow-up. Everything else — who, when, how urgent —
 * is one click away rather than in the way.
 */
export function QuickTask({
  revalidate,
  team = [],
  customerId,
  projectId,
  leadId,
  contactId,
  placeholder = "Add a follow-up…",
}: {
  revalidate: string;
  team?: TeamMember[];
  customerId?: string;
  projectId?: string;
  leadId?: string;
  contactId?: string;
  placeholder?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const uid = useId();

  return (
    <ActionForm
      action={createTask}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2"
      onSuccess={() => setExpanded(false)}
    >
      <input type="hidden" name="revalidate" value={revalidate} />
      <input type="hidden" name="customerId" value={customerId ?? ""} />
      <input type="hidden" name="projectId" value={projectId ?? ""} />
      <input type="hidden" name="leadId" value={leadId ?? ""} />
      <input type="hidden" name="contactId" value={contactId ?? ""} />

      <div className="flex items-center gap-2">
        <Plus className="ml-1 size-4 shrink-0 text-[var(--text-faint)]" aria-hidden />
        <Input
          name="title"
          required
          aria-label="What needs doing"
          placeholder={placeholder}
          onFocus={() => setExpanded(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setExpanded(false);
          }}
          className="h-8 border-transparent bg-transparent shadow-none hover:border-transparent focus:border-[var(--ring)] focus:bg-[var(--surface)]"
        />
        <SubmitButton size="sm" pendingLabel="Adding…">
          Add
        </SubmitButton>
      </div>

      {/* Details stay out of the way until the field is in use. */}
      {expanded ? (
        <div className="mt-2 grid gap-2 border-t border-[var(--border-soft)] pt-2 sm:grid-cols-3">
          <TextField
            name="dueDate"
            label="Due"
            type="date"
            id={`${uid}-due`}
            defaultValue={isoDate(1)}
          />
          <SelectField
            name="priority"
            label="Priority"
            id={`${uid}-priority`}
            defaultValue="normal"
            options={[
              { value: "low", label: "Low" },
              { value: "normal", label: "Normal" },
              { value: "high", label: "High" },
              { value: "urgent", label: "Urgent" },
            ]}
          />
          {team.length > 0 ? (
            <SelectField
              name="assigneeId"
              label="Who"
              id={`${uid}-assignee`}
              defaultValue=""
              options={[
                { value: "", label: "Me" },
                ...team.map((m) => ({ value: m.id, label: m.name })),
              ]}
            />
          ) : null}
          <div className="sm:col-span-3">
            <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </ActionForm>
  );
}
