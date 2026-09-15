"use client";

import { useId } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { OwnerSelect } from "@/components/app/owner-select";
import {
  FormRow,
  FormSection,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/app/form-kit";
import {
  optionsFor,
  PRIORITY,
  PROJECT_HEALTH,
  PROJECT_STATUS,
} from "@/components/ui/status";
import type { Project } from "@/lib/db/schema";
import type { TeamMember } from "@/lib/data/common";
import type { ActionState } from "@/lib/actions/shared";

export function ProjectForm({
  action,
  project,
  team,
  customers,
  defaultCustomerId,
  submitLabel,
  cancelHref,
  children,
}: {
  action: (prev: ActionState | undefined, formData: FormData) => Promise<ActionState>;
  project?: Project;
  team: TeamMember[];
  customers: { id: string; name: string }[];
  defaultCustomerId?: string;
  submitLabel: string;
  cancelHref: string;
  /** The template picker, only shown when creating. */
  children?: React.ReactNode;
}) {
  const uid = useId();
  const f = (k: string) => `${uid}-${k}`;

  return (
    <ActionForm action={action} className="flex flex-col gap-8">
      <FormSection title="What it is">
        <FormRow>
          <SelectField
            name="customerId"
            label="Customer"
            required
            id={f("customerId")}
            defaultValue={project?.customerId ?? defaultCustomerId ?? ""}
            options={[
              { value: "", label: "Choose a customer…" },
              ...customers.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <TextField
            name="name"
            label="Project name"
            required
            id={f("name")}
            defaultValue={project?.name}
            placeholder="Onboarding & system migration"
          />
        </FormRow>
        <FormRow cols={3}>
          <TextField
            name="code"
            label="Reference"
            id={f("code")}
            defaultValue={project?.code ?? ""}
            placeholder="MSK-ONB"
            hint="Short code used in file names and emails."
          />
          <Field label="Project lead" htmlFor={f("ownerId")}>
            <OwnerSelect id={f("ownerId")} team={team} defaultValue={project?.ownerId} />
          </Field>
          <SelectField
            name="priority"
            label="Priority"
            id={f("priority")}
            defaultValue={project?.priority ?? "normal"}
            options={optionsFor(PRIORITY)}
          />
        </FormRow>
        <TextAreaField
          name="summary"
          label="Summary"
          id={f("summary")}
          rows={2}
          defaultValue={project?.summary ?? ""}
          placeholder="What this project delivers, in a sentence."
        />
      </FormSection>

      {children}

      <FormSection title="Where it's up to">
        <FormRow cols={3}>
          <SelectField
            name="status"
            label="Status"
            id={f("status")}
            defaultValue={project?.status ?? "planning"}
            options={optionsFor(PROJECT_STATUS)}
          />
          <SelectField
            name="health"
            label="Health"
            id={f("health")}
            defaultValue={project?.health ?? "on_track"}
            options={optionsFor(PROJECT_HEALTH)}
          />
          <TextField
            name="budgetAud"
            label="Budget (AUD)"
            type="number"
            step="100"
            min="0"
            id={f("budgetAud")}
            defaultValue={project?.budgetAud ?? ""}
          />
        </FormRow>
        <FormRow>
          <TextField
            name="startDate"
            label="Started"
            type="date"
            id={f("startDate")}
            defaultValue={project?.startDate ?? ""}
          />
          <TextField
            name="targetDate"
            label="Target completion"
            type="date"
            id={f("targetDate")}
            defaultValue={project?.targetDate ?? ""}
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="Act first"
        description="The one thing that matters most right now — shown as a banner at the top of the project."
      >
        <TextField
          name="headline"
          label="Headline"
          id={f("headline")}
          defaultValue={project?.headline ?? ""}
          placeholder="The website is completely offline"
        />
        <TextAreaField
          name="headlineDetail"
          label="Why it matters"
          id={f("headlineDetail")}
          rows={2}
          defaultValue={project?.headlineDetail ?? ""}
          placeholder="This is what the client will judge the engagement on. It doesn't depend on the other workstreams."
        />
      </FormSection>

      <FormSection
        title="Systems map"
        description="How things work today, and how they should work when this is finished."
      >
        <FormRow>
          <TextAreaField
            name="stateBefore"
            label="Today"
            id={f("stateBefore")}
            rows={5}
            defaultValue={project?.stateBefore ?? ""}
            placeholder="Who holds the keys, where things are bought, what actually runs."
          />
          <TextAreaField
            name="stateAfter"
            label="After"
            id={f("stateAfter")}
            rows={5}
            defaultValue={project?.stateAfter ?? ""}
            placeholder="Who should own what once this is done."
          />
        </FormRow>
      </FormSection>

      <div className="flex items-center gap-2 border-t border-[var(--border)] pt-5">
        <SubmitButton>{submitLabel}</SubmitButton>
        <ButtonLink href={cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </ActionForm>
  );
}
