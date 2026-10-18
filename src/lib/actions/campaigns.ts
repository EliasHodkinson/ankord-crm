"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  audienceSegments,
  campaignRecipients,
  campaigns,
  contacts,
  emailAssets,
  emailSuppressions,
  emailTemplates,
  settings,
  type Campaign,
} from "@/lib/db/schema";
import {
  currentSessionId,
  getGraphToken,
  GraphAuthError,
  ReadOnlyError,
  requireAdmin,
  requireMember,
  sessionScopes,
} from "@/lib/auth/session";
import { hasScopeSet } from "@/lib/auth/entra";
import { AccessDenied, assertStaff, getAccess } from "@/lib/access";
import { getSettings } from "@/lib/data/common";
import { appUrl } from "@/lib/env";
import { fromWallTime } from "@/lib/utils";
import { GraphError } from "@/lib/graph/client";
import { sendMessage } from "@/lib/graph/send";
import { resolveAudience } from "@/lib/campaigns/audience";
import { composeEmail, mergeValuesFor } from "@/lib/campaigns/compose";
import {
  cleanBlocks,
  cleanTheme,
  DEFAULT_AB,
  DEFAULT_THEME,
  EMPTY_AUDIENCE,
  normaliseAudience,
  SAMPLE_MERGE,
  type AbTest,
  type AudiencePreview,
  type AudienceRule,
  type EngagementFilter,
  type MergeValues,
} from "@/lib/campaigns/model";
import { starterById } from "@/lib/campaigns/starters";
import { pumpCampaign, startCampaign, type PumpResult } from "@/lib/campaigns/send";
import { fail, fromZod, logActivity, OK, optionalEmail, optionalText, type ActionState } from "./shared";

/**
 * Writes for email marketing. Every action:
 * - is staff-only (`assertStaff`) and needs an admin or staff member
 *   (`requireMember`) — viewers can read reports, not send;
 * - sends nothing except through Graph with the signed-in person's own
 *   delegated token, or — once a campaign is under way — the token of the
 *   session that started it (lib/campaigns/send.ts);
 * - never calls touchRecords: a broadcast is not a conversation.
 */

class Refusal extends Error {}

async function guarded(run: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Refusal || error instanceof ReadOnlyError || error instanceof AccessDenied) {
      return fail(error.message);
    }
    if (error instanceof GraphAuthError) return fail(error.message);
    throw error;
  }
}

async function writer() {
  await assertStaff();
  return requireMember();
}

async function loadCampaign(id: string): Promise<Campaign> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Refusal("That campaign no longer exists.");
  const [row] = await getDb().select().from(campaigns).where(eq(campaigns.id, id));
  if (!row) throw new Refusal("That campaign no longer exists.");
  return row;
}

function editable(c: Campaign) {
  if (c.status !== "draft" && c.status !== "scheduled" && c.status !== "paused") {
    throw new Refusal("This campaign has gone out, so it can't be changed. Duplicate it to make another.");
  }
  if (c.status === "paused" && c.startedAt) {
    throw new Refusal("This campaign is part-sent. Cancel it, or resume it as it is.");
  }
}

function revalidateCampaign(id?: string) {
  revalidatePath("/campaigns");
  if (id) revalidatePath(`/campaigns/${id}`);
}

/** Whether this browser session may send — Mail.Send granted on demand. */
async function canSend(): Promise<boolean> {
  return hasScopeSet(await sessionScopes(), "marketing");
}

/* ── creating ────────────────────────────────────────────────────── */

