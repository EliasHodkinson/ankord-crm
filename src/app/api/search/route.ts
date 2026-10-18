import { NextResponse, type NextRequest } from "next/server";
import { and, ilike, or, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { contacts, customers, documents, leads, projects } from "@/lib/db/schema";
import { docHref, documentTitle, typeLabel } from "@/lib/sales/doc-types";
import { customerScope, getAccess } from "@/lib/access";

export const dynamic = "force-dynamic";

export type SearchHit = {
  id: string;
  kind: "customer" | "contact" | "lead" | "project" | "document";
  title: string;
  subtitle: string | null;
  href: string;
};

export async function GET(request: NextRequest) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ hits: [] satisfies SearchHit[] });

  const db = getDb();
  const like = `%${q}%`;
  // Search is a list like any other: a restricted person finds only their own
  // partners and what hangs off them, and never a lead.
  const access = await getAccess();

  const [customerHits, contactHits, leadHits, projectHits, documentHits] = await Promise.all([
    db
      .select({ id: customers.id, name: customers.name, suburb: customers.suburb })
      .from(customers)
      .where(
        and(
          or(ilike(customers.name, like), ilike(customers.legalName, like)),
          customerScope(access, customers.id),
        ),
      )
      .limit(5),
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
        ),
      )
      .limit(5),
    access.restricted
      ? Promise.resolve([])
      : db
          .select({ id: leads.id, name: leads.companyName, contact: leads.contactName })
          .from(leads)
          .where(or(ilike(leads.companyName, like), ilike(leads.contactName, like)))
          .limit(5),
    db
      .select({ id: projects.id, name: projects.name, company: customers.name })
      .from(projects)
      .innerJoin(customers, sql`${customers.id} = ${projects.customerId}`)
      .where(
        and(
          or(ilike(projects.name, like), ilike(projects.code, like)),
          customerScope(access, projects.customerId),
        ),
      )
      .limit(5),
    // Sales documents by number (QU-, SO-, INV-…) or the customer's reference.
    db
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
      .limit(6),
  ]);

  const hits: SearchHit[] = [
    ...customerHits.map((c) => ({
      id: c.id,
      kind: "customer" as const,
      title: c.name,
      subtitle: c.suburb,
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

  return NextResponse.json({ hits });
}
