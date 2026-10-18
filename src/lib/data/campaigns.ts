import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import {
  audienceSegments,
  campaignEvents,
  campaignLinks,
  campaignRecipients,
  campaigns,
  contacts,
  customers,
  emailAssets,
  emailSuppressions,
  emailTemplates,
  users,
} from "@/lib/db/schema";
import { getAccess, requireStaffPage } from "@/lib/access";
import { variantResults } from "@/lib/campaigns/send";

/**
 * Reads for email marketing. Campaigns are a staff area: every function here
 * starts with requireStaffPage, so a restricted person gets a 404, not data.
 */

/** Per-campaign totals, computed from recipients so they can never drift. */
const stats = {
  recipients: sql<number>`count(${campaignRecipients.id})::int`,
  sent: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'sent')::int`,
  failed: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'failed')::int`,
  waiting: sql<number>`count(*) filter (where ${campaignRecipients.status} in ('queued','held','sending'))::int`,
  opened: sql<number>`count(${campaignRecipients.firstOpenedAt})::int`,
  clicked: sql<number>`count(${campaignRecipients.firstClickedAt})::int`,
  unsubscribed: sql<number>`count(${campaignRecipients.unsubscribedAt})::int`,
  bounced: sql<number>`count(${campaignRecipients.bouncedAt})::int`,
};

export type CampaignStats = { [K in keyof typeof stats]: number };

export const EMPTY_STATS: CampaignStats = {
  recipients: 0,
  sent: 0,
  failed: 0,
  waiting: 0,
  opened: 0,
  clicked: 0,
  unsubscribed: 0,
  bounced: 0,
};

async function statsFor(ids: string[]): Promise<Map<string, CampaignStats>> {
  if (!ids.length) return new Map();
  const rows = await getDb()
    .select({ campaignId: campaignRecipients.campaignId, ...stats })
    .from(campaignRecipients)
    .where(inArray(campaignRecipients.campaignId, ids))
    .groupBy(campaignRecipients.campaignId);
  return new Map(rows.map(({ campaignId, ...s }) => [campaignId, s]));
}

export async function listCampaigns(filter: { status?: string; q?: string } = {}) {
  await requireStaffPage();
  const where: SQL[] = [];
  if (filter.status === "drafts") where.push(eq(campaigns.status, "draft"));
  else if (filter.status === "active")
    where.push(inArray(campaigns.status, ["scheduled", "sending", "testing", "paused"]));
  else if (filter.status === "sent") where.push(eq(campaigns.status, "sent"));
  if (filter.q) where.push(or(ilike(campaigns.name, `%${filter.q}%`), ilike(campaigns.subject, `%${filter.q}%`))!);

  const rows = await getDb()
    .select({ campaign: campaigns, senderName: users.name })
    .from(campaigns)
    .leftJoin(users, eq(users.id, sql`coalesce(${campaigns.senderId}, ${campaigns.createdById})`))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(sql`coalesce(${campaigns.startedAt}, ${campaigns.scheduledAt}, ${campaigns.updatedAt})`))
    .limit(300);

  const byId = await statsFor(rows.map((r) => r.campaign.id));
  return rows.map((r) => ({ ...r, stats: byId.get(r.campaign.id) ?? EMPTY_STATS }));
}

export type CampaignListRow = Awaited<ReturnType<typeof listCampaigns>>[number];

export async function getCampaign(id: string) {
  await requireStaffPage();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const creator = alias(users, "creator");
  const [row] = await getDb()
    .select({ campaign: campaigns, senderName: users.name, senderEmail: users.email, creatorName: creator.name })
    .from(campaigns)
    .leftJoin(users, eq(users.id, campaigns.senderId))
    .leftJoin(creator, eq(creator.id, campaigns.createdById))
    .where(eq(campaigns.id, id));
  if (!row) return null;
  const s = (await statsFor([id])).get(id) ?? EMPTY_STATS;
  return { ...row, stats: s };
}

export type CampaignDetail = NonNullable<Awaited<ReturnType<typeof getCampaign>>>;

