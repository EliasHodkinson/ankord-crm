import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { readXeroRefs } from "@/lib/data/xero-cache";
import { isPurchaseAccount, isSalesAccount } from "@/lib/sales/xero-refs";

/** What the item form's pickers offer. */
export async function itemFormOptions() {
  const [refs, suppliers] = await Promise.all([
    readXeroRefs(),
    getDb()
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.isSupplier, true), isNull(customers.archivedAt)))
      .orderBy(asc(customers.name)),
  ]);
  return {
    salesAccounts: refs.accounts.filter(isSalesAccount),
    purchaseAccounts: refs.accounts.filter(isPurchaseAccount),
    salesTax: refs.taxRates.filter((t) => t.canApplyToRevenue),
    purchaseTax: refs.taxRates.filter((t) => t.canApplyToExpenses),
    suppliers,
    xeroReady: refs.accounts.length > 0,
  };
}
