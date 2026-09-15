"use client";

import { useId, useState, useTransition } from "react";
import { CalendarHeart, Plus, Sparkles, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormRow, SelectField, TextField } from "@/components/app/form-kit";
import { addContactFact, deleteContactFact } from "@/lib/actions/contacts";
import type { ContactFact } from "@/lib/db/schema";
import { daysAway, formatDate } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  preference: "Prefers",
  personal: "Personal",
  event: "Coming up",
  mention: "Worth knowing",
};

/**
 * The "special mentions" list — anything about a person worth remembering,
 * with an optional date so upcoming things can surface on the dashboard.
 */
export function ContactFacts({
  contactId,
  customerId,
  facts,
}: {
  contactId: string;
  customerId: string;
  facts: ContactFact[];
}) {
  const [adding, setAdding] = useState(false);
  const uid = useId();

  return (
    <div className="flex flex-col gap-2.5">
      {facts.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {facts.map((fact) => (
            <FactRow key={fact.id} fact={fact} customerId={customerId} />
          ))}
        </ul>
      ) : null}

      {adding ? (
        <ActionForm
          action={addContactFact}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
          onSuccess={() => setAdding(false)}
        >
          <input type="hidden" name="contactId" value={contactId} />
          <input type="hidden" name="customerId" value={customerId} />
          <FormRow cols={2}>
            <SelectField
              name="kind"
              label="Kind"
              id={`${uid}-kind`}
              defaultValue="mention"
              options={Object.entries(KIND_LABEL).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <TextField
              name="label"
              label="What is it"
              required
              id={`${uid}-label`}
              placeholder="Daughter's wedding"
            />
          </FormRow>
          <FormRow cols={3}>
            <TextField
              name="detail"
              label="Detail"
              id={`${uid}-detail`}
              placeholder="In Beechworth — taking the week off"
            />
            <TextField name="onDate" label="Date" type="date" id={`${uid}-onDate`} />
            <TextField
              name="remindDaysBefore"
              label="Remind me"
              type="number"
              min="0"
              max="365"
              id={`${uid}-remind`}
              placeholder="7"
              hint="Days before."
            />
          </FormRow>
          <label className="mt-3 flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              name="recurring"
              className="size-3.5 accent-[var(--accent)]"
            />
            Happens every year
          </label>
          <div className="mt-3 flex items-center gap-2">
            <SubmitButton size="sm">Add</SubmitButton>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </ActionForm>
      ) : (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAdding(true)}>
          <Plus />
          Remember something about them
        </Button>
      )}
    </div>
  );
}

function FactRow({ fact, customerId }: { fact: ContactFact; customerId: string }) {
  const [pending, start] = useTransition();
  const days = daysAway(fact.onDate, fact.recurring);
  const soon = days !== null && days >= 0 && days <= 30;

  return (
    <li
      className="group flex items-start gap-2.5 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2"
      data-pending={pending || undefined}
    >
      {fact.kind === "event" ? (
        <CalendarHeart className="mt-0.5 size-3.5 shrink-0 text-[var(--color-sunrise-500)]" />
      ) : (
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[var(--color-coastal-400)]" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 text-[var(--text)]">
          <span className="font-medium">{fact.label}</span>
          {fact.detail ? (
            <span className="text-[var(--text-muted)]"> — {fact.detail}</span>
          ) : null}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-faint)]">
          <span>{KIND_LABEL[fact.kind]}</span>
          {fact.onDate ? (
            <span>
              · {formatDate(fact.onDate)}
              {fact.recurring ? " · yearly" : ""}
            </span>
          ) : null}
          {soon ? (
            <Badge tone="accent">{days === 0 ? "Today" : `In ${days} days`}</Badge>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        aria-label={`Remove "${fact.label}"`}
        disabled={pending}
        onClick={() => start(() => void deleteContactFact(fact.id, customerId))}
        className="rounded p-1 text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-[var(--danger)]"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}
