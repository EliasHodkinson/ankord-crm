import { NextResponse, type NextRequest } from "next/server";
import { recordClick } from "@/lib/campaigns/tracking";

export const dynamic = "force-dynamic";

/**
 * A tracked link. The URL names a link row, never a destination, so it can
 * only redirect where the campaign itself pointed — not an open redirect.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string; link: string }> }) {
  const { token, link } = await ctx.params;
  const target = await recordClick(token, link, request.headers.get("user-agent")).catch(() => null);
  if (!target) {
    return new Response("This link is no longer available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.redirect(target, 302);
}