export async function createCampaign(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  let id = "";
  const result = await guarded(async () => {
    const { user } = await writer();
    const name = String(formData.get("name") ?? "").trim() || "Untitled campaign";
    const source = String(formData.get("source") ?? "starter:blank");
    const [kind, ref] = source.split(":");

    let content: Pick<Campaign, "subject" | "preheader" | "blocks" | "theme"> = {
      subject: "",
      preheader: "",
      blocks: [],
      theme: DEFAULT_THEME,
    };
    let templateId: string | null = null;
    if (kind === "starter") {
      const starter = starterById(ref) ?? starterById("blank")!;
      content = { subject: starter.subject, preheader: starter.preheader, blocks: starter.blocks(), theme: starter.theme };
    } else if (kind === "template") {
      const [t] = await getDb().select().from(emailTemplates).where(eq(emailTemplates.id, ref));
      if (!t) return fail("That template no longer exists.");
      content = { subject: t.subject, preheader: t.preheader, blocks: t.blocks, theme: t.theme };
      templateId = t.id;
    } else if (kind === "campaign") {
      const c = await loadCampaign(ref);
      content = { subject: c.subject, preheader: c.preheader, blocks: c.blocks, theme: c.theme };
      templateId = c.templateId;
    }

    const [row] = await getDb()
      .insert(campaigns)
      .values({
        name,
        ...content,
        templateId,
        fromMode: "marketing",
        audience: EMPTY_AUDIENCE,
        createdById: user.id,
      })
      .returning({ id: campaigns.id });
    id = row.id;
    await logActivity({ entityType: "campaign", entityId: id, verb: "created", summary: `${user.name} started a campaign: ${name}` });
    return OK;
  });
  if (!result.ok) return result;
  revalidateCampaign();
  redirect(`/campaigns/${id}/design`);
}

export async function duplicateCampaign(id: string): Promise<ActionState> {
  let copyId = "";
  const result = await guarded(async () => {
    const { user } = await writer();
    const c = await loadCampaign(id);
    const [row] = await getDb()
      .insert(campaigns)
      .values({
        name: `${c.name} (copy)`,
        subject: c.subject,
        preheader: c.preheader,
        fromMode: c.fromMode,
        replyTo: c.replyTo,
        blocks: c.blocks,
        theme: c.theme,
        audience: c.audience,
        abTest: c.abTest,
        trackOpens: c.trackOpens,
        trackClicks: c.trackClicks,
        templateId: c.templateId,
        createdById: user.id,
      })
      .returning({ id: campaigns.id });
    copyId = row.id;
    return OK;
  });
  if (!result.ok) return result;
  revalidateCampaign();
  redirect(`/campaigns/${copyId}`);
}

/**
 * A follow-up to the people who did (or didn't) respond: same content, same
 * audience rule, narrowed to that engagement. Mailchimp's "resend to
 * non-openers", with the subject left for the person to change.
 */
export async function followUpCampaign(id: string, kind: EngagementFilter): Promise<ActionState> {
  let copyId = "";
  const result = await guarded(async () => {
    const { user } = await writer();
    const c = await loadCampaign(id);
    if (!c.startedAt) return fail("Send the campaign before following it up.");
    const audience: AudienceRule = {
      ...normaliseAudience(c.audience),
      engagement: { campaignId: c.id, campaignName: c.name, kind },
    };
    const [row] = await getDb()
      .insert(campaigns)
      .values({
        name: `${c.name} — follow-up`,
        subject: c.subject,
        preheader: c.preheader,
        fromMode: c.fromMode,
        replyTo: c.replyTo,
        blocks: c.blocks,
        theme: c.theme,
        audience,
        trackOpens: c.trackOpens,
        trackClicks: c.trackClicks,
        createdById: user.id,
      })
      .returning({ id: campaigns.id });
    copyId = row.id;
    return OK;
  });
  if (!result.ok) return result;
  revalidateCampaign();
  redirect(`/campaigns/${copyId}`);
}

export async function deleteCampaign(id: string): Promise<ActionState> {
  const result = await guarded(async () => {
    const { user } = await writer();
    const c = await loadCampaign(id);
    if (c.status !== "draft") return fail("Only a draft can be deleted. Cancel a scheduled campaign first.");
    await getDb().delete(campaigns).where(eq(campaigns.id, id));
    await logActivity({ entityType: "campaign", entityId: id, verb: "deleted", summary: `${user.name} deleted the draft ${c.name}` });
    return OK;
  });
  if (!result.ok) return result;
  revalidateCampaign();
  redirect("/campaigns");
}

