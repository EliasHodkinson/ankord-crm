import { neon, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { requireEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Neon over HTTP in production, and plain Postgres when DATABASE_URL points at
 * a local server — so the CRM can be developed against a local database
 * without a network round trip to Neon for every query.
 */

/**
 * The Neon shape is the one the app is written against. The node-postgres
 * client implements the same query API for everything used here, so it is
 * presented under the same type rather than forcing a union at every call.
 */
type Db = ReturnType<typeof drizzleHttp<typeof schema>>;

const isLocal = (url: string) =>
  /(^|@|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])([:/]|$)/.test(url);

const options = { schema, casing: "snake_case" } as const;

function create(): Db {
  const url = requireEnv("DATABASE_URL");
  return isLocal(url)
    ? (drizzleNode(url, options) as unknown as Db)
    : drizzleHttp(neon(url), options);
}

let cached: Db | undefined;

/** The Drizzle client, created on first use so importing never throws. */
export function getDb(): Db {
  cached ??= create();
  return cached;
}

/* ── transactions ────────────────────────────────────────────────── */

type WsDb = ReturnType<typeof drizzleWs<typeof schema>>;

/**
 * The handle a transaction body writes through. Same query API as getDb(),
 * plus `execute` for the raw SQL the counters need.
 */
export type Tx = Parameters<Parameters<WsDb["transaction"]>[0]>[0];

let localDb: ReturnType<typeof drizzleNode<typeof schema>> | undefined;

/**
 * Runs `fn` inside a real database transaction.
 *
 * The HTTP driver cannot hold one open across statements, so Neon gets a
 * WebSocket pool for the life of the call — created here and ended in
 * `finally`, which is what serverless wants (no pool outliving the request).
 * Locally the node-postgres client's own transaction is used.
 *
 * Never call Xero (or anything slow and external) from inside `fn`: commit
 * first, then push.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const url = requireEnv("DATABASE_URL");

  if (isLocal(url)) {
    localDb ??= drizzleNode(url, options);
    return localDb.transaction((tx) => fn(tx as unknown as Tx));
  }

  const pool = new Pool({ connectionString: url });
  try {
    return await drizzleWs(pool, options).transaction(fn);
  } finally {
    await pool.end();
  }
}

export { schema };
