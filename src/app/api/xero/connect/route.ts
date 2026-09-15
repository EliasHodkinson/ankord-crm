import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { randomUrlSafe } from "@/lib/auth/entra";
import { appUrl } from "@/lib/env";
import {
  XERO_AUTHORIZE_URL,
  XERO_SCOPE_STRING,
  xeroConfigured,
  xeroRedirectUri,
} from "@/lib/xero/config";

export const dynamic = "force-dynamic";

const FIVE_MINUTES = 300;

/**
 * Starts the Xero connection. Admin-only: this links the whole company's
 * accounts, not the signed-in person's, so it is not a per-user action.
 */
export async function GET(request: NextRequest) {
  await requireAdmin();

  if (!xeroConfigured()) {
    return NextResponse.redirect(
      new URL("/settings?xero=not-configured", request.nextUrl.origin),
    );
  }

  const state = randomUrlSafe(24);

  // Built by hand rather than with URLSearchParams, which encodes a space as
  // "+". That is legal in a form-encoded body but ambiguous in a query string,
  // and the scope list is the one parameter where a mis-parse is silent: Xero
  // answers `invalid_scope` either way, whether a name is wrong or the whole
  // list arrived as a single token. %20 removes the doubt.
  const query = [
    "response_type=code",
    `client_id=${encodeURIComponent(process.env.XERO_CLIENT_ID!)}`,
    `redirect_uri=${encodeURIComponent(xeroRedirectUri(appUrl()))}`,
    `scope=${encodeURIComponent(XERO_SCOPE_STRING)}`,
    `state=${encodeURIComponent(state)}`,
  ].join("&");
  const target = `${XERO_AUTHORIZE_URL}?${query}`;

  const response = NextResponse.redirect(target);
  response.cookies.set("ankord_xero_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: FIVE_MINUTES,
  });
  return response;
}