/* ── editing ─────────────────────────────────────────────────────── */

const contentInput = z.object({
  subject: z.string().max(300),
  preheader: z.string().max(300),
  blocks: z.unknown(),
  theme: z.unknown(),
});

/** The editor's autosave. Takes plain values, not FormData. */
export async function saveCampaignContent(id: string, input: z.input<typeof contentInput>): Promise<ActionState> {
  return guarded(async () => {
    await writer();
    const parsed = contentInput.safeParse(input);
    if (!parsed.success) return fail("The email could not be saved.");
    const c = await loadCampaign(id);
    editable(c);
    await getDb()
      .update(campaigns)
      .set({
        subject: parsed.data.subject,
        preheader: parsed.data.preheader,
        blocks: cleanBlocks(parsed.data.blocks),
        theme: cleanTheme(parsed.data.theme),
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, id));
    revalidatePath(`/campaigns/${id}`);
    return { ok: true, message: "Saved." };
  });
}

const settingsInput = z.object({
  name: z.string().trim().min(1, "Give the campaign a name.").max(200),
  subject: z.string().trim().max(300),
  preheader: z.string().trim().max(300),
  fromMode: z.enum(["me", "marketing"]),
  replyTo: optionalEmail,
  trackOpens: z.preprocess((v) => v === "on", z.boolean()),
  trackClicks: z.preprocess((v) => v === "on", z.boolean()),
  abEnabled: z.preprocess((v) => v === "on", z.boolean()),
  subjectB: optionalText,
  preheaderB: optionalText,
  testPercent: z.coerce.number().int().min(10).max(100).catch(DEFAULT_AB.testPercent),
  waitHours: z.coerce.number().int().min(1).max(72).catch(DEFAULT_AB.waitHours),
  metric: z.enum(["opens", "clicks"]).catch(DEFAULT_AB.metric),
});

export async function saveCampaignSettings(
  id: string,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  return guarded(async () => {
    await writer();
    const parsed = settingsInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fromZod(parsed.error);
    const v = parsed.data;
    if (v.abEnabled && !v.subjectB) return fail("Write subject B, or turn the A/B test off.", { subjectB: ["Write the second subject line."] });
    const c = await loadCampaign(id);
    editable(c);
    const abTest: AbTest | null = v.abEnabled
      ? { subjectB: v.subjectB!, preheaderB: v.preheaderB ?? "", testPercent: v.testPercent, waitHours: v.waitHours, metric: v.metric }
      : null;
    await getDb()
      .update(campaigns)
      .set({
        name: v.name,
        subject: v.subject,
        preheader: v.preheader,
        fromMode: v.fromMode,
        replyTo: v.replyTo,
        trackOpens: v.trackOpens,
        trackClicks: v.trackClicks,
        abTest,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, id));
    revalidateCampaign(id);
    return { ok: true, message: "Saved." };
  });
}

/* ── audience ────────────────────────────────────────────────────── */

const ruleInput = z.object({}).passthrough();

