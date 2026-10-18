import "server-only";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { getDb, withTransaction } from "@/lib/db";
import { documents, settings, type Document } from "@/lib/db/schema";
import { baseLinesOf, recomputeCounters } from "@/lib/actions/documents-core";
import { toCents } from "@/lib/sales/money";
import { parseXeroDate, xeroSend } from "./client";

/**
 * Reading Xero back (spec §8.6). Gangway owns lines and quantities; Xero owns
 * numbers, sent/approved status and money. So the pull copies status and
 * amounts, and never lines.
 *
 * What it does not do is mirror a void: a document voided or deleted in Xero
 * while it is still open here is flagged for a person, not silently cancelled.
 */

type XeroQuote = {
  QuoteID: string;
  QuoteNumber?: string;
  Status?: string;
  Total?: number;
  UpdatedDateUTC?: string;
};

type XeroInvoice = {
  InvoiceID: string;
  InvoiceNumber?: string;
  Status?: string;
  Total?: number;
  AmountPaid?: number;
  AmountDue?: number;
  UpdatedDateUTC?: string;
};

const GONE = new Set(["VOIDED", "DELETED"]);

function goneMessage(status: string, kind: string) {
  return `${status === "VOIDED" ? "Voided" : "Deleted"} in Xero but still live here. Cancel the ${kind} here too, or re-push it.`;
}

/** Applies one quote's Xero state. Returns true if anything changed. */
async function applyQuote(doc: Document, x: XeroQuote): Promise<boolean> {
  const status = x.Status ?? doc.xeroStatus ?? "DRAFT";
  const patch: Partial<Document> = {
    xeroStatus: status,
    xeroUpdatedAt: parseXeroDate(x.UpdatedDateUTC),
    xeroTotal: x.Total !== undefined ? String(x.Total) : doc.xeroTotal,
    number: doc.number ?? x.QuoteNumber ?? null,
  };

  if (GONE.has(status) && doc.status !== "cancelled") {
    patch.xeroSyncState = "failed";
    patch.xeroError = goneMessage(status, "quote");
  } else if (doc.status === "draft" && status !== "DRAFT") {
    patch.status = "open";
    patch.issuedAt = doc.issuedAt ?? new Date();
  }
  if ((status === "ACCEPTED" || status === "INVOICED") && doc.quoteOutcome !== "accepted") {
    patch.quoteOutcome = "accepted";
    if (doc.status === "draft") patch.status = "open";
  }
  if (status === "DECLINED" && doc.status !== "cancelled" && doc.quoteOutcome !== "declined") {
    patch.quoteOutcome = "declined";
    patch.status = "closed";
    patch.closedAt = new Date();
    patch.closedBy = "auto";
  }

  await getDb().update(documents).set(patch).where(eq(documents.id, doc.id));
  return patch.status !== undefined || patch.quoteOutcome !== undefined;
}

/** Applies one invoice's Xero state. Returns true if anything changed. */
async function applyInvoice(doc: Document, x: XeroInvoice): Promise<boolean> {
  const status = x.Status ?? doc.xeroStatus ?? "DRAFT";
  const patch: Partial<Document> = {
    xeroStatus: status,
    xeroUpdatedAt: parseXeroDate(x.UpdatedDateUTC),
    xeroTotal: x.Total !== undefined ? String(x.Total) : doc.xeroTotal,
    number: doc.number ?? x.InvoiceNumber ?? null,
    amountPaid: x.AmountPaid !== undefined ? String(x.AmountPaid) : doc.amountPaid,
    amountDue: x.AmountDue !== undefined ? String(x.AmountDue) : doc.amountDue,
  };

  let approvedHere = false;
  if (GONE.has(status) && doc.status !== "cancelled") {
    patch.xeroSyncState = "failed";
    patch.xeroError = goneMessage(status, "invoice");
  } else if (doc.status === "draft" && (status === "AUTHORISED" || status === "PAID")) {
    // Approved in Xero: lock it here too, and let its goods go out.
    patch.status = status === "PAID" ? "closed" : "open";
    patch.issuedAt = doc.issuedAt ?? new Date();
    approvedHere = true;
  }
  if (status === "PAID" && doc.status === "open") {
    patch.status = "closed";
    patch.closedAt = new Date();
    patch.closedBy = "auto";
  }
  if (status === "AUTHORISED" && doc.status === "closed" && doc.closedBy === "auto") {
    // A payment was removed in Xero.
    patch.status = "open";
    patch.closedAt = null;
    patch.closedBy = null;
  }

  if (approvedHere) {
    // The status change and the delivery counters it implies land together.
    await withTransaction(async (tx) => {
      await tx.update(documents).set(patch).where(eq(documents.id, doc.id));
      await recomputeCounters(tx, await baseLinesOf(tx, [doc.id]));
    });
  } else {
    await getDb().update(documents).set(patch).where(eq(documents.id, doc.id));
  }

  const moneyChanged =
    toCents(patch.amountPaid ?? "0") !== toCents(doc.amountPaid) ||
    patch.status !== undefined;
  return moneyChanged;
}

