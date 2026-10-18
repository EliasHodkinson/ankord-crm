import "server-only";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contacts, customers, documents, leads, projects } from "@/lib/db/schema";
import { docHref, documentTitle, typeLabel } from "@/lib/sales/doc-types";
import { customerScope, getAccess } from "@/lib/access";
import { PARTNER_TYPE } from "@/components/ui/status";
import { isPartnerType, PARTNER_TYPE_FIELD, typesOf, type PartnerType } from "@/lib/contact-kinds";

export type SearchHit = {
  id: string;
  kind: "customer" | "contact" | "lead" | "project" | "document";
  title: string;
  subtitle: string | null;
  href: string;
};

/**
 * ⌘K search, and the MCP `search` tool. Search is a list like any other: a
 * restricted person finds only their own partners and what hangs off them,
 * and never a lead.
 */
export async function searchEverything(
  input: string,
  perKind = 5,
  options: { partnerType?: PartnerType } = {},
): Promise<SearchHit[]> {
  const { q, partnerType = options.partnerType } = parseTypePrefix(input);
  if (q.length < 2) return [];

  const db = getDb();
  const like = `%${q}%`;
  const access = await getAccess();
  // A type narrows partners, and the people at them, to that relationship.
  const ofType = partnerType ? eq(customers[PARTNER_TYPE_FIELD[partnerType]], true) : undefined;

  const [customerHits, contactHits, leadHits, projectHits, documentHits] = await Promise.all([
    db
      .select({
        id: customers.id,
        name: customers.name,
        suburb: customers.suburb,
        isCustomer: customers.isCustomer,
        isSupplier: customers.isSupplier,
        isMedia: customers.isMedia,
      })
      .from(customers)
      .where(
        and(
          or(ilike(customers.name, like), ilike(customers.legalName, like)),
          customerScope(access, customers.id),
          ofType,
        ),
      )
      .limit(perKind),
    db
      .select({
        id: contacts.id,
        customerId: contacts.customerId,
        first: contacts.firstName,
        last: contacts.lastName,
        title: contacts.jobTitle,
        company: customers.name,
      })
      .from(contacts)
      .innerJoin(customers, sql`${customers.id} = ${contacts.customerId}`)
      .where(
        and(
          or(
            ilike(contacts.firstName, like),
            ilike(contacts.lastName, like),
            ilike(contacts.email, like),
          ),
          customerScope(access, contacts.customerId),
          ofType,
        ),
      )
      .limit(perKind),
    access.restricted || partnerType
      ? Promise.resolve([])
      : db
          .select({ id: leads.id, name: leads.companyName, contact: leads.contactName })
          .from(leads)
          .where(or(ilike(leads.companyName, like), ilike(leads.contactName, like)))
          .limit(perKind),
    partnerType
      ? Promise.resolve([])
      : db
          .select({ id: projects.id, name: projects.name, company: customers.name })
          .from(projects)
          .innerJoin(customers, sql`${customers.id} = ${projects.customerId}`)
          .where(
            and(
              or(ilike(projects.name, like), ilike(projects.code, like)),
              customerScope(access, projects.customerId),
            ),
          )
          .limit(perKind),
    // Sales documents by number (QU-, SO-, INV-…) or the customer's reference.
    partnerType
      ? Promise.resolve([])
      : db
          .select({
            id: documents.id,
            type: documents.type,
            number: documents.number,
            isReserve: documents.isReserve,
            partnerName: documents.partnerName,
          })
          .from(documents)
          .where(
            and(
              or(ilike(documents.number, like), ilike(documents.reference, like)),
              customerScope(access, documents.partnerId),
            ),
          )
          .limit(perKind + 1),
  ]);

  return [
    ...customerHits.map((c) => ({
      id: c.id,
      kind: "customer" as const,
      title: c.name,
      subtitle:
        [...typesOf(c).map((t) => PARTNER_TYPE[t].label), c.suburb].filter(Boolean).join(" · ") || null,
      href: `/customers/${c.id}`,
    })),
    ...contactHits.map((c) => ({
      id: c.id,
      kind: "contact" as const,
      title: [c.first, c.last].filter(Boolean).join(" "),
      subtitle: [c.title, c.company].filter(Boolean).join(" · ") || null,
      href: `/customers/${c.customerId}?contact=${c.id}`,
    })),
    ...leadHits.map((l) => ({
      id: l.id,
      kind: "lead" as const,
      title: l.name,
      subtitle: l.contact,
      href: `/leads/${l.id}`,
    })),
    ...projectHits.map((p) => ({
      id: p.id,
      kind: "project" as const,
      title: p.name,
      subtitle: p.company,
      href: `/projects/${p.id}`,
    })),
    ...documentHits.map((d) => ({
      id: d.id,
      kind: "document" as const,
      title: documentTitle(d),
      subtitle: `${typeLabel(d.type, d.isReserve)} · ${d.partnerName}`,
      href: docHref(d),
    })),
  ];
}

/**
 * "media: abc", "suppliers: abc" — a typed prefix narrows to that type of
 * partner, so ⌘K and the MCP search can be asked for one relationship.
 */
function parseTypePrefix(input: string): { q: string; partnerType?: PartnerType } {
  const match = /^\s*(clients?|suppliers?|media)\s*:\s*(.*)$/i.exec(input);
  if (!match) return { q: input.trim() };
  const word = match[1].toLowerCase().replace(/s$/, "");
  return { q: match[2].trim(), partnerType: isPartnerType(word) ? word : undefined };
}