function cleanRule(value: unknown): AudienceRule {
  const r = normaliseAudience(ruleInput.parse(value));
  const ids = (list: unknown) =>
    Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, 2000) : [];
  return {
    ...r,
    partnerKinds: ids(r.partnerKinds).filter((k): k is "customer" | "supplier" | "media" =>
      ["customer", "supplier", "media"].includes(k),
    ),
    partnerStatuses: ids(r.partnerStatuses),
    partnerTags: ids(r.partnerTags),
    partnerSegments: ids(r.partnerSegments),
    partnerIndustries: ids(r.partnerIndustries),
    partnerStates: ids(r.partnerStates),
    ownerIds: ids(r.ownerIds).filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
    customerIds: ids(r.customerIds).filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
    includeContactIds: ids(r.includeContactIds).filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
    excludeContactIds: ids(r.excludeContactIds).filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
    leadStages: ids(r.leadStages),
    leadTags: ids(r.leadTags),
    contacts: Boolean(r.contacts),
    leads: Boolean(r.leads),
    primaryOnly: Boolean(r.primaryOnly),
    decisionMakersOnly: Boolean(r.decisionMakersOnly),
    consent: ["any", "recorded", "express"].includes(r.consent) ? r.consent : "any",
    notEmailedWithinDays:
      typeof r.notEmailedWithinDays === "number" && r.notEmailedWithinDays > 0
        ? Math.min(Math.round(r.notEmailedWithinDays), 365)
        : null,
    engagement:
      r.engagement && /^[0-9a-f-]{36}$/i.test(r.engagement.campaignId) &&
      ["not_opened", "opened", "clicked", "not_clicked"].includes(r.engagement.kind)
        ? r.engagement
        : null,
  };
}

/** Live count and a sample while the rule is being edited. Reads only. */
export async function previewAudience(rule: unknown): Promise<AudiencePreview> {
  await assertStaff();
  const access = await getAccess();
  const result = await resolveAudience(cleanRule(rule), access);
  return {
    count: result.recipients.length,
    sample: result.recipients.slice(0, 25).map((r) => ({
      email: r.email,
      name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email,
      company: r.company,
      source: r.leadId ? "lead" : "contact",
      contactId: r.contactId,
    })),
    excluded: result.excluded,
    unrecordedConsent: result.unrecordedConsent,
  };
}

export async function saveAudience(id: string, rule: unknown): Promise<ActionState> {
  return guarded(async () => {
    await writer();
    const c = await loadCampaign(id);
    editable(c);
    await getDb()
      .update(campaigns)
      .set({ audience: cleanRule(rule), updatedAt: new Date() })
      .where(eq(campaigns.id, id));
    revalidateCampaign(id);
    return { ok: true, message: "Audience saved." };
  });
}

export async function saveSegment(name: string, rule: unknown): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await writer();
    const clean = name.trim().slice(0, 120);
    if (!clean) return fail("Name the segment.");
    const [row] = await getDb()
      .insert(audienceSegments)
      .values({ name: clean, rule: cleanRule(rule), createdById: user.id })
      .returning({ id: audienceSegments.id });
    revalidatePath("/campaigns/audience");
    return { ok: true, message: `Saved “${clean}”.`, data: { id: row.id } };
  });
}

export async function deleteSegment(id: string): Promise<ActionState> {
  return guarded(async () => {
    await writer();
    await getDb().delete(audienceSegments).where(eq(audienceSegments.id, id));
    revalidatePath("/campaigns/audience");
    return OK;
  });
}

/* ── testing ─────────────────────────────────────────────────────── */

/**
 * Sends the email, as it will look, to a few addresses — from the same
 * mailbox the campaign will use, so a Send As problem shows up here rather
 * than on the real send. Not tracked; the unsubscribe link is inert.
 */
