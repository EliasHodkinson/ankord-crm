import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookieSecret } from "@/lib/auth/crypto";
import { appUrl } from "@/lib/env";

/**
 * Where the MCP server lives, and the tokens The Gangway issues for it.
 *
 * The Gangway is its own OAuth authorization server for MCP (the issuer is the
 * app's origin): Microsoft cannot issue tokens for an MCP client it has never
 * heard of, and Graph tokens must never be handed to one. So a client gets
 * The Gangway's own short-lived access token, naming one MCP session; the
 * person's Microsoft tokens stay encrypted on that session row, as they do for
 * the browser.
 */

export const ACCESS_TOKEN_SECONDS = 60 * 60;
/** How long an unused connection lasts. Each refresh pushes it out again. */
export const CONNECTION_DAYS = 90;
export const MCP_SCOPE = "gangway";

export const issuerUrl = () => appUrl();
export const mcpUrl = () => `${appUrl()}/mcp`;
export const resourceMetadataUrl = () => `${appUrl()}/.well-known/oauth-protected-resource/mcp`;

/**
 * The signing key for access tokens: derived from APP_ENCRYPTION_KEY with a
 * label, so it is never the same key as the session cookie's.
 */
function accessKey(): Uint8Array {
  return new Uint8Array(createHmac("sha256", cookieSecret()).update("gangway-mcp-access-token").digest());
}

export type AccessClaims = { sid: string; sub: string; client_id: string };

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ sid: claims.sid, client_id: claims.client_id, scope: MCP_SCOPE })
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setIssuer(issuerUrl())
    .setAudience(mcpUrl())
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
    .sign(accessKey());
}

/**
 * The session an access token names, or null. Checks signature, issuer,
 * expiry and that it was issued for this MCP server (RFC 8707 audience). The
 * caller still checks the session row, so revoking takes effect at once.
 */
export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, accessKey(), {
      issuer: issuerUrl(),
      audience: mcpUrl(),
      typ: "at+jwt",
      algorithms: ["HS256"],
    });
    if (typeof payload.sid !== "string" || typeof payload.sub !== "string") return null;
    return { sid: payload.sid, sub: payload.sub, client_id: String(payload.client_id ?? "") };
  } catch {
    return null;
  }
}

/** An opaque secret for a code or refresh token. Stored only as its hash. */
export function opaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
