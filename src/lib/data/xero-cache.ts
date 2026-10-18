import "server-only";
import { cache } from "react";
import { inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { xeroCache } from "@/lib/db/schema";
import {
  FALLBACK_TAX_RATES,
  type XeroAccountRef,
  type XeroTaxRateRef,
  type XeroThemeRef,
} from "@/lib/sales/xero-refs";

/**
 * Xero's accounts, tax rates and branding themes, as last read. Reading never
 * calls Xero: the cache is filled by lib/xero/reference-data.ts (daily from
 * the cron, and on demand from Settings), so a page that needs a picker opens
 * just as fast with Xero down.
 */

export type XeroRefs = {
  accounts: XeroAccountRef[];
  taxRates: XeroTaxRateRef[];
  themes: XeroThemeRef[];
  /** When the cache was last filled; null means it never has been. */
  fetchedAt: Date | null;
};

export const readXeroRefs = cache(async (): Promise<XeroRefs> => {
  const rows = await getDb()
    .select()
    .from(xeroCache)
    .where(inArray(xeroCache.key, ["accounts", "tax_rates", "branding_themes"]));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const taxRates = (byKey.get("tax_rates")?.data as XeroTaxRateRef[] | undefined) ?? [];
  return {
    accounts: (byKey.get("accounts")?.data as XeroAccountRef[] | undefined) ?? [],
    taxRates: taxRates.length ? taxRates : FALLBACK_TAX_RATES,
    themes: (byKey.get("branding_themes")?.data as XeroThemeRef[] | undefined) ?? [],
    fetchedAt: byKey.get("accounts")?.fetchedAt ?? null,
  };
});

/** Tax type → effective rate, for snapshotting onto a line. */
export async function taxRateMap(): Promise<Map<string, string>> {
  const { taxRates } = await readXeroRefs();
  const map = new Map(FALLBACK_TAX_RATES.map((t) => [t.taxType, t.rate]));
  for (const t of taxRates) map.set(t.taxType, t.rate);
  return map;
}
