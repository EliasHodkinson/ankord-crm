"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { numberSeries, settings } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { refreshXeroReferenceData } from "@/lib/xero/reference-data";
import { pullChanged } from "@/lib/xero/pull";
import { drainQueue } from "@/lib/xero/push";
import { XeroAuthError } from "@/lib/xero/auth";
import { XeroApiError } from "@/lib/xero/client";
import { fail, fromZod, optionalText, type ActionState } from "./shared";

/** Settings → Sales & Xero. Admin only (Q9). */

const days = (label: string) =>
  z.coerce.number().int(`${label} must be whole days.`).min(0, `${label} can't be negative.`).max(365);

const salesSchema = z.object({
  defaultSalesAccount: optionalText,
  defaultPurchaseAccount: optionalText,
  defaultSalesTaxType: optionalText,
  defaultPurchaseTaxType: optionalText,
  quoteBrandingThemeId: optionalText,
  invoiceBrandingThemeId: optionalText,
  poBrandingThemeId: optionalText,
  deliveryAddress: optionalText,
  customerTermsDays: days("Customer terms"),
  supplierTermsDays: days("Supplier terms"),
  quoteValidityDays: days("Quote validity").min(1, "A quote has to be valid for at least a day."),
  allowBillApproval: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  soPrefix: z.string().trim().min(1, "Give sales orders a prefix.").max(10),
  soNext: z.coerce.number().int().min(1),
});

export async function saveSalesSettings(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireAdmin();
  const parsed = salesSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);
  const { soPrefix, soNext, ...values } = parsed.data;

  const db = getDb();
  await db
    .insert(settings)
    .values({ id: "singleton", ...values, updatedById: user.id })
    .onConflictDoUpdate({
      target: settings.id,
      set: { ...values, updatedById: user.id, updatedAt: new Date() },
    });

  // The series may only move forward: a number already used must never come round again.
  const [series] = await db.select().from(numberSeries).where(eq(numberSeries.key, "sales_order"));
  if (series && soNext < series.nextValue) {
    return fail(`Sales orders are already up to ${series.nextValue - 1}; the next number can't go back below ${series.nextValue}.`, {
      soNext: ["Too low"],
    });
  }
  await db
    .update(numberSeries)
    .set({ prefix: soPrefix, nextValue: soNext })
    .where(eq(numberSeries.key, "sales_order"));

  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}

/** Re-read Xero's accounts, tax rates and branding themes for the pickers. */
export async function refreshXeroPickers(): Promise<ActionState> {
  await requireAdmin();
  try {
    const counts = await refreshXeroReferenceData();
    revalidatePath("/settings");
    revalidatePath("/sales/items", "layout");
    return {
      ok: true,
      message: `Read ${counts.accounts} accounts, ${counts.taxRates} tax rates and ${counts.themes} branding themes from Xero.`,
    };
  } catch (error) {
    if (error instanceof XeroAuthError || error instanceof XeroApiError) return fail(error.message);
    throw error;
  }
}

/** Run the sync now instead of waiting for the cron: pull, then push the queue. */
export async function syncXeroNow(): Promise<ActionState> {
  await requireAdmin();
  try {
    const pulled = await pullChanged();
    const pushed = await drainQueue(30);
    revalidatePath("/settings");
    revalidatePath("/sales", "layout");
    return {
      ok: true,
      message: `Checked ${pulled.quotes + pulled.invoices} documents in Xero (${pulled.changed} changed) and pushed ${pushed.pushed}.`,
    };
  } catch (error) {
    if (error instanceof XeroAuthError || error instanceof XeroApiError) return fail(error.message);
    throw error;
  }
}
