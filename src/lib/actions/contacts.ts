"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { contactFacts, contacts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import {
  emptyToNull,
  fail,
  fromZod,
  logActivity,
  optionalDate,
  optionalEmail,
  optionalText,
  optionalUrl,
  type ActionState,
} from "./shared";

const contactSchema = z.object({
  customerId: z.uuid(),
  firstName: z.string().trim().min(1, "A first name at least."),
  lastName: optionalText,
  jobTitle: optionalText,
  email: optionalEmail,
  phone: optionalText,
  mobile: optionalText,
  linkedin: optionalUrl,
  isPrimary: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  isDecisionMaker: z.preprocess(
    (v) => v === "on" || v === "true" || v === true,
    z.boolean(),
  ),
  coffeeOrder: optionalText,
  birthday: optionalDate,
  dietary: optionalText,
  pronouns: optionalText,
  preferredContact: optionalText,
  notes: optionalText,
});

/** Only one contact per customer can be the primary one. */
async function demoteOtherPrimaries(customerId: string, keepId?: string) {
  const db = getDb();
  await db
    .update(contacts)
    .set({ isPrimary: false })
    .where(
      keepId
        ? and(eq(contacts.customerId, customerId), ne(contacts.id, keepId))
        : eq(contacts.customerId, customerId),
    );
}

export async function createContact(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireUser();
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  if (parsed.data.isPrimary) await demoteOtherPrimaries(parsed.data.customerId);

  const [row] = await getDb()
    .insert(contacts)
    .values({ ...parsed.data, createdById: user.id })
    .returning({ id: contacts.id });

  await logActivity({
    entityType: "contact",
    entityId: row.id,
    customerId: parsed.data.customerId,
    verb: "created",
    summary: `Added ${parsed.data.firstName} ${parsed.data.lastName ?? ""}`.trim(),
  });

  revalidatePath(`/customers/${parsed.data.customerId}`);
  revalidatePath("/contacts");
  return { ok: true, message: "Contact added." };
}

export async function updateContact(
  id: string,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  if (parsed.data.isPrimary) await demoteOtherPrimaries(parsed.data.customerId, id);

  await getDb()
    .update(contacts)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(contacts.id, id));

  await logActivity({
    entityType: "contact",
    entityId: id,
    customerId: parsed.data.customerId,
    verb: "updated",
    summary: `Updated ${parsed.data.firstName}`,
  });

  revalidatePath(`/customers/${parsed.data.customerId}`);
  revalidatePath("/contacts");
  return { ok: true, message: "Saved." };
}

export async function deleteContact(id: string, customerId: string): Promise<void> {
  await requireUser();
  await getDb().delete(contacts).where(eq(contacts.id, id));
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/contacts");
}

/* ── the small human details ─────────────────────────────────────── */

const factSchema = z.object({
  contactId: z.uuid(),
  customerId: z.uuid(),
  kind: z.enum(["preference", "personal", "event", "mention"]),
  label: z.string().trim().min(1, "What is it?"),
  detail: optionalText,
  onDate: optionalDate,
  recurring: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  remindDaysBefore: z.preprocess(
    emptyToNull,
    z.coerce.number().int().min(0).max(365).nullable(),
  ),
});

export async function addContactFact(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireUser();
  const parsed = factSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  const { customerId, ...values } = parsed.data;
  await getDb()
    .insert(contactFacts)
    .values({ ...values, createdById: user.id });

  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: "Noted." };
}

export async function deleteContactFact(
  id: string,
  customerId: string,
): Promise<ActionState> {
  await requireUser();
  const db = getDb();
  const [row] = await db
    .select({ id: contactFacts.id })
    .from(contactFacts)
    .where(eq(contactFacts.id, id))
    .limit(1);
  if (!row) return fail("Already removed.");

  await db.delete(contactFacts).where(eq(contactFacts.id, id));
  revalidatePath(`/customers/${customerId}`);
  return { ok: true };
}
