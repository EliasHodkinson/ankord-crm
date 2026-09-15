"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { communications, customers, tasks, users } from "@/lib/db/schema";
import { getGraphToken, requireUser } from "@/lib/auth/session";
import { getCustomer } from "@/lib/data/customers";
import { ensureChildFolders, writeTextFile } from "@/lib/graph/sharepoint";
import { describeGraphFailure } from "@/lib/graph/errors";
import { buildBrief, BRIEF_FILE_NAME, BRIEF_FOLDER } from "@/lib/brief";
import { appUrl } from "@/lib/env";
import { fail, type ActionState } from "./shared";

/**
 * Writes the Copilot brief for a business partner into their SharePoint folder.
 *
 * Copilot grounds on the tenant and cannot reach Neon, so this file is the only
 * way CRM context reaches it. It is regenerated rather than appended to: there
 * is one canonical copy, and a stale brief is worse than none.
 *
 * Needs a delegated token, so it only runs inside a request made by a signed-in
 * person — there is no background regeneration.
 */
export async function writeCustomerBrief(customerId: string): Promise<ActionState> {
  await requireUser();

  const customer = await getCustomer(customerId);
  if (!customer) return fail("That business partner no longer exists.");
  if (!customer.spDriveId || !customer.spItemId) {
    return fail(
      "There is no SharePoint folder for this record yet. Create one first — the brief lives inside it.",
    );
  }

  const db = getDb();

  const [recent, open] = await Promise.all([
    db
      .select({
        occurredAt: communications.occurredAt,
        type: communications.type,
        direction: communications.direction,
        subject: communications.subject,
        preview: communications.preview,
      })
      .from(communications)
      // Private notes stay private: the brief is readable by anyone who can
      // open the folder, which is a wider audience than the CRM timeline.
      .where(
        and(
          eq(communications.customerId, customerId),
          eq(communications.visibility, "team"),
        ),
      )
      .orderBy(desc(communications.occurredAt))
      .limit(12),
    db
      .select({
        title: tasks.title,
        dueDate: tasks.dueDate,
        assigneeName: users.name,
      })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(eq(tasks.customerId, customerId), eq(tasks.status, "open")))
      .orderBy(desc(tasks.dueDate))
      .limit(20),
  ]);

  const address = [
    customer.addressLine1,
    customer.addressLine2,
    [customer.suburb, customer.state, customer.postcode].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  const markdown = buildBrief({
    name: customer.name,
    legalName: customer.legalName,
    isCustomer: customer.isCustomer,
    isSupplier: customer.isSupplier,
    isMedia: customer.isMedia,
    status: customer.status,
    industry: customer.industry,
    segment: customer.segment,
    website: customer.website,
    phone: customer.phone,
    email: customer.email,
    address: address || null,
    ownerName: customer.owner?.name ?? null,
    tags: customer.tags ?? [],
    notes: customer.notes,
    lastActivityAt: customer.lastActivityAt,
    contacts: customer.contacts.map((c) => ({
      name: [c.firstName, c.lastName].filter(Boolean).join(" "),
      jobTitle: c.jobTitle,
      email: c.email,
      phone: c.phone ?? c.mobile,
      isPrimary: c.isPrimary,
      isDecisionMaker: c.isDecisionMaker,
      coffeeOrder: c.coffeeOrder,
      dietary: c.dietary,
      pronouns: c.pronouns,
      notes: c.notes,
      facts: c.facts.map((f) => ({ label: f.label, detail: f.detail })),
    })),
    projects: customer.projects.map((p) => ({
      name: p.name,
      status: p.status,
      health: p.health,
      summary: p.summary,
      targetDate: p.targetDate,
    })),
    communications: recent,
    tasks: open,
    generatedAt: new Date(),
    crmUrl: `${appUrl()}/customers/${customer.id}`,
  });

  try {
    const token = await getGraphToken();

    // The brief sits in its own subfolder rather than beside client documents.
    const folders = await ensureChildFolders(token, customer.spDriveId, customer.spItemId, [
      BRIEF_FOLDER,
    ]);
    if (folders.failed.length) {
      return fail(`Could not create the ${BRIEF_FOLDER} folder in SharePoint.`);
    }

    // ensureChildFolders does not hand back the item, so address the file by
    // path from the record's folder instead — one call either way.
    await writeTextFile(
      token,
      customer.spDriveId,
      customer.spItemId,
      `${BRIEF_FOLDER}/${BRIEF_FILE_NAME}`,
      markdown,
    );

    await db
      .update(customers)
      .set({ briefWrittenAt: new Date() })
      .where(eq(customers.id, customerId));

    revalidatePath(`/customers/${customerId}`);
    return { ok: true, message: "Brief written to SharePoint." };
  } catch (error) {
    return fail(describeGraphFailure(error));
  }
}

/**
 * Regenerates after a record change, without ever throwing.
 *
 * Only refreshes a brief that already exists: writing one for the first time is
 * a deliberate act, not a side effect of editing a phone number.
 */
export async function refreshBriefIfPresent(customerId: string): Promise<void> {
  try {
    const [row] = await getDb()
      .select({ written: customers.briefWrittenAt })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    if (!row?.written) return;
    await writeCustomerBrief(customerId);
  } catch {
    /* A stale brief is not worth failing an edit over. */
  }
}
