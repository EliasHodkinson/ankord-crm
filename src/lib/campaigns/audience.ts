import "server-only";
import { and, arrayOverlaps, eq, gt, inArray, isNotNull, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  campaignRecipients,
  contacts,
  customers,
  emailSuppressions,
  leads,
} from "@/lib/db/schema";
import { contactScope, customerScope, type Access } from "@/lib/access";
import type { AudienceRule } from "./model";

/**
 * Turns an audience rule into the people it reaches today.
 *
 * Every address is lower-cased and appears once; a contact wins over a lead
 * with the same address. Suppressed addresses (unsubscribed, bounced, taken
 * out by hand) never come back, whatever the rule says.
 */

export type Candidate = {
  contactId: string | null;
  leadId: string | null;
  customerId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  consent: "express" | "inferred" | null;
};

export type AudienceResult = {
  recipients: Candidate[];
  /** Why people the rule matched are not in it. */
  excluded: { suppressed: number; consent: number; recent: number; engagement: number };
  /** People with no consent recorded, still included (the rule allows it). */
  unrecordedConsent: number;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitName(full: string | null): { first: string | null; last: string | null } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: null, last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") || null };
}

export async function resolveAudience(rule: AudienceRule, access: Access): Promise<AudienceResult> {
  const db = getDb();
  const found = new Map<string, Candidate>();
  const add = (c: Candidate) => {
    const email = c.email.trim().toLowerCase();
    if (!EMAIL.test(email) || found.has(email)) return;
    found.set(email, { ...c, email });
  };

  const scope = contactScope(access);
  const contactSelect = {
    contactId: contacts.id,
    customerId: customers.id,
    email: contacts.email,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    jobTitle: contacts.jobTitle,
    company: customers.name,
    consent: contacts.marketingConsent,
  };
  const live = and(
    isNull(contacts.archivedAt),
    isNull(customers.archivedAt),
    isNotNull(contacts.email),
    ne(contacts.email, ""),
    scope,
  );

  // Hand-picked people first: they are in regardless of the filters.
  if (rule.includeContactIds.length) {
    const picked = await db
      .select(contactSelect)
      .from(contacts)
      .innerJoin(customers, eq(customers.id, contacts.customerId))
      .where(and(live, inArray(contacts.id, rule.includeContactIds)));
    for (const r of picked) add({ ...r, email: r.email!, leadId: null });
  }

  let consentDropped = 0;

  if (rule.contacts) {
    const filters: (SQL | undefined)[] = [live];
    if (rule.partnerKinds.length) {
      filters.push(
        or(
          ...rule.partnerKinds.map((k) =>
            k === "customer"
              ? eq(customers.isCustomer, true)
              : k === "supplier"
                ? eq(customers.isSupplier, true)
                : eq(customers.isMedia, true),
          ),
        ),
      );
    }
    if (rule.partnerStatuses.length) {
      filters.push(
        inArray(customers.status, rule.partnerStatuses as (typeof customers.status.enumValues)[number][]),
      );
    }
    if (rule.partnerTags.length) filters.push(arrayOverlaps(customers.tags, rule.partnerTags));
    if (rule.partnerSegments.length) filters.push(inArray(customers.segment, rule.partnerSegments));
    if (rule.partnerIndustries.length) filters.push(inArray(customers.industry, rule.partnerIndustries));
    if (rule.partnerStates.length) filters.push(inArray(customers.state, rule.partnerStates));
    if (rule.ownerIds.length) filters.push(inArray(customers.ownerId, rule.ownerIds));
    if (rule.customerIds.length) filters.push(inArray(customers.id, rule.customerIds));
    if (rule.primaryOnly) filters.push(eq(contacts.isPrimary, true));
    if (rule.decisionMakersOnly) filters.push(eq(contacts.isDecisionMaker, true));
    if (rule.excludeContactIds.length) filters.push(notInArray(contacts.id, rule.excludeContactIds));

    const rows = await db
      .select(contactSelect)
      .from(contacts)
      .innerJoin(customers, eq(customers.id, contacts.customerId))
      .where(and(...filters))
      .orderBy(customers.name, contacts.firstName)
      .limit(20_000);

    for (const r of rows) {
      const ok =
        rule.consent === "any" ||
        (rule.consent === "recorded" && r.consent !== null) ||
        (rule.consent === "express" && r.consent === "express");
      if (!ok) {
        consentDropped++;
        continue;
      }
      add({ ...r, email: r.email!, leadId: null });
    }
  }

  // Leads are staff-only records, and campaigns are staff-only too.
  if (rule.leads && !access.restricted) {
    const filters: (SQL | undefined)[] = [
      isNotNull(leads.email),
      ne(leads.email, ""),
      // A converted lead lives on as a business partner and its people.
      isNull(leads.convertedCustomerId),
    ];
    if (rule.leadStages.length) {
      filters.push(inArray(leads.stage, rule.leadStages as (typeof leads.stage.enumValues)[number][]));
    }
    if (rule.leadTags.length) filters.push(arrayOverlaps(leads.tags, rule.leadTags));

    const rows = await db
      .select({
        leadId: leads.id,
        email: leads.email,
        contactName: leads.contactName,
        company: leads.companyName,
        jobTitle: leads.jobTitle,
      })
      .from(leads)
      .where(and(...filters))
      .limit(20_000);

    for (const r of rows) {
      if (rule.consent !== "any") {
        // Leads carry no consent record, so a consent filter leaves them out.
        consentDropped++;
        continue;
      }
      const { first, last } = splitName(r.contactName);
      add({
        contactId: null,
        leadId: r.leadId,
        customerId: null,
        email: r.email!,
        firstName: first,
        lastName: last,
        company: r.company,
        jobTitle: r.jobTitle,
        consent: null,
      });
    }
  }

  const emails = [...found.keys()];
  const excluded = { suppressed: 0, consent: consentDropped, recent: 0, engagement: 0 };
  if (!emails.length) return { recipients: [], excluded, unrecordedConsent: 0 };

  const drop = (set: Set<string>, key: keyof typeof excluded) => {
    for (const email of set) {
      if (found.delete(email)) excluded[key]++;
    }
  };

  // Suppression is checked in chunks, so a big audience stays one query each.
  const suppressed = new Set<string>();
  for (let i = 0; i < emails.length; i += 1000) {
    const rows = await db
      .select({ email: emailSuppressions.email })
      .from(emailSuppressions)
      .where(inArray(emailSuppressions.email, emails.slice(i, i + 1000)));
    for (const r of rows) suppressed.add(r.email);
  }
  drop(suppressed, "suppressed");

  if (rule.notEmailedWithinDays && rule.notEmailedWithinDays > 0) {
    const since = new Date(Date.now() - rule.notEmailedWithinDays * 86_400_000);
    const rows = await db
      .selectDistinct({ email: campaignRecipients.email })
      .from(campaignRecipients)
      .where(and(eq(campaignRecipients.status, "sent"), gt(campaignRecipients.sentAt, since)));
    drop(new Set(rows.map((r) => r.email)), "recent");
  }

  if (rule.engagement) {
    const { campaignId, kind } = rule.engagement;
    const base = and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "sent"));
    const condition =
      kind === "opened"
        ? isNotNull(campaignRecipients.firstOpenedAt)
        : kind === "not_opened"
          ? isNull(campaignRecipients.firstOpenedAt)
          : kind === "clicked"
            ? isNotNull(campaignRecipients.firstClickedAt)
            : isNull(campaignRecipients.firstClickedAt);
    const rows = await db
      .select({ email: campaignRecipients.email })
      .from(campaignRecipients)
      .where(and(base, condition));
    const keep = new Set(rows.map((r) => r.email));
    drop(new Set([...found.keys()].filter((e) => !keep.has(e))), "engagement");
  }

  const recipients = [...found.values()];
  return {
    recipients,
    excluded,
    unrecordedConsent: recipients.filter((r) => r.consent === null).length,
  };
}

