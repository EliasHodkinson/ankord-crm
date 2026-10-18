import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, count, eq, gt, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  campaignLinks,
  campaignRecipients,
  campaigns,
  emailSuppressions,
  sessions,
  users,
  type Campaign,
  type CampaignRecipient,
} from "@/lib/db/schema";
import { graphTokenForSession } from "@/lib/auth/session";
import { hasScopeSet } from "@/lib/auth/entra";
import { getSettings } from "@/lib/data/common";
import { classifySendError, sendMessage } from "@/lib/graph/send";
import { getMessage, htmlToText, searchMessages } from "@/lib/graph/mail";
import { resolveAudience } from "./audience";
import { composeEmail, type Sender } from "./compose";
import { blockLinks, normaliseAudience, normaliseBlocks, SEND_LIMITS } from "./model";
import { safeUrl } from "./render";

/**
 * The send engine. A campaign is sent one message per person through Graph,
 * as the person who pressed Send (or as the marketing mailbox, through them),
 * never faster than Exchange allows a mailbox to send.
 *
 * Work is pulled, not pushed: whatever calls `pumpCampaign` — the cron every
 * minute, the action that started the send, or an open campaign page — claims
 * a batch of queued recipients with SKIP LOCKED, so two callers never send to
 * the same person. A recipient interrupted mid-send is marked failed rather
 * than retried: sending twice is worse than not sending.
 */

const STUCK_AFTER_MS = 10 * 60_000;
const CONCURRENCY = 3;

export const newToken = () => randomBytes(18).toString("base64url");

/* ── starting ────────────────────────────────────────────────────── */

/**
 * Fixes the audience and links, and moves a campaign into sending. Safe to
 * call twice — only the caller whose conditional update lands does the work.
 */
export async function startCampaign(campaignId: string): Promise<{ ok: boolean; message?: string }> {
  const db = getDb();
  const [claimed] = await db
    .update(campaigns)
    .set({ status: "sending", startedAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(and(eq(campaigns.id, campaignId), inArray(campaigns.status, ["draft", "scheduled"])))
    .returning();
  if (!claimed) return { ok: false, message: "That campaign has already started." };

  try {
    const settings = await getSettings();
    const fromAddress =
      claimed.fromMode === "marketing"
        ? (settings?.marketingMailbox ?? null)
        : await senderAddress(claimed.senderId);
    if (!fromAddress) throw new Error("There is no mailbox to send from.");

    // Campaigns are staff-only; resolve the audience with staff visibility.
    const { recipients } = await resolveAudience(normaliseAudience(claimed.audience), {
      userId: claimed.senderId ?? "",
      role: "member",
      restricted: false,
    });
    if (!recipients.length) throw new Error("Nobody is left in the audience to send to.");

    // Links are fixed now, so a click URL can only ever name one of these.
    const links = new Map<string, string>();
    blockLinks(normaliseBlocks(claimed.blocks)).forEach((l) => {
      const url = safeUrl(l.href);
      if (url && /^https?:/i.test(url) && !/\{\{/.test(url) && !links.has(url)) links.set(url, l.label);
    });
    if (links.size) {
      await db
        .insert(campaignLinks)
        .values([...links].map(([url, label], position) => ({ campaignId, url, label, position })))
        .onConflictDoNothing();
    }

    // A/B: the test pool is split A/B; the rest is held for the winner.
    const ab = claimed.abTest?.subjectB ? claimed.abTest : null;
    const shuffled = ab ? shuffle(recipients) : recipients;
    const testSize = ab
      ? Math.max(2, Math.round((shuffled.length * Math.min(Math.max(ab.testPercent, 10), 100)) / 100))
      : 0;
    const holdBack = ab && testSize < shuffled.length;

    const rows = shuffled.map((r, i) => ({
      campaignId,
      contactId: r.contactId,
      leadId: r.leadId,
      customerId: r.customerId,
      email: r.email,
      firstName: r.firstName,
      lastName: r.lastName,
      company: r.company,
      jobTitle: r.jobTitle,
      token: newToken(),
      variant: (ab && i < testSize ? (i % 2 === 0 ? "a" : "b") : null) as "a" | "b" | null,
      status: holdBack && i >= testSize ? ("held" as const) : ("queued" as const),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await db.insert(campaignRecipients).values(rows.slice(i, i + 500)).onConflictDoNothing();
    }

    await db
      .update(campaigns)
      .set({
        fromAddress,
        status: holdBack ? "testing" : "sending",
        abDecideAt: holdBack ? new Date(Date.now() + ab!.waitHours * 3_600_000) : null,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, campaignId));
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The campaign could not start.";
    await db
      .update(campaigns)
      .set({ status: "paused", lastError: message, updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId));
    return { ok: false, message };
  }
}

async function senderAddress(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [u] = await getDb().select({ email: users.email }).from(users).where(eq(users.id, userId));
  return u?.email ?? null;
}

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ── A/B ─────────────────────────────────────────────────────────── */

/** Unique opens or clicks per variant, among those sent. */
export async function variantResults(campaignId: string) {
  const rows = await getDb()
    .select({
      variant: campaignRecipients.variant,
      sent: count(),
      opened: sql<number>`count(${campaignRecipients.firstOpenedAt})::int`,
      clicked: sql<number>`count(${campaignRecipients.firstClickedAt})::int`,
    })
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.campaignId, campaignId),
        eq(campaignRecipients.status, "sent"),
        isNotNull(campaignRecipients.variant),
      ),
    )
    .groupBy(campaignRecipients.variant);
  const pick = (v: "a" | "b") => rows.find((r) => r.variant === v) ?? { sent: 0, opened: 0, clicked: 0 };
  return { a: pick("a"), b: pick("b") };
}

async function decideWinner(campaign: Campaign): Promise<void> {
  const db = getDb();
  const metric = campaign.abTest?.metric ?? "clicks";
  const { a, b } = await variantResults(campaign.id);
  const rate = (v: { sent: number; opened: number; clicked: number }) =>
    v.sent ? (metric === "opens" ? v.opened : v.clicked) / v.sent : 0;
  // Clicks can tie at nothing on a small list; fall back to opens, then A.
  let winner: "a" | "b" = rate(b) > rate(a) ? "b" : "a";
  if (rate(a) === rate(b) && metric === "clicks") winner = b.sent && b.opened / b.sent > (a.sent ? a.opened / a.sent : 0) ? "b" : "a";

  const [won] = await db
    .update(campaigns)
    .set({ abWinner: winner, status: "sending", updatedAt: new Date() })
    .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, "testing")))
    .returning({ id: campaigns.id });
  if (!won) return;
  await db
    .update(campaignRecipients)
    .set({ status: "queued", variant: winner })
    .where(and(eq(campaignRecipients.campaignId, campaign.id), eq(campaignRecipients.status, "held")));
}

