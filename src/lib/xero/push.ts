import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  customers,
  documentLines,
  documents,
  items,
  settings,
  xeroHistoryNotes,
  xeroSyncLog,
  type Document,
  type XeroSyncState,
} from "@/lib/db/schema";
import { DOC_TYPES, type DocType } from "@/lib/sales/doc-types";
import { computeTotals } from "@/lib/sales/totals";
import { toCents } from "@/lib/sales/money";
import { readXeroConnection, XeroAuthError } from "./auth";
import { XeroApiError, xeroSend, parseXeroDate } from "./client";
import {
  invoicePayload,
  invoiceStatusPayload,
  itemPayload,
  markerFor,
  quotePayload,
  type MapDoc,
  type MapLine,
} from "./mapping";

/**
 * Pushing Gangway documents to Xero (spec §8.5).
 *
 * The rules that make it safe:
 * - **Write locally, commit, then push.** Nothing here runs inside a
 *   transaction, and a failed push never undoes a save.
 * - **Claim first.** One UPDATE moves the row to `pushing`; whoever does not
 *   get the row back leaves it alone. A claim older than two minutes is
 *   considered abandoned.
 * - **Never create twice.** Creates carry an Idempotency-Key per version, and
 *   after an unknown outcome (timeout, network, 5xx) the next attempt reads
 *   Xero back for this document's marker before creating anything.
 * - **Never send numbers.** Xero assigns them; Gangway copies them back.
 * - **Never retry a 400 unchanged.** It stays `failed` until someone edits or
 *   presses Retry.
 */

export type PushOutcome = { state: XeroSyncState; message: string | null };

const RESOURCE: Partial<Record<DocType, "Quotes" | "Invoices">> = {
  quote: "Quotes",
  invoice: "Invoices",
};

/* ── logging ─────────────────────────────────────────────────────── */

async function log(entry: {
  entityType: string;
  entityId: string | null;
  action: string;
  httpStatus?: number | null;
  xeroId?: string | null;
  message?: string | null;
  startedAt: number;
}) {
  const { startedAt, ...rest } = entry;
  await getDb()
    .insert(xeroSyncLog)
    .values({ ...rest, durationMs: Date.now() - startedAt })
    .catch(() => {
      /* the log is a diagnostic; losing a row must never fail a push */
    });
}

/* ── preconditions ───────────────────────────────────────────────── */

class Blocked extends Error {}

async function assertConnected() {
  const connection = await readXeroConnection();
  if (!connection) throw new Blocked("Xero is not connected. An admin can connect it in Settings.");
  if (connection.missingScopes.length) {
    throw new Blocked("Reconnect Xero in Settings to let The Gangway create documents.");
  }
}

/* ── documents ───────────────────────────────────────────────────── */

type Loaded = {
  doc: Document;
  map: MapDoc;
  lines: MapLine[];
  total: string;
};