export async function sendTestEmail(id: string, _prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await writer();
    if (!(await canSend())) return fail("Allow The Gangway to send email first.");
    const c = await loadCampaign(id);

    const to = String(formData.get("to") ?? "")
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!to.length) return fail("Add at least one address.", { to: ["Who should get the test?"] });
    if (to.length > 5) return fail("Send a test to five addresses at most.");
    if (to.some((a) => !z.email().safeParse(a).success)) return fail("One of those isn't an email address.");

    // Merge tags filled from a real person if one is chosen, otherwise samples.
    const contactId = String(formData.get("contactId") ?? "");
    let merge: MergeValues = { ...SAMPLE_MERGE, sender_name: user.name, sender_title: user.jobTitle };
    if (/^[0-9a-f-]{36}$/i.test(contactId)) {
      const access = await getAccess();
      const { recipients } = await resolveAudience({ ...EMPTY_AUDIENCE, contacts: false, includeContactIds: [contactId] }, access);
      if (recipients[0]) merge = mergeValuesFor({ ...recipients[0] }, { name: user.name, jobTitle: user.jobTitle });
    }

    const settingsRow = await getSettings();
    const mailbox = c.fromMode === "marketing" ? settingsRow?.marketingMailbox ?? null : null;
    if (c.fromMode === "marketing" && !mailbox) return fail("Set the marketing mailbox in Campaigns → Settings.");

    const { subject, html } = composeEmail({ campaign: c, recipient: null, sender: user, settings: settingsRow, mode: "test", merge });
    const token = await getGraphToken();
    try {
      for (const address of to) {
        await sendMessage(token, {
          mailbox,
          to: { address },
          subject: `[Test] ${subject || "(no subject)"}`,
          html,
          replyTo: c.replyTo,
          saveToSentItems: true,
        });
      }
    } catch (error) {
      if (error instanceof GraphError) {
        if (error.code === "ErrorSendAsDenied") {
          return fail(`Exchange won't let you send as ${mailbox}. Ask an admin to give you Send As on it.`);
        }
        return fail(`Microsoft refused: ${error.message}`);
      }
      throw error;
    }
    await getDb().update(campaigns).set({ testSentAt: new Date() }).where(eq(campaigns.id, id));
    revalidatePath(`/campaigns/${id}`);
    return { ok: true, message: `Test sent to ${to.join(", ")}.` };
  });
}

/* ── sending ─────────────────────────────────────────────────────── */

const scheduleInput = z.object({
  when: z.enum(["now", "later"]),
  at: optionalText,
});

export async function scheduleCampaign(id: string, _prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await writer();
    const parsed = scheduleInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fromZod(parsed.error);
    const c = await loadCampaign(id);
    if (c.status !== "draft" && c.status !== "scheduled") return fail("This campaign has already started.");
    if (!c.subject.trim()) return fail("Write a subject line first.");
    if (!cleanBlocks(c.blocks).length) return fail("The email is empty.");
    if (!(await canSend())) return fail("Allow The Gangway to send email first.");

    const sessionId = await currentSessionId();
    if (!sessionId) throw new GraphAuthError("Sign in again to send.");

    const s = await getSettings();
    if (c.fromMode === "marketing" && !s?.marketingMailbox) return fail("Set the marketing mailbox in Campaigns → Settings.");
    if (!s?.marketingFooter?.trim()) return fail("Add the sender details for the footer in Campaigns → Settings — the Spam Act requires them.");

    const audience = await resolveAudience(normaliseAudience(c.audience), await getAccess());
    if (!audience.recipients.length) return fail("Nobody is in the audience yet.");

    let scheduledAt: Date | null = null;
    if (parsed.data.when === "later") {
      scheduledAt = parsed.data.at ? fromWallTime(parsed.data.at) : null;
      if (!scheduledAt || scheduledAt.getTime() < Date.now() + 60_000) {
        return fail("Pick a time in the future.", { at: ["Pick a time at least a minute from now."] });
      }
    }

    await getDb()
      .update(campaigns)
      .set({
        status: "scheduled",
        scheduledAt: scheduledAt ?? new Date(),
        sendSessionId: sessionId,
        senderId: user.id,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, id));

    if (!scheduledAt) {
      const started = await startCampaign(id);
      if (!started.ok) {
        revalidateCampaign(id);
        return fail(started.message ?? "The campaign could not start.");
      }
      after(() => pumpCampaign(id).catch(() => undefined));
    }

    await logActivity({
      entityType: "campaign",
      entityId: id,
      verb: scheduledAt ? "scheduled" : "sent",
      summary: scheduledAt
        ? `${user.name} scheduled ${c.name} for ${audience.recipients.length} people`
        : `${user.name} started sending ${c.name} to ${audience.recipients.length} people`,
    });
    revalidateCampaign(id);
    return {
      ok: true,
      message: scheduledAt ? "Scheduled." : `Sending to ${audience.recipients.length} people.`,
    };
  });
}

