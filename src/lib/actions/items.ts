"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { items } from "@/lib/db/schema";
import { ReadOnlyError, requireMember } from "@/lib/auth/session";
import { AccessDenied, assertCustomer, assertStaff } from "@/lib/access";
import { pushItem } from "@/lib/xero/push";
import { pushItemLater } from "@/lib/xero/queue";
import { fail, fromZod, logActivity, optionalText, optionalUuid, type ActionState } from "./shared";

/**
 * The item catalogue. Saving an item also saves it in Xero (as an untracked
 * Item, with its accounts and tax types), after the response — a slow or
 * disconnected Xero never stops the item saving here.
 */

const price = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : String(v).replace(/[$,\s]/g, "")),
  z
    .string()
    .regex(/^\d*(\.\d{0,4})?$/, "Use a price like 12.50 — up to four decimal places.")
    .nullable(),
);

const itemSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Give the item a code.")
    .max(30, "Xero item codes stop at 30 characters."),
  name: z.string().trim().min(1, "Give the item a name.").max(50, "Xero item names stop at 50 characters."),
  description: optionalText,
  purchaseDescription: optionalText,
  unit: optionalText,
  tracksStock: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  isSold: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  isPurchased: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  salePrice: price,
  purchasePrice: price,
  salesAccountCode: optionalText,
  purchaseAccountCode: optionalText,
  salesTaxType: optionalText,
  purchaseTaxType: optionalText,
  preferredSupplierId: optionalUuid,
});

async function guarded(run: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ReadOnlyError || error instanceof AccessDenied) return fail(error.message);
    throw error;
  }
}

export async function saveItem(
  itemId: string | null,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireMember();
    await assertStaff();
    const parsed = itemSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fromZod(parsed.error);
    const values = parsed.data;
    if (!values.isSold && !values.isPurchased) {
      return fail("An item has to be sold, bought, or both.");
    }
    if (values.preferredSupplierId) await assertCustomer(values.preferredSupplierId);

    const db = getDb();
    const [clash] = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.code, values.code), itemId ? ne(items.id, itemId) : undefined))
      .limit(1);
    if (clash) return fail(`Another item already uses the code ${values.code}.`, { code: ["Already in use"] });

    const [saved] = itemId
      ? await db
          .update(items)
          .set({ ...values, xeroSyncState: "pending", xeroError: null, updatedAt: new Date() })
          .where(eq(items.id, itemId))
          .returning()
      : await db
          .insert(items)
          .values({ ...values, xeroSyncState: "pending", createdById: user.id })
          .returning();
    if (!saved) return fail("That item no longer exists.");

    await logActivity({
      entityType: "item",
      entityId: saved.id,
      verb: itemId ? "item_updated" : "item_created",
      summary: `${itemId ? "Updated" : "Added"} item ${saved.code}`,
    });
    // Awaited for a moment, so the page usually opens already synced.
    const outcome = await Promise.race([
      pushItem(saved.id),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
    ]);
    if (outcome === null) pushItemLater(saved.id);

    revalidatePath("/sales/items");
    revalidatePath(`/sales/items/${saved.id}`);
    return {
      ok: true,
      message:
        outcome?.state === "synced"
          ? "Saved, and saved in Xero."
          : outcome?.message
            ? `Saved. Not in Xero yet: ${outcome.message}`
            : "Saved.",
      data: { id: saved.id, href: `/sales/items/${saved.id}` },
    };
  });
}

export async function archiveItem(itemId: string, archived: boolean): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    await assertStaff();
    await getDb()
      .update(items)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(items.id, itemId));
    revalidatePath("/sales/items");
    revalidatePath(`/sales/items/${itemId}`);
    return { ok: true, message: archived ? "Archived. It won't be offered on new lines." : "Restored." };
  });
}

/** Push one item again now. */
export async function syncItem(itemId: string): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    await assertStaff();
    const outcome = await pushItem(itemId);
    revalidatePath(`/sales/items/${itemId}`);
    revalidatePath("/sales/items");
    return outcome.state === "synced"
      ? { ok: true, message: "Saved in Xero." }
      : fail(outcome.message ?? "Xero did not take it.");
  });
}

/** Admin: push every live item, matching existing Xero items by code. */
export async function syncAllItems(): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    await assertStaff();
    const rows = await getDb().select({ id: items.id }).from(items).where(isNull(items.archivedAt));
    let ok = 0;
    let firstError: string | null = null;
    // Serial: Xero allows five concurrent calls, and each item is two.
    for (const { id } of rows.slice(0, 25)) {
      const outcome = await pushItem(id);
      if (outcome.state === "synced") ok += 1;
      else firstError ??= outcome.message;
    }
    for (const { id } of rows.slice(25)) pushItemLater(id);
    revalidatePath("/sales/items");
    if (firstError && ok === 0) return fail(firstError);
    return {
      ok: true,
      message:
        rows.length > 25
          ? `Synced ${ok}; the other ${rows.length - 25} are going in the background.`
          : `Synced ${ok} of ${rows.length}.${firstError ? ` First problem: ${firstError}` : ""}`,
    };
  });
}
