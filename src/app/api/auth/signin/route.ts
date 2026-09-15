import { NextResponse, type NextRequest } from "next/server";
import { buildAuthorizeUrl, codeChallengeFor, randomUrlSafe } from "@/lib/auth/entra";
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

  const target = buildAuthorizeUrl({
    state,
    codeChallenge: await codeChallengeFor(verifier),
    loginHint: request.nextUrl.searchParams.get("login_hint") ?? undefined,
    prompt: request.nextUrl.searchParams.get("prompt") === "select_account"
      ? "select_account"
      : undefined,
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
  // Only ever a path within this app, so it cannot be used as an open redirect.
  response.cookies.set("ankord_next", next.startsWith("/") ? next : "/", options);
  return response;
}
