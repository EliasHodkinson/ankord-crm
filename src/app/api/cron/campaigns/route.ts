import { NextResponse, type NextRequest } from "next/server";
import { runCampaignQueue } from "@/lib/campaigns/send";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The campaign heartbeat, every minute (vercel.json): start scheduled
 * campaigns, send the next batch of each one under Exchange's per-mailbox
 * limits, and read bounce notices for recent ones. Every Graph call is made
 * with the sending person's own delegated token.
 *
 * Vercel Cron calls with `Authorization: Bearer $CRON_SECRET`. Without the
 * secret set, the route refuses everyone.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runCampaignQueue());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 500 });
  }
}
