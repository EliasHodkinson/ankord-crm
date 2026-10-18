import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { customers, xeroImportSkips } from "@/lib/db/schema";
import { suggestPartner, type PartnerForMatch, type Suggestion } from "./match";
import { xeroGet, xeroGetAll } from "./read";

/**
 * Xero contacts → business partners. Reading and building the review rows;
 * the decisions (link, create, skip) are actions in actions/xero-import.ts.
 */

type RawAddress = {
  AddressType?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  City?: string;
  Region?: string;
  PostalCode?: string;
  Country?: string;
};

type RawContact = {
  ContactID: string;
  Name: string;
  FirstName?: string;
  LastName?: string;
  EmailAddress?: string;
  TaxNumber?: string;
  CompanyNumber?: string;
  IsCustomer?: boolean;
  IsSupplier?: boolean;
  ContactStatus?: string;
  Website?: string;
  Addresses?: RawAddress[];
  Phones?: { PhoneType?: string; PhoneNumber?: string; PhoneAreaCode?: string; PhoneCountryCode?: string }[];
};

export type XeroContactForImport = {
  contactId: string;
  name: string;
  email: string | null;
  taxNumber: string | null;
  isCustomer: boolean;
  isSupplier: boolean;
  phone: string | null;
  website: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    suburb: string | null;
    state: string | null;
    postcode: string | null;
    country: string | null;
  } | null;
};

const clean = (value?: string | null) => value?.trim() || null;

function toContact(c: RawContact): XeroContactForImport {
  // The street address is where they are; the postal one is the fallback.
  const address =
    c.Addresses?.find((a) => a.AddressType === "STREET" && (a.AddressLine1 || a.City)) ??
    c.Addresses?.find((a) => a.AddressLine1 || a.City) ??
    null;
  const phone = c.Phones?.find((p) => p.PhoneNumber?.trim() && p.PhoneType === "DEFAULT") ??
    c.Phones?.find((p) => p.PhoneNumber?.trim());
  return {
    contactId: c.ContactID,
    name: c.Name.trim(),
    email: clean(c.EmailAddress),
    taxNumber: clean(c.TaxNumber),
    isCustomer: Boolean(c.IsCustomer),
    isSupplier: Boolean(c.IsSupplier),
    phone: phone ? [phone.PhoneAreaCode, phone.PhoneNumber].map(clean).filter(Boolean).join(" ") : null,
    website: clean(c.Website),
    address: address
      ? {
          line1: clean(address.AddressLine1),
          line2: clean(address.AddressLine2),
          suburb: clean(address.City),
          state: clean(address.Region),
          postcode: clean(address.PostalCode),
          country: clean(address.Country),
        }
      : null,
  };
}

/** Every active Xero contact. Archived ones are not worth bringing in. */
export async function listXeroContacts(): Promise<XeroContactForImport[]> {
  const rows = await xeroGetAll<RawContact>(
    (page) => `/Contacts?page=${page}&pageSize=500&order=${encodeURIComponent("Name ASC")}`,
    "Contacts",
    { pageSize: 500, maxPages: 20 },
  );
  return rows.filter((c) => (c.ContactStatus ?? "ACTIVE") === "ACTIVE").map(toContact);
}

/** One contact, read fresh — what a "create" works from, never the browser's copy. */
export async function getXeroContactForImport(contactId: string): Promise<XeroContactForImport | null> {
  const data = await xeroGet<{ Contacts?: RawContact[] }>(`/Contacts/${contactId}`);
  const c = data.Contacts?.[0];
  return c ? toContact(c) : null;
}

export type ContactReviewRow = {
  contact: XeroContactForImport;
  suggestion: Suggestion | null;
  skipped: boolean;
};

/** Partners as the matcher sees them, archived ones included (they can still be linked). */
export async function partnersForMatch(): Promise<PartnerForMatch[]> {
  return getDb()
    .select({
      id: customers.id,
      name: customers.name,
      legalName: customers.legalName,
      abn: customers.abn,
      email: customers.email,
      xeroContactId: customers.xeroContactId,
    })
    .from(customers);
}

export async function contactReview(): Promise<ContactReviewRow[]> {
  const [contacts, partners, skips] = await Promise.all([
    listXeroContacts(),
    partnersForMatch(),
    getDb()
      .select({ xeroId: xeroImportSkips.xeroId })
      .from(xeroImportSkips)
      .where(eq(xeroImportSkips.kind, "contact")),
  ]);
  const skipped = new Set(skips.map((s) => s.xeroId));
  return contacts.map((contact) => ({
    contact,
    suggestion: suggestPartner(contact, partners),
    skipped: skipped.has(contact.contactId),
  }));
}

/**
 * Creates the partner a Xero contact describes, already linked to it. The
 * customer/supplier flags come from Xero; a contact that is neither (Xero
 * sets them only once a document exists) starts as a customer, as a new
 * partner does anywhere else.
 */
export async function insertPartnerFromContact(contact: XeroContactForImport, userId: string) {
  const db = getDb();
  const [row] = await db
    .insert(customers)
    .values({
      name: contact.name,
      abn: contact.taxNumber,
      email: contact.email,
      phone: contact.phone,
      website: contact.website && !/^https?:\/\//i.test(contact.website) ? `https://${contact.website}` : contact.website,
      isCustomer: contact.isCustomer || !contact.isSupplier,
      isSupplier: contact.isSupplier,
      addressLine1: contact.address?.line1 ?? null,
      addressLine2: contact.address?.line2 ?? null,
      suburb: contact.address?.suburb ?? null,
      state: contact.address?.state ?? null,
      postcode: contact.address?.postcode ?? null,
      country: contact.address?.country ?? "Australia",
      xeroContactId: contact.contactId,
      ownerId: userId,
      createdById: userId,
    })
    .returning({ id: customers.id, name: customers.name });
  return row;
}

/** Xero's flags only ever add to a partner's: linking never un-marks a supplier. */
export async function addXeroFlags(customerId: string, contact: Pick<XeroContactForImport, "isCustomer" | "isSupplier">) {
  const patch: { isCustomer?: true; isSupplier?: true } = {};
  if (contact.isCustomer) patch.isCustomer = true;
  if (contact.isSupplier) patch.isSupplier = true;
  if (!Object.keys(patch).length) return;
  await getDb()
    .update(customers)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(customers.id, customerId));
}

export async function setContactSkipped(contactId: string, name: string, userId: string, skipped: boolean) {
  const db = getDb();
  if (skipped) {
    await db
      .insert(xeroImportSkips)
      .values({ kind: "contact", xeroId: contactId, name, skippedById: userId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(xeroImportSkips)
      .where(and(eq(xeroImportSkips.kind, "contact"), eq(xeroImportSkips.xeroId, contactId)));
  }
}
