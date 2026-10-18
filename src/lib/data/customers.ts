import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contacts, customers, projects } from "@/lib/db/schema";
import { canSeeCustomer, customerScope, getAccess } from "@/lib/access";

/** Null when it does not exist — or when this person may not see it. */
export async function getCustomer(id: string) {
  if (!(await canSeeCustomer(id))) return null;
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

/** Business partners this person may pick from — project and email forms. */
export async function listCustomerOptions() {
  const access = await getAccess();
  return getDb()
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(customerScope(access, customers.id))
    .orderBy(asc(customers.name));
}

export type CustomerRecord = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;
