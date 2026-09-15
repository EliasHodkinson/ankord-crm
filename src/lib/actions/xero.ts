"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { searchXeroContacts, XeroApiError } from "@/lib/xero/client";
import { XeroAuthError } from "@/lib/xero/auth";
import { fail, logActivity, type ActionState } from "./shared";

/**
 * Linking a CRM organisation to its Xero contact.
 *
 * The Xero ContactID is stored rather than matching on name at read time: names
 * drift on both sides, and a silent mismatch showing someone else's balance
 * would be worse than showing none.
 */

export type XeroSearchResult = {
  contactId: string;
  name: string;
  email: string | null;
  isCustomer: boolean;
  isSupplier: boolean;
  /** Already linked to a different CRM record. */
  takenBy: string | null;
};

/** Searches Xero, flagging anything already spoken for. */
export async function searchXeroForLink(
  term: string,
): Promise<{ ok: true; results: XeroSearchResult[] } | { ok: false; message: string }> {
  await requireUser();

  try {
    const found = await searchXeroContacts(term);
    if (found.length === 0) return { ok: true, results: [] };

    const linked = await getDb()
      .select({ id: customers.id, name: customers.name, xeroContactId: customers.xeroContactId })
      .from(customers);

    const byXeroId = new Map(
      linked.filter((c) => c.xeroContactId).map((c) => [c.xeroContactId!, c.name]),
    );

    return {
      ok: true,
      results: found.map((c) => ({ ...c, takenBy: byXeroId.get(c.contactId) ?? null })),
    };
  } catch (error) {
    if (error instanceof XeroAuthError || error instanceof XeroApiError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Could not search Xero." };
  }
}

export async function linkXeroContact(
  customerId: string,
  xeroContactId: string,
  xeroName: string,
): Promise<ActionState> {
  await requireUser();

  const parsed = z.uuid().safeParse(xeroContactId);
  if (!parsed.success) return fail("That does not look like a Xero contact.");

  const db = getDb();

  // One Xero contact, one CRM record. Two records sharing a contact would show
  // the same balance in both places and neither would be wrong on its own.
  const [taken] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(eq(customers.xeroContactId, parsed.data))
    .limit(1);

  if (taken && taken.id !== customerId) {
    return fail(`That Xero contact is already linked to ${taken.name}.`);
  }

  await db
    .update(customers)
    .set({ xeroContactId: parsed.data, updatedAt: new Date() })
    .where(eq(customers.id, customerId));

  await logActivity({
    entityType: "customer",
    entityId: customerId,
    customerId,
    verb: "xero_linked",
    summary: `Linked to ${xeroName} in Xero`,
  });

  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: `Linked to ${xeroName}.` };
}

export async function unlinkXeroContact(customerId: string): Promise<ActionState> {
  await requireUser();

  await getDb()
    .update(customers)
    .set({ xeroContactId: null, updatedAt: new Date() })
    .where(eq(customers.id, customerId));

  await logActivity({
    entityType: "customer",
    entityId: customerId,
    customerId,
    verb: "xero_unlinked",
    summary: "Unlinked from Xero",
  });

  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: "Unlinked from Xero." };
}
