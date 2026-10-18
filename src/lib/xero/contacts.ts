import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { xeroSend } from "./client";

/**
 * Creating a Xero contact for an organisation that has none, from a
 * document's Xero panel.
 *
 * Xero contact names are unique, so the name is searched first. A match is
 * **not** linked automatically — the same name is not proof of the same
 * business — it is handed back so the person can link it deliberately.
 */

export type CreateContactResult =
  | { ok: true; contactId: string; name: string }
  | { ok: false; clash: { contactId: string; name: string } | null; message: string };

export async function createXeroContactFor(customerId: string): Promise<CreateContactResult> {
  const db = getDb();
  const [c] = await db.select().from(customers).where(eq(customers.id, customerId));
  if (!c) return { ok: false, clash: null, message: "That business partner no longer exists." };
  if (c.xeroContactId) {
    return { ok: false, clash: null, message: `${c.name} is already linked to Xero.` };
  }

  // The name people know them by, as on the record; the ABN identifies the entity.
  const name = c.name.trim();
  const where = encodeURIComponent(`Name=="${name.replace(/"/g, '\\"')}"`);
  const existing = await xeroSend<{ Contacts?: { ContactID: string; Name: string }[] }>(
    "GET",
    `/Contacts?where=${where}&summaryOnly=true`,
  );
  const clash = existing.Contacts?.[0];
  if (clash) {
    return {
      ok: false,
      clash: { contactId: clash.ContactID, name: clash.Name },
      message: `Xero already has a contact called ${clash.Name}. Link to it if it is the same business.`,
    };
  }

  const created = await xeroSend<{ Contacts?: { ContactID: string; Name: string }[] }>(
    "PUT",
    "/Contacts",
    {
      Contacts: [
        {
          Name: name,
          ...(c.email ? { EmailAddress: c.email } : {}),
          ...(c.abn ? { TaxNumber: c.abn.replace(/\s/g, "") } : {}),
          ...(c.addressLine1 || c.suburb
            ? {
                Addresses: [
                  {
                    AddressType: "STREET",
                    AddressLine1: c.addressLine1 ?? undefined,
                    AddressLine2: c.addressLine2 ?? undefined,
                    City: c.suburb ?? undefined,
                    Region: c.state ?? undefined,
                    PostalCode: c.postcode ?? undefined,
                    Country: c.country ?? undefined,
                  },
                ],
              }
            : {}),
          ...(c.phone ? { Phones: [{ PhoneType: "DEFAULT", PhoneNumber: c.phone }] } : {}),
        },
      ],
    },
    { idempotencyKey: `gw-contact-${customerId}` },
  );

  const contact = created.Contacts?.[0];
  if (!contact) return { ok: false, clash: null, message: "Xero did not return the new contact." };

  await db
    .update(customers)
    .set({ xeroContactId: contact.ContactID, updatedAt: new Date() })
    .where(eq(customers.id, customerId));

  return { ok: true, contactId: contact.ContactID, name: contact.Name };
}
