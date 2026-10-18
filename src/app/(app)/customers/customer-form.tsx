"use client";

import { useId } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { OwnerSelect } from "@/components/app/owner-select";
import {
  AU_STATES,
  CheckboxField,
  FormRow,
  FormSection,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/app/form-kit";
import { CUSTOMER_STATUS, PARTNER_TYPE, optionsFor } from "@/components/ui/status";
import { PARTNER_TYPES, PARTNER_TYPE_FIELD, type PartnerType } from "@/lib/contact-kinds";
import type { Customer } from "@/lib/db/schema";
import type { TeamMember } from "@/lib/data/common";
import type { ActionState } from "@/lib/actions/shared";

export function CustomerForm({
  action,
  customer,
  team,
  initialType = "client",
  submitLabel,
  cancelHref,
}: {
  action: (prev: ActionState | undefined, formData: FormData) => Promise<ActionState>;
  customer?: Customer;
  team: TeamMember[];
  /** For a new partner: the type ticked to begin with. */
  initialType?: PartnerType;
  submitLabel: string;
  cancelHref: string;
}) {
  const uid = useId();
  const f = (k: string) => `${uid}-${k}`;

  return (
    <ActionForm action={action} className="flex flex-col gap-8">
      <FormSection title="The business">
        <FormRow>
          <TextField
            name="name"
            label="Trading name"
            required
            id={f("name")}
            defaultValue={customer?.name}
            placeholder="Maple Street Kitchens"
          />
          <TextField
            name="legalName"
            label="Legal entity"
            id={f("legalName")}
            defaultValue={customer?.legalName ?? ""}
            placeholder="Maple Street Kitchens Pty Ltd"
          />
        </FormRow>
        <FormRow cols={3}>
          <TextField
            name="abn"
            label="ABN"
            id={f("abn")}
            defaultValue={customer?.abn ?? ""}
            placeholder="12 345 678 901"
          />
          <SelectField
            name="status"
            label="Status"
            id={f("status")}
            defaultValue={customer?.status ?? "active"}
            options={optionsFor(CUSTOMER_STATUS)}
          />
          <Field label="Account owner" htmlFor={f("ownerId")}>
            <OwnerSelect id={f("ownerId")} team={team} defaultValue={customer?.ownerId} />
          </Field>
        </FormRow>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[12px] font-medium text-[var(--text-muted)]">
            Type
          </legend>
          <p className="-mt-1 text-[12px] leading-5 text-[var(--text-faint)]">
            Tick every one that applies. Client and Supplier match Xero; Media stays in The Gangway.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {PARTNER_TYPES.map((t) => {
              const field = PARTNER_TYPE_FIELD[t];
              return (
                <CheckboxField
                  // Remounts when the header's toggles change the stored
                  // value, or a later save here would quietly undo them.
                  key={`${t}-${customer?.[field]}`}
                  id={f(field)}
                  name={field}
                  label={PARTNER_TYPE[t].label}
                  hint={PARTNER_TYPE[t].hint}
                  defaultChecked={customer ? customer[field] : t === initialType}
                />
              );
            })}
          </div>
        </fieldset>

        <FormRow>
          <TextField
            name="industry"
            label="Industry"
            id={f("industry")}
            defaultValue={customer?.industry ?? ""}
            placeholder="Cabinetry & joinery"
          />
          <TextField
            name="segment"
            label="Segment"
            id={f("segment")}
            defaultValue={customer?.segment ?? ""}
            hint="However Ankor'd groups clients — retainer, project, referral partner."
          />
        </FormRow>
        <FormRow>
          <TextField
            name="termsDays"
            label="Payment terms (days)"
            id={f("termsDays")}
            type="number"
            min={0}
            defaultValue={customer?.termsDays?.toString() ?? ""}
            hint="For invoices to them. Blank uses the default."
          />
          <TextField
            name="supplierTermsDays"
            label="Their terms to us (days)"
            id={f("supplierTermsDays")}
            type="number"
            min={0}
            defaultValue={customer?.supplierTermsDays?.toString() ?? ""}
            hint="For bills from them, if they supply us."
          />
        </FormRow>
      </FormSection>

      <FormSection title="How to reach them">
        <FormRow cols={3}>
          <TextField
            name="phone"
            label="Main phone"
            type="tel"
            id={f("phone")}
            defaultValue={customer?.phone ?? ""}
            placeholder="(02) 6040 2007"
          />
          <TextField
            name="email"
            label="General email"
            type="email"
            id={f("email")}
            defaultValue={customer?.email ?? ""}
            placeholder="info@example.com"
          />
          <TextField
            name="website"
            label="Website"
            id={f("website")}
            defaultValue={customer?.website ?? ""}
            placeholder="example.com"
          />
        </FormRow>
        <FormRow>
          <TextField
            name="addressLine1"
            label="Street address"
            id={f("addressLine1")}
            defaultValue={customer?.addressLine1 ?? ""}
            placeholder="909 Metry Street"
          />
          <TextField
            name="addressLine2"
            label="Address line 2"
            id={f("addressLine2")}
            defaultValue={customer?.addressLine2 ?? ""}
          />
        </FormRow>
        <FormRow cols={3}>
          <TextField
            name="suburb"
            label="Suburb"
            id={f("suburb")}
            defaultValue={customer?.suburb ?? ""}
            placeholder="North Riverbend"
          />
          <SelectField
            name="state"
            label="State"
            id={f("state")}
            defaultValue={customer?.state ?? ""}
            options={[{ value: "", label: "—" }, ...AU_STATES.map((s) => ({ value: s, label: s }))]}
          />
          <TextField
            name="postcode"
            label="Postcode"
            id={f("postcode")}
            defaultValue={customer?.postcode ?? ""}
            placeholder="2640"
            inputMode="numeric"
          />
        </FormRow>
        <input type="hidden" name="country" value={customer?.country ?? "Australia"} />
      </FormSection>

      <FormSection title="Context">
        <TextField
          name="tags"
          label="Tags"
          id={f("tags")}
          defaultValue={customer?.tags?.join(", ") ?? ""}
          hint="Comma separated."
          placeholder="retainer, m365, website"
        />
        <TextAreaField
          name="notes"
          label="Notes"
          id={f("notes")}
          rows={5}
          defaultValue={customer?.notes ?? ""}
          placeholder="How the relationship works, who decides what, anything the team should know before picking up the phone."
        />
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