async function load(documentId: string): Promise<Loaded> {
  const db = getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new Blocked("That document no longer exists.");

  const [[partner], [config], rows, [salesOrder]] = await Promise.all([
    db
      .select({ name: customers.name, xeroContactId: customers.xeroContactId })
      .from(customers)
      .where(eq(customers.id, doc.partnerId)),
    db.select().from(settings).where(eq(settings.id, "singleton")),
    db
      .select({ line: documentLines, xeroItemId: items.xeroItemId, itemCode: items.code })
      .from(documentLines)
      .leftJoin(items, eq(items.id, documentLines.itemId))
      .where(eq(documentLines.documentId, documentId))
      .orderBy(asc(documentLines.position)),
    doc.salesOrderId
      ? db
          .select({ number: documents.number })
          .from(documents)
          .where(eq(documents.id, doc.salesOrderId))
      : Promise.resolve([] as { number: string | null }[]),
  ]);

  if (!partner?.xeroContactId) {
    throw new Blocked(
      `${partner?.name ?? "This partner"} is not linked to a Xero contact. Link it, or create it in Xero.`,
    );
  }

  const fallbackAccount =
    DOC_TYPES[doc.type].side === "customer"
      ? config?.defaultSalesAccount
      : config?.defaultPurchaseAccount;

  const totals = computeTotals(
    rows.map((r) => r.line),
    doc.amountsAre,
  );

  const lines: MapLine[] = rows.map(({ line, xeroItemId, itemCode }, i) => ({
    rowType: line.rowType,
    description: line.description,
    note: line.note,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
    accountCode: line.accountCode ?? fallbackAccount ?? null,
    taxType: line.taxType,
    xeroItemCode: xeroItemId ? (itemCode ?? null) : null,
    lineAmount: totals.lines[i].lineAmount,
    subtotalValue: totals.lines[i].subtotalValue,
  }));

  const missing = lines.findIndex((l) => l.rowType === "item" && !l.accountCode);
  if (missing >= 0) {
    throw new Blocked(
      `Line ${missing + 1} has no Xero account. Choose one on the item, or set a default in Settings → Sales & Xero.`,
    );
  }

  const theme =
    doc.type === "quote"
      ? config?.quoteBrandingThemeId
      : doc.type === "purchase_order"
        ? config?.poBrandingThemeId
        : config?.invoiceBrandingThemeId;

  return {
    doc,
    total: totals.total,
    lines,
    map: {
      id: doc.id,
      type: doc.type as MapDoc["type"],
      status: doc.status,
      quoteOutcome: doc.quoteOutcome,
      xeroId: doc.xeroId,
      xeroStatus: doc.xeroStatus,
      xeroContactId: partner.xeroContactId,
      reference: doc.reference,
      docDate: doc.docDate,
      dueDate: doc.dueDate,
      amountsAre: doc.amountsAre,
      title: doc.title,
      summary: doc.summary,
      terms: doc.terms,
      salesOrderNumber: salesOrder?.number ?? null,
      imported: doc.importedAt !== null,
      brandingThemeId: theme ?? null,
    },
  };
}

type XeroDocument = {
  QuoteID?: string;
  QuoteNumber?: string;
  InvoiceID?: string;
  InvoiceNumber?: string;
  Status?: string;
  Total?: number;
  AmountPaid?: number;
  AmountDue?: number;
  Reference?: string;
  UpdatedDateUTC?: string;
};

const xeroIdOf = (x: XeroDocument) => x.QuoteID ?? x.InvoiceID ?? null;
const xeroNumberOf = (x: XeroDocument) => x.QuoteNumber ?? x.InvoiceNumber ?? null;

async function send(
  method: "PUT" | "POST",
  resource: "Quotes" | "Invoices",
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string | undefined,
  timeoutMs: number | undefined,
): Promise<XeroDocument> {
  const data = await xeroSend<Record<string, XeroDocument[] | undefined>>(
    method,
    `${path}?unitdp=4`,
    { [resource]: [body] },
    { idempotencyKey, timeoutMs },
  );
  const result = data[resource]?.[0];
  if (!result) throw new XeroApiError(500, "Xero answered without the document.");
  return result;
}

/**
 * After an unknown outcome, the create may have landed. Look for it before
 * trying again: quotes by the marker on their Reference; invoices by the same
 * Reference and total among the contact's recent drafts.
 */
