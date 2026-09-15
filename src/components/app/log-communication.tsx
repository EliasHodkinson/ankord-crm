"use client";

import { useId, useState } from "react";
import { Lock, Plus } from "lucide-react";
import { ActionForm, SaveIndicator, SubmitButton } from "@/components/ui/form";
import { SelectField, TextAreaField, TextField } from "@/components/app/form-kit";
import { Button } from "@/components/ui/button";
import { logCommunication } from "@/lib/actions/communications";
import { isoDate } from "@/lib/utils";

/**
 * Inline logger — no modal. Collapsed it is one button; expanded it is the
 * smallest form that can capture a call, a meeting or a note.
 */
export function LogCommunication({
  customerId,
  projectId,
  leadId,
  contactOptions = [],
  redirectTo,
}: {
  customerId?: string;
  projectId?: string;
  leadId?: string;
  contactOptions?: { id: string; label: string }[];
  redirectTo: string;
}) {
  const [open, setOpen] = useState(false);
  const uid = useId();

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus />
        Log a call, meeting or note
      </Button>
    );
  }

  return (
    <ActionForm
      action={logCommunication}
      className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] p-3"
      onSuccess={() => setOpen(false)}
    >
        <input type="hidden" name="customerId" value={customerId ?? ""} />
        <input type="hidden" name="projectId" value={projectId ?? ""} />
        <input type="hidden" name="leadId" value={leadId ?? ""} />
        <input type="hidden" name="redirectTo" value={redirectTo} />

        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            name="type"
            label="What happened"
            id={`${uid}-type`}
            defaultValue="call"
            options={[
              { value: "call", label: "Call" },
              { value: "meeting", label: "Meeting" },
              { value: "note", label: "Note" },
              { value: "teams", label: "Teams message" },
              { value: "email", label: "Email (typed in)" },
            ]}
          />
          <SelectField
            name="direction"
            label="Direction"
            id={`${uid}-direction`}
            defaultValue="outbound"
            options={[
              { value: "outbound", label: "We contacted them" },
              { value: "inbound", label: "They contacted us" },
              { value: "internal", label: "Internal" },
            ]}
          />
          <TextField
            name="occurredAt"
            label="When"
            type="datetime-local"
            id={`${uid}-when`}
            defaultValue={localNow()}
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField
            name="subject"
            label="Subject"
            id={`${uid}-subject`}
            placeholder="Scope call — kitchen gallery"
          />
          {contactOptions.length > 0 ? (
            <SelectField
              name="contactId"
              label="Who with"
              id={`${uid}-contact`}
              defaultValue=""
              options={[
                { value: "", label: "Not specified" },
                ...contactOptions.map((c) => ({ value: c.id, label: c.label })),
              ]}
            />
          ) : null}
        </div>

        <TextAreaField
          name="body"
          label="What was said"
          id={`${uid}-body`}
          className="mt-3"
          rows={4}
          required
          placeholder="Agreed to send the sitemap by Friday. Wendy is away the week after next."
        />

        {/* Leaving a record with no next step is how things go quiet. */}
        <div className="mt-3 grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 sm:grid-cols-[2fr_1fr]">
          <TextField
            name="followUpTitle"
            label="And then what?"
            id={`${uid}-follow`}
            placeholder="Send the sitemap for sign-off"
            hint="Optional — becomes a follow-up assigned to you."
          />
          <TextField
            name="followUpDate"
            label="By when"
            type="date"
            id={`${uid}-follow-date`}
            defaultValue={isoDate(3)}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <SubmitButton size="sm" pendingLabel="Logging…">
            Log it
          </SubmitButton>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              name="visibility"
              value="private"
              className="size-3.5 accent-[var(--accent)]"
            />
            <Lock className="size-3" />
            Only visible to me
          </label>
          <span className="ml-auto">
            <SaveIndicator />
          </span>
        </div>
    </ActionForm>
  );
}

/** `datetime-local` needs a local ISO string, not a UTC one. */
function localNow(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}
