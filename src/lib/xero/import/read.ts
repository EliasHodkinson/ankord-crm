import "server-only";
import { xeroSend } from "../client";

/**
 * The import's only way into Xero, and it only reads.
 *
 * Importing must never write to Xero: no contact created, no item saved, no
 * document pushed, no history note. Everything under lib/xero/import goes
 * through `xeroGet`, so a write cannot slip in by accident — there is no
 * method parameter to get wrong. What the import writes locally is marked
 * `synced` (documents, items), which is the one state the push engine and the
 * cron leave alone (lib/xero/push.ts `claim`, `drainQueue`).
 */
export function xeroGet<T>(path: string): Promise<T> {
  return xeroSend<T>("GET", path);
}

/**
 * Every page of a Xero list. Xero pages at 100 by default (up to 1,000 where
 * `pageSize` is honoured); a short page is the last one. `maxPages` caps a
 * runaway listing — at 100 a page that is 5,000 records, far more than an
 * import screen should show at once.
 */
export async function xeroGetAll<T>(
  path: (page: number) => string,
  key: string,
  { pageSize = 100, maxPages = 50 }: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await xeroGet<Record<string, T[] | undefined>>(path(page));
    const rows = data[key] ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

/** YYYY-MM-DD → Xero's DateTime(yyyy, mm, dd) for `where` clauses. */
export function xeroDateTime(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `DateTime(${y}, ${String(m).padStart(2, "0")}, ${String(d).padStart(2, "0")})`;
}
