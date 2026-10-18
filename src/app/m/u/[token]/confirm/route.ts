import { NextResponse, type NextRequest } from "next/server";
import { unsubscribe } from "@/lib/campaigns/tracking";

export const dynamic = "force-dynamic";

/**
 * The unsubscribe itself — a POST from the confirmation page. Only a POST:
 * mail scanners follow every GET in a message, and must not unsubscribe
 * anyone by doing so.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const done = await unsubscribe(token, request.headers.get("user-agent")).catch(() => null);
  const url = new URL(`/m/u/${encodeURIComponent(token)}`, request.nextUrl.origin);
  url.searchParams.set("done", done ? "1" : "0");
  return NextResponse.redirect(url, 303);
}
