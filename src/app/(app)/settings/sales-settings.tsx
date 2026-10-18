"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { ActionForm, SaveIndicator, SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { CheckboxField, FormRow, FormSection, SelectField, TextAreaField, TextField } from "@/components/app/form-kit";
import { refreshXeroPickers, saveSalesSettings, syncXeroNow } from "@/lib/actions/sales-settings";
import type { ActionState } from "@/lib/actions/shared";
import type { Settings } from "@/lib/db/schema";
import {
  accountLabel,
  isPurchaseAccount,
  isSalesAccount,
  taxLabel,
  type XeroAccountRef,
  type XeroTaxRateRef,
  type XeroThemeRef,
} from "@/lib/sales/xero-refs";
import { cn, formatDateTime } from "@/lib/utils";

/** Settings → Sales & Xero: defaults, numbering and sync health. Admin only. */
export function SalesSettings({
  settings,
  accounts,
  taxRates,
  themes,
  refsFetchedAt,
  soSeries,
  problems,
  connected,
}: {
  settings: Settings | null;
  accounts: XeroAccountRef[];
  taxRates: XeroTaxRateRef[];
  themes: XeroThemeRef[];
  refsFetchedAt: Date | null;
  soSeries: { prefix: string; nextValue: number };
  problems: number;
  connected: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ActionState | null>(null);

  const act = (name: string, fn: () => Promise<ActionState>) => {
    setBusy(name);
    start(async () => {
      setResult(await fn());
      setBusy(null);
      router.refresh();
    });
  };

  const accountOptions = (list: XeroAccountRef[], current: string | null | undefined) => [
    { value: "", label: list.length ? "Choose an account" : "Read Xero's accounts first" },
    ...(current && !list.some((a) => a.code === current) ? [{ value: current, label: current }] : []),
    ...list.map((a) => ({ value: a.code, label: accountLabel(a) })),
  ];
  const taxOptions = (list: XeroTaxRateRef[]) => [
    { value: "", label: "Xero's standard rate" },
    ...list.map((t) => ({ value: t.taxType, label: taxLabel(t) })),
  ];
  const themeOptions = [
    { value: "", label: themes.length ? "Xero's default" : "Read Xero first" },
    ...themes.map((t) => ({ value: t.id, label: t.name })),
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
        <p className="text-[12px] leading-5 text-[var(--text-muted)]">
          {refsFetchedAt
            ? `Accounts and tax rates read from Xero ${formatDateTime(refsFetchedAt)}.`
            : "Xero's accounts and tax rates have not been read yet."}{" "}
          {problems > 0 ? (
            <Link href="/sales/invoices?xero=problems&status=all" className="font-medium text-[var(--danger)] hover:underline underline-offset-2">
              {problems} {problems === 1 ? "document needs" : "documents need"} attention in Xero.
            </Link>
          ) : connected ? (
            "Nothing is stuck."
          ) : null}
        </p>
        <span className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={pending || !connected} onClick={() => act("refs", refreshXeroPickers)}>
            {busy === "refs" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Read accounts
          </Button>
          <Button size="sm" variant="ghost" disabled={pending || !connected} onClick={() => act("sync", syncXeroNow)}>
            {busy === "sync" ? <Loader2 className="animate-spin" /> : null}
            Sync now
          </Button>
        </span>
      </div>
      {result?.message ? (
        <p role={result.ok ? "status" : "alert"} className={cn("text-[12px]", result.ok ? "text-[var(--ok)]" : "text-[var(--danger)]")}>
          {result.message}
        </p>
      ) : null}

      <ActionForm action={saveSalesSettings} className="flex flex-col gap-6">
        <FormSection title="Default accounts" description="Used when an item does not name its own. Items can override both.">
          <FormRow cols={2}>
            <SelectField
              name="defaultSalesAccount"
              label="Sales"
              defaultValue={settings?.defaultSalesAccount ?? ""}
              options={accountOptions(accounts.filter(isSalesAccount), settings?.defaultSalesAccount)}
            />
            <SelectField
              name="defaultPurchaseAccount"
              label="Purchases"
              defaultValue={settings?.defaultPurchaseAccount ?? ""}
              options={accountOptions(accounts.filter(isPurchaseAccount), settings?.defaultPurchaseAccount)}
            />
          </FormRow>
          <FormRow cols={2}>
            <SelectField
              name="defaultSalesTaxType"
              label="Sales tax"
              defaultValue={settings?.defaultSalesTaxType ?? ""}
              options={taxOptions(taxRates.filter((t) => t.canApplyToRevenue))}
            />
            <SelectField
              name="defaultPurchaseTaxType"
              label="Purchase tax"
              defaultValue={settings?.defaultPurchaseTaxType ?? ""}
              options={taxOptions(taxRates.filter((t) => t.canApplyToExpenses))}
            />
          </FormRow>
        </FormSection>

        <FormSection title="Branding themes" description="Which Xero theme each document is created with.">
          <FormRow cols={3}>
            <SelectField name="quoteBrandingThemeId" label="Quotes" defaultValue={settings?.quoteBrandingThemeId ?? ""} options={themeOptions} />
            <SelectField name="invoiceBrandingThemeId" label="Invoices" defaultValue={settings?.invoiceBrandingThemeId ?? ""} options={themeOptions} />
            <SelectField name="poBrandingThemeId" label="Purchase orders" defaultValue={settings?.poBrandingThemeId ?? ""} options={themeOptions} />
          </FormRow>
        </FormSection>

        <FormSection title="Terms">
          <FormRow cols={3}>
            <TextField name="customerTermsDays" label="Customers pay within (days)" type="number" min={0} defaultValue={String(settings?.customerTermsDays ?? 14)} />
            <TextField name="supplierTermsDays" label="We pay suppliers within (days)" type="number" min={0} defaultValue={String(settings?.supplierTermsDays ?? 30)} />
            <TextField name="quoteValidityDays" label="Quotes are valid for (days)" type="number" min={1} defaultValue={String(settings?.quoteValidityDays ?? 30)} />
          </FormRow>
          <TextAreaField
            name="deliveryAddress"
            label="Our delivery address"
            rows={2}
            hint="Where suppliers deliver to, unless a purchase order says otherwise"
            defaultValue={settings?.deliveryAddress ?? ""}
          />
          <CheckboxField
            name="allowBillApproval"
            label="The Gangway may approve supplier bills"
            hint="Off leaves bills as Xero drafts for whoever does accounts."
            defaultChecked={settings?.allowBillApproval ?? true}
          />
        </FormSection>

        <FormSection title="Sales order numbers" description="Quotes and invoices take Xero's numbers. Sales orders are numbered here.">
          <FormRow cols={3}>
            <TextField name="soPrefix" label="Prefix" defaultValue={soSeries.prefix} />
            <TextField name="soNext" label="Next number" type="number" min={1} defaultValue={String(soSeries.nextValue)} />
          </FormRow>
        </FormSection>

        <div className="flex items-center justify-end gap-3">
          <SaveIndicator />
          <SubmitButton>Save</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
