import type { NextRequest } from "next/server";
import { campaignForToken } from "@/lib/campaigns/tracking";
import { composeEmail, EMAIL_PAGE_CSP } from "@/lib/campaigns/compose";
import { senderOf } from "@/lib/campaigns/send";
import { getSettings } from "@/lib/data/common";

export const dynamic = "force-dynamic";

/** "View in your browser": the email as that person received it, without tracking. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const found = await campaignForToken(token);
  if (!found) return new Response("This email is no longer available.", { status: 404 });

  const [settings, sender] = await Promise.all([getSettings(), senderOf(found.campaign.senderId)]);
  const { html } = composeEmail({
    campaign: found.campaign,
    recipient: found.recipient,
    sender,
    settings,
    mode: "web",
  });
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": EMAIL_PAGE_CSP,
      "x-robots-tag": "noindex",
      "cache-control": "private, no-store",
    },
  });
}
