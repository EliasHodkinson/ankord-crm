import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { xeroConnection } from "@/lib/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/auth/crypto";
import {
  XERO_CONNECTIONS_URL,
  XERO_SCOPE_STRING,
  XERO_TOKEN_URL,
  xeroRedirectUri,
} from "./config";
import { appUrl } from "@/lib/env";

/**
 * Xero token handling.
 *
 * The thing that makes this different from the Microsoft side: **Xero refresh
 * tokens are single use**. Every refresh returns a new access/refresh pair and
 * invalidates the one just used, so the new refresh token must be persisted
 * immediately or the connection is dead inside the hour. Xero allows a
 * 30-minute grace window in which the previous refresh token still works if the
 * response was lost, which is the only thing that makes a failed write
 * recoverable.
 *
 * Access tokens last 30 minutes; refresh tokens last 60 days from last use.
 */

export class XeroAuthError extends Error {
  constructor(
    message: string,
    /** True when the fix is "an admin needs to reconnect Xero". */
    readonly needsReconnect = false,
  ) {
    super(message);
    this.name = "XeroAuthError";
  }
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
};

function credentials(): { id: string; secret: string } {
  const id = process.env.XERO_CLIENT_ID;
  const secret = process.env.XERO_CLIENT_SECRET;
  if (!id || !secret) {
    throw new XeroAuthError("Xero is not configured on this deployment.");
  }
  return { id, secret };
}

/** Xero wants the client credentials as HTTP Basic on the token endpoint. */
function basicAuth(): string {
  const { id, secret } = credentials();
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: basicAuth(),
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // invalid_grant means the refresh token is spent or revoked — no amount of
    // retrying fixes that, only reconnecting does.
    const spent = res.status === 400 && detail.includes("invalid_grant");
    throw new XeroAuthError(
      spent
        ? "The Xero connection has expired. An admin needs to reconnect it."
        : `Xero refused the token request (${res.status}).`,
      spent,
    );
  }

  return (await res.json()) as TokenResponse;
}

/** Persists a freshly issued pair. Called on connect and on every refresh. */
async function storeTokens(
  tokens: TokenResponse,
  extra: { tenantId?: string; tenantName?: string; connectedById?: string } = {},
): Promise<void> {
  const values = {
    accessTokenEnc: await encryptSecret(tokens.access_token),
    // A minute of headroom so a token is never used in its dying seconds.
    accessTokenExpiresAt: new Date(Date.now() + (tokens.expires_in - 60) * 1000),
    refreshTokenEnc: await encryptSecret(tokens.refresh_token),
    refreshedAt: new Date(),
    updatedAt: new Date(),
    ...(extra.tenantId ? { tenantId: extra.tenantId } : {}),
    ...(extra.tenantName ? { tenantName: extra.tenantName } : {}),
    ...(extra.connectedById
      ? { connectedById: extra.connectedById, connectedAt: new Date() }
      : {}),
  };

  await getDb()
    .insert(xeroConnection)
    .values({ id: "singleton", ...values })
    .onConflictDoUpdate({ target: xeroConnection.id, set: values });
}

/** Exchanges the authorisation code, then records which organisation it is. */
export async function completeXeroConnection(
  code: string,
  connectedById: string,
): Promise<{ tenantName: string }> {
  const tokens = await postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: xeroRedirectUri(appUrl()),
    }),
  );

  // Which organisations this grant covers. Ankor'd has one; if that ever
  // changes, the first is taken and the rest ignored rather than guessed at.
  const res = await fetch(XERO_CONNECTIONS_URL, {
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      "content-type": "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new XeroAuthError("Connected, but Xero would not say which organisation.");

  const connections = (await res.json()) as { tenantId: string; tenantName: string }[];
  const first = connections[0];
  if (!first) throw new XeroAuthError("That Xero login has no organisations attached.");

  await storeTokens(tokens, {
    tenantId: first.tenantId,
    tenantName: first.tenantName,
    connectedById,
  });

  return { tenantName: first.tenantName };
}

export type XeroSession = { accessToken: string; tenantId: string };

/**
 * A usable access token and tenant id, refreshing first when the current token
 * has expired. Throws XeroAuthError when an admin needs to reconnect.
 */
export async function getXeroSession(): Promise<XeroSession> {
  const [row] = await getDb()
    .select()
    .from(xeroConnection)
    .where(eq(xeroConnection.id, "singleton"))
    .limit(1);

  if (!row?.refreshTokenEnc || !row.tenantId) {
    throw new XeroAuthError("Xero is not connected yet.", true);
  }

  const stillValid =
    row.accessTokenEnc &&
    row.accessTokenExpiresAt &&
    row.accessTokenExpiresAt.getTime() > Date.now();

  if (stillValid) {
    return {
      accessToken: await decryptSecret(row.accessTokenEnc!),
      tenantId: row.tenantId,
    };
  }

  const refreshed = await postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: await decryptSecret(row.refreshTokenEnc),
    }),
  );

  // Write the rotated pair back before anything else can use it.
  await storeTokens(refreshed);

  return { accessToken: refreshed.access_token, tenantId: row.tenantId };
}

/** What the settings page shows without ever touching a token. */
export async function readXeroConnection() {
  const [row] = await getDb()
    .select({
      tenantName: xeroConnection.tenantName,
      tenantId: xeroConnection.tenantId,
      connectedAt: xeroConnection.connectedAt,
      refreshedAt: xeroConnection.refreshedAt,
      connected: xeroConnection.refreshTokenEnc,
    })
    .from(xeroConnection)
    .where(eq(xeroConnection.id, "singleton"))
    .limit(1);

  if (!row?.connected) return null;
  return {
    tenantName: row.tenantName,
    tenantId: row.tenantId,
    connectedAt: row.connectedAt,
    refreshedAt: row.refreshedAt,
  };
}

export async function disconnectXero(): Promise<void> {
  await getDb().delete(xeroConnection).where(eq(xeroConnection.id, "singleton"));
}

export { XERO_SCOPE_STRING };