export async function unscheduleCampaign(id: string): Promise<ActionState> {
  return guarded(async () => {
    await writer();
    await getDb()
      .update(campaigns)
      .set({ status: "draft", scheduledAt: null, updatedAt: new Date() })
      .where(and(eq(campaigns.id, id), eq(campaigns.status, "scheduled")));
    revalidateCampaign(id);
    return { ok: true, message: "Back to draft." };
  });
}

export async function pauseCampaign(id: string): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await writer();
    await getDb()
      .update(campaigns)
      .set({ status: "paused", lastError: `Paused by ${user.name}.`, updatedAt: new Date() })
      .where(and(eq(campaigns.id, id), inArray(campaigns.status, ["sending", "testing"])));
    revalidateCampaign(id);
    return { ok: true, message: "Paused." };
  });
}

/**
 * Carries on a paused campaign, sending from now on with the resumer's
 * session. A campaign that sends from a person's own mailbox can only be
 * resumed by that person — anyone else would be sending as them.
 */
export async function resumeCampaign(id: string): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await writer();
    const c = await loadCampaign(id);
    if (c.status !== "paused") return fail("This campaign isn't paused.");
    if (!(await canSend())) return fail("Allow The Gangway to send email first.");
    if (c.fromMode === "me" && c.senderId && c.senderId !== user.id) {
      return fail("This campaign sends from someone else's mailbox, so only they can resume it.");
    }
    const sessionId = await currentSessionId();
    if (!sessionId) throw new GraphAuthError("Sign in again to send.");

    if (!c.startedAt) {
      // Paused before it ever started (a failed start): try again from scratch.
      await getDb()
        .update(campaigns)
        .set({ status: "draft", sendSessionId: sessionId, senderId: user.id, lastError: null })
        .where(eq(campaigns.id, id));
      const started = await startCampaign(id);
      if (!started.ok) {
        revalidateCampaign(id);
        return fail(started.message ?? "The campaign could not start.");
      }
    } else {
      const held = await getDb()
        .select({ id: campaignRecipients.id })
        .from(campaignRecipients)
        .where(and(eq(campaignRecipients.campaignId, id), eq(campaignRecipients.status, "held")))
        .limit(1);
      await getDb()
        .update(campaigns)
        .set({
          status: held.length && !c.abWinner ? "testing" : "sending",
          sendSessionId: sessionId,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(campaigns.id, id));
    }
    after(() => pumpCampaign(id).catch(() => undefined));
    await logActivity({ entityType: "campaign", entityId: id, verb: "resumed", summary: `${user.name} resumed ${c.name}` });
    revalidateCampaign(id);
    return { ok: true, message: "Sending again." };
  });
}

export async function cancelCampaign(id: string): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await writer();
    const c = await loadCampaign(id);
    if (!["scheduled", "sending", "testing", "paused"].includes(c.status)) return fail("There is nothing to cancel.");
    await getDb().update(campaigns).set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() }).where(eq(campaigns.id, id));
    await getDb()
      .update(campaignRecipients)
      .set({ status: "skipped", error: "Campaign cancelled." })
      .where(and(eq(campaignRecipients.campaignId, id), inArray(campaignRecipients.status, ["queued", "held"])));
    await logActivity({ entityType: "campaign", entityId: id, verb: "cancelled", summary: `${user.name} cancelled ${c.name}` });
    revalidateCampaign(id);
    return { ok: true, message: "Cancelled. Nobody else will receive it." };
  });
}

