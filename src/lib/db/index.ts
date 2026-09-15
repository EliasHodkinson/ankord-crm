import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
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

function create(): Db {
  const url = requireEnv("DATABASE_URL");
  const options = { schema, casing: "snake_case" } as const;
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

export { schema };
