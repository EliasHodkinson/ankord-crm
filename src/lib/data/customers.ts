import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contacts, customers, projects } from "@/lib/db/schema";

export async function getCustomer(id: string) {
  const customer = await getDb().query.customers.findFirst({
    where: eq(customers.id, id),
    with: {
      owner: { columns: { id: true, name: true, photo: true, email: true } },
      contacts: {
        where: (c, { isNull }) => isNull(c.archivedAt),
        orderBy: [desc(contacts.isPrimary), asc(contacts.firstName)],
        with: { facts: { orderBy: (f, { asc: a }) => [a(f.onDate)] } },
      },
      projects: {
        orderBy: [asc(projects.status), desc(projects.updatedAt)],
        columns: {
          id: true,
          name: true,
          code: true,
          status: true,
          health: true,
          targetDate: true,
          summary: true,
        },
      },
      accounts: { orderBy: (a, { asc: ord }) => [ord(a.position), ord(a.system)] },
    },
  });
  return customer ?? null;
}

export type CustomerRecord = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;