async function findLostCreate(loaded: Loaded): Promise<XeroDocument | null> {
  const { map, total } = loaded;
  const contact = map.xeroContactId;
  const db = getDb();
  const taken = async (xeroId: string) =>
    (await db.select({ id: documents.id }).from(documents).where(eq(documents.xeroId, xeroId)))
      .length > 0;

  if (map.type === "quote") {
    const data = await xeroSend<{ Quotes?: XeroDocument[] }>(
      "GET",
      `/Quotes?ContactID=${contact}&order=${encodeURIComponent("UpdatedDateUTC DESC")}`,
    );
    const marker = markerFor(map.id);
    for (const q of data.Quotes ?? []) {
      if (q.Reference?.endsWith(marker) && q.QuoteID && !(await taken(q.QuoteID))) return q;
    }
    return null;
  }

  const where = encodeURIComponent(`Contact.ContactID==Guid("${contact}") AND Status=="DRAFT"`);
  const data = await xeroSend<{ Invoices?: XeroDocument[] }>(
    "GET",
    `/Invoices?where=${where}&order=${encodeURIComponent("UpdatedDateUTC DESC")}&page=1`,
  );
  const reference = invoicePayload(map, loaded.lines).Reference ?? "";
  for (const inv of data.Invoices ?? []) {
    if (
      (inv.Reference ?? "") === reference &&
      toCents(inv.Total ?? 0) === toCents(total) &&
      inv.InvoiceID &&
      !(await taken(inv.InvoiceID))
    ) {
      return inv;
    }
  }
  return null;
}

/** Claims the row. Null means someone else is pushing it, or there is nothing to do. */
async function claim(documentId: string): Promise<{ version: number; attempts: number } | null> {
  const [row] = await getDb()
    .update(documents)
    .set({
      xeroSyncState: "pushing",
      xeroLastAttemptAt: new Date(),
      xeroAttempts: sql`${documents.xeroAttempts} + 1`,
    })
    .where(
      and(
        eq(documents.id, documentId),
        sql`(${documents.xeroSyncState} in ('pending','stale','failed','blocked')
          or (${documents.xeroSyncState} = 'pushing'
              and ${documents.xeroLastAttemptAt} < now() - interval '2 minutes'))`,
      ),
    )
    .returning({ version: documents.version, attempts: documents.xeroAttempts });
  return row ?? null;
}

async function settle(documentId: string, state: XeroSyncState, message: string | null) {
  await getDb()
    .update(documents)
    .set({ xeroSyncState: state, xeroError: message })
    .where(eq(documents.id, documentId));
  return { state, message };
}

/**
 * Pushes one document. Safe to call from anywhere, any number of times: the
 * claim makes concurrent calls no-ops. `timeoutMs` bounds the wait for the
 * first push, which runs inline so the person lands on Xero's number.
 */
export async function pushDocument(
  documentId: string,
  options: { timeoutMs?: number } = {},
): Promise<PushOutcome> {
  const claimed = await claim(documentId);
  if (!claimed) {
    const [row] = await getDb()
      .select({ state: documents.xeroSyncState, error: documents.xeroError })
      .from(documents)
      .where(eq(documents.id, documentId));
    return { state: row?.state ?? "local_only", message: row?.error ?? null };
  }

  const startedAt = Date.now();
  let loaded: Loaded | null = null;

  try {
    await assertConnected();
    loaded = await load(documentId);
    const { doc, map, lines } = loaded;
    const resource = RESOURCE[doc.type];
    if (!resource) return settle(documentId, "local_only", null);

    const payload =
      resource === "Quotes" ? quotePayload(map, lines) : invoicePayload(map, lines);

    let result: XeroDocument | null = null;
    let xeroId = doc.xeroId;

    // A previous attempt may have created it without our hearing back.
    if (!xeroId && claimed.attempts > 1) {
      const found = await findLostCreate(loaded);
      if (found) {
        xeroId = xeroIdOf(found);
        await log({ entityType: doc.type, entityId: doc.id, action: "recovered", xeroId, startedAt });
      }
    }

    // Xero quotes move DRAFT → SENT → ACCEPTED; going straight to ACCEPTED
    // from DRAFT is refused, so an accepted quote is sent first.
    const finalStatus = payload.Status;
    const needsSentFirst =
      resource === "Quotes" &&
      (finalStatus === "ACCEPTED" || finalStatus === "DECLINED") &&
      (!xeroId || !doc.xeroStatus || doc.xeroStatus === "DRAFT");

    const body = needsSentFirst ? { ...payload, Status: "SENT" } : payload;

    if (!xeroId) {
      // Creating: never with an id, never with a number.
      const create = { ...body } as Record<string, unknown>;
      delete create.QuoteID;
      delete create.InvoiceID;
      result = await send(
        "PUT",
        resource,
        `/${resource}`,
        create,
        `gw-${doc.id}-v${claimed.version}`,
        options.timeoutMs,
      );
      xeroId = xeroIdOf(result);
      await log({
        entityType: doc.type,
        entityId: doc.id,
        action: "create",
        httpStatus: 200,
        xeroId,
        startedAt,
      });
    } else if (resource === "Invoices" && doc.status === "cancelled") {
      result = await send(
        "POST",
        resource,
        `/Invoices/${xeroId}`,
        invoiceStatusPayload({ ...map, xeroId }),
        undefined,
        options.timeoutMs,
      );
    } else {
      const update = { ...body, ...(resource === "Quotes" ? { QuoteID: xeroId } : { InvoiceID: xeroId }) };
      result = await send("POST", resource, `/${resource}/${xeroId}`, update, undefined, options.timeoutMs);
      await log({ entityType: doc.type, entityId: doc.id, action: "update", httpStatus: 200, xeroId, startedAt });
    }

    if (needsSentFirst && xeroId) {
      result = await send(
        "POST",
        resource,
        `/${resource}/${xeroId}`,
        { QuoteID: xeroId, ...payload, Status: finalStatus },
        undefined,
        options.timeoutMs,
      );
    }

    return await recordSuccess(doc, claimed.version, result, loaded.total);
  } catch (error) {
    return recordFailure(documentId, loaded?.doc.type ?? "document", error, startedAt);
  }
}

