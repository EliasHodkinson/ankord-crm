import { after, type NextRequest } from "next/server";
import { recordOpen } from "@/lib/campaigns/tracking";

export const dynamic = "force-dynamic";

/** A transparent 1×1 GIF. */
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/**
 * The open pixel. Public: the token is the only credential, and it can only
 * record its own open. The image is returned straight away; the write happens
 * after, so a slow database never shows as a broken image.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const agent = request.headers.get("user-agent");
  after(() => recordOpen(token.replace(/\.gif$/, ""), agent).catch(() => undefined));
  return new Response(PIXEL, {
    headers: {
      "content-type": "image/gif",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
