import "server-only";
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { oauthClients, sessions, users } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";

/** Approved MCP connections: your own, or everyone's for an admin. */
export async function listConnections() {
  const { user } = await requireUser();
  return getDb()
    .select({
      id: sessions.id,
      client: oauthClients.name,
      clientId: oauthClients.clientId,
      clientKind: oauthClients.kind,
      personId: users.id,
      person: users.name,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(oauthClients, eq(oauthClients.id, sessions.oauthClientId))
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.kind, "mcp"),
        isNotNull(sessions.oauthClientId),
        gt(sessions.expiresAt, new Date()),
        user.role === "admin" ? undefined : eq(sessions.userId, user.id),
      ),
    )
    .orderBy(desc(sessions.lastUsedAt));
}
