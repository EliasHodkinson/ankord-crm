import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  campaignEvents,
  campaignLinks,
  campaignRecipients,
  campaigns,
  emailSuppressions,
  type CampaignRecipient,
} from "@/lib/db/schema";

/**
 * What the public /m routes record. These run with no session: the only
 * credential is the recipient's token, which identifies one person in one
 * campaign and grants nothing but the right to record their own open, click
 * or unsubscribe. Nothing here reads or reveals anything else.
 *
 * Opens are approximate by nature — Apple Mail fetches images for privacy,
 * and some clients block them — and link scanners (Defender Safe Links) can
 * register a click before a person does. The report says so.
 */

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export async function recipientByToken(token: string): Promise<CampaignRecipient | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await getDb()
    .select()
    .from(campaignRecipients)
    .where(eq(campaignRecipients.token, token))
    .limit(1);
  return row ?? null;
}

const ua = (value: string | null) => value?.slice(0, 300) ?? null;

export async function recordOpen(token: string, userAgent: string | null): Promise<void> {
  const r = await recipientByToken(token);
  if (!r) return;
  const db = getDb();
  await db
    .update(campaignRecipients)
    .set({
      openCount: sql`${campaignRecipients.openCount} + 1`,
      firstOpenedAt: sql`coalesce(${campaignRecipients.firstOpenedAt}, now())`,
    })
    .where(eq(campaignRecipients.id, r.id));
  await db.insert(campaignEvents).values({
    campaignId: r.campaignId,
    recipientId: r.id,
    kind: "open",
    userAgent: ua(userAgent),
  });
}

/** Records a click and returns where it goes — only ever a link of that campaign. */
export async function recordClick(token: string, linkId: string, userAgent: string | null): Promise<string | null> {
  const r = await recipientByToken(token);
  if (!r || !/^[0-9a-f-]{36}$/i.test(linkId)) return null;
  const db = getDb();
  const [link] = await db
    .select({ id: campaignLinks.id, url: campaignLinks.url })
    .from(campaignLinks)
    .where(and(eq(campaignLinks.id, linkId), eq(campaignLinks.campaignId, r.campaignId)));
  if (!link) return null;

  // A click implies the email was opened, even where images were blocked.
  await db
    .update(campaignRecipients)
    .set({
      clickCount: sql`${campaignRecipients.clickCount} + 1`,
      firstClickedAt: sql`coalesce(${campaignRecipients.firstClickedAt}, now())`,
      firstOpenedAt: sql`coalesce(${campaignRecipients.firstOpenedAt}, now())`,
    })
    .where(eq(campaignRecipients.id, r.id));
  await db.insert(campaignEvents).values({
    campaignId: r.campaignId,
    recipientId: r.id,
    kind: "click",
    linkId: link.id,
    userAgent: ua(userAgent),
  });
  return link.url;
}

/**
 * Unsubscribes the address behind a token from every future campaign. Only on
 * an explicit POST from the confirmation page — never on the GET, which mail
 * scanners fetch on their own.
 */
export async function unsubscribe(token: string, userAgent: string | null): Promise<CampaignRecipient | null> {
  const r = await recipientByToken(token);
  if (!r) return null;
  const db = getDb();
  await db
    .insert(emailSuppressions)
    .values({ email: r.email, reason: "unsubscribed", campaignId: r.campaignId })
    .onConflictDoUpdate({
      target: emailSuppressions.email,
      set: { reason: "unsubscribed", campaignId: r.campaignId, createdAt: new Date() },
    });
  if (!r.unsubscribedAt) {
    await db
      .update(campaignRecipients)
      .set({ unsubscribedAt: new Date() })
      .where(eq(campaignRecipients.id, r.id));
    await db.insert(campaignEvents).values({
      campaignId: r.campaignId,
      recipientId: r.id,
      kind: "unsubscribe",
      userAgent: ua(userAgent),
    });
  }
  return r;
}

export async function isSuppressed(email: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.email, email.toLowerCase()));
  return Boolean(row);
}

/** Everything the web version of an email needs, for a token. */
export async function campaignForToken(token: string) {
  const r = await recipientByToken(token);
  if (!r) return null;
  const [campaign] = await getDb().select().from(campaigns).where(eq(campaigns.id, r.campaignId));
  return campaign ? { recipient: r, campaign } : null;
}