/* ── sending ─────────────────────────────────────────────────────── */

export type PumpResult = { sent: number; failed: number; remaining: number; stopped?: string };

async function pause(campaignId: string, message: string) {
  await getDb()
    .update(campaigns)
    .set({ status: "paused", lastError: message, updatedAt: new Date() })
    .where(eq(campaigns.id, campaignId));
}

/** How many more this mailbox may send now, under Exchange's per-minute and per-day limits. */
async function mailboxBudget(fromAddress: string): Promise<number> {
  const db = getDb();
  const sentSince = async (ms: number) => {
    const [row] = await db
      .select({ n: count() })
      .from(campaignRecipients)
      .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
      .where(
        and(
          eq(campaigns.fromAddress, fromAddress),
          inArray(campaignRecipients.status, ["sent", "sending"]),
          or(
            gt(campaignRecipients.sentAt, new Date(Date.now() - ms)),
            gt(campaignRecipients.claimedAt, new Date(Date.now() - ms)),
          ),
        ),
      );
    return row?.n ?? 0;
  };
  const [minute, day] = await Promise.all([sentSince(60_000), sentSince(86_400_000)]);
  return Math.max(0, Math.min(SEND_LIMITS.perMinute - minute, SEND_LIMITS.perDay - day));
}

export async function pumpCampaign(campaignId: string): Promise<PumpResult> {
  const db = getDb();
  const empty = { sent: 0, failed: 0, remaining: 0 };

  // Anything claimed long ago never reported back. It may have gone; don't risk twice.
  await db
    .update(campaignRecipients)
    .set({ status: "failed", error: "Interrupted while sending. Not retried, in case it was delivered." })
    .where(
      and(
        eq(campaignRecipients.campaignId, campaignId),
        eq(campaignRecipients.status, "sending"),
        lt(campaignRecipients.claimedAt, new Date(Date.now() - STUCK_AFTER_MS)),
      ),
    );

  let [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign || (campaign.status !== "sending" && campaign.status !== "testing")) return empty;

  if (campaign.status === "testing" && campaign.abDecideAt && campaign.abDecideAt <= new Date()) {
    await decideWinner(campaign);
    [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  }

  // The sender's own session — their delegated token, nobody else's.
  const token = await senderToken(campaign);
  if ("stopped" in token) {
    await pause(campaignId, token.stopped);
    return { ...empty, stopped: token.stopped };
  }

  const budget = await mailboxBudget(campaign.fromAddress!);
  let result: PumpResult = { sent: 0, failed: 0, remaining: 0 };

  if (budget > 0) {
    const claimable = db
      .select({ id: campaignRecipients.id })
      .from(campaignRecipients)
      .where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "queued")))
      .orderBy(asc(campaignRecipients.id))
      .limit(budget)
      .for("update", { skipLocked: true });

    const batch = await db
      .update(campaignRecipients)
      .set({ status: "sending", claimedAt: new Date() })
      .where(inArray(campaignRecipients.id, claimable))
      .returning();

    result = await sendBatch(campaign, batch, token.token);
  }

  const [left] = await db
    .select({ n: count() })
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.campaignId, campaignId),
        inArray(campaignRecipients.status, ["queued", "sending", "held"]),
      ),
    );
  result.remaining = left?.n ?? 0;

  if (!result.remaining && !result.stopped) {
    await db
      .update(campaigns)
      .set({ status: "sent", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "sending")));
  }
  return result;
}

