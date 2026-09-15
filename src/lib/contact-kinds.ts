/**
 * What an organisation is to Ankor'd.
 *
 * Independent flags, not one kind. A single value had already forced "both"
 * into existence to express customer + supplier, and every kind added after
 * that doubles the combinations again — media alone would have needed
 * customer+media, supplier+media and all-three. Flags also match Xero, which
 * carries its own IsCustomer and IsSupplier.
 *
 * Lives outside the `"use server"` modules so the form, the list and the Xero
 * panel can all import it.
 */

export type ContactKinds = {
  isCustomer: boolean;
  isSupplier: boolean;
  isMedia: boolean;
};

export const CONTACT_KINDS = [
  {
    field: "isCustomer",
    label: "Customer",
    hint: "We invoice them",
  },
  {
    field: "isSupplier",
    label: "Supplier",
    hint: "They invoice us",
  },
  {
    field: "isMedia",
    label: "Media",
    hint: "Press, radio, publications",
  },
] as const satisfies readonly {
  field: keyof ContactKinds;
  label: string;
  hint: string;
}[];

/** Filter values the customers list accepts, beyond "all". */
export type ContactKindFilter = "customer" | "supplier" | "media";

export const KIND_FILTER_FIELD: Record<ContactKindFilter, keyof ContactKinds> = {
  customer: "isCustomer",
  supplier: "isSupplier",
  media: "isMedia",
};

export function isContactKindFilter(value: string | undefined): value is ContactKindFilter {
  return value === "customer" || value === "supplier" || value === "media";
}

/**
 * The labels worth showing on a record.
 *
 * A plain customer gets nothing — it is the overwhelming default and a badge on
 * every row would be noise. Anything else is worth saying, including a record
 * with no kind at all, which is easy to create by accident and should look
 * unfinished rather than look like a customer.
 */
export function kindBadges(kinds: ContactKinds): string[] {
  const set = CONTACT_KINDS.filter((k) => kinds[k.field]).map((k) => k.label);
  if (set.length === 0) return ["No relationship set"];
  if (set.length === 1 && set[0] === "Customer") return [];
  return set;
}
