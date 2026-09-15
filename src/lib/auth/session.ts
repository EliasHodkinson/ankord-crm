import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SignJWT, jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";
import { cookieSecret, decryptSecret, encryptSecret } from "./crypto";
import {
  EntraTokenError,
  issuer,
  jwksUrl,
  refreshTokens,
  type TokenSet,
} from "./entra";
import { requireEnv } from "@/lib/env";

export const SESSION_COOKIE = "ankord_session";
const SESSION_TTL_DAYS = 14;

/* ── the cookie ──────────────────────────────────────────────────── */

async function signCookie(sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(cookieSecret());
}

async function readCookie(): Promise<string | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify<{ sid: string }>(raw, cookieSecret());
    return payload.sid ?? null;
  } catch {
    return null;
  }
}

/* ── id_token validation ─────────────────────────────────────────── */

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export type EntraClaims = JWTPayload & {
  oid: string;
  tid: string;
  name?: string;
  preferred_username?: string;
  email?: string;
};

export async function verifyIdToken(idToken: string): Promise<EntraClaims> {
  jwks ??= createRemoteJWKSet(new URL(jwksUrl()));
  const { payload } = await jwtVerify<EntraClaims>(idToken, jwks, {
    issuer: issuer(),
    audience: requireEnv("AZURE_AD_CLIENT_ID"),
  });
  if (payload.tid !== requireEnv("AZURE_AD_TENANT_ID")) {
    throw new Error("Sign-in came from outside the Ankor'd tenant.");
  }
  if (!payload.oid) throw new Error("Microsoft did not return an object id.");
  return payload;
}

/* ── creating and ending sessions ────────────────────────────────── */

export async function createSession(userId: string, tokens: TokenSet): Promise<void> {
  const db = getDb();
  const hdrs = await headers();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      accessTokenEnc: await encryptSecret(tokens.access_token),
      accessTokenExpiresAt: new Date(Date.now() + (tokens.expires_in - 60) * 1000),
      refreshTokenEnc: tokens.refresh_token
        ? await encryptSecret(tokens.refresh_token)
        : null,
      scope: tokens.scope ?? null,
      userAgent: hdrs.get("user-agent")?.slice(0, 400) ?? null,
      ip: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      expiresAt,
    })
    .returning({ id: sessions.id });

  (await cookies()).set(SESSION_COOKIE, await signCookie(row.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const sid = await readCookie();
  if (sid) {
    try {
      await getDb().delete(sessions).where(eq(sessions.id, sid));
    } catch {
      /* the cookie is cleared regardless */
    }
  }
  (await cookies()).delete(SESSION_COOKIE);
}

/* ── reading the current user ────────────────────────────────────── */

export type SessionContext = { user: User; sessionId: string };

/**
 * The signed-in user, or null. Cached per request so a page with many server
 * components only hits the database once.
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const sid = await readCookie();
  if (!sid) return null;

  const rows = await getDb()
    .select({ user: users, sessionId: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sid), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row || !row.user.isActive) return null;
  return { user: row.user, sessionId: row.sessionId };
});

export async function requireUser(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/signin");
  return session;
}

export async function requireAdmin(): Promise<SessionContext> {
  const session = await requireUser();
  if (session.user.role !== "admin") redirect("/?denied=admin");
  return session;
}

/* ── Microsoft Graph access tokens ───────────────────────────────── */

export class GraphAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphAuthError";
  }
}

/**
 * A valid Graph access token for the current session, refreshing it silently
 * when it has expired. Throws GraphAuthError when the user needs to sign in
 * again (for example after the refresh token has been revoked).
 */
export async function getGraphToken(): Promise<string> {
  const sid = await readCookie();
  if (!sid) throw new GraphAuthError("Not signed in.");

  const db = getDb();
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sid)).limit(1);
  if (!row) throw new GraphAuthError("Session has expired.");

  const stillValid =
    row.accessTokenEnc &&
    row.accessTokenExpiresAt &&
    row.accessTokenExpiresAt.getTime() > Date.now();

  if (stillValid) return decryptSecret(row.accessTokenEnc!);

  if (!row.refreshTokenEnc) {
    throw new GraphAuthError("Microsoft access has expired — please sign in again.");
  }

  let tokens: TokenSet;
  try {
    tokens = await refreshTokens(await decryptSecret(row.refreshTokenEnc));
  } catch (error) {
    if (error instanceof EntraTokenError) {
      throw new GraphAuthError(
        "Microsoft would not renew access for this session — please sign in again.",
      );
    }
    throw error;
  }

  await db
    .update(sessions)
    .set({
      accessTokenEnc: await encryptSecret(tokens.access_token),
      accessTokenExpiresAt: new Date(Date.now() + (tokens.expires_in - 60) * 1000),
      refreshTokenEnc: tokens.refresh_token
        ? await encryptSecret(tokens.refresh_token)
        : row.refreshTokenEnc,
      scope: tokens.scope ?? row.scope,
      lastUsedAt: new Date(),
    })
    .where(eq(sessions.id, sid));

  return tokens.access_token;
}
