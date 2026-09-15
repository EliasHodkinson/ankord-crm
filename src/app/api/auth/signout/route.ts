import { NextResponse, type NextRequest } from "next/server";
import { destroySession } from "@/lib/auth/session";
import { logoutUrl } from "@/lib/auth/entra";
import { appUrl, isAuthConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

async function signOut(request: NextRequest) {
  await destroySession();

  // Ending the Microsoft session too, so a shared machine does not stay signed in.
  if (isAuthConfigured() && request.nextUrl.searchParams.get("full") === "1") {
    const url = new URL(logoutUrl());
    url.searchParams.set("post_logout_redirect_uri", `${appUrl()}/signin`);
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(new URL("/signin", request.nextUrl.origin));
}

export const GET = signOut;
export const POST = signOut;
