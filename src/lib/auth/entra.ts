import "server-only";
import { requireEnv, redirectUri } from "@/lib/env";

/**
 * Microsoft Entra ID (Azure AD) sign-in, using the authorization-code flow
 * with PKCE against the tenant-specific v2.0 endpoints. Single-tenant: only
 * accounts in the Ankor'd tenant can complete the flow.
 */

export const GRAPH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "User.ReadBasic.All",
  "Mail.Read",
  "Sites.ReadWrite.All",
  // Mirroring follow-ups into the signed-in person's Microsoft To Do. There is
  // no application-permission path for To Do — /me/todo is delegated only — so
  // each person's list is only ever written with their own token.
  "Tasks.ReadWrite",
  // Naming the Microsoft 365 groups a person belongs to, so they can choose
  // where a Planner plan lives. User.Read alone returns the group ids with
  // every other property blanked out. Needs admin consent — grant it before
  // deploying, or token refresh fails for everyone until it is granted.
  "GroupMember.Read.All",
] as const;

export const SCOPE_STRING = GRAPH_SCOPES.join(" ");

/**
 * Scopes asked for only when someone chooses a feature that needs them, never
 * at an ordinary sign-in — so nobody is prompted for what they will not use,
 * and the app still signs in before an administrator has consented to them.
 * A session keeps every set it has been granted across refreshes.
 *
 * - `access` — `User.Invite.All`, for an admin inviting a VA or contractor as a
 *   B2B guest. Bounded by the admin's own directory role: they also need to be
 *   allowed to invite guests (Guest Inviter, User Administrator, or the tenant
 *   letting members invite). Sharing customer folders needs nothing new —
 *   driveItem invite and permission delete are covered by Sites.ReadWrite.All,
 *   bounded by the admin's own rights on the site.
 * - `shared-mail` — `Mail.Read.Shared`, for linking email from a shared
 *   mailbox. Bounded by Exchange: only mailboxes the person can already open
 *   in Outlook.
 * - `marketing` — `Mail.Send` and `Mail.Send.Shared`, for campaigns: sending
 *   as yourself, or as the marketing mailbox. Bounded by Exchange: sending as
 *   the shared mailbox works only for people given Send As on it. Asked for
 *   only by someone who sends a campaign; nothing else in the CRM sends mail.
 *   Mail.Read.Shared rides along so bounces can be read back from the
 *   marketing mailbox.
 */
export const OPTIONAL_SCOPES = {
  access: ["User.Invite.All"],
  "shared-mail": ["Mail.Read.Shared"],
  marketing: ["Mail.Send", "Mail.Send.Shared", "Mail.Read.Shared"],
} as const satisfies Record<string, readonly string[]>;

export type ScopeSet = keyof typeof OPTIONAL_SCOPES;

export const isScopeSet = (value: unknown): value is ScopeSet =>
  typeof value === "string" && value in OPTIONAL_SCOPES;

/** Graph may report scopes bare or as full URIs; compare them bare. */
const bare = (scope: string) => scope.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase();

/** The optional sets a granted scope string covers. */
export function grantedScopeSets(scope: string | null | undefined): ScopeSet[] {
  const granted = new Set((scope ?? "").split(/\s+/).filter(Boolean).map(bare));
  return (Object.keys(OPTIONAL_SCOPES) as ScopeSet[]).filter((set) =>
    OPTIONAL_SCOPES[set].every((s) => granted.has(bare(s))),
  );
}

export const hasScopeSet = (scope: string | null | undefined, set: ScopeSet) =>
  grantedScopeSets(scope).includes(set);

/** Whether a granted scope list includes the people-management scopes. */
export const hasAccessAdminScopes = (scope: string | null | undefined) =>
  hasScopeSet(scope, "access");

/** The ordinary scopes plus the given optional sets. */
export function scopeStringFor(sets: readonly ScopeSet[]): string {
  return [...GRAPH_SCOPES, ...sets.flatMap((set) => OPTIONAL_SCOPES[set])].join(" ");
}

const authority = () =>
  `https://login.microsoftonline.com/${requireEnv("AZURE_AD_TENANT_ID")}`;

export const authorizeUrl = () => `${authority()}/oauth2/v2.0/authorize`;
export const tokenUrl = () => `${authority()}/oauth2/v2.0/token`;
export const logoutUrl = () => `${authority()}/oauth2/v2.0/logout`;
export const jwksUrl = () => `${authority()}/discovery/v2.0/keys`;
export const issuer = () =>
  `https://login.microsoftonline.com/${requireEnv("AZURE_AD_TENANT_ID")}/v2.0`;

export type TokenSet = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
};

export function buildAuthorizeUrl(opts: {
  state: string;
  codeChallenge: string;
  loginHint?: string;
  prompt?: "login" | "select_account" | "consent";
  scope?: string;
}): string {
  const params = new URLSearchParams({
    client_id: requireEnv("AZURE_AD_CLIENT_ID"),
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: opts.scope ?? SCOPE_STRING,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  if (opts.prompt) params.set("prompt", opts.prompt);
  return `${authorizeUrl()}?${params}`;
}

async function postToken(body: URLSearchParams): Promise<TokenSet> {
  body.set("client_id", requireEnv("AZURE_AD_CLIENT_ID"));
  body.set("client_secret", requireEnv("AZURE_AD_CLIENT_SECRET"));

  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const json = (await res.json()) as TokenSet & {
    error?: string;
    error_description?: string;
  };

  if (!res.ok || json.error) {
    throw new EntraTokenError(
      json.error ?? `token_endpoint_${res.status}`,
      json.error_description ?? "Microsoft rejected the token request.",
    );
  }
  return json;
}

export class EntraTokenError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EntraTokenError";
  }
}

export function exchangeCode(
  code: string,
  codeVerifier: string,
  scope: string = SCOPE_STRING,
): Promise<TokenSet> {
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: codeVerifier,
      scope,
    }),
  );
}

export function refreshTokens(
  refreshToken: string,
  scope: string = SCOPE_STRING,
): Promise<TokenSet> {
  return postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope,
    }),
  );
}

/* ── PKCE helpers ────────────────────────────────────────────────── */

export function randomUrlSafe(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

export async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(new Uint8Array(digest)).toString("base64url");
}
