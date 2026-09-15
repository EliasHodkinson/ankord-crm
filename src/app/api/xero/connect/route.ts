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

  const target = new URL(XERO_AUTHORIZE_URL);
  target.searchParams.set("response_type", "code");
  target.searchParams.set("client_id", process.env.XERO_CLIENT_ID!);
  target.searchParams.set("redirect_uri", xeroRedirectUri(appUrl()));
  target.searchParams.set("scope", XERO_SCOPE_STRING);
  target.searchParams.set("state", state);

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
