"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { customers, contacts, leads } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { autoProvisionFolder } from "./files";
import { notifyTeams } from "@/lib/notify";
import { appUrl } from "@/lib/env";
import { money } from "@/lib/utils";
import {
  emptyToNull,
  fail,
  fromZod,
  logActivity,
  optionalDate,
  optionalEmail,
  optionalNumber,
  optionalText,
  optionalUrl,
  optionalUuid,
  tagList,
  touchRecords,
  type ActionState,
} from "./shared";
import { labelFor, LEAD_STAGES } from "@/components/ui/status";

const STAGES = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;

const leadSchema = z.object({
  companyName: z.string().trim().min(1, "A lead needs a company or trading name."),
  contactName: optionalText,
  jobTitle: optionalText,
  email: optionalEmail,
  phone: optionalText,
  website: optionalUrl,
  suburb: optionalText,
  state: optionalText,
  stage: z.enum(STAGES),
  source: optionalText,
  interest: optionalText,
  valueAud: optionalNumber,
  probability: z.preprocess(
    emptyToNull,
    z.coerce.number().int().min(0).max(100).nullable(),
  ),
  expectedCloseDate: optionalDate,
  ownerId: optionalUuid,
  nextAction: optionalText,
  nextActionAt: optionalDate,
  lostReason: optionalText,
  tags: tagList,
  notes: optionalText,
});

function parse(formData: FormData) {
  return leadSchema.safeParse(Object.fromEntries(formData));
}

export async function createLead(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireUser();
  const parsed = parse(formData);
  if (!parsed.success) return fromZod(parsed.error);

  const [row] = await getDb()
    .insert(leads)
    .values({
      ...parsed.data,
      valueAud: parsed.data.valueAud?.toString() ?? null,
      ownerId: parsed.data.ownerId ?? user.id,
      createdById: user.id,
    })
    .returning({ id: leads.id });

  await logActivity({
    entityType: "lead",
    entityId: row.id,
    leadId: row.id,
    verb: "created",
    summary: `Added lead ${parsed.data.companyName}`,
  });

  // Best-effort: never throws, so a SharePoint problem cannot lose the record.
  // Must run before redirect(), which throws to unwind.
  await autoProvisionFolder({ leadId: row.id });

  revalidatePath("/leads");
  redirect(`/leads/${row.id}`);
}

export async function updateLead(
  id: string,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = parse(formData);
  if (!parsed.success) return fromZod(parsed.error);

  await getDb()
    .update(leads)
    .set({
      ...parsed.data,
      valueAud: parsed.data.valueAud?.toString() ?? null,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, id));

  await logActivity({
    entityType: "lead",
    entityId: id,
    leadId: id,
    verb: "updated",
    summary: `Updated lead details`,
  });

  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
  return { ok: true, message: "Saved." };
}

/** Announces a lead reaching Proposal. Never throws — see lib/notify.ts. */
async function notifyLeadProposal(
  id: string,
  companyName: string,
  valueAud: string | null,
): Promise<void> {
  await notifyTeams({
    title: `${companyName} reached Proposal`,
    subtitle: "A proposal is now with them. Worth agreeing who chases it and when.",
    tone: "good",
    facts: [
      { title: "Lead", value: companyName },
      ...(valueAud ? [{ title: "Value", value: money(valueAud) ?? valueAud }] : []),
    ],
    url: `${appUrl()}/leads/${id}`,
    urlLabel: "Open the lead",
  });
}

/** Stage moves happen constantly, so they get their own one-click path. */
export async function setLeadStage(id: string, stage: string): Promise<ActionState> {
  await requireUser();
  const value = z.enum(STAGES).safeParse(stage);
  if (!value.success) return fail("Unknown stage.");

  const db = getDb();
  const [before] = await db
    .select({ stage: leads.stage, companyName: leads.companyName, valueAud: leads.valueAud })
    .from(leads)
    .where(eq(leads.id, id))
    .limit(1);

  await db
    .update(leads)
    .set({ stage: value.data, updatedAt: new Date() })
    .where(eq(leads.id, id));

  // Only on the way in — re-saving the same stage should not re-announce it.
  if (before && before.stage !== value.data && value.data === "proposal") {
    await notifyLeadProposal(id, before.companyName, before.valueAud);
  }

  await touchRecords({ leadId: id });

  await logActivity({
    entityType: "lead",
    entityId: id,
    leadId: id,
    verb: "stage_changed",
    summary: `Moved to ${labelFor(LEAD_STAGES, value.data)}`,
    meta: { stage: value.data },
  });

  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
  return { ok: true };
}

