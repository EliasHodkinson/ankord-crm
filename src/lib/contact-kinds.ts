/**
 * What an organisation is to Ankor'd.
 *
 * Independent flags, not one kind. A single value had already forced "both"
 * into existence to express customer + supplier, and every kind added after
 * that doubles the combinations again — media alone would have needed
 * customer+media, supplier+media and all-three. Flags also match Xero, which
 * carries its own IsCustomer and IsSupplier. Media is The Gangway's own and
 * never reaches Xero.
 *
 * The Gangway calls a customer a *client*; the column keeps Xero's word.
 * Wording and badge colour live in PARTNER_TYPE (components/ui/status.tsx).
 *
 * Lives outside the `"use server"` modules so the form, the list and the Xero
 * panel can all import it.
 */

export type ContactKinds = {
  isCustomer: boolean;
  isSupplier: boolean;
  isMedia: boolean;
};

export const PARTNER_TYPES = ["client", "supplier", "media"] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

export const PARTNER_TYPE_FIELD: Record<PartnerType, keyof ContactKinds> = {
  client: "isCustomer",
  supplier: "isSupplier",
  media: "isMedia",
};

export function isPartnerType(value: unknown): value is PartnerType {
  return typeof value === "string" && (PARTNER_TYPES as readonly string[]).includes(value);
}

/**
 * The Business Partners list's `?type=`. Clients unless told otherwise —
 * they are most of the list and most of the work. Also reads the older
 * `?kind=` (customer/supplier/media, "all"), which saved views still carry.
 */
export function partnerTypeParam(type: string | undefined, legacyKind?: string): PartnerType | "all" {
  const value = type ?? (legacyKind === "customer" ? "client" : legacyKind);
  if (value === "all") return "all";
  return isPartnerType(value) ? value : "client";
}

/** Filter values the MCP tools have always accepted; "customer" is a client. */
export type ContactKindFilter = "customer" | "supplier" | "media";

export function kindToType(kind: ContactKindFilter | PartnerType): PartnerType {
  return kind === "customer" ? "client" : kind;
}

/** The types a record is, in the fixed order the switch shows them. */
export function typesOf(kinds: ContactKinds): PartnerType[] {
  return PARTNER_TYPES.filter((t) => kinds[PARTNER_TYPE_FIELD[t]]);
}

/**
 * The type badges worth showing on a record, or null for "none set".
 *
 * A plain client gets nothing — it is the overwhelming default and a badge on
 * every row would be noise. Anything else is worth saying, including a record
 * with no type at all, which is easy to create by accident and should look
 * unfinished rather than look like a client. Inside one type's tab that
 * type goes without saying, so it is left out too.
 */
export function typeBadges(kinds: ContactKinds, within?: PartnerType): PartnerType[] | null {
  const set = typesOf(kinds);
  if (set.length === 0) return null;
  if (set.length === 1 && set[0] === "client") return [];
  return set.filter((t) => t !== within);
}
