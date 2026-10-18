"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, UserPlus } from "lucide-react";
import { ActionForm, SubmitButton, useFormResult } from "@/components/ui/form";
import {
  CheckboxField,
  FormRow,
  FormSection,
  SelectField,
  TextField,
} from "@/components/app/form-kit";
import { addPerson } from "@/lib/actions/people";
import { CustomerPicker, type PickerCustomer } from "./customer-picker";

export function AddPersonForm({ customers }: { customers: PickerCustomer[] }) {
  // Bumped after each success so the checklist starts empty for the next person.
  const [round, setRound] = useState(0);

  return (
    <ActionForm action={addPerson} onSuccess={() => setRound((r) => r + 1)}>
      <div className="flex flex-col gap-5">
        <Added />
        <FormRow>
          <TextField name="name" label="Name" required autoComplete="off" />
          <TextField
            name="email"
            label="Email"
            type="email"
            required
            autoComplete="off"
            hint="Their own address for a guest; their Ankor'd address for staff."
          />
        </FormRow>
        <FormRow>
          <SelectField
            name="role"
            label="Access"
            defaultValue="restricted"
            options={[
              { value: "restricted", label: "Restricted — only the partners ticked below" },
              { value: "member", label: "Staff — every record" },
              { value: "viewer", label: "Viewer — every record, read only" },
              { value: "admin", label: "Admin — everything, including this page" },
            ]}
          />
          <SelectField
            name="fileAccess"
            label="SharePoint folders"
            defaultValue="write"
            hint="For a restricted person. Can be changed per partner later."
            options={[
              { value: "write", label: "Can edit files" },
              { value: "read", label: "Can view files" },
            ]}
          />
        </FormRow>
        <FormRow>
          <CheckboxField
            name="invite"
            label="Invite as a guest if they are not in the tenant"
            hint="For a VA or contractor from outside Ankor'd. No licence needed — they sign in with their own email."
            defaultChecked
          />
          <CheckboxField
            name="sendEmail"
            label="Have Microsoft email them the invitation"
            hint="Untick to get the invitation link here and send it yourself."
            defaultChecked
          />
        </FormRow>
        <FormSection
          title="Business partners they can see"
          description="Only applies to a restricted person. Each one shares that partner's contacts, projects, emails and follow-ups in the CRM, and its SharePoint folder."
        >
          <CustomerPicker key={round} customers={customers} showAccess={false} />
        </FormSection>
        <div>
          <SubmitButton pendingLabel="Adding…">
            <UserPlus />
            Add person
          </SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

/** What happened on the last add — including the invitation link, when Microsoft did not send it. */
function Added() {
  const result = useFormResult();
  if (!result?.ok) return null;
  const { userId, redeemUrl } = result.data ?? {};
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg border border-[var(--ok)]/25 bg-[var(--ok-bg)] px-3 py-2.5 text-[13px] text-[var(--text)]"
    >
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--ok)]" />
      <div className="min-w-0 flex flex-col gap-1">
        <p>{result.message}</p>
        {redeemUrl ? (
          <p className="text-[12px] text-[var(--text-muted)]">
            Send them this invitation link — it is shown once:{" "}
            <code className="font-mono text-[11px] break-all text-[var(--text)]">{redeemUrl}</code>
          </p>
        ) : null}
        {userId ? (
          <Link
            href={`/settings/people/${userId}`}
            className="text-[12px] font-medium text-[var(--color-coastal-600)] underline-offset-2 hover:underline"
          >
            Open their access
          </Link>
        ) : null}
      </div>
    </div>
  );
}
