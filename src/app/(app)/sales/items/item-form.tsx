"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ActionForm, SubmitButton, useFormResult } from "@/components/ui/form";
import { ButtonLink } from "@/components/ui/button";
import {
  CheckboxField,
  FormRow,
  FormSection,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/app/form-kit";
import { saveItem } from "@/lib/actions/items";
import type { Item } from "@/lib/db/schema";
import {
  accountLabel,
  taxLabel,
  type XeroAccountRef,
  type XeroTaxRateRef,
} from "@/lib/sales/xero-refs";

/**
 * An item, with the Xero accounts and tax types its lines are coded to.
 * Saving also saves it in Xero as an untracked Item.
 */
export function ItemForm({
  item,
  salesAccounts,
  purchaseAccounts,
  salesTax,
  purchaseTax,
  suppliers,
  xeroReady,
}: {
  item: Item | null;
  salesAccounts: XeroAccountRef[];
  purchaseAccounts: XeroAccountRef[];
  salesTax: XeroTaxRateRef[];
  purchaseTax: XeroTaxRateRef[];
  suppliers: { id: string; name: string }[];
  /** Whether Xero's accounts have been read; the item still saves without them. */
  xeroReady: boolean;
}) {
  const accountHint = xeroReady
    ? "Blank uses the default in Settings → Sales & Xero"
    : "Connect Xero in Settings to choose accounts. The item still saves.";

  const accountOptions = (list: XeroAccountRef[], current: string | null | undefined) => [
    { value: "", label: "Default account" },
    ...(current && !list.some((a) => a.code === current) ? [{ value: current, label: current }] : []),
    ...list.map((a) => ({ value: a.code, label: accountLabel(a) })),
  ];
  const taxOptions = (list: XeroTaxRateRef[]) => [
    { value: "", label: "Default tax rate" },
    ...list.map((t) => ({ value: t.taxType, label: taxLabel(t) })),
  ];

  return (
    <ActionForm action={saveItem.bind(null, item?.id ?? null)} className="flex flex-col gap-6">
      <GoToSaved />
      <FormSection title="The item">
        <FormRow cols={3}>
          <TextField name="code" label="Code" required maxLength={30} defaultValue={item?.code ?? ""} hint="Up to 30 characters, as in Xero" />
          <TextField name="name" label="Name" required maxLength={50} defaultValue={item?.name ?? ""} />
          <TextField name="unit" label="Unit" defaultValue={item?.unit ?? ""} placeholder="ea, hr, box of 500" />
        </FormRow>
        <FormRow cols={3}>
          <CheckboxField name="isSold" label="We sell it" defaultChecked={item?.isSold ?? true} />
          <CheckboxField name="isPurchased" label="We buy it" defaultChecked={item?.isPurchased ?? false} />
          <CheckboxField
            name="tracksStock"
            label="Physical goods"
            hint="Counted in and out — ordered, received and delivered. Leave off for services."
            defaultChecked={item?.tracksStock ?? false}
          />
        </FormRow>
      </FormSection>

      <FormSection title="Selling" description="What a quote or invoice line defaults to.">
        <TextAreaField name="description" label="Sales description" rows={2} defaultValue={item?.description ?? ""} />
        <FormRow cols={3}>
          <TextField
            name="salePrice"
            label="Sale price (ex GST)"
            inputMode="decimal"
            defaultValue={item?.salePrice ? trim(item.salePrice) : ""}
          />
          <SelectField
            name="salesAccountCode"
            label="Sales account"
            hint={accountHint}
            defaultValue={item?.salesAccountCode ?? ""}
            options={accountOptions(salesAccounts, item?.salesAccountCode)}
          />
          <SelectField
            name="salesTaxType"
            label="Sales tax"
            defaultValue={item?.salesTaxType ?? ""}
            options={taxOptions(salesTax)}
          />
        </FormRow>
      </FormSection>

      <FormSection title="Buying" description="What a purchase-order line defaults to. A missing buy price is shown as missing, never guessed.">
        <TextAreaField
          name="purchaseDescription"
          label="Purchase description"
          rows={2}
          defaultValue={item?.purchaseDescription ?? ""}
        />
        <FormRow cols={3}>
          <TextField
            name="purchasePrice"
            label="Buy price (ex GST)"
            inputMode="decimal"
            defaultValue={item?.purchasePrice ? trim(item.purchasePrice) : ""}
          />
          <SelectField
            name="purchaseAccountCode"
            label="Purchase account"
            hint={accountHint}
            defaultValue={item?.purchaseAccountCode ?? ""}
            options={accountOptions(purchaseAccounts, item?.purchaseAccountCode)}
          />
          <SelectField
            name="purchaseTaxType"
            label="Purchase tax"
            defaultValue={item?.purchaseTaxType ?? ""}
            options={taxOptions(purchaseTax)}
          />
        </FormRow>
        <SelectField
          name="preferredSupplierId"
          label="Usual supplier"
          defaultValue={item?.preferredSupplierId ?? ""}
          options={[{ value: "", label: suppliers.length ? "None" : "No suppliers yet" }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
        />
      </FormSection>

      <div className="flex justify-end gap-2">
        <ButtonLink href={item ? `/sales/items/${item.id}` : "/sales/items"} variant="ghost">
          Cancel
        </ButtonLink>
        <SubmitButton pendingLabel="Saving…">{item ? "Save changes" : "Add item"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

function GoToSaved() {
  const result = useFormResult();
  const router = useRouter();
  React.useEffect(() => {
    if (result?.ok && result.data?.href) {
      router.push(`${result.data.href}?saved=${encodeURIComponent(result.message ?? "Saved.")}`);
    }
  }, [result, router]);
  return null;
}

function trim(value: string) {
  return value.replace(/\.?0+$/, "") || "0";
}
