"use client";

import { useId } from "react";
import { ActionForm, SaveIndicator, SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import {
  CheckboxField,
  FormRow,
  FormSection,
  TextAreaField,
  TextField,
} from "@/components/app/form-kit";
import type { Contact } from "@/lib/db/schema";
import type { ActionState } from "@/lib/actions/shared";

export function ContactForm({
  action,
  customerId,
  contact,
  submitLabel,
  onCancel,
  onSaved,
}: {
  action: (prev: ActionState | undefined, formData: FormData) => Promise<ActionState>;
  customerId: string;
  contact?: Contact;
  submitLabel: string;
  onCancel?: () => void;
  onSaved?: () => void;
}) {
  const uid = useId();
  const f = (k: string) => `${uid}-${k}`;

  return (
    <ActionForm action={action} className="flex flex-col gap-6" onSuccess={onSaved}>
      <input type="hidden" name="customerId" value={customerId} />

      <FormSection>
        <FormRow>
          <TextField
            name="firstName"
            label="First name"
            required
            id={f("firstName")}
            defaultValue={contact?.firstName}
            placeholder="Wendy"
          />
          <TextField
            name="lastName"
            label="Last name"
            id={f("lastName")}
            defaultValue={contact?.lastName ?? ""}
            placeholder="Alder"
          />
        </FormRow>
        <FormRow>
          <TextField
            name="jobTitle"
            label="Role"
            id={f("jobTitle")}
            defaultValue={contact?.jobTitle ?? ""}
            placeholder="Director"
          />
          <TextField
            name="pronouns"
            label="Pronouns"
            id={f("pronouns")}
            defaultValue={contact?.pronouns ?? ""}
            placeholder="she/her"
          />
        </FormRow>
        <FormRow cols={3}>
          <TextField
            name="email"
            label="Email"
            type="email"
            id={f("email")}
            defaultValue={contact?.email ?? ""}
          />
          <TextField
            name="phone"
            label="Phone"
            type="tel"
            id={f("phone")}
            defaultValue={contact?.phone ?? ""}
          />
          <TextField
            name="mobile"
            label="Mobile"
            type="tel"
            id={f("mobile")}
            defaultValue={contact?.mobile ?? ""}
          />
        </FormRow>
        <FormRow>
          <TextField
            name="linkedin"
            label="LinkedIn"
            id={f("linkedin")}
            defaultValue={contact?.linkedin ?? ""}
            placeholder="linkedin.com/in/…"
          />
          <TextField
            name="preferredContact"
            label="Best way to reach them"
            id={f("preferredContact")}
            defaultValue={contact?.preferredContact ?? ""}
            placeholder="Phone — rarely reads email"
          />
        </FormRow>
        <FormRow>
          <CheckboxField
            id={f("isPrimary")}
            name="isPrimary"
            label="Primary contact"
            hint="The first person we call at this business."
            defaultChecked={contact?.isPrimary}
          />
          <CheckboxField
            id={f("isDecisionMaker")}
            name="isDecisionMaker"
            label="Decision maker"
            hint="Can approve scope and spend."
            defaultChecked={contact?.isDecisionMaker}
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="The human bit"
        description="The details that make the next conversation easier. Optional, and only ever visible to the Ankor'd team."
      >
        <FormRow cols={3}>
          <TextField
            name="coffeeOrder"
            label="Coffee order"
            id={f("coffeeOrder")}
            defaultValue={contact?.coffeeOrder ?? ""}
            placeholder="Large flat white, one sugar"
          />
          <TextField
            name="birthday"
            label="Birthday"
            type="date"
            id={f("birthday")}
            defaultValue={contact?.birthday ?? ""}
            hint="Only the day and month are ever shown."
          />
          <TextField
            name="dietary"
            label="Dietary"
            id={f("dietary")}
            defaultValue={contact?.dietary ?? ""}
            placeholder="Gluten free"
          />
        </FormRow>
        <TextAreaField
          name="notes"
          label="Notes"
          id={f("notes")}
          rows={3}
          defaultValue={contact?.notes ?? ""}
          placeholder="Straight talker, prefers a call to an email, decides with Theo."
        />
      </FormSection>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton size="sm">{submitLabel}</SubmitButton>
        {onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <span className="ml-auto">
          <SaveIndicator />
        </span>
      </div>
    </ActionForm>
  );
}
