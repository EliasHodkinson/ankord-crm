"use client";

import { useId } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field } from "@/components/ui/field";
import { ButtonLink } from "@/components/ui/button";
import { OwnerSelect } from "@/components/app/owner-select";
import {
  AU_STATES,
  FormRow as Row,
  FormSection as Section,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/app/form-kit";
import { LEAD_STAGES, optionsFor } from "@/components/ui/status";
import type { Lead } from "@/lib/db/schema";
import type { TeamMember } from "@/lib/data/common";
import type { ActionState } from "@/lib/actions/shared";

export function LeadForm({
  action,
  lead,
  team,
  submitLabel,
  cancelHref,
}: {
  action: (prev: ActionState | undefined, formData: FormData) => Promise<ActionState>;
  lead?: Lead;
  team: TeamMember[];
  submitLabel: string;
  cancelHref: string;
}) {
  const uid = useId();
  const f = (key: string) => `${uid}-${key}`;

  return (
    <ActionForm action={action} className="flex flex-col gap-8">
      <Section title="Who they are">
        <Row>
          <TextField
            name="companyName"
            label="Company or trading name"
            required
            id={f("companyName")}
            defaultValue={lead?.companyName}
            placeholder="Maple Street Kitchens Pty Ltd"
          />
          <TextField
            name="contactName"
            label="Main contact"
            id={f("contactName")}
            defaultValue={lead?.contactName ?? ""}
            placeholder="Wendy Alder"
          />
        </Row>
        <Row>
          <TextField
            name="jobTitle"
            label="Their role"
            id={f("jobTitle")}
            defaultValue={lead?.jobTitle ?? ""}
            placeholder="Director"
          />
          <TextField
            name="email"
            label="Email"
            type="email"
            id={f("email")}
            defaultValue={lead?.email ?? ""}
            placeholder="wendy@example.com"
          />
        </Row>
        <Row>
          <TextField
            name="phone"
            label="Phone"
            type="tel"
            id={f("phone")}
            defaultValue={lead?.phone ?? ""}
            placeholder="(02) 6040 2007"
          />
          <TextField
            name="website"
            label="Website"
            id={f("website")}
            defaultValue={lead?.website ?? ""}
            placeholder="example.com"
          />
        </Row>
        <Row>
          <TextField
            name="suburb"
            label="Suburb"
            id={f("suburb")}
            defaultValue={lead?.suburb ?? ""}
            placeholder="North Riverbend"
          />
          <SelectField
            name="state"
            label="State"
            id={f("state")}
            defaultValue={lead?.state ?? ""}
            options={[
              { value: "", label: "—" },
              ...AU_STATES.map((code) => ({ value: code, label: code })),
            ]}
          />
        </Row>
      </Section>

      <Section title="Where it's up to">
        <Row>
          <SelectField
            name="stage"
            label="Stage"
            required
            id={f("stage")}
            defaultValue={lead?.stage ?? "new"}
            options={optionsFor(LEAD_STAGES)}
          />
          <Field label="Owner" htmlFor={f("ownerId")} hint="Who is chasing this.">
            <OwnerSelect id={f("ownerId")} team={team} defaultValue={lead?.ownerId} />
          </Field>
        </Row>
        <Row>
          <TextField
            name="source"
            label="Where it came from"
            id={f("source")}
            defaultValue={lead?.source ?? ""}
            placeholder="Referral — Chamber of Commerce"
          />
          <TextField
            name="interest"
            label="What they're after"
            id={f("interest")}
            defaultValue={lead?.interest ?? ""}
            placeholder="Website rebuild + M365 migration"
          />
        </Row>
        <Row cols={3}>
          <TextField
            name="valueAud"
            label="Value (AUD)"
            type="number"
            step="100"
            min="0"
            id={f("valueAud")}
            defaultValue={lead?.valueAud ?? ""}
            placeholder="18000"
          />
          <TextField
            name="probability"
            label="Confidence (%)"
            type="number"
            min="0"
            max="100"
            id={f("probability")}
            defaultValue={lead?.probability ?? ""}
            placeholder="60"
          />
          <TextField
            name="expectedCloseDate"
            label="Expected close"
            type="date"
            id={f("expectedCloseDate")}
            defaultValue={lead?.expectedCloseDate ?? ""}
          />
        </Row>
      </Section>

      <Section title="Next move">
        <Row>
          <TextField
            name="nextAction"
            label="Next action"
            id={f("nextAction")}
            defaultValue={lead?.nextAction ?? ""}
            placeholder="Send scope + pricing"
          />
          <TextField
            name="nextActionAt"
            label="By when"
            type="date"
            id={f("nextActionAt")}
            defaultValue={lead?.nextActionAt ?? ""}
          />
        </Row>
        <Row>
          <TextField
            name="tags"
            label="Tags"
            id={f("tags")}
            defaultValue={lead?.tags?.join(", ") ?? ""}
            hint="Comma separated."
            placeholder="hospitality, riverbend"
          />
          <TextField
            name="lostReason"
            label="If lost, why"
            id={f("lostReason")}
            defaultValue={lead?.lostReason ?? ""}
            placeholder="Went with incumbent provider"
          />
        </Row>
        <TextAreaField
          name="notes"
          label="Notes"
          id={f("notes")}
          rows={5}
          defaultValue={lead?.notes ?? ""}
          placeholder="Context, history, anything the next person needs to know."
        />
      </Section>

      <div className="flex items-center gap-2 border-t border-[var(--border)] pt-5">
        <SubmitButton>{submitLabel}</SubmitButton>
        <ButtonLink href={cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </ActionForm>
  );
}
