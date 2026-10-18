"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { ReadOnlyError, requireMember } from "@/lib/auth/session";
import { AccessDenied, assertCustomer, assertStaff } from "@/lib/access";
import { XeroAuthError } from "@/lib/xero/auth";
import { XeroApiError } from "@/lib/xero/client";
import {
  addXeroFlags,
  contactReview,
  getXeroContactForImport,
  insertPartnerFromContact,
  setContactSkipped,
} from "@/lib/xero/import/contacts";
import { importItems } from "@/lib/xero/import/items";
import { importDocuments } from "@/lib/xero/import/documents";
import { STRONG_REASONS } from "@/lib/xero/import/match";
import { parseScope, parseSource } from "@/lib/xero/import/scope";
import { autoProvisionFolder } from "./files";
import { linkXeroContact } from "./xero";
import { fail, logActivity, type ActionState } from "./shared";

/**
 * Import from Xero (spec Q11). Every action here reads Xero and writes only to
 * The Gangway — lib/xero/import reaches Xero through a GET-only door. Staff
 * only: the contact list is the whole client book. Writes need a member.
 */

async function guarded(run: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ReadOnlyError || error instanceof AccessDenied) return fail(error.message);
    if (error instanceof XeroAuthError || error instanceof XeroApiError) return fail(error.message);
    throw error;
  }
}

function revalidateImport() {
  revalidatePath("/sales/import");
  revalidatePath("/customers");
}

const contactId = z.uuid("That does not look like a Xero contact.");

/** Links a Xero contact to an existing partner, through the one link mechanism. */
export async function linkContactToPartner(xeroContactId: string, customerId: string): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireMember();
    await assertStaff();
    const id = contactId.safeParse(xeroContactId);
    if (!id.success || !z.uuid().safeParse(customerId).success) return fail("Choose a business partner to link.");
    await assertCustomer(customerId);

    const [partner] = await getDb()
      .select({ xeroContactId: customers.xeroContactId, name: customers.name })
      .from(customers)
      .where(eq(customers.id, customerId));
    if (!partner) return fail("That business partner no longer exists.");
    if (partner.xeroContactId && partner.xeroContactId !== id.data) {
      return fail(`${partner.name} is already linked to a different Xero contact. Unlink it on its page first.`);
    }

    // Read fresh: the name and flags come from Xero, not from the browser.
    const contact = await getXeroContactForImport(id.data);
    if (!contact) return fail("Xero no longer has that contact.");

    const linked = await linkXeroContact(customerId, contact.contactId, contact.name);
    if (!linked.ok) return linked;
    await addXeroFlags(customerId, contact);
    await setContactSkipped(contact.contactId, contact.name, user.id, false);
    revalidateImport();
    return { ok: true, message: `${contact.name} is linked to ${partner.name}.` };
  });
}

/** Creates a business partner from a Xero contact, linked to it from the start. */
export async function createPartnerFromXero(xeroContactId: string): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireMember();
    await assertStaff();
    const id = contactId.safeParse(xeroContactId);
    if (!id.success) return fail(id.error.issues[0].message);

    const [taken] = await getDb()
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.xeroContactId, id.data))
      .limit(1);
    if (taken) return fail(`That Xero contact is already linked to ${taken.name}.`);

    const contact = await getXeroContactForImport(id.data);
    if (!contact) return fail("Xero no longer has that contact.");

    const row = await insertPartnerFromContact(contact, user.id);
    await logActivity({
      entityType: "customer",
      entityId: row.id,
      customerId: row.id,
      verb: "created",
      summary: `Added ${row.name} from Xero`,
    });
    await setContactSkipped(contact.contactId, contact.name, user.id, false);
    // As for any new partner: best effort, never throws.
    await autoProvisionFolder({ customerId: row.id });
    revalidateImport();
    return { ok: true, message: `Added ${row.name}, linked to Xero.`, data: { id: row.id } };
  });
}

