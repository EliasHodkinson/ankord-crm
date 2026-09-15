"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { communications, tasks } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import {
  fail,
  fromZod,
  logActivity,
  optionalDate,
  optionalText,
  optionalUuid,
  touchRecords,
  type ActionState,
} from "./shared";

const logSchema = z.object({
  customerId: optionalUuid,
  contactId: optionalUuid,
  projectId: optionalUuid,
  leadId: optionalUuid,
  type: z.enum(["email", "call", "meeting", "note", "teams"]),
  direction: z.enum(["inbound", "outbound", "internal"]),
  visibility: z.enum(["team", "private"]).default("team"),
  subject: optionalText,
  body: z.string().trim().min(1, "Write something worth remembering."),
  occurredAt: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? new Date() : v),
    z.coerce.date(),
  ),
  /* Activity-based selling: log what happened, and say what happens next. */
  followUpTitle: optionalText,
  followUpDate: optionalDate,
  redirectTo: z.string().default("/"),
});

export async function logCommunication(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireUser();
  const parsed = logSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  const { redirectTo, body, followUpTitle, followUpDate, ...values } = parsed.data;

  const [row] = await getDb()
    .insert(communications)
    .values({
      ...values,
      body,
      preview: body.replace(/\s+/g, " ").slice(0, 200),
      loggedById: user.id,
    })
    .returning({ id: communications.id });

  if (followUpTitle) {
    await getDb()
      .insert(tasks)
      .values({
        title: followUpTitle,
        dueDate: followUpDate,
        assigneeId: user.id,
        customerId: values.customerId,
        contactId: values.contactId,
        projectId: values.projectId,
        leadId: values.leadId,
        createdById: user.id,
      });
  }

  await touchRecords({
    customerId: values.customerId,
    projectId: values.projectId,
    leadId: values.leadId,
    at: values.occurredAt,
  });

  await logActivity({
    entityType: "communication",
    entityId: row.id,
    customerId: values.customerId,
    projectId: values.projectId,
    leadId: values.leadId,
    verb: "logged",
    summary: `Logged a ${values.type}${values.subject ? `: ${values.subject}` : ""}`,
  });

  revalidatePath(redirectTo);
  revalidatePath("/tasks");
  return {
    ok: true,
    message: followUpTitle ? "Logged, and the follow-up is set." : "Logged.",
  };
}

export async function deleteCommunication(
  id: string,
  redirectTo: string,
): Promise<ActionState> {
  const { user } = await requireUser();
  const db = getDb();

  const [row] = await db
    .select({ loggedById: communications.loggedById })
    .from(communications)
    .where(eq(communications.id, id))
    .limit(1);

  if (!row) return fail("That entry has already been removed.");
  if (row.loggedById !== user.id && user.role !== "admin") {
    return fail("Only the person who logged it, or an admin, can remove it.");
  }

  await db.delete(communications).where(eq(communications.id, id));
  revalidatePath(redirectTo);
  return { ok: true, message: "Removed." };
}
