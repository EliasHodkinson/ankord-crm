import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { getDb } from "@/lib/db";
import { oauthClients, oauthCodes, sessions, users } from "@/lib/db/schema";
import { cookieSecret } from "@/lib/auth/crypto";
import { redirectUriMatches, sha256, verifyPkce, withParams, resourceAllowed } from "./oauth-rules";
import {
  ACCESS_TOKEN_SECONDS,
  CONNECTION_DAYS,
  MCP_SCOPE,
  issuerUrl,
  mcpUrl,
  opaqueToken,
  signAccessToken,
} from "./tokens";

/**
 * Connecting an MCP client, end to end:
 *
 * 1. `/oauth/authorize` checks the client and keeps the request in a signed,
 *    short-lived cookie (`REQUEST_COOKIE`), then sends the person through the
 *    ordinary Microsoft sign-in with purpose=mcp.
 * 2. The sign-in callback makes a *pending* MCP session holding that person's
 *    own Microsoft tokens (no browser cookie), and names it in `SESSION_COOKIE`.
 * 3. `/oauth/consent` shows who is connecting what; approving binds the
 *    session to the client and issues a one-time code.
 * 4. `/oauth/token` swaps the code (with PKCE) for an access token and a
 *    rotating refresh token.
 *
 * Every connection is a row in `sessions`, so suspending a person, or deleting
 * the row from Settings → Claude connections, ends it.
 */

export const REQUEST_COOKIE = "ankord_mcp_request";
export const SESSION_COOKIE = "ankord_mcp_session";
const COOKIE_SECONDS = 15 * 60;
const CODE_SECONDS = 120;

export type PendingRequest = {
  /** oauth_clients.id */
  client: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string;
};

function cookieKey(purpose: string): Uint8Array {
  return new Uint8Array(createHmac("sha256", cookieSecret()).update(`gangway-mcp-${purpose}`).digest());
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: COOKIE_SECONDS,
};

export async function sealRequest(request: PendingRequest): Promise<string> {
  return new SignJWT({ req: request })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${COOKIE_SECONDS}s`)
    .sign(cookieKey("request"));
}

export async function openRequest(value: string | undefined): Promise<PendingRequest | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtVerify<{ req: PendingRequest }>(value, cookieKey("request"));
    return payload.req ?? null;
  } catch {
    return null;
  }
}

export async function sealSession(sessionId: string): Promise<string> {
  return new SignJWT({ msid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${COOKIE_SECONDS}s`)
    .sign(cookieKey("session"));
}

export async function openSession(value: string | undefined): Promise<string | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtVerify<{ msid: string }>(value, cookieKey("session"));
    return payload.msid ?? null;
  } catch {
    return null;
  }
}

/** The pending session and the client it would be granted to, for the consent screen. */
export async function loadPending(request: PendingRequest, sessionId: string) {
  const db = getDb();
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.kind, "mcp"),
        isNull(sessions.oauthClientId),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.id, request.client)).limit(1);
  if (!row || !client || !row.user.isActive) return null;
  if (!redirectUriMatches(client.redirectUris, request.redirectUri)) return null;
  return { session: row.session, user: row.user, client };
}

/** Approve: bind the session to the client and return where to send the person, with a code. */
export async function approve(request: PendingRequest, sessionId: string): Promise<string | null> {
  const pending = await loadPending(request, sessionId);
  if (!pending) return null;
  const code = opaqueToken();
  const db = getDb();
  await db
    .update(sessions)
    .set({
      oauthClientId: pending.client.id,
      expiresAt: new Date(Date.now() + CONNECTION_DAYS * 86_400_000),
      lastUsedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));
  await db.insert(oauthCodes).values({
    codeHash: sha256(code),
    oauthClientId: pending.client.id,
    sessionId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    resource: request.resource,
    expiresAt: new Date(Date.now() + CODE_SECONDS * 1000),
  });
  return withParams(request.redirectUri, {
    code,
    state: request.state ?? undefined,
    iss: issuerUrl(),
  });
}

/** Decline: the pending session (and its Microsoft tokens) is thrown away. */
export async function decline(request: PendingRequest, sessionId: string | null): Promise<string> {
  if (sessionId) {
    await getDb()
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.kind, "mcp"), isNull(sessions.oauthClientId)));
  }
  return withParams(request.redirectUri, {
    error: "access_denied",
    error_description: "The connection was declined.",
    state: request.state ?? undefined,
    iss: issuerUrl(),
  });
}

