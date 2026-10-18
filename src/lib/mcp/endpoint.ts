import "server-only";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { getDb } from "@/lib/db";
import { oauthClients, sessions, users } from "@/lib/db/schema";
import { actAs } from "@/lib/auth/principal";
import { createGangwayServer } from "./server";
import { MCP_SCOPE, resourceMetadataUrl, verifyAccessToken } from "./tokens";

/**
 * The MCP endpoint (Streamable HTTP, stateless). Every request must carry a
 * bearer token The Gangway issued for this endpoint; the session it names is
 * checked on every request — so ending a connection, or suspending the
 * person, takes effect at once — and the request then runs as that person.
 */

const handler = createMcpHandler(() => createGangwayServer(), {
  // Serve 2025-era clients too, statelessly: every Claude client in use today.
  legacy: "stateless",
  onerror: (error) => console.error("[mcp]", error.message),
});

function challenge(error?: "invalid_token", description?: string): Response {
  const parts = [`Bearer resource_metadata="${resourceMetadataUrl()}"`, `scope="${MCP_SCOPE}"`];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description}"`);
  return Response.json(
    { error: error ?? "unauthorized", error_description: description ?? "Connect The Gangway to sign in." },
    { status: 401, headers: { "www-authenticate": parts.join(", "), "cache-control": "no-store" } },
  );
}

/** The live, approved MCP session a token names — or null. */
async function sessionFor(token: string) {
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  const [row] = await getDb()
    .select({ sessionId: sessions.id, userId: users.id, client: oauthClients.name, clientId: oauthClients.clientId })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(oauthClients, eq(oauthClients.id, sessions.oauthClientId))
    .where(
      and(
        eq(sessions.id, claims.sid),
        eq(sessions.kind, "mcp"),
        isNotNull(sessions.oauthClientId),
        gt(sessions.expiresAt, new Date()),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  if (!row || row.userId !== claims.sub || row.clientId !== claims.client_id) return null;
  return row;
}

export async function handleMcp(request: Request): Promise<Response> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!token) return challenge();

  const session = await sessionFor(token);
  if (!session) return challenge("invalid_token", "The token is expired, revoked or not for this server.");

  return actAs({ sessionId: session.sessionId, via: "mcp", client: session.client, activityLogged: 0 }, () =>
    handler.fetch(request, {
      authInfo: {
        token,
        clientId: session.clientId,
        scopes: [MCP_SCOPE],
        extra: { userId: session.userId, sessionId: session.sessionId },
      },
    }),
  );
}
