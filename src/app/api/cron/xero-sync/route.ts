import { NextResponse, type NextRequest } from "next/server";
import { lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { xeroSyncLog } from "@/lib/db/schema";
import { readXeroRefs } from "@/lib/data/xero-cache";
import { readXeroConnection } from "@/lib/xero/auth";
import { refreshXeroReferenceData } from "@/lib/xero/reference-data";
import { pullChanged } from "@/lib/xero/pull";
import { drainQueue } from "@/lib/xero/push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Xero heartbeat, every five minutes (vercel.json):
 *  1. refresh the account and tax pickers once a day;
 *  2. pull what changed in Xero since the last run;
 *  3. push what is waiting — pending, stale, retryable failures, history
 *     notes and items — serially, within a budget that keeps one run well
 *     inside Xero's 60 calls a minute;
 *  4. prune the sync log past 90 days.
 *
 * Vercel Cron calls with `Authorization: Bearer $CRON_SECRET`. Without the
 * secret set, the route refuses everyone.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }

  const connection = await readXeroConnection().catch(() => null);
  if (!connection || connection.missingScopes.length) {
    return NextResponse.json({ skipped: "Xero is not connected with write access." });
  }

  const report: Record<string, unknown> = {};
  try {
    const refs = await readXeroRefs();
    if (!refs.fetchedAt || Date.now() - refs.fetchedAt.getTime() > 86_400_000) {
      report.refs = await refreshXeroReferenceData();
    }
    report.pulled = await pullChanged();
    report.pushed = await drainQueue(40);
  } catch (error) {
    report.error = error instanceof Error ? error.message : "Sync failed.";
  }

  await getDb()
    .delete(xeroSyncLog)
    .where(lt(xeroSyncLog.createdAt, new Date(Date.now() - 90 * 86_400_000)))
    .catch(() => undefined);

  return NextResponse.json(report);
}