/** Everything the report shows beyond the totals. */
export async function campaignReport(id: string, recipientFilter?: string) {
  await requireStaffPage();
  const db = getDb();

  const linkRows = await db
    .select({
      id: campaignLinks.id,
      url: campaignLinks.url,
      label: campaignLinks.label,
      clicks: sql<number>`count(${campaignEvents.id})::int`,
      people: sql<number>`count(distinct ${campaignEvents.recipientId})::int`,
    })
    .from(campaignLinks)
    .leftJoin(campaignEvents, and(eq(campaignEvents.linkId, campaignLinks.id), eq(campaignEvents.kind, "click")))
    .where(eq(campaignLinks.campaignId, id))
    .groupBy(campaignLinks.id)
    .orderBy(asc(campaignLinks.position));

  // First opens and first clicks by hour since sending started, over two days.
  const timeline = await db.execute<{ hour: number; opens: number; clicks: number }>(sql`
    with c as (select started_at from campaigns where id = ${id})
    select h.hour,
      (select count(*) from campaign_recipients r, c
        where r.campaign_id = ${id} and r.first_opened_at is not null
          and floor(extract(epoch from r.first_opened_at - c.started_at) / 3600) = h.hour)::int as opens,
      (select count(*) from campaign_recipients r, c
        where r.campaign_id = ${id} and r.first_clicked_at is not null
          and floor(extract(epoch from r.first_clicked_at - c.started_at) / 3600) = h.hour)::int as clicks
    from generate_series(0, 47) as h(hour)
  `);

  const where: SQL[] = [eq(campaignRecipients.campaignId, id)];
  switch (recipientFilter) {
    case "opened":
      where.push(isNotNull(campaignRecipients.firstOpenedAt));
      break;
    case "not_opened":
      where.push(eq(campaignRecipients.status, "sent"), isNull(campaignRecipients.firstOpenedAt));
      break;
    case "clicked":
      where.push(isNotNull(campaignRecipients.firstClickedAt));
      break;
    case "unsubscribed":
      where.push(isNotNull(campaignRecipients.unsubscribedAt));
      break;
    case "bounced":
      where.push(isNotNull(campaignRecipients.bouncedAt));
      break;
    case "failed":
      where.push(inArray(campaignRecipients.status, ["failed", "skipped"]));
      break;
    case "waiting":
      where.push(inArray(campaignRecipients.status, ["queued", "held", "sending"]));
      break;
  }

  const recipients = await db
    .select({
      id: campaignRecipients.id,
      email: campaignRecipients.email,
      firstName: campaignRecipients.firstName,
      lastName: campaignRecipients.lastName,
      company: campaignRecipients.company,
      customerId: campaignRecipients.customerId,
      leadId: campaignRecipients.leadId,
      variant: campaignRecipients.variant,
      status: campaignRecipients.status,
      error: campaignRecipients.error,
      sentAt: campaignRecipients.sentAt,
      firstOpenedAt: campaignRecipients.firstOpenedAt,
      openCount: campaignRecipients.openCount,
      clickCount: campaignRecipients.clickCount,
      unsubscribedAt: campaignRecipients.unsubscribedAt,
      bouncedAt: campaignRecipients.bouncedAt,
    })
    .from(campaignRecipients)
    .where(and(...where))
    .orderBy(
      desc(campaignRecipients.clickCount),
      desc(campaignRecipients.openCount),
      asc(campaignRecipients.email),
    )
    .limit(500);

  return {
    links: linkRows,
    timeline: timeline.rows,
    recipients,
    variants: await variantResults(id),
  };
}

/* ── templates, segments, assets ─────────────────────────────────── */

export async function listTemplates() {
  await requireStaffPage();
  return getDb()
    .select({ template: emailTemplates, authorName: users.name })
    .from(emailTemplates)
    .leftJoin(users, eq(users.id, emailTemplates.createdById))
    .where(isNull(emailTemplates.archivedAt))
    .orderBy(desc(emailTemplates.updatedAt));
}

export async function getTemplate(id: string) {
  await requireStaffPage();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await getDb().select().from(emailTemplates).where(eq(emailTemplates.id, id));
  return row ?? null;
}

export async function listSegments() {
  await requireStaffPage();
  return getDb().select().from(audienceSegments).orderBy(asc(audienceSegments.name));
}

export async function listAssets() {
  await requireStaffPage();
  return getDb()
    .select({
      id: emailAssets.id,
      name: emailAssets.name,
      width: emailAssets.width,
      height: emailAssets.height,
      size: emailAssets.size,
      createdAt: emailAssets.createdAt,
    })
    .from(emailAssets)
    .orderBy(desc(emailAssets.createdAt))
    .limit(120);
}

/** Earlier campaigns, for "resend to non-openers" and engagement filters. */
export async function listSentCampaigns() {
  await requireStaffPage();
  return getDb()
    .select({ id: campaigns.id, name: campaigns.name, startedAt: campaigns.startedAt })
    .from(campaigns)
    .where(inArray(campaigns.status, ["sent", "sending", "testing", "paused"]))
    .orderBy(desc(campaigns.startedAt))
    .limit(50);
}

