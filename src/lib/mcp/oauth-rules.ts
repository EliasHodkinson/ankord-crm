import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The rules the MCP authorization server applies, kept free of the database
 * and of Next so they can be unit tested. Everything that decides whether a
 * request is let through lives here; the routes only gather inputs.
 */

/** Loopback hosts a native client (Claude Code, Claude Desktop) listens on. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Schemes that must never be redirected to, whatever a client registers. */
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "blob:", "vbscript:", "about:", "ftp:"]);

export function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK.has(url.hostname);
}

/**
 * Whether a client may register this redirect URI. Any client may connect (an
 * explicit choice: Claude, Cursor, an Inspector), so the bar is OAuth 2.1's,
 * not an allow-list: https anywhere, http only on loopback, or a private-use
 * scheme for a native app (`cursor://…`). Never a fragment.
 */
export function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || value.includes("#")) return false;
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return Boolean(url.hostname);
  if (url.protocol === "http:") return isLoopback(url);
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return false;
  // RFC 8252 §7.1: a private-use scheme names the app, reverse-DNS style.
  return /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/i.test(url.protocol) || /^[a-z][a-z0-9+-]{2,}:$/i.test(url.protocol);
}

/**
 * Whether a redirect URI in an authorization request is one the client
 * registered. Exact match, except that a loopback URI may use any port
 * (RFC 8252 §7.3): a native client picks a free port each time.
 */
export function redirectUriMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  let want: URL;
  try {
    want = new URL(requested);
  } catch {
    return false;
  }
  if (!isLoopback(want)) return false;
  return registered.some((r) => {
    try {
      const have = new URL(r);
      return (
        isLoopback(have) &&
        have.hostname === want.hostname &&
        have.pathname === want.pathname &&
        have.search === want.search
      );
    } catch {
      return false;
    }
  });
}

/** base64url(SHA-256(verifier)) — PKCE S256 (RFC 7636 §4.6). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** RFC 7636 §4.1: 43–128 characters from the unreserved set. */
export const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
export const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!PKCE_VERIFIER.test(verifier)) return false;
  return safeEqual(pkceChallenge(verifier), challenge);
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Codes and refresh tokens are stored only as this. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/**
 * A resource indicator compared the way RFC 8707 means it: scheme and host
 * case-insensitive, no trailing slash, no fragment. Null if it is not a URL.
 */
export function canonicalResource(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hash) return null;
    // URL already lowercases the scheme and host and drops a default port.
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * Whether a client asked for this server. An absent `resource` is accepted
 * (older clients); a present one must name this MCP endpoint or its origin.
 */
export function resourceAllowed(requested: string | null | undefined, mcpUrl: string): boolean {
  if (!requested) return true;
  const want = canonicalResource(requested);
  if (!want) return false;
  const mine = canonicalResource(mcpUrl)!;
  return want === mine || want === new URL(mcpUrl).origin;
}

/**
 * A client_id that is a Client ID Metadata Document URL: https, with a path
 * (draft-ietf-oauth-client-id-metadata-document §3).
 */
export function isMetadataDocumentUrl(clientId: string): boolean {
  try {
    const url = new URL(clientId);
    return (
      url.protocol === "https:" &&
      url.pathname.length > 1 &&
      !url.hash &&
      !url.username &&
      !url.password &&
      !isIpLiteral(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Metadata is fetched by host name only — never an address, so not an internal one. */
export function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[") || hostname === "localhost";
}

export type ClientMetadata = {
  clientId: string;
  name: string;
  clientUri: string | null;
  redirectUris: string[];
};

/**
 * Checks a fetched metadata document: valid JSON object, its `client_id` the
 * exact URL it came from, a name, and redirect URIs this server allows.
 * Returns a reason when it is not acceptable.
 */
export function parseMetadataDocument(url: string, body: unknown): ClientMetadata | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "The client's metadata document is not a JSON object." };
  }
  const doc = body as Record<string, unknown>;
  if (doc.client_id !== url) return { error: "The client's metadata document names a different client_id." };
  const uris = doc.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => typeof u === "string")) {
    return { error: "The client's metadata document lists no redirect URIs." };
  }
  const allowed = (uris as string[]).filter(isAllowedRedirectUri);
  if (allowed.length === 0) return { error: "None of the client's redirect URIs are allowed." };
  const auth = doc.token_endpoint_auth_method;
  if (auth !== undefined && auth !== "none") {
    return { error: "Only public clients (token_endpoint_auth_method none) can connect." };
  }
  return {
    clientId: url,
    name: clientName(doc.client_name, new URL(url).hostname),
    clientUri: typeof doc.client_uri === "string" && doc.client_uri.startsWith("https://") ? doc.client_uri : null,
    redirectUris: allowed.slice(0, 20),
  };
}

/** A display name from client-supplied input: short, single line. */
export function clientName(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() : "";
  return (text || fallback).slice(0, 80);
}

/** Adds query parameters to a redirect URI, keeping any it already has. */
export function withParams(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}