async function recordSuccess(
  doc: Document,
  pushedVersion: number,
  result: XeroDocument | null,
  ourTotal: string,
): Promise<PushOutcome> {
  const db = getDb();
  const xeroId = result ? xeroIdOf(result) : doc.xeroId;
  const xeroTotal = result?.Total !== undefined ? String(result.Total) : null;

  const [current] = await db
    .select({ version: documents.version, number: documents.number })
    .from(documents)
    .where(eq(documents.id, doc.id));
  // An edit landed while we were talking to Xero: it needs its own push.
  const moved = (current?.version ?? pushedVersion) !== pushedVersion;

  await db
    .update(documents)
    .set({
      xeroId,
      number: current?.number ?? (result ? xeroNumberOf(result) : null),
      xeroStatus: result?.Status ?? doc.xeroStatus,
      xeroPushedVersion: pushedVersion,
      xeroUpdatedAt: parseXeroDate(result?.UpdatedDateUTC) ?? doc.xeroUpdatedAt,
      xeroSyncedAt: new Date(),
      xeroTotal,
      xeroError: null,
      xeroAttempts: 0,
      xeroSyncState: moved ? "stale" : "synced",
      ...(result?.AmountPaid !== undefined
        ? { amountPaid: String(result.AmountPaid), amountDue: String(result.AmountDue ?? 0) }
        : {}),
    })
    .where(eq(documents.id, doc.id));

  if (xeroTotal !== null && toCents(xeroTotal) !== toCents(ourTotal)) {
    await log({
      entityType: doc.type,
      entityId: doc.id,
      action: "total_mismatch",
      xeroId,
      message: `Xero has ${xeroTotal}, The Gangway has ${ourTotal}.`,
      startedAt: Date.now(),
    });
  }

  await flushHistoryNotes(doc.id).catch(() => undefined);

  if (moved) return pushDocument(doc.id);
  return { state: "synced", message: null };
}