/* ── the audience area ───────────────────────────────────────────── */

export async function listSuppressions(q?: string) {
  await requireStaffPage();
  return getDb()
    .select({ suppression: emailSuppressions, campaignName: campaigns.name, byName: users.name })
    .from(emailSuppressions)
    .leftJoin(campaigns, eq(campaigns.id, emailSuppressions.campaignId))
    .leftJoin(users, eq(users.id, emailSuppressions.createdById))
    .where(q ? ilike(emailSuppressions.email, `%${q}%`) : undefined)
    .orderBy(desc(emailSuppressions.createdAt))
    .limit(500);
}

/** The shape of the mailing list: who can be reached, on what consent. */
export async function audienceHealth() {
  await requireStaffPage();
  const db = getDb();
  const [row] = await db
    .select({
      withEmail: count(),
      express: sql<number>`count(*) filter (where ${contacts.marketingConsent} = 'express')::int`,
      inferred: sql<number>`count(*) filter (where ${contacts.marketingConsent} = 'inferred')::int`,
      suppressed: sql<number>`count(*) filter (where exists (select 1 from ${emailSuppressions} s where s.email = lower(${contacts.email})))::int`,
    })
    .from(contacts)
    .innerJoin(customers, eq(customers.id, contacts.customerId))
    .where(
      and(isNull(contacts.archivedAt), isNull(customers.archivedAt), isNotNull(contacts.email), ne(contacts.email, "")),
    );
  return row ?? { withEmail: 0, express: 0, inferred: 0, suppressed: 0 };
}

/** People with an email and how they stand, for setting consent in bulk. */
export async function listMarketingContacts(filter: { q?: string; consent?: string }) {
  await requireStaffPage();
  const where: SQL[] = [
    isNull(contacts.archivedAt),
    isNull(customers.archivedAt),
    isNotNull(contacts.email),
    ne(contacts.email, ""),
  ];
  if (filter.q) {
    where.push(
      or(
        ilike(contacts.firstName, `%${filter.q}%`),
        ilike(contacts.lastName, `%${filter.q}%`),
        ilike(contacts.email, `%${filter.q}%`),
        ilike(customers.name, `%${filter.q}%`),
      )!,
    );
  }
  if (filter.consent === "express") where.push(eq(contacts.marketingConsent, "express"));
  else if (filter.consent === "inferred") where.push(eq(contacts.marketingConsent, "inferred"));
  else if (filter.consent === "none") where.push(isNull(contacts.marketingConsent));

  const rows = await getDb()
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      consent: contacts.marketingConsent,
      customerId: customers.id,
      customerName: customers.name,
      suppressed: emailSuppressions.reason,
    })
    .from(contacts)
    .innerJoin(customers, eq(customers.id, contacts.customerId))
    .leftJoin(emailSuppressions, eq(emailSuppressions.email, sql`lower(${contacts.email})`))
    .where(and(...where))
    .orderBy(asc(customers.name), asc(contacts.firstName))
    .limit(500);
  return rows;
}

/* ── on a record ─────────────────────────────────────────────────── */

/**
 * The campaigns a business partner's people received, for its record page.
 * Takes the customer id the page has already access-checked.
 */
export async function marketingForCustomer(customerId: string) {
  // Campaigns are staff-only; a restricted person simply doesn't get the card.
  if ((await getAccess()).restricted) return null;
  const db = getDb();
  const [received, suppressed] = await Promise.all([
    db
      .select({
        campaignId: campaigns.id,
        name: campaigns.name,
        status: campaigns.status,
        email: campaignRecipients.email,
        firstName: campaignRecipients.firstName,
        lastName: campaignRecipients.lastName,
        sentAt: campaignRecipients.sentAt,
        opened: campaignRecipients.firstOpenedAt,
        clicked: campaignRecipients.firstClickedAt,
        unsubscribed: campaignRecipients.unsubscribedAt,
      })
      .from(campaignRecipients)
      .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
      .where(and(eq(campaignRecipients.customerId, customerId), eq(campaignRecipients.status, "sent")))
      .orderBy(desc(campaignRecipients.sentAt))
      .limit(30),
    db
      .select({ email: emailSuppressions.email, reason: emailSuppressions.reason })
      .from(emailSuppressions)
      .innerJoin(contacts, eq(sql`lower(${contacts.email})`, emailSuppressions.email))
      .where(eq(contacts.customerId, customerId)),
  ]);
  return { received, suppressed };
}

