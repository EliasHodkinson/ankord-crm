import "server-only";
import { after } from "next/server";
import { flushHistoryNotes, pushDocument, pushItem, type PushOutcome } from "./push";

/**
 * When a push runs, relative to the request that caused it (spec §8.5).
 *
 * The **first** push of a Xero-type document is awaited, so the person lands
 * on the page with Xero's number — but only for so long. If Xero is slow the
 * page saves anyway and shows "Draft · not in Xero yet"; the push keeps going
 * under `after()` and lands when it lands.
 *
 * Everything later (edits, status changes, notes) goes under `after()`, so
 * nobody waits on Xero to see their own save.
 */

const FIRST_PUSH_WAIT_MS = 8_000;

export async function pushNow(documentId: string): Promise<PushOutcome | null> {
  const push = pushDocument(documentId, { timeoutMs: FIRST_PUSH_WAIT_MS });
  after(() => push.catch(() => undefined));
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FIRST_PUSH_WAIT_MS + 500));
  return Promise.race([push, timeout]);
}

export function pushLater(documentId: string): void {
  after(() => pushDocument(documentId).catch(() => undefined));
}

export function pushItemLater(itemId: string): void {
  after(() => pushItem(itemId).catch(() => undefined));
}

/** Writes a document's queued history notes after the response. */
export function notesLater(documentId: string): void {
  after(() => flushHistoryNotes(documentId).catch(() => undefined));
}
