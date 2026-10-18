import { NextResponse, type NextRequest } from "next/server";
import {
  buildAuthorizeUrl,
  codeChallengeFor,
  grantedScopeSets,
  isScopeSet,
  randomUrlSafe,
  scopeStringFor,
} from "@/lib/auth/entra";
import { sessionScopes } from "@/lib/auth/session";
import { isAuthConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

const FIVE_MINUTES = 300;

export async function GET(request: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.redirect(new URL("/setup", request.nextUrl.origin));
  }

  const verifier = randomUrlSafe(48);
  const state = randomUrlSafe(24);
  const next = request.nextUrl.searchParams.get("next") ?? "/";
  // A feature that needs an optional scope set sends the person back through
  // sign-in for it (see OPTIONAL_SCOPES). The sets this session already holds
  // are asked for again, so picking up one never drops another. Anyone can ask;
  // Entra only issues what has been consented, and the CRM's own checks still
  // decide who may use what.
  const asked = request.nextUrl.searchParams.get("scopes");
  // Connecting an MCP client (see lib/mcp/grants.ts): the sign-in makes that
  // connection its own session, with only the ordinary scopes.
  const forMcp = request.nextUrl.searchParams.get("purpose") === "mcp";
  const sets = forMcp
    ? []
    : [
        ...new Set([
          ...grantedScopeSets(await sessionScopes().catch(() => null)),
          ...(isScopeSet(asked) ? [asked] : []),
        ]),
      ];

  const target = buildAuthorizeUrl({
    state,
    codeChallenge: await codeChallengeFor(verifier),
    loginHint: request.nextUrl.searchParams.get("login_hint") ?? undefined,
    prompt: request.nextUrl.searchParams.get("prompt") === "select_account"
      ? "select_account"
      : undefined,
    scope: sets.length ? scopeStringFor(sets) : undefined,
  });

  const response = NextResponse.redirect(target);
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: FIVE_MINUTES,
  };
  response.cookies.set("ankord_pkce", verifier, options);
  response.cookies.set("ankord_state", state, options);
  // Only ever a path within this app — "//host" is protocol-relative, so it is
  // excluded too — so it cannot be used as an open redirect.
  response.cookies.set(
    "ankord_next",
    next.startsWith("/") && !next.startsWith("//") ? next : "/",
    options,
  );
  if (sets.length) response.cookies.set("ankord_scopes", sets.join(","), options);
  else response.cookies.delete("ankord_scopes");
  if (forMcp) response.cookies.set("ankord_purpose", "mcp", options);
  else response.cookies.delete("ankord_purpose");
  return response;
}
