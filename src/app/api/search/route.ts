import { NextResponse, type NextRequest } from "next/server";
import { ilike, or, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { contacts, customers, leads, projects } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export type SearchHit = {
  id: string;
  kind: "customer" | "contact" | "lead" | "project";
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

  const [customerHits, contactHits, leadHits, projectHits] = await Promise.all([
    db
      .select({ id: customers.id, name: customers.name, suburb: customers.suburb })
      .from(customers)
      .where(or(ilike(customers.name, like), ilike(customers.legalName, like)))
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
        or(
          ilike(contacts.firstName, like),
          ilike(contacts.lastName, like),
          ilike(contacts.email, like),
        ),
      )
      .limit(5),
    db
      .select({ id: leads.id, name: leads.companyName, contact: leads.contactName })
      .from(leads)
      .where(or(ilike(leads.companyName, like), ilike(leads.contactName, like)))
      .limit(5),
    db
      .select({ id: projects.id, name: projects.name, company: customers.name })
      .from(projects)
      .innerJoin(customers, sql`${customers.id} = ${projects.customerId}`)
      .where(or(ilike(projects.name, like), ilike(projects.code, like)))
      .limit(5),
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
  ];

  return NextResponse.json({ hits });
}
