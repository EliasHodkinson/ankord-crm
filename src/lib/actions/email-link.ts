"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { communications, contacts } from "@/lib/db/schema";
import { getGraphToken, requireUser } from "@/lib/auth/session";
import {
  addressOf,
  cleanText,
  getMessage,
  htmlToText,
  nameOf,
  recipientList,
} from "@/lib/graph/mail";
import { describeGraphFailure } from "@/lib/graph/errors";
import {
  fail,
  logActivity,
  optionalUuid,
  touchRecords,
  type ActionState,
} from "./shared";

const linkSchema = z.object({
  messageIds: z.string().min(1, "Choose at least one email."),
  customerId: optionalUuid,
  projectId: optionalUuid,
  leadId: optionalUuid,
  visibility: z.enum(["team", "private"]).default("team"),
});

/**
 * Pulls the selected Outlook messages into the CRM timeline. Messages already
 * linked are skipped rather than duplicated.
 */
export async function linkEmails(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireUser();
  const parsed = linkSchema.safeParse({
    messageIds: formData.getAll("messageIds").join(" "),
    customerId: formData.get("customerId"),
    projectId: formData.get("projectId"),
    leadId: formData.get("leadId"),
    visibility: formData.get("visibility") ?? "team",
  });
  if (!parsed.success) return fail("Choose at least one email, and where it belongs.");

  const { customerId, projectId, leadId, visibility } = parsed.data;
  if (!customerId && !projectId && !leadId) {
    return fail("Pick the customer, project or lead this belongs against.");
  }

  const ids = parsed.data.messageIds.split(" ").filter(Boolean);
  const db = getDb();

  let linked = 0;
  let skipped = 0;

  try {
    const token = await getGraphToken();

    for (const messageId of ids) {
      const message = await getMessage(token, messageId);

      // One CRM entry per Microsoft message, no matter who links it.
      if (message.internetMessageId) {
        const [existing] = await db
          .select({ id: communications.id })
          .from(communications)
          .where(eq(communications.graphInternetMessageId, message.internetMessageId))
          .limit(1);
        if (existing) {
          skipped += 1;
          continue;
        }
      }

      const fromAddress = addressOf(message.from ?? message.sender);
      const contactId = customerId
        ? await matchContact(customerId, [
            fromAddress,
            ...recipientList(message.toRecipients).map((r) => r.address.toLowerCase()),
          ])
        : null;

      const body = message.body?.content ?? message.bodyPreview ?? "";
      const isHtml = message.body?.contentType === "html";

      await db.insert(communications).values({
        customerId,
        projectId,
        leadId,
        contactId,
        type: "email",
        direction: fromAddress === user.email.toLowerCase() ? "outbound" : "inbound",
        visibility,
        subject: cleanText(message.subject ?? "") || "(no subject)",
        preview: (isHtml ? htmlToText(body) : cleanText(body)).slice(0, 400),
        body,
        bodyIsHtml: isHtml,
        occurredAt: new Date(message.receivedDateTime),
        fromName: nameOf(message.from ?? message.sender),
        fromEmail: fromAddress,
        toRecipients: recipientList(message.toRecipients),
        ccRecipients: recipientList(message.ccRecipients),
        hasAttachments: Boolean(message.hasAttachments),
        graphMessageId: message.id,
        graphInternetMessageId: message.internetMessageId ?? null,
        graphConversationId: message.conversationId ?? null,
        graphWebLink: message.webLink ?? null,
        linkedFromUserId: user.id,
        loggedById: user.id,
      });
      linked += 1;
    }
  } catch (error) {
    return fail(describeGraphFailure(error));
  }

  if (linked > 0) await touchRecords({ customerId, projectId, leadId });

  await logActivity({
    entityType: "communication",
    entityId: customerId ?? projectId ?? leadId!,
    customerId,
    projectId,
    leadId,
    verb: "email_linked",
    summary: `Linked ${linked} ${linked === 1 ? "email" : "emails"} from Microsoft 365`,
  });

  if (customerId) revalidatePath(`/customers/${customerId}`);
  if (projectId) revalidatePath(`/projects/${projectId}`);
  if (leadId) revalidatePath(`/leads/${leadId}`);
  revalidatePath("/inbox");

  if (linked === 0 && skipped > 0) {
    return { ok: true, message: "Those emails were already linked." };
  }
  const parts = [`Linked ${linked} ${linked === 1 ? "email" : "emails"}.`];
  if (skipped > 0) parts.push(`${skipped} already linked.`);
  return { ok: true, message: parts.join(" ") };
}

/** Attaches the email to a known person at the customer, when there is one. */
async function matchContact(
  customerId: string,
  addresses: (string | null)[],
): Promise<string | null> {
  const clean = addresses.filter((a): a is string => Boolean(a));
  if (clean.length === 0) return null;

  const [match] = await getDb()
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.customerId, customerId), inArray(contacts.email, clean)))
    .limit(1);

  return match?.id ?? null;
}