/** Stops offering a contact, or starts offering it again. */
export async function skipXeroContact(xeroContactId: string, name: string, skip: boolean): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireMember();
    await assertStaff();
    const id = contactId.safeParse(xeroContactId);
    if (!id.success) return fail(id.error.issues[0].message);
    await setContactSkipped(id.data, name.slice(0, 200), user.id, skip);
    revalidatePath("/sales/import");
    return { ok: true, message: skip ? `Skipped ${name}.` : `${name} is back on the list.` };
  });
}

/**
 * Links every contact whose ABN or email matches exactly one unlinked partner.
 * Name-only matches are deliberately left for a person.
 */
export async function linkStrongMatches(): Promise<ActionState> {
  return guarded(async () => {
    await requireMember();
    await assertStaff();
    const rows = await contactReview();
    let linked = 0;
    const problems: string[] = [];
    // One partner per contact, even if two contacts point at the same one.
    const used = new Set<string>();
    for (const row of rows) {
      const s = row.suggestion;
      if (!s || row.skipped || !STRONG_REASONS.has(s.reason) || used.has(s.partnerId)) continue;
      used.add(s.partnerId);
      const result = await linkXeroContact(s.partnerId, row.contact.contactId, row.contact.name);
      if (result.ok) {
        await addXeroFlags(s.partnerId, row.contact);
        linked += 1;
      } else if (result.message) problems.push(result.message);
    }
    revalidateImport();
    if (!linked && !problems.length) return { ok: true, message: "No ABN or email matches left to link." };
    return {
      ok: problems.length === 0,
      message: `Linked ${linked} ${linked === 1 ? "contact" : "contacts"} by ABN or email.${problems.length ? ` ${problems.join(" ")}` : ""}`,
    };
  });
}

export async function importXeroItems(): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireMember();
    await assertStaff();
    const result = await importItems(user.id);
    revalidatePath("/sales/items");
    revalidatePath("/sales/import");
    const parts = [
      `${result.created} added`,
      `${result.updated} updated`,
      ...(result.held ? [`${result.held} left as they are`] : []),
    ];
    return { ok: true, message: `Items from Xero: ${parts.join(", ")}.` };
  });
}

/**
 * Imports quotes, invoices, purchase orders or bills. `params` is the screen's query string (source,
 * mode, from, to, numbers), re-parsed here; `only` is the ticked Xero IDs.
 */
export async function importXeroDocuments(
  params: { source?: string; mode?: string; from?: string; to?: string; numbers?: string },
  only?: string[],
): Promise<ActionState> {
  return guarded(async () => {
    const { user } = await requireMember();
    await assertStaff();
    const ids = only ? z.array(z.uuid()).max(500).safeParse(only) : null;
    if (ids && !ids.success) return fail("Choose documents from the list.");

    const source = parseSource(params.source);
    const report = await importDocuments(source, parseScope(params), user.id, ids?.data);

    revalidatePath(
      { quotes: "/sales/quotes", invoices: "/sales/invoices", purchase_orders: "/purchasing/orders", bills: "/purchasing/bills" }[source],
    );
    revalidatePath("/sales/import");
    for (const id of report.touched) revalidatePath(`/customers/${id}`);

    const parts = [
      report.created ? `${report.created} imported` : null,
      report.updated ? `${report.updated} updated from Xero` : null,
      report.refreshed ? `${report.refreshed} refreshed` : null,
      report.waiting ? `${report.waiting} waiting for their contact` : null,
      report.skipped ? `${report.skipped} not in AUD` : null,
    ].filter(Boolean);
    const summary = parts.length ? `${parts.join(", ")}.` : "Nothing to import.";
    return report.failed.length
      ? { ok: false, message: `${summary} ${report.failed.slice(0, 3).join(" ")}` }
      : { ok: true, message: summary.charAt(0).toUpperCase() + summary.slice(1) };
  });
}
