import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { items, type Item } from "@/lib/db/schema";
import { fromScaled, toScaled } from "@/lib/sales/money";
import { xeroGet } from "./read";

/**
 * Xero Items → the item catalogue, keyed by Xero's ItemID and then by Code.
 *
 * Xero owns what it holds — code, name, descriptions, prices, accounts, tax
 * types, sold/purchased. Gangway keeps what Xero has no field for: whether the
 * item tracks stock, its unit and its usual supplier. Re-running updates in
 * place, and leaves alone an item edited here that has not reached Xero yet,
 * so the import never undoes someone's unsent change.
 */

type RawItem = {
  ItemID: string;
  Code: string;
  Name?: string;
  Description?: string;
  PurchaseDescription?: string;
  IsSold?: boolean;
  IsPurchased?: boolean;
  SalesDetails?: { UnitPrice?: number; AccountCode?: string; TaxType?: string };
  PurchaseDetails?: { UnitPrice?: number; AccountCode?: string; TaxType?: string };
};

export type ItemFields = Pick<
  Item,
  | "code"
  | "name"
  | "description"
  | "purchaseDescription"
  | "isSold"
  | "isPurchased"
  | "salePrice"
  | "purchasePrice"
  | "salesAccountCode"
  | "purchaseAccountCode"
  | "salesTaxType"
  | "purchaseTaxType"
>;

export type ItemReviewRow = {
  xeroItemId: string;
  fields: ItemFields;
  existing: { id: string; code: string } | null;
  plan: "create" | "update" | "unchanged" | "held" | "conflict";
  note: string | null;
};

const clean = (value?: string) => value?.trim() || null;
const price = (value?: number) => (value === undefined || value === null ? null : fromScaled(toScaled(value)));

function fieldsOf(raw: RawItem): ItemFields {
  const code = raw.Code.trim().slice(0, 30);
  return {
    code,
    name: (clean(raw.Name) ?? code).slice(0, 50),
    description: clean(raw.Description),
    purchaseDescription: clean(raw.PurchaseDescription),
    // Xero sets neither on an item made only for its code; it is still sold.
    isSold: raw.IsSold ?? !raw.IsPurchased,
    isPurchased: Boolean(raw.IsPurchased),
    salePrice: price(raw.SalesDetails?.UnitPrice),
    purchasePrice: price(raw.PurchaseDetails?.UnitPrice),
    salesAccountCode: clean(raw.SalesDetails?.AccountCode),
    purchaseAccountCode: clean(raw.PurchaseDetails?.AccountCode),
    salesTaxType: clean(raw.SalesDetails?.TaxType),
    purchaseTaxType: clean(raw.PurchaseDetails?.TaxType),
  };
}

/** numeric(14,4) comes back as "12.5000"; compare as numbers of record, not text. */
const same = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" && /^-?\d+(\.\d+)?$/.test(a) && /^-?\d+(\.\d+)?$/.test(b)
    ? toScaled(a) === toScaled(b)
    : (a ?? null) === (b ?? null);

export async function itemReview(): Promise<ItemReviewRow[]> {
  const [data, local] = await Promise.all([
    xeroGet<{ Items?: RawItem[] }>("/Items?unitdp=4"),
    getDb().select().from(items),
  ]);
  const byXeroId = new Map(local.filter((i) => i.xeroItemId).map((i) => [i.xeroItemId!, i]));
  const byCode = new Map(local.map((i) => [i.code.toLowerCase(), i]));

  return (data.Items ?? [])
    .filter((raw) => raw.Code?.trim())
    .map((raw): ItemReviewRow => {
      const fields = fieldsOf(raw);
      const existing = byXeroId.get(raw.ItemID) ?? byCode.get(fields.code.toLowerCase()) ?? null;
      const base = { xeroItemId: raw.ItemID, fields, existing: existing ? { id: existing.id, code: existing.code } : null };

      if (!existing) return { ...base, plan: "create", note: null };
      if (existing.xeroItemId && existing.xeroItemId !== raw.ItemID) {
        return { ...base, plan: "conflict", note: `${existing.code} here is linked to a different Xero item.` };
      }
      if (existing.xeroItemId === raw.ItemID && existing.code !== fields.code && byCode.get(fields.code.toLowerCase())) {
        return { ...base, plan: "conflict", note: `Xero renamed it to ${fields.code}, which another item here already uses.` };
      }
      if (existing.xeroSyncState !== "synced") {
        return {
          ...base,
          plan: "held",
          note: "Saved here but not in Xero yet, so it is left as it is. It matches this Xero item by code when it syncs.",
        };
      }
      const changed = (Object.keys(fields) as (keyof ItemFields)[]).some((k) => !same(existing[k], fields[k]));
      return {
        ...base,
        plan: changed || existing.xeroItemId !== raw.ItemID ? "update" : "unchanged",
        note: !existing.xeroItemId ? "Same code here; it will be linked to the Xero item." : null,
      };
    })
    .sort((a, b) => a.fields.code.localeCompare(b.fields.code, undefined, { numeric: true }));
}

/** Applies the review. Returns how many were created and updated. */
export async function importItems(userId: string): Promise<{ created: number; updated: number; held: number }> {
  const db = getDb();
  const rows = await itemReview();
  let created = 0;
  let updated = 0;
  let held = 0;
  const now = new Date();
  // Marked synced: they came from Xero, so there is nothing to push back.
  const synced = { xeroSyncState: "synced" as const, xeroError: null, xeroSyncedAt: now };

  for (const row of rows) {
    if (row.plan === "held" || row.plan === "conflict") {
      held += 1;
      continue;
    }
    if (row.plan === "create") {
      await db.insert(items).values({ ...row.fields, xeroItemId: row.xeroItemId, ...synced, createdById: userId });
      created += 1;
    } else if (row.plan === "update" && row.existing) {
      await db
        .update(items)
        .set({ ...row.fields, xeroItemId: row.xeroItemId, ...synced, updatedAt: now })
        .where(eq(items.id, row.existing.id));
      updated += 1;
    }
  }
  return { created, updated, held };
}
