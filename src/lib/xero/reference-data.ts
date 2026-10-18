import "server-only";
import { getDb } from "@/lib/db";
import { xeroCache } from "@/lib/db/schema";
import type { XeroAccountRef, XeroTaxRateRef, XeroThemeRef } from "@/lib/sales/xero-refs";
import { xeroSend } from "./client";

/**
 * Reads Xero's accounts, tax rates and branding themes into xero_cache. Three
 * calls, run in series to stay well inside Xero's concurrency limit.
 */
export async function refreshXeroReferenceData(): Promise<{
  accounts: number;
  taxRates: number;
  themes: number;
}> {
  const accounts = await xeroSend<{
    Accounts?: { Code?: string; Name: string; Type: string; Class?: string; Status?: string }[];
  }>("GET", `/Accounts?where=${encodeURIComponent('Status=="ACTIVE"')}`);

  const taxRates = await xeroSend<{
    TaxRates?: {
      TaxType: string;
      Name: string;
      EffectiveRate?: number;
      Status?: string;
      CanApplyToRevenue?: boolean;
      CanApplyToExpenses?: boolean;
    }[];
  }>("GET", "/TaxRates");

  const themes = await xeroSend<{
    BrandingThemes?: { BrandingThemeID: string; Name: string }[];
  }>("GET", "/BrandingThemes");

  const accountRows: XeroAccountRef[] = (accounts.Accounts ?? [])
    // Bank accounts can lack a code; a line cannot be coded to one anyway.
    .filter((a) => a.Code)
    .map((a) => ({ code: a.Code!, name: a.Name, type: a.Type, class: a.Class ?? "" }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const taxRows: XeroTaxRateRef[] = (taxRates.TaxRates ?? [])
    .filter((t) => (t.Status ?? "ACTIVE") === "ACTIVE")
    .map((t) => ({
      taxType: t.TaxType,
      name: t.Name,
      rate: String(t.EffectiveRate ?? 0),
      canApplyToRevenue: t.CanApplyToRevenue ?? true,
      canApplyToExpenses: t.CanApplyToExpenses ?? true,
    }));

  const themeRows: XeroThemeRef[] = (themes.BrandingThemes ?? []).map((t) => ({
    id: t.BrandingThemeID,
    name: t.Name,
  }));

  const db = getDb();
  const now = new Date();
  for (const [key, data] of [
    ["accounts", accountRows],
    ["tax_rates", taxRows],
    ["branding_themes", themeRows],
  ] as const) {
    await db
      .insert(xeroCache)
      .values({ key, data, fetchedAt: now })
      .onConflictDoUpdate({ target: xeroCache.key, set: { data, fetchedAt: now } });
  }

  return { accounts: accountRows.length, taxRates: taxRows.length, themes: themeRows.length };
}