/**
 * Called every so often by an open campaign page, so a send keeps moving
 * between cron runs (and at all where there is no cron, in development).
 * Always sends with the campaign's own sender session, never the viewer's.
 */
export async function nudgeCampaign(id: string): Promise<PumpResult | null> {
  await assertStaff();
  const c = await loadCampaign(id).catch(() => null);
  if (!c || (c.status !== "sending" && c.status !== "testing")) return null;
  const result = await pumpCampaign(id);
  if (result.sent || result.stopped || !result.remaining) revalidatePath(`/campaigns/${id}`);
  return result;
}

/* ── templates ───────────────────────────────────────────────────── */

export async function saveAsTemplate(id: string, name: string): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await writer();
    const c = await loadCampaign(id);
    const clean = name.trim().slice(0, 120) || c.name;
    const [row] = await getDb()
      .insert(emailTemplates)
      .values({
        name: clean,
        subject: c.subject,
        preheader: c.preheader,
        blocks: c.blocks,
        theme: c.theme,
        createdById: user.id,
      })
      .returning({ id: emailTemplates.id });
    revalidatePath("/campaigns/templates");
    return { ok: true, message: `Saved as the template “${clean}”.`, data: { id: row.id } };
  });
}

export async function createTemplate(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  let id = "";
  const result = await guarded(async () => {
    const { user } = await writer();
    const name = String(formData.get("name") ?? "").trim().slice(0, 120) || "Untitled template";
    const starter = starterById(String(formData.get("starter") ?? "blank")) ?? starterById("blank")!;
    const [row] = await getDb()
      .insert(emailTemplates)
      .values({
        name,
        description: optionalText.parse(formData.get("description")),
        subject: starter.subject,
        preheader: starter.preheader,
        blocks: starter.blocks(),
        theme: starter.theme,
        createdById: user.id,
      })
      .returning({ id: emailTemplates.id });
    id = row.id;
    return OK;
  });
  if (!result.ok) return result;
  revalidatePath("/campaigns/templates");
  redirect(`/campaigns/templates/${id}`);
}

export async function saveTemplateContent(
  id: string,
  input: z.input<typeof contentInput> & { name?: string },
): Promise<ActionState> {
  return guarded(async () => {
    await writer();
    const parsed = contentInput.safeParse(input);
    if (!parsed.success) return fail("The template could not be saved.");
    await getDb()
      .update(emailTemplates)
      .set({
        ...(input.name?.trim() ? { name: input.name.trim().slice(0, 120) } : {}),
        subject: parsed.data.subject,
        preheader: parsed.data.preheader,
        blocks: cleanBlocks(parsed.data.blocks),
        theme: cleanTheme(parsed.data.theme),
        updatedAt: new Date(),
      })
      .where(eq(emailTemplates.id, id));
    revalidatePath("/campaigns/templates");
    return { ok: true, message: "Saved." };
  });
}

export async function archiveTemplate(id: string): Promise<ActionState> {
  const result = await guarded(async () => {
    await writer();
    await getDb().update(emailTemplates).set({ archivedAt: new Date() }).where(eq(emailTemplates.id, id));
    return OK;
  });
  if (!result.ok) return result;
  revalidatePath("/campaigns/templates");
  redirect("/campaigns/templates");
}

/* ── images ──────────────────────────────────────────────────────── */

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE = 2 * 1024 * 1024;

/** Stores an image for use in emails; returns its public URL. */
export async function uploadEmailImage(formData: FormData): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await writer();
    const file = formData.get("file");
    if (!(file instanceof File) || !file.size) return fail("Choose an image.");
    if (!IMAGE_TYPES.includes(file.type)) return fail("Use a PNG, JPEG, GIF or WebP image. Most email clients can't show SVG.");
    if (file.size > MAX_IMAGE) return fail("Keep images under 2 MB — big images are slow to load and look like spam.");
    const width = Number(formData.get("width")) || null;
    const height = Number(formData.get("height")) || null;
    const [row] = await getDb()
      .insert(emailAssets)
      .values({
        name: file.name.slice(0, 200),
        mime: file.type,
        size: file.size,
        width,
        height,
        data: Buffer.from(await file.arrayBuffer()).toString("base64"),
        createdById: user.id,
      })
      .returning({ id: emailAssets.id });
    const ext = file.type.split("/")[1].replace("jpeg", "jpg");
    return { ok: true, data: { id: row.id, url: `${appUrl()}/m/i/${row.id}.${ext}` } };
  });
}

