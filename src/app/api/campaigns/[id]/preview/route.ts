import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getAccess } from "@/lib/access";
import { getSettings } from "@/lib/data/common";
import { getCampaign } from "@/lib/data/campaigns";
import { EMAIL_PAGE_CSP, previewHtml } from "@/lib/campaigns/compose";

export const dynamic = "force-dynamic";

/** A campaign's email full-size, with sample merge values. Staff only. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if ((await getAccess()).restricted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await ctx.params;
  const found = await getCampaign(id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new Response(previewHtml(found.campaign, await getSettings()), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": EMAIL_PAGE_CSP,
      "cache-control": "private, no-store",
    },
  });
}
