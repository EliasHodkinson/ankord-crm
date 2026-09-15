/**
 * The shape of an import, shared by the client wizard and the server action.
 *
 * This lives outside lib/actions because a "use server" module may only export
 * async functions — a plain constant exported from one is not a value on the
 * client, and reading it there fails at runtime rather than at build time.
 */

export type ImportField = {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
};

/** Column names other CRMs and spreadsheets actually use, for auto-matching. */
export const IMPORT_FIELDS: Record<"customers" | "leads", ImportField[]> = {
  customers: [
    { key: "name", label: "Company name", required: true, aliases: ["company", "companyname", "account", "accountname", "organisation", "organization", "client", "businessname", "tradingname"] },
    { key: "legalName", label: "Legal entity", aliases: ["legalname", "entity", "registeredname"] },
    { key: "abn", label: "ABN", aliases: ["abn", "acn", "taxid", "vat"] },
    { key: "email", label: "Email", aliases: ["email", "emailaddress", "generalemail"] },
    { key: "phone", label: "Phone", aliases: ["phone", "telephone", "phonenumber", "mainphone"] },
    { key: "website", label: "Website", aliases: ["website", "url", "domain", "web"] },
    { key: "industry", label: "Industry", aliases: ["industry", "sector", "vertical"] },
    { key: "addressLine1", label: "Street address", aliases: ["address", "street", "addressline1", "address1"] },
    { key: "suburb", label: "Suburb", aliases: ["suburb", "city", "town", "locality"] },
    { key: "state", label: "State", aliases: ["state", "region", "province"] },
    { key: "postcode", label: "Postcode", aliases: ["postcode", "postalcode", "zip", "zipcode"] },
    { key: "notes", label: "Notes", aliases: ["notes", "description", "comments", "about"] },
  ],
  leads: [
    { key: "companyName", label: "Company name", required: true, aliases: ["company", "companyname", "account", "organisation", "organization", "businessname"] },
    { key: "contactName", label: "Contact name", aliases: ["contact", "contactname", "name", "fullname", "person", "primarycontact"] },
    { key: "jobTitle", label: "Role", aliases: ["title", "jobtitle", "position", "role"] },
    { key: "email", label: "Email", aliases: ["email", "emailaddress"] },
    { key: "phone", label: "Phone", aliases: ["phone", "mobile", "telephone", "phonenumber"] },
    { key: "website", label: "Website", aliases: ["website", "url", "domain"] },
    { key: "source", label: "Source", aliases: ["source", "leadsource", "channel", "origin"] },
    { key: "interest", label: "What they want", aliases: ["interest", "requirement", "enquiry", "inquiry"] },
    { key: "valueAud", label: "Value", aliases: ["value", "amount", "dealvalue", "budget", "revenue"] },
    { key: "suburb", label: "Suburb", aliases: ["suburb", "city", "town"] },
    { key: "state", label: "State", aliases: ["state", "region"] },
  ],
};

export type ImportKind = keyof typeof IMPORT_FIELDS;

export type ImportPreviewRow = {
  index: number;
  values: Record<string, string>;
  /** An existing record — or an earlier row — that this one looks like. */
  duplicateOf: { id: string; name: string; reason: "name" | "email" } | null;
};
