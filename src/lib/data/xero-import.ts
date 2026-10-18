import "server-only";
import { asc, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { XeroAuthError } from "@/lib/xero/auth";
import { XeroApiError } from "@/lib/xero/client";
import { contactReview, type ContactReviewRow } from "@/lib/xero/import/contacts";
import { itemReview, type ItemReviewRow } from "@/lib/xero/import/items";
import { previewDocuments } from "@/lib/xero/import/documents";
import { STRONG_REASONS, normaliseName } from "@/lib/xero/import/match";
import type { DocPreviewRow, ImportScope, ImportSourceKey } from "@/lib/xero/import/scope";

/**
 * Reads for the Import from Xero screen. Each one reads Xero live — the
 * screen is the dry run — and turns a Xero failure into a message the page
 * shows, rather than an error page.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false; message: string };

async function load<T>(run: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof XeroAuthError || error instanceof XeroApiError) return { ok: false, message: error.message };
    throw error;
  }
}

export type ContactFilter = "decide" | "linked" | "skipped" | "all";

export type ContactReview = {
  rows: ContactReviewRow[];
  counts: { total: number; linked: number; strong: number; decide: number; skipped: number };
  /** Partners not linked to any Xero contact — what a contact can be linked to. */
  freePartners: { id: string; name: string }[];
};

const isLinked = (r: ContactReviewRow) => r.suggestion?.reason === "linked";

export async function loadContactReview(filters: { show?: string; q?: string }): Promise<Loaded<ContactReview>> {
  return load(async () => {
    const [all, partners] = await Promise.all([
      contactReview(),
      getDb()
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(isNull(customers.xeroContactId))
        .orderBy(asc(customers.name)),
    ]);
    const show = (["decide", "linked", "skipped", "all"].includes(filters.show ?? "") ? filters.show : "decide") as ContactFilter;
    const term = normaliseName(filters.q);
    const raw = filters.q?.trim().toLowerCase() ?? "";
    const rows = all.filter((r) => {
      if (raw && !normaliseName(r.contact.name).includes(term) && !(r.contact.email ?? "").includes(raw)) return false;
      switch (show) {
        case "linked":
          return isLinked(r);
        case "skipped":
          return r.skipped && !isLinked(r);
        case "decide":
          return !isLinked(r) && !r.skipped;
        default:
          return true;
      }
    });
    return {
      rows,
      counts: {
        total: all.length,
        linked: all.filter(isLinked).length,
        strong: all.filter((r) => !r.skipped && r.suggestion && STRONG_REASONS.has(r.suggestion.reason)).length,
        decide: all.filter((r) => !isLinked(r) && !r.skipped).length,
        skipped: all.filter((r) => r.skipped && !isLinked(r)).length,
      },
      freePartners: partners,
    };
  });
}

export async function loadItemReview(): Promise<Loaded<ItemReviewRow[]>> {
  return load(itemReview);
}

export async function loadDocumentPreview(source: ImportSourceKey, scope: ImportScope): Promise<Loaded<DocPreviewRow[]>> {
  return load(() => previewDocuments(source, scope));
}
