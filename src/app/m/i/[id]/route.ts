import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { emailAssets } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * An image uploaded for an email. Public, because mail clients fetch images
 * with no credentials; the id is a random UUID and nothing else is served.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const clean = id.replace(/\.[a-z]+$/i, "");
  if (!/^[0-9a-f-]{36}$/i.test(clean)) return new Response("Not found", { status: 404 });
  const [asset] = await getDb()
    .select({ mime: emailAssets.mime, data: emailAssets.data })
    .from(emailAssets)
    .where(eq(emailAssets.id, clean));
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(asset.data, "base64"), {
    headers: {
      "content-type": asset.mime,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