/* ── the token endpoint ──────────────────────────────────────────── */

export class GrantError extends Error {
  constructor(
    readonly code: "invalid_grant" | "invalid_request" | "invalid_client" | "invalid_target",
    message: string,
  ) {
    super(message);
    this.name = "GrantError";
  }
}

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

async function issue(sessionId: string, userId: string, clientId: string): Promise<TokenResponse> {
  const refresh = opaqueToken();
  await getDb()
    .update(sessions)
    .set({
      refreshHash: sha256(refresh),
      expiresAt: new Date(Date.now() + CONNECTION_DAYS * 86_400_000),
      lastUsedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));
  return {
    access_token: await signAccessToken({ sid: sessionId, sub: userId, client_id: clientId }),
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_SECONDS,
    refresh_token: refresh,
    scope: MCP_SCOPE,
  };
}

export async function exchangeCode(input: {
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string | null;
}): Promise<TokenResponse> {
  const db = getDb();
  const [row] = await db
    .select({ code: oauthCodes, client: oauthClients, session: sessions, user: users })
    .from(oauthCodes)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthCodes.oauthClientId))
    .innerJoin(sessions, eq(sessions.id, oauthCodes.sessionId))
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(oauthCodes.codeHash, sha256(input.code)))
    .limit(1);
  if (!row) throw new GrantError("invalid_grant", "That authorization code is not valid.");

  if (row.code.usedAt) {
    // A code presented twice may have been stolen: end the connection it made.
    await db.delete(sessions).where(eq(sessions.id, row.session.id));
    throw new GrantError("invalid_grant", "That authorization code has already been used.");
  }
  const [claimed] = await db
    .update(oauthCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(oauthCodes.codeHash, row.code.codeHash), isNull(oauthCodes.usedAt)))
    .returning({ codeHash: oauthCodes.codeHash });
  if (!claimed) throw new GrantError("invalid_grant", "That authorization code has already been used.");

  if (row.code.expiresAt.getTime() < Date.now()) {
    throw new GrantError("invalid_grant", "That authorization code has expired.");
  }
  if (row.client.clientId !== input.clientId) {
    throw new GrantError("invalid_grant", "That code was issued to a different client.");
  }
  if (row.code.redirectUri !== input.redirectUri) {
    throw new GrantError("invalid_grant", "redirect_uri does not match the authorization request.");
  }
  if (!verifyPkce(input.codeVerifier, row.code.codeChallenge)) {
    throw new GrantError("invalid_grant", "The PKCE code_verifier does not match.");
  }
  if (input.resource && !resourceAllowed(input.resource, mcpUrl())) {
    throw new GrantError("invalid_target", "Tokens are only issued for this MCP server.");
  }
  if (!row.user.isActive || row.session.oauthClientId !== row.client.id) {
    throw new GrantError("invalid_grant", "That connection is no longer active.");
  }
  return issue(row.session.id, row.user.id, row.client.clientId);
}

export async function refresh(input: {
  clientId: string;
  refreshToken: string;
  resource: string | null;
}): Promise<TokenResponse> {
  if (input.resource && !resourceAllowed(input.resource, mcpUrl())) {
    throw new GrantError("invalid_target", "Tokens are only issued for this MCP server.");
  }
  const [row] = await getDb()
    .select({ session: sessions, client: oauthClients, user: users })
    .from(sessions)
    .innerJoin(oauthClients, eq(oauthClients.id, sessions.oauthClientId))
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.refreshHash, sha256(input.refreshToken)),
        eq(sessions.kind, "mcp"),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row || !row.user.isActive) {
    throw new GrantError("invalid_grant", "That refresh token is not valid. Connect again.");
  }
  if (row.client.clientId !== input.clientId) {
    throw new GrantError("invalid_grant", "That refresh token was issued to a different client.");
  }
  return issue(row.session.id, row.user.id, row.client.clientId);
}

/** RFC 7009: revoking a refresh token ends its connection. Unknown tokens are not an error. */
export async function revoke(token: string): Promise<void> {
  await getDb()
    .delete(sessions)
    .where(and(eq(sessions.refreshHash, sha256(token)), eq(sessions.kind, "mcp")));
}