async function senderToken(campaign: Campaign): Promise<{ token: string } | { stopped: string }> {
  const db = getDb();
  if (!campaign.sendSessionId || !campaign.fromAddress) {
    return { stopped: "The sender's sign-in has ended. Resume the campaign to carry on as you." };
  }
  const [row] = await db
    .select({ scope: sessions.scope, expiresAt: sessions.expiresAt, active: users.isActive })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, campaign.sendSessionId));
  if (!row || row.expiresAt < new Date() || !row.active) {
    return { stopped: "The sender's sign-in has ended. Resume the campaign to carry on as you." };
  }
  if (!hasScopeSet(row.scope, "marketing")) {
    return { stopped: "The sender hasn't allowed The Gangway to send email. Resume to grant it." };
  }
  try {
    return { token: await graphTokenForSession(campaign.sendSessionId) };
  } catch {
    return { stopped: "Microsoft would not renew the sender's access. Resume the campaign to carry on as you." };
  }
}

async function sendBatch(campaign: Campaign, batch: CampaignRecipient[], token: string): Promise<PumpResult> {
  const db = getDb();
  const result: PumpResult = { sent: 0, failed: 0, remaining: 0 };
  if (!batch.length) return result;

  // Someone may have unsubscribed since the audience was taken.
  const suppressed = new Set(
    (
      await db
        .select({ email: emailSuppressions.email })
        .from(emailSuppressions)
        .where(inArray(emailSuppressions.email, batch.map((r) => r.email)))
    ).map((r) => r.email),
  );
  const skipped = batch.filter((r) => suppressed.has(r.email));
  if (skipped.length) {
    await db
      .update(campaignRecipients)
      .set({ status: "skipped", error: "Unsubscribed or suppressed before it went." })
      .where(inArray(campaignRecipients.id, skipped.map((r) => r.id)));
  }

  const [settings, links, sender] = await Promise.all([
    getSettings(),
    db.select({ id: campaignLinks.id, url: campaignLinks.url }).from(campaignLinks).where(eq(campaignLinks.campaignId, campaign.id)),
    senderOf(campaign.senderId),
  ]);
  const linkMap = new Map(links.map((l) => [l.url, l.id]));
  const mailbox = campaign.fromMode === "marketing" ? campaign.fromAddress : null;

  const queue = batch.filter((r) => !suppressed.has(r.email));
  let stop: { message: string; fatal: boolean } | null = null;

  const worker = async () => {
    while (queue.length && !stop) {
      const r = queue.shift()!;
      const { subject, html } = composeEmail({
        campaign,
        recipient: r,
        sender,
        settings,
        links: linkMap,
        mode: "send",
      });
      try {
        await sendMessage(token, {
          mailbox,
          to: { address: r.email, name: [r.firstName, r.lastName].filter(Boolean).join(" ") || null },
          subject,
          html,
          replyTo: campaign.replyTo,
          headers: { "X-Gangway-Campaign": campaign.id },
        });
        await db
          .update(campaignRecipients)
          .set({ status: "sent", sentAt: new Date(), error: null })
          .where(eq(campaignRecipients.id, r.id));
        result.sent++;
      } catch (error) {
        const verdict = classifySendError(error);
        if (verdict.retry || verdict.fatal) {
          // Back in the queue for the next run; stop this one.
          await db
            .update(campaignRecipients)
            .set({ status: "queued", claimedAt: null })
            .where(eq(campaignRecipients.id, r.id));
          stop = { message: verdict.message, fatal: verdict.fatal };
        } else {
          await db
            .update(campaignRecipients)
            .set({ status: "failed", error: verdict.message })
            .where(eq(campaignRecipients.id, r.id));
          result.failed++;
        }
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Whatever the workers had not reached goes back to the queue untouched.
  if (queue.length) {
    await db
      .update(campaignRecipients)
      .set({ status: "queued", claimedAt: null })
      .where(inArray(campaignRecipients.id, queue.map((r) => r.id)));
  }

  const halt = stop as { message: string; fatal: boolean } | null;
  if (halt) {
    if (halt.fatal) await pause(campaign.id, halt.message);
    else
      await db
        .update(campaigns)
        .set({ lastError: halt.message, updatedAt: new Date() })
        .where(eq(campaigns.id, campaign.id));
    result.stopped = halt.message;
  } else if (campaign.lastError && result.sent) {
    await db.update(campaigns).set({ lastError: null }).where(eq(campaigns.id, campaign.id));
  }
  return result;
}

export async function senderOf(userId: string | null): Promise<Sender | null> {
  if (!userId) return null;
  const [u] = await getDb()
    .select({ name: users.name, jobTitle: users.jobTitle })
    .from(users)
    .where(eq(users.id, userId));
  return u ?? null;
}

/* ── bounces ─────────────────────────────────────────────────────── */

/**
 * Exchange reports a failed delivery by mailing an "Undeliverable" notice
 * back to the mailbox that sent it. For a few days after a campaign, those
 * notices are read (with the sender's own token) and the addresses in them
 * that this campaign sent to are marked bounced and suppressed.
 */
export async function scanBounces(campaign: Campaign): Promise<number> {
  if (!campaign.startedAt || !campaign.fromAddress) return 0;
  const token = await senderToken(campaign);
  if ("stopped" in token) return 0;

  const db = getDb();
  await db.update(campaigns).set({ bouncesCheckedAt: new Date() }).where(eq(campaigns.id, campaign.id));

  const mailbox = campaign.fromMode === "marketing" ? campaign.fromAddress : null;
  let notices;
  try {
    notices = await searchMessages(token.token, 'subject:"Undeliverable"', 50, mailbox);
  } catch {
    return 0;
  }
  const recent = notices.filter((m) => new Date(m.receivedDateTime) >= campaign.startedAt!);
  if (!recent.length) return 0;

  const sent = await db
    .select({ id: campaignRecipients.id, email: campaignRecipients.email, bouncedAt: campaignRecipients.bouncedAt })
    .from(campaignRecipients)
    .where(and(eq(campaignRecipients.campaignId, campaign.id), eq(campaignRecipients.status, "sent")));
  const byEmail = new Map(sent.map((r) => [r.email, r]));

  let found = 0;
  for (const notice of recent.slice(0, 25)) {
    let text = "";
    try {
      const full = await getMessage(token.token, notice.id, mailbox);
      text = (full.body?.contentType === "html" ? htmlToText(full.body.content) : full.body?.content ?? "").toLowerCase();
    } catch {
      continue;
    }
    // A notice names the address that failed; only addresses this campaign
    // actually sent to, since it started, are taken from it.
    for (const match of text.matchAll(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/g)) {
      const r = byEmail.get(match[0]);
      if (!r || r.bouncedAt) continue;
      r.bouncedAt = new Date();
      found++;
      await db.update(campaignRecipients).set({ bouncedAt: r.bouncedAt }).where(eq(campaignRecipients.id, r.id));
      await db
        .insert(emailSuppressions)
        .values({ email: r.email, reason: "bounced", campaignId: campaign.id, note: "Undeliverable notice from Exchange" })
        .onConflictDoNothing();
    }
  }
  return found;
}

/* ── the heartbeat ───────────────────────────────────────────────── */

/**
 * Called by the cron every minute: start what is due, send what is waiting,
 * and look for bounces on what went out recently. Time-boxed so one run
 * finishes inside the function limit.
 */
export async function runCampaignQueue(deadlineMs = 50_000) {
  const db = getDb();
  const until = Date.now() + deadlineMs;
  const report: Record<string, unknown> = {};

  const due = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.status, "scheduled"), lte(campaigns.scheduledAt, new Date())));
  for (const c of due) report[`start:${c.id}`] = await startCampaign(c.id);

  const active = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(inArray(campaigns.status, ["sending", "testing"]));
  for (const c of active) {
    if (Date.now() > until) break;
    report[c.id] = await pumpCampaign(c.id).catch((e: unknown) => ({ error: String(e) }));
  }

  // Bounce notices: for three days after sending, at most every fifteen minutes.
  const recent = await db
    .select()
    .from(campaigns)
    .where(
      and(
        inArray(campaigns.status, ["sending", "sent", "testing"]),
        gt(campaigns.startedAt, new Date(Date.now() - 3 * 86_400_000)),
        or(
          sql`${campaigns.bouncesCheckedAt} is null`,
          lt(campaigns.bouncesCheckedAt, new Date(Date.now() - 15 * 60_000)),
        ),
      ),
    )
    .limit(3);
  for (const c of recent) {
    if (Date.now() > until) break;
    report[`bounces:${c.id}`] = await scanBounces(c).catch(() => 0);
  }
  return report;
}
