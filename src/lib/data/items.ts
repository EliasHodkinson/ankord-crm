import "server-only";
import { and, asc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { customers, items, settings } from "@/lib/db/schema";
import { requireStaffPage } from "@/lib/access";
import { FALLBACK_PURCHASE_TAX, FALLBACK_SALES_TAX } from "@/lib/sales/xero-refs";
import { taxRateMap } from "./xero-cache";

/**
 * The item catalogue. Staff-only: it carries buy prices, which are not part
 * of what a partner grant shares.
 */

export async function listItems(filter: { q?: string; show?: string } = {}) {
  await requireStaffPage();
  const where: SQL[] = [];
  if (filter.show !== "archived") where.push(isNull(items.archivedAt));
  if (filter.show === "stock") where.push(eq(items.tracksStock, true));
  if (filter.show === "services") where.push(eq(items.tracksStock, false));
  if (filter.q) {
    where.push(
      or(
        ilike(items.code, `%${filter.q}%`),
        ilike(items.name, `%${filter.q}%`),
        ilike(items.description, `%${filter.q}%`),
      )!,
    );
  }
  return getDb()
    .select({ item: items, supplierName: customers.name })
    .from(items)
    .leftJoin(customers, eq(customers.id, items.preferredSupplierId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(items.code))
    .limit(500);
}

export async function getItem(id: string) {
  await requireStaffPage();
  const [row] = await getDb().select().from(items).where(eq(items.id, id));
  return row ?? null;
}

export type PricedItem = {
  itemId: string;
  code: string;
  name: string;
  description: string;
  unit: string | null;
  tracksStock: boolean;
  unitPrice: string;
  /** No price set on the item: shown as missing, never guessed (EduCom rule). */
  priceMissing: boolean;
  accountCode: string | null;
  taxType: string;
  taxRate: string;
};

/**
 * What a line for each item should default to on one side of the business.
 * One price per item (Q8: no customer price lists); the tax type and account
 * fall back to the settings defaults.
 */
export async function priceItems(
  itemIds: string[],
  side: "customer" | "supplier",
): Promise<Map<string, PricedItem>> {
  if (itemIds.length === 0) return new Map();
  const db = getDb();
  const [rows, [config], rates] = await Promise.all([
    db.select().from(items).where(inArray(items.id, itemIds)),
    db.select().from(settings).where(eq(settings.id, "singleton")),
    taxRateMap(),
  ]);

  const sales = side === "customer";
  return new Map(
    rows.map((item) => {
      const price = sales ? item.salePrice : item.purchasePrice;
      const taxType =
        (sales ? item.salesTaxType : item.purchaseTaxType) ??
        (sales ? config?.defaultSalesTaxType : config?.defaultPurchaseTaxType) ??
        (sales ? FALLBACK_SALES_TAX : FALLBACK_PURCHASE_TAX);
      return [
        item.id,
        {
          itemId: item.id,
          code: item.code,
          name: item.name,
          description:
            (sales ? item.description : (item.purchaseDescription ?? item.description)) ??
            item.name,
          unit: item.unit,
          tracksStock: item.tracksStock,
          unitPrice: price ?? "0",
          priceMissing: price === null,
          accountCode:
            (sales ? item.salesAccountCode : item.purchaseAccountCode) ??
            (sales ? config?.defaultSalesAccount : config?.defaultPurchaseAccount) ??
            null,
          taxType,
          taxRate: rates.get(taxType) ?? "0",
        },
      ];
    }),
  );
}
