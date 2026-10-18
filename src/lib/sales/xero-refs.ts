/**
 * Shapes of the Xero reference data the pickers show, and the fallbacks used
 * before Xero has ever been read. Client-safe.
 */

export type XeroAccountRef = {
  code: string;
  name: string;
  /** Xero account Type: REVENUE, SALES, DIRECTCOSTS, EXPENSE, INVENTORY… */
  type: string;
  /** Xero account Class: REVENUE, EXPENSE, ASSET, LIABILITY, EQUITY. */
  class: string;
};

export type XeroTaxRateRef = {
  taxType: string;
  name: string;
  /** Effective rate in percent, as a decimal string. */
  rate: string;
  /** Which side it belongs on, as far as Xero says. */
  canApplyToRevenue: boolean;
  canApplyToExpenses: boolean;
};

export type XeroThemeRef = { id: string; name: string };

/**
 * Xero's standard Australian tax types, used until /TaxRates has been read so
 * that a document can be written and totalled with Xero disconnected. Xero is
 * still the authority: once the cache fills, its list replaces this one.
 */
export const FALLBACK_TAX_RATES: XeroTaxRateRef[] = [
  { taxType: "OUTPUT", name: "GST on Income", rate: "10", canApplyToRevenue: true, canApplyToExpenses: false },
  { taxType: "EXEMPTOUTPUT", name: "GST Free Income", rate: "0", canApplyToRevenue: true, canApplyToExpenses: false },
  { taxType: "INPUT", name: "GST on Expenses", rate: "10", canApplyToRevenue: false, canApplyToExpenses: true },
  { taxType: "EXEMPTEXPENSES", name: "GST Free Expenses", rate: "0", canApplyToRevenue: false, canApplyToExpenses: true },
  { taxType: "BASEXCLUDED", name: "BAS Excluded", rate: "0", canApplyToRevenue: true, canApplyToExpenses: true },
];

export const FALLBACK_SALES_TAX = "OUTPUT";
export const FALLBACK_PURCHASE_TAX = "INPUT";

/** Accounts a sale can be coded to. */
export const isSalesAccount = (a: XeroAccountRef) => a.class === "REVENUE";

/** Accounts a purchase can be coded to: costs and expenses, or inventory (Q3). */
export const isPurchaseAccount = (a: XeroAccountRef) =>
  a.class === "EXPENSE" || a.type === "INVENTORY";

/** "200 · Sales" — how Xero people recognise an account. */
export const accountLabel = (a: Pick<XeroAccountRef, "code" | "name">) => `${a.code} · ${a.name}`;

export const taxLabel = (t: XeroTaxRateRef) => `${t.name} (${Number(t.rate)}%)`;
