/**
 * Suggesting which business partner a Xero contact is. Pure and client-safe,
 * so it is tested without a database.
 *
 * The order is the strength of the evidence:
 *
 * 1. **Linked** — a partner already carries this ContactID. Settled.
 * 2. **ABN** — the same 11-digit ABN is the same legal entity.
 * 3. **Email** — the same accounts address is very likely the same business.
 * 4. **Name** — offered, never assumed. "Mister Minit Blacktown" and "Mister
 *    Minit Mt Druitt" are different franchisees with near-identical names, so a
 *    name match is shown for a person to confirm and is never applied in bulk.
 *
 * A partner already linked to a *different* Xero contact is never suggested:
 * one ContactID maps to one partner, and the reverse.
 */

export type MatchReason = "linked" | "abn" | "email" | "name";

export type PartnerForMatch = {
  id: string;
  name: string;
  legalName: string | null;
  abn: string | null;
  email: string | null;
  xeroContactId: string | null;
};

export type ContactForMatch = {
  contactId: string;
  name: string;
  taxNumber: string | null;
  email: string | null;
};

export type Suggestion = { partnerId: string; partnerName: string; reason: MatchReason };

/** Strong enough to apply in bulk. A name match never is. */
export const STRONG_REASONS: ReadonlySet<MatchReason> = new Set(["abn", "email"]);

/** Digits only, and only if it is the right length for an ABN. */
export function normaliseAbn(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

export function normaliseEmail(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().toLowerCase();
  return trimmed.includes("@") ? trimmed : null;
}

const SUFFIXES = /\b(pty|ltd|limited|proprietary|inc|incorporated|co|company|the|trust|trustee|for|atf|t\/as|ta)\b/g;

/** "Mister Fixed Pty. Ltd." and "mister fixed" compare equal. */
export function normaliseName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/ ]+/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The best suggestion for one contact, or null when nothing fits. */
export function suggestPartner(contact: ContactForMatch, partners: PartnerForMatch[]): Suggestion | null {
  const hit = (p: PartnerForMatch, reason: MatchReason): Suggestion => ({
    partnerId: p.id,
    partnerName: p.name,
    reason,
  });

  const linked = partners.find((p) => p.xeroContactId === contact.contactId);
  if (linked) return hit(linked, "linked");

  // Anyone linked elsewhere is spoken for.
  const free = partners.filter((p) => !p.xeroContactId);

  const abn = normaliseAbn(contact.taxNumber);
  if (abn) {
    const byAbn = free.filter((p) => normaliseAbn(p.abn) === abn);
    // Two partners with one ABN (branches of one company) is for a person to pick.
    if (byAbn.length === 1) return hit(byAbn[0], "abn");
  }

  const email = normaliseEmail(contact.email);
  if (email) {
    const byEmail = free.filter((p) => normaliseEmail(p.email) === email);
    if (byEmail.length === 1) return hit(byEmail[0], "email");
  }

  const name = normaliseName(contact.name);
  if (name) {
    const byName = free.filter(
      (p) => normaliseName(p.name) === name || (p.legalName && normaliseName(p.legalName) === name),
    );
    if (byName.length === 1) return hit(byName[0], "name");
  }

  return null;
}