async function recordFailure(
  documentId: string,
  entityType: string,
  error: unknown,
  startedAt: number,
): Promise<PushOutcome> {
  if (error instanceof Blocked) {
    await log({ entityType, entityId: documentId, action: "blocked", message: error.message, startedAt });
    return settle(documentId, "blocked", error.message);
  }
  if (error instanceof XeroAuthError) {
    await log({ entityType, entityId: documentId, action: "push", httpStatus: 401, message: error.message, startedAt });
    return settle(documentId, "blocked", error.message);
  }
  if (error instanceof XeroApiError) {
    await log({
      entityType,
      entityId: documentId,
      action: "push",
      httpStatus: error.status,
      message: error.message,
      startedAt,
    });
    const message =
      error.status === 0
        ? `${error.message} It will be checked and retried without creating a duplicate.`
        : error.message;
    return settle(documentId, "failed", message);
  }
  const message = error instanceof Error ? error.message : "The push to Xero failed.";
  await log({ entityType, entityId: documentId, action: "push", httpStatus: 0, message, startedAt });
  return settle(documentId, "failed", message);
}

/* ── history notes ───────────────────────────────────────────────── */

/** Queues a note for a document's Xero history. Written once it is in Xero. */
export async function queueHistoryNote(documentId: string, details: string) {
  await getDb()
    .insert(xeroHistoryNotes)
    .values({ documentId, details: details.slice(0, 250) });
}

/** Writes any unwritten notes for one document. Best effort; never throws far. */
export async function flushHistoryNotes(documentId: string): Promise<number> {
  const db = getDb();
  const [doc] = await db
    .select({ type: documents.type, xeroId: documents.xeroId })
    .from(documents)
    .where(eq(documents.id, documentId));
  const resource = doc ? RESOURCE[doc.type] : undefined;
  if (!doc?.xeroId || !resource) return 0;

  const pending = await db
    .select()
    .from(xeroHistoryNotes)
    .where(and(eq(xeroHistoryNotes.documentId, documentId), isNull(xeroHistoryNotes.writtenAt)))
    .orderBy(asc(xeroHistoryNotes.createdAt));

  let written = 0;
  for (const note of pending) {
    const startedAt = Date.now();
    try {
      await xeroSend("PUT", `/${resource}/${doc.xeroId}/History`, {
        HistoryRecords: [{ Details: note.details }],
      });
      await db
        .update(xeroHistoryNotes)
        .set({ writtenAt: new Date(), attempts: note.attempts + 1, lastError: null })
        .where(eq(xeroHistoryNotes.id, note.id));
      written += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not write the note.";
      await db
        .update(xeroHistoryNotes)
        .set({ attempts: note.attempts + 1, lastError: message })
        .where(eq(xeroHistoryNotes.id, note.id));
      await log({ entityType: "history_note", entityId: documentId, action: "note", message, startedAt });
      break;
    }
  }
  return written;
}

/* ── items ───────────────────────────────────────────────────────── */

/**
 * Creates or updates the Xero Item. Matches on Code first, so an item that
 * already exists in Xero is linked rather than duplicated.
 */
export async function pushItem(itemId: string): Promise<PushOutcome> {
  const db = getDb();
  const startedAt = Date.now();
  const [item] = await db.select().from(items).where(eq(items.id, itemId));
  if (!item) return { state: "failed", message: "That item no longer exists." };

  const settle = async (state: XeroSyncState, message: string | null, extra = {}) => {
    await db
      .update(items)
      .set({ xeroSyncState: state, xeroError: message, ...extra })
      .where(eq(items.id, itemId));
    return { state, message };
  };

  try {
    await assertConnected();
    let xeroItemId = item.xeroItemId;
    if (!xeroItemId) {
      const where = encodeURIComponent(`Code=="${item.code.replace(/"/g, "")}"`);
      const found = await xeroSend<{ Items?: { ItemID: string }[] }>("GET", `/Items?where=${where}`);
      xeroItemId = found.Items?.[0]?.ItemID ?? null;
    }
    // An item with no account of its own goes to Xero with the defaults it
    // would be coded to anyway, so the Xero item is never account-less.
    const [config] = await db.select().from(settings).where(eq(settings.id, "singleton"));
    const data = await xeroSend<{ Items?: { ItemID: string }[] }>("POST", "/Items?unitdp=4", {
      Items: [
        itemPayload({
          ...item,
          xeroItemId,
          salesAccountCode: item.salesAccountCode ?? config?.defaultSalesAccount ?? null,
          purchaseAccountCode: item.purchaseAccountCode ?? config?.defaultPurchaseAccount ?? null,
          salesTaxType: item.salesTaxType ?? config?.defaultSalesTaxType ?? null,
          purchaseTaxType: item.purchaseTaxType ?? config?.defaultPurchaseTaxType ?? null,
        }),
      ],
    });
    const savedId = data.Items?.[0]?.ItemID ?? xeroItemId;
    await log({ entityType: "item", entityId: itemId, action: "push", httpStatus: 200, xeroId: savedId, startedAt });
    return settle("synced", null, { xeroItemId: savedId, xeroSyncedAt: new Date() });
  } catch (error) {
    const blocked = error instanceof Blocked || error instanceof XeroAuthError;
    const message = error instanceof Error ? error.message : "Could not save the item in Xero.";
    await log({
      entityType: "item",
      entityId: itemId,
      action: "push",
      httpStatus: error instanceof XeroApiError ? error.status : null,
      message,
      startedAt,
    });
    return settle(blocked ? "blocked" : "failed", message);
  }
}