/** Linked documents that are still worth watching. */
async function linked(type: "quote" | "invoice", ids?: string[]) {
  return getDb()
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.type, type),
        isNotNull(documents.xeroId),
        ids ? inArray(documents.id, ids) : ne(documents.status, "cancelled"),
      ),
    );
}

/**
 * Refreshes the given documents (or every live linked one) from Xero.
 * Invoices go in batches by ID; quotes, which Xero cannot fetch by a list of
 * IDs, come from one listing filtered by If-Modified-Since when `since` is
 * given, otherwise one by one.
 */
export async function pullDocuments(options: { ids?: string[]; since?: Date | null } = {}) {
  let changed = 0;

  const invoiceDocs = await linked("invoice", options.ids);
  for (let i = 0; i < invoiceDocs.length; i += 40) {
    const batch = invoiceDocs.slice(i, i + 40);
    const data = await xeroSend<{ Invoices?: XeroInvoice[] }>(
      "GET",
      `/Invoices?IDs=${batch.map((d) => d.xeroId).join(",")}&summaryOnly=true`,
    );
    const byId = new Map((data.Invoices ?? []).map((x) => [x.InvoiceID, x]));
    for (const doc of batch) {
      const x = byId.get(doc.xeroId!);
      if (x && (await applyInvoice(doc, x))) changed += 1;
    }
  }

  const quoteDocs = await linked("quote", options.ids);
  if (quoteDocs.length) {
    const byDoc = new Map(quoteDocs.map((d) => [d.xeroId!, d]));
    if (!options.ids && options.since) {
      const data = await xeroSend<{ Quotes?: XeroQuote[] }>("GET", "/Quotes?page=1", undefined, {
        headers: { "if-modified-since": options.since.toUTCString() },
      });
      for (const x of data.Quotes ?? []) {
        const doc = byDoc.get(x.QuoteID);
        if (doc && (await applyQuote(doc, x))) changed += 1;
      }
    } else {
      for (const doc of quoteDocs.slice(0, 20)) {
        const data = await xeroSend<{ Quotes?: XeroQuote[] }>("GET", `/Quotes/${doc.xeroId}`);
        const x = data.Quotes?.[0];
        if (x && (await applyQuote(doc, x))) changed += 1;
      }
    }
  }

  return { changed, invoices: invoiceDocs.length, quotes: quoteDocs.length };
}

/** The scheduled pull: everything changed since the last one. */
export async function pullChanged() {
  const db = getDb();
  const [row] = await db
    .select({ at: settings.xeroLastPullAt })
    .from(settings)
    .where(eq(settings.id, "singleton"));
  const startedAt = new Date();
  // A minute of overlap so nothing changed during the last pull slips through.
  const since = row?.at ? new Date(row.at.getTime() - 60_000) : null;
  const result = await pullDocuments({ since });
  await db
    .update(settings)
    .set({ xeroLastPullAt: startedAt })
    .where(eq(settings.id, "singleton"));
  return result;
}