/**
 * Turns a won lead into a customer, carrying the named contact across so the
 * relationship history is not retyped. The lead is kept, not deleted.
 */
export async function convertLead(id: string): Promise<void> {
  const { user } = await requireUser();
  const db = getDb();

  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) redirect("/leads");
  if (lead.convertedCustomerId) redirect(`/customers/${lead.convertedCustomerId}`);

  const [customer] = await db
    .insert(customers)
    .values({
      name: lead.companyName,
      status: "active",
      website: lead.website,
      phone: lead.phone,
      email: lead.email,
      suburb: lead.suburb,
      state: lead.state,
      ownerId: lead.ownerId ?? user.id,
      tags: lead.tags,
      notes: lead.notes,
      createdById: user.id,
    })
    .returning({ id: customers.id });

  if (lead.contactName) {
    const [first, ...rest] = lead.contactName.trim().split(/\s+/);
    await db.insert(contacts).values({
      customerId: customer.id,
      firstName: first,
      lastName: rest.join(" ") || null,
      jobTitle: lead.jobTitle,
      email: lead.email,
      phone: lead.phone,
      isPrimary: true,
      createdById: user.id,
    });
  }

  await db
    .update(leads)
    .set({
      stage: "won",
      convertedCustomerId: customer.id,
      convertedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(leads.id, id));

  await logActivity({
    entityType: "lead",
    entityId: id,
    leadId: id,
    customerId: customer.id,
    verb: "converted",
    summary: `Converted to customer ${lead.companyName}`,
  });

  revalidatePath("/leads");
  revalidatePath("/customers");
  redirect(`/customers/${customer.id}`);
}

export async function deleteLead(id: string): Promise<void> {
  await requireUser();
  await getDb().delete(leads).where(eq(leads.id, id));
  revalidatePath("/leads");
  redirect("/leads");
}

/**
 * Board move: change the stage and where the card sits in its column.
 * Cards below the insertion point shuffle down, so the order the team sets
 * by hand survives a reload.
 */
export async function moveLeadOnBoard(
  id: string,
  stage: string,
  beforeId: string | null,
): Promise<ActionState> {
  await requireUser();
  const parsed = z.enum(STAGES).safeParse(stage);
  if (!parsed.success) return fail("Unknown stage.");

  const db = getDb();
  const [current] = await db
    .select({ stage: leads.stage, companyName: leads.companyName })
    .from(leads)
    .where(eq(leads.id, id))
    .limit(1);
  if (!current) return fail("That lead no longer exists.");

  // Where in the column does it land? Above `beforeId`, or at the bottom.
  const column = await db
    .select({ id: leads.id, position: leads.boardPosition })
    .from(leads)
    .where(and(eq(leads.stage, parsed.data), ne(leads.id, id)))
    .orderBy(asc(leads.boardPosition));

  const index = beforeId ? column.findIndex((c) => c.id === beforeId) : -1;
  const ordered = [...column];
  ordered.splice(index === -1 ? ordered.length : index, 0, { id, position: 0 });

  await Promise.all(
    ordered.map((row, position) =>
      db
        .update(leads)
        .set(
          row.id === id
            ? { stage: parsed.data, boardPosition: position, updatedAt: new Date() }
            : { boardPosition: position },
        )
        .where(eq(leads.id, row.id)),
    ),
  );

  if (current.stage !== parsed.data) {
    await touchRecords({ leadId: id });
    await logActivity({
      entityType: "lead",
      entityId: id,
      leadId: id,
      verb: "stage_changed",
      summary: `Moved ${current.companyName} to ${labelFor(LEAD_STAGES, parsed.data)}`,
      meta: { stage: parsed.data },
    });

    // Dragging a card on the board is the same event as picking the stage on
    // the record, so it announces the same way.
    if (parsed.data === "proposal") {
      await notifyLeadProposal(id, current.companyName, null);
    }
  }

  revalidatePath("/leads");
  return { ok: true };
}
