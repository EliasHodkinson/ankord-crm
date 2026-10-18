import "server-only";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/lib/db";
import { xeroPayments } from "@/lib/db/schema";
import type { ImportedPayment } from "./import/map";

/**
 * The payments read model (spec §7): what Xero says was paid against an
 * invoice or bill. Written by the import and the pull, never by a person.
 *
 * Xero lists a document's live payments; one that has gone from the list was
 * removed there, so it is dropped here too.
 */
export async function replacePayments(
  documentId: string,
  payments: ImportedPayment[],
  tx?: Tx,
): Promise<void> {
  const db = tx ?? getDb();
  const ids = payments.map((p) => p.xeroPaymentId);
  await db
    .delete(xeroPayments)
    .where(
      and(
        eq(xeroPayments.documentId, documentId),
        ids.length ? notInArray(xeroPayments.xeroPaymentId, ids) : undefined,
      ),
    );
  if (!payments.length) return;
  await db
    .insert(xeroPayments)
    .values(payments.map((p) => ({ ...p, documentId })))
    .onConflictDoUpdate({
      target: xeroPayments.xeroPaymentId,
      set: {
        documentId,
        date: sql`excluded.date`,
        amount: sql`excluded.amount`,
        reference: sql`excluded.reference`,
        accountCode: sql`excluded.account_code`,
        status: sql`excluded.status`,
        pulledAt: new Date(),
      },
    });
}
