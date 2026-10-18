"use client";

import { ActionForm, SaveIndicator, SubmitButton } from "@/components/ui/form";
import { TextAreaField } from "@/components/app/form-kit";
import { saveSharedMailboxes } from "@/lib/actions/settings";

export function SharedMailboxesForm({ mailboxes }: { mailboxes: string[] }) {
  return (
    <ActionForm action={saveSharedMailboxes}>
      <div className="flex flex-col gap-3">
        <TextAreaField
          name="sharedMailboxes"
          label="Shared mailboxes"
          defaultValue={mailboxes.join("\n")}
          placeholder={"kee@ankord.com.au\nannemaree@ankord.com.au"}
          hint="One address per line. Listing a mailbox grants nothing — Exchange decides who can open it, exactly as in Outlook."
          rows={3}
        />
        <div className="flex items-center gap-3">
          <SubmitButton>Save mailboxes</SubmitButton>
          <SaveIndicator />
        </div>
      </div>
    </ActionForm>
  );
}