/* ── suppressions and consent ────────────────────────────────────── */

export async function addSuppressions(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await writer();
    const emails = String(formData.get("emails") ?? "")
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const bad = emails.filter((e) => !z.email().safeParse(e).success);
    if (!emails.length) return fail("Add at least one address.", { emails: ["Add at least one address."] });
    if (bad.length) return fail(`Not email addresses: ${bad.slice(0, 3).join(", ")}`);
    const note = optionalText.parse(formData.get("note"));
    await getDb()
      .insert(emailSuppressions)
      .values(emails.map((email) => ({ email, reason: "manual" as const, note, createdById: user.id })))
      .onConflictDoNothing();
    revalidatePath("/campaigns/audience");
    return { ok: true, message: `${emails.length} ${emails.length === 1 ? "address" : "addresses"} won't be emailed.` };
  });
}

/** Re-subscribes an address. Only ever at that person's own request. */
export async function removeSuppression(email: string): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await writer();
    await getDb().delete(emailSuppressions).where(eq(emailSuppressions.email, email.toLowerCase()));
    await logActivity({
      entityType: "suppression",
      entityId: user.id,
      verb: "resubscribed",
      summary: `${user.name} allowed marketing email to ${email} again`,
      meta: { email },
    });
    revalidatePath("/campaigns/audience");
    return { ok: true, message: `${email} can be emailed again.` };
  });
}

export async function setMarketingConsent(contactIds: string[], consent: "express" | "inferred" | null): Promise<ActionState> {
  return guarded(async () => {
    await writer();
    const ids = contactIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 1000);
    if (!ids.length) return fail("Choose some people first.");
    if (consent !== null && consent !== "express" && consent !== "inferred") return fail("Unknown consent.");
    await getDb().update(contacts).set({ marketingConsent: consent, updatedAt: new Date() }).where(inArray(contacts.id, ids));
    revalidatePath("/campaigns/audience");
    return { ok: true, message: `Updated ${ids.length} ${ids.length === 1 ? "person" : "people"}.` };
  });
}

/* ── settings ────────────────────────────────────────────────────── */

const SOCIAL = ["website", "linkedin", "facebook", "instagram", "youtube"] as const;

const marketingSettingsInput = z.object({
  marketingMailbox: optionalEmail,
  marketingFooter: z.string().trim().min(10, "Name the business and where it is — the Spam Act requires it.").max(1000),
  marketingLogoUrl: optionalText,
});

export async function saveMarketingSettings(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireAdmin();
    const parsed = marketingSettingsInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fromZod(parsed.error);
    const social: Record<string, string> = {};
    for (const key of SOCIAL) {
      const v = String(formData.get(`social_${key}`) ?? "").trim();
      if (v) social[key] = v;
    }
    const values = {
      marketingMailbox: parsed.data.marketingMailbox?.toLowerCase() ?? null,
      marketingFooter: parsed.data.marketingFooter,
      marketingLogoUrl: parsed.data.marketingLogoUrl,
      marketingSocial: social,
      updatedById: user.id,
    };
    await getDb()
      .insert(settings)
      .values({ id: "singleton", ...values })
      .onConflictDoUpdate({ target: settings.id, set: { ...values, updatedAt: new Date() } });
    revalidatePath("/campaigns/settings");
    return { ok: true, message: "Saved." };
  });
}

