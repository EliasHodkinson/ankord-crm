"use client";

import { ActionForm, SaveIndicator, SubmitButton } from "@/components/ui/form";
import { FormRow, FormSection, TextAreaField, TextField } from "@/components/app/form-kit";
import { saveMarketingSettings } from "@/lib/actions/campaigns";

const NETWORKS = [
  ["website", "Website"],
  ["linkedin", "LinkedIn"],
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["youtube", "YouTube"],
] as const;

export function MarketingSettingsForm({
  values,
  readOnly,
}: {
  values: { marketingMailbox: string; marketingFooter: string; marketingLogoUrl: string; social: Record<string, string> };
  readOnly: boolean;
}) {
  return (
    <ActionForm action={saveMarketingSettings}>
      <fieldset disabled={readOnly} className="flex flex-col gap-7">
        <FormSection title="The marketing mailbox" description="A shared mailbox campaigns can send from instead of a person's own. Replies land there.">
          <TextField name="marketingMailbox" label="Address" type="email" defaultValue={values.marketingMailbox} placeholder="marketing@ankord.com.au" />
        </FormSection>

        <FormSection
          title="Footer"
          description="Every campaign ends with this, then an unsubscribe link. The Spam Act requires the sender to be identified and how to reach them."
        >
          <TextAreaField
            name="marketingFooter"
            label="Sender details"
            defaultValue={values.marketingFooter}
            rows={4}
            required
            hint="Business name, ABN or address, and why they're getting it. One line per line."
          />
        </FormSection>

        <FormSection title="Brand" description="Blank uses the Ankor'd wordmark, sized for email.">
          <TextField name="marketingLogoUrl" label="Logo image (PNG or JPEG)" defaultValue={values.marketingLogoUrl} placeholder="https://" />
        </FormSection>

        <FormSection title="Social links" description="Used by the Social links block.">
          <FormRow>
            {NETWORKS.map(([key, label]) => (
              <TextField key={key} name={`social_${key}`} label={label} defaultValue={values.social[key] ?? ""} placeholder="https://" />
            ))}
          </FormRow>
        </FormSection>

        {readOnly ? null : (
          <div className="flex items-center gap-3">
            <SubmitButton>Save settings</SubmitButton>
            <SaveIndicator />
          </div>
        )}
      </fieldset>
    </ActionForm>
  );
}
