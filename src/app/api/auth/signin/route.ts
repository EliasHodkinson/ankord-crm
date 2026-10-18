import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_ADMIN_SCOPE_STRING,
  buildAuthorizeUrl,
  codeChallengeFor,
  randomUrlSafe,
} from "@/lib/auth/entra";
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
  // Settings → People and access sends an admin back through sign-in to pick
  // up the scopes for inviting guests. Anyone can ask; Entra only issues them
  // where consent exists, and the CRM only uses them behind requireAdmin.
  const elevated = request.nextUrl.searchParams.get("scopes") === "access";

  const target = buildAuthorizeUrl({
    state,
    codeChallenge: await codeChallengeFor(verifier),
    loginHint: request.nextUrl.searchParams.get("login_hint") ?? undefined,
    prompt: request.nextUrl.searchParams.get("prompt") === "select_account"
      ? "select_account"
      : undefined,
    scope: elevated ? ACCESS_ADMIN_SCOPE_STRING : undefined,
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
  if (elevated) response.cookies.set("ankord_scopes", "access", options);
  else response.cookies.delete("ankord_scopes");
  return response;
}
