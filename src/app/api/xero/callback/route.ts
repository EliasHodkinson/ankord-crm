import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { completeXeroConnection, XeroAuthError } from "@/lib/xero/auth";

export const dynamic = "force-dynamic";

function back(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/settings", request.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = NextResponse.redirect(url);
  response.cookies.delete("ankord_xero_state");
  return response;
}

export async function GET(request: NextRequest) {
  const { user } = await requireAdmin();
  const params = request.nextUrl.searchParams;

  if (params.get("error")) {
    return back(request, {
      xero: "error",
      detail: params.get("error_description") ?? params.get("error")!,
    });
  }

  const code = params.get("code");
  const state = params.get("state");
  const expected = request.cookies.get("ankord_xero_state")?.value;

  // Without this check a third party could hand us their own Xero grant.
  if (!code || !state || !expected || state !== expected) {
    return back(request, {
      xero: "error",
      detail: "That connection attempt could not be verified. Try again from Settings.",
    });
  }

  try {
    const { tenantName } = await completeXeroConnection(code, user.id);
    return back(request, { xero: "connected", org: tenantName });
  } catch (error) {
    return back(request, {
      xero: "error",
      detail:
        error instanceof XeroAuthError
          ? error.message
          : "Xero would not complete the connection.",
    });
  }
}