/* ── the queue ───────────────────────────────────────────────────── */

/** Minutes to wait after the nth failed attempt before the cron tries again. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 60, 60];
export const MAX_ATTEMPTS = 6;

/**
 * Works through what is waiting: pending and stale documents, failed ones
 * whose failure was not Xero rejecting the content, unwritten history notes,
 * and items. Serial, never Promise.all — Xero allows five concurrent calls
 * and sixty a minute, and `budget` keeps one run well inside that.
 */
export async function drainQueue(budget = 40): Promise<{ pushed: number; notes: number; items: number }> {
  const db = getDb();
  let calls = 0;
  let pushed = 0;

  const waiting = await db.execute<{ id: string }>(sql`
    select d.id from documents d
    where d.type in ('quote','invoice')
      and (
        d.xero_sync_state in ('pending','stale')
        or (d.xero_sync_state = 'pushing' and d.xero_last_attempt_at < now() - interval '2 minutes')
        or (
          d.xero_sync_state = 'failed'
          and d.xero_attempts < ${MAX_ATTEMPTS}
          and d.xero_last_attempt_at < now() - (
            (array[${sql.raw(BACKOFF_MINUTES.join(","))}])[least(greatest(d.xero_attempts, 1), ${BACKOFF_MINUTES.length})]
            * interval '1 minute')
          and coalesce((
            select l.http_status from xero_sync_log l
            where l.entity_id = d.id and l.action = 'push'
            order by l.created_at desc limit 1
          ), 0) <> 400
        )
      )
    order by d.updated_at
    limit ${budget}
  `);

  for (const row of waiting.rows) {
    if (calls >= budget) break;
    await pushDocument(row.id);
    calls += 2;
    pushed += 1;
  }

  // Notes for documents that are already in Xero.
  const notes = await db
    .selectDistinct({ documentId: xeroHistoryNotes.documentId })
    .from(xeroHistoryNotes)
    .innerJoin(documents, eq(documents.id, xeroHistoryNotes.documentId))
    .where(
      and(
        isNull(xeroHistoryNotes.writtenAt),
        sql`${xeroHistoryNotes.attempts} < ${MAX_ATTEMPTS}`,
        sql`${documents.xeroId} is not null`,
      ),
    )
    .limit(Math.max(0, budget - calls));
  let noteCount = 0;
  for (const { documentId } of notes) {
    if (calls >= budget) break;
    noteCount += await flushHistoryNotes(documentId);
    calls += 1;
  }

  const itemRows = await db
    .select({ id: items.id })
    .from(items)
    .where(and(inArray(items.xeroSyncState, ["pending", "failed"]), isNull(items.archivedAt)))
    .limit(Math.max(0, Math.floor((budget - calls) / 2)));
  for (const { id } of itemRows) {
    await pushItem(id);
    calls += 2;
  }

  return { pushed, notes: noteCount, items: itemRows.length };
}
