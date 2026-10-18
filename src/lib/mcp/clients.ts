import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { oauthClients } from "@/lib/db/schema";
import {
  clientName,
  isAllowedRedirectUri,
  isMetadataDocumentUrl,
  parseMetadataDocument,
} from "./oauth-rules";
import { opaqueToken } from "./tokens";

/**
 * MCP clients. Two ways in, both open to any client (an explicit choice):
 *
 * - **Client ID Metadata Documents** — the client_id is an https URL serving
 *   the client's metadata, fetched and cached here. What current Claude
 *   clients use.
 * - **Dynamic Client Registration** (RFC 7591) — deprecated in the MCP spec,
 *   kept for clients that still use it.
 *
 * Knowing a client grants nothing. A person still signs in with Microsoft and
 * approves the client by name, and it can then do only what they can.
 */

export type OAuthClient = typeof oauthClients.$inferSelect;

const REFRESH_AFTER_MS = 24 * 60 * 60_000;
const STALE_LIMIT_MS = 7 * 24 * 60 * 60_000;
const MAX_DOCUMENT_BYTES = 64 * 1024;

export class ClientError extends Error {
  constructor(
    readonly code: "invalid_client" | "invalid_redirect_uri" | "invalid_client_metadata",
    message: string,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

/** RFC 7591 registration. Public clients only: PKCE, no secret. */
export async function registerClient(body: unknown): Promise<OAuthClient> {
  if (!body || typeof body !== "object") {
    throw new ClientError("invalid_client_metadata", "Send the client metadata as a JSON object.");
  }
  const meta = body as Record<string, unknown>;
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 20) {
    throw new ClientError("invalid_redirect_uri", "Register between one and twenty redirect URIs.");
  }
  for (const uri of uris) {
    if (typeof uri !== "string" || !isAllowedRedirectUri(uri)) {
      throw new ClientError(
        "invalid_redirect_uri",
        `Redirect URI ${String(uri)} is not allowed: use https, a loopback http address, or an app's own scheme.`,
      );
    }
  }
  const grants = meta.grant_types;
  if (Array.isArray(grants) && grants.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    throw new ClientError("invalid_client_metadata", "Only authorization_code and refresh_token are supported.");
  }

  const [row] = await getDb()
    .insert(oauthClients)
    .values({
      clientId: `gw_${opaqueToken(18)}`,
      kind: "dcr",
      name: clientName(meta.client_name, "MCP client"),
      clientUri:
        typeof meta.client_uri === "string" && meta.client_uri.startsWith("https://")
          ? meta.client_uri.slice(0, 300)
          : null,
      redirectUris: uris as string[],
    })
    .returning();
  return row;
}

/** The client a client_id names, fetching its metadata document if it is a URL. */
export async function resolveClient(clientId: string): Promise<OAuthClient> {
  if (!clientId || clientId.length > 500) throw new ClientError("invalid_client", "Unknown client.");
  const db = getDb();
  const [known] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);

  if (!isMetadataDocumentUrl(clientId)) {
    if (!known || known.kind !== "dcr") throw new ClientError("invalid_client", "Unknown client.");
    return known;
  }

  const age = known ? Date.now() - known.refreshedAt.getTime() : Infinity;
  if (known && age < REFRESH_AFTER_MS) return known;

  let fetched;
  try {
    fetched = await fetchMetadata(clientId);
  } catch (error) {
    // A client whose document is briefly unreachable keeps working for a while.
    if (known && age < STALE_LIMIT_MS) return known;
    throw error;
  }

  const values = {
    kind: "cimd" as const,
    name: fetched.name,
    clientUri: fetched.clientUri,
    redirectUris: fetched.redirectUris,
    refreshedAt: new Date(),
  };
  const [row] = await db
    .insert(oauthClients)
    .values({ clientId, ...values })
    .onConflictDoUpdate({ target: oauthClients.clientId, set: values })
    .returning();
  return row;
}

async function fetchMetadata(url: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      // A redirect could lead anywhere; the document must be at the URL itself.
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new ClientError("invalid_client", "The client's metadata document could not be fetched.");
  }
  if (!response.ok) {
    throw new ClientError("invalid_client", `The client's metadata document returned ${response.status}.`);
  }
  const text = await response.text();
  if (text.length > MAX_DOCUMENT_BYTES) {
    throw new ClientError("invalid_client", "The client's metadata document is too large.");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ClientError("invalid_client", "The client's metadata document is not JSON.");
  }
  const parsed = parseMetadataDocument(url, body);
  if ("error" in parsed) throw new ClientError("invalid_client", parsed.error);
  return parsed;
}
