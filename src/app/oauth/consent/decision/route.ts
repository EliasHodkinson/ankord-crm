import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_COOKIE, SESSION_COOKIE, approve, decline, openRequest, openSession } from "@/lib/mcp/grants";

export const dynamic = "force-dynamic";

/**
 * The consent form posts here. A plain form post and a 303 rather than a
 * server action, because the destination is the client's own redirect URI —
 * a loopback port or an app scheme — which only a real navigation reaches.
 */
export async function POST(request: NextRequest) {
  // Same-origin only: the decision is the person's, made on our page.
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return new NextResponse("Cross-site request refused.", { status: 403 });
  }

  const req = await openRequest(request.cookies.get(REQUEST_COOKIE)?.value);
  const sessionId = await openSession(request.cookies.get(SESSION_COOKIE)?.value);
  const expired = NextResponse.redirect(
    new URL(`/oauth/consent?error=${encodeURIComponent("This connection request has expired. Start connecting again from Claude.")}`, request.nextUrl.origin),
    303,
  );
  if (!req) return expired;

  const form = await request.formData();
  const target =
    form.get("decision") === "approve" && sessionId
      ? await approve(req, sessionId)
      : await decline(req, sessionId);
  if (!target) return expired;

  const response = NextResponse.redirect(target, 303);
  response.cookies.delete(REQUEST_COOKIE);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
