/**
 * The areas of The Gangway an admin can switch on or off for a restricted
 * person (Settings → People and access).
 *
 * A switch narrows what their business-partner grants already allow; it never
 * widens it. Staff are not affected. Overview is not a switch: it is where
 * everyone lands.
 *
 * `null` on the person means every section, so people restricted before
 * sections existed keep what they had. Lives outside the `"use server"`
 * modules so the nav, the settings form and lib/access.ts can all import it.
 */

export const SECTIONS = [
  "tasks",
  "customers",
  "contacts",
  "projects",
  "sales",
  "purchasing",
  "inbox",
] as const;

export type Section = (typeof SECTIONS)[number];

export const SECTION_INFO: Record<Section, { label: string; hint: string }> = {
  tasks: { label: "Follow-ups", hint: "Their own follow-ups and those on their records" },
  customers: { label: "Business Partners", hint: "The partner pages they have been granted" },
  contacts: { label: "People", hint: "Contacts at their partners" },
  projects: { label: "Projects", hint: "Their partners' projects, phases and steps" },
  sales: { label: "Sales", hint: "Quotes, sales orders, invoices and deliveries" },
  purchasing: { label: "Purchasing", hint: "Purchase orders, receipts and bills" },
  inbox: { label: "Link email", hint: "Filing their Outlook mail against records" },
};

export function isSection(value: unknown): value is Section {
  return typeof value === "string" && (SECTIONS as readonly string[]).includes(value);
}

/** The sections a stored value grants. Unknown names are dropped. */
export function sectionsFrom(stored: readonly string[] | null | undefined): Section[] {
  if (stored == null) return [...SECTIONS];
  return SECTIONS.filter((s) => stored.includes(s));
}