/** The values a rule can filter on, for the audience builder's pickers. */
export async function audienceOptions(access: Access) {
  const db = getDb();
  const scope = customerScope(access, customers.id);
  const [tags, segments, industries, states, leadTags, partners] = await Promise.all([
    db.execute<{ tag: string }>(
      sql`select distinct unnest(${customers.tags}) as tag from ${customers} where ${customers.archivedAt} is null order by 1`,
    ),
    db
      .selectDistinct({ v: customers.segment })
      .from(customers)
      .where(and(isNotNull(customers.segment), isNull(customers.archivedAt), scope)),
    db
      .selectDistinct({ v: customers.industry })
      .from(customers)
      .where(and(isNotNull(customers.industry), isNull(customers.archivedAt), scope)),
    db
      .selectDistinct({ v: customers.state })
      .from(customers)
      .where(and(isNotNull(customers.state), isNull(customers.archivedAt), scope)),
    db.execute<{ tag: string }>(sql`select distinct unnest(${leads.tags}) as tag from ${leads} order by 1`),
    db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(isNull(customers.archivedAt), scope))
      .orderBy(customers.name)
      .limit(2000),
  ]);
  const clean = (rows: { v: string | null }[]) =>
    rows.map((r) => r.v!.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
  return {
    tags: tags.rows.map((r) => r.tag),
    segments: clean(segments),
    industries: clean(industries),
    states: clean(states),
    leadTags: leadTags.rows.map((r) => r.tag),
    partners,
  };
}

export type AudienceOptions = Awaited<ReturnType<typeof audienceOptions>>;
