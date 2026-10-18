import "server-only";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contacts, customers, documents, projects, users } from "@/lib/db/schema";
import { canSeeCustomer, customerScope, getAccess } from "@/lib/access";
import { PARTNER_TYPE_FIELD, type PartnerType } from "@/lib/contact-kinds";

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

/* ── the Business Partners list ─────────────────────────────────── */

/** Per-type quick filters, as `?only=`. Each belongs to one type's tab. */
export const PARTNER_QUICK_FILTERS = {
  client: [
    { value: "live", label: "With live projects" },
    { value: "quoted", label: "With open quotes" },
  ],
  supplier: [
    { value: "open_po", label: "With open POs" },
    { value: "bills", label: "With bills to pay" },
  ],
  media: [{ value: "reachable", label: "With a contact on file" }],
  all: [{ value: "untyped", label: "No type set" }],
} satisfies Record<PartnerType | "all", { value: string; label: string }[]>;

export type PartnerListFilter = {
  type: PartnerType | "all";
  status?: string;
  q?: string;
  only?: string;
};

const LIVE_PROJECTS = sql<number>`(select count(*)::int from ${projects} where ${projects.customerId} = ${customers.id} and ${projects.status} in ('planning','active','on_hold'))`;

/** Sum of one money column over a partner's documents of one type and status. */
function docSum(column: "total" | "amount_due", type: string, extra = sql``) {
  return sql<number>`(select coalesce(sum(${sql.raw(`d.${column}`)}), 0)::float8 from ${documents} d where d.partner_id = ${customers.id} and d.type = ${type} and d.status = 'open' ${extra})`;
}
function docCount(type: string) {
  return sql<number>`(select count(*)::int from ${documents} d where d.partner_id = ${customers.id} and d.type = ${type} and d.status = 'open')`;
}
// A quote with an outcome is decided, even before it is closed.
const OPEN_QUOTES = docSum("total", "quote", sql`and d.quote_outcome is null`);
const OWING = docSum("amount_due", "invoice");
const OPEN_PO_COUNT = docCount("purchase_order");
const OPEN_PO_VALUE = docSum("total", "purchase_order");
const BILLS_DUE = docSum("amount_due", "bill");
const firstContact = (expr: SQL) =>
  sql<string | null>`(select ${expr} from ${contacts} where ${contacts.customerId} = ${customers.id} and ${contacts.archivedAt} is null order by ${contacts.isPrimary} desc, ${contacts.firstName} limit 1)`;
const CONTACT_NAME = firstContact(sql`trim(concat_ws(' ', ${contacts.firstName}, ${contacts.lastName}))`);
const CONTACT_TITLE = firstContact(sql`${contacts.jobTitle}`);
const CONTACT_EMAIL = firstContact(sql`${contacts.email}`);
const CONTACT_PHONE = firstContact(sql`coalesce(${contacts.mobile}, ${contacts.phone})`);

const QUICK: Record<string, SQL> = {
  live: sql`${LIVE_PROJECTS} > 0`,
  quoted: sql`${OPEN_QUOTES} > 0`,
  open_po: sql`${OPEN_PO_COUNT} > 0`,
  bills: sql`${BILLS_DUE} > 0`,
  reachable: sql`exists (select 1 from ${contacts} where ${contacts.customerId} = ${customers.id} and ${contacts.archivedAt} is null)`,
  untyped: sql`not (${customers.isCustomer} or ${customers.isSupplier} or ${customers.isMedia})`,
};

/** Everything but the type: the counts on the switch answer "and in the others?" */
function baseFilters(access: Awaited<ReturnType<typeof getAccess>>, filter: PartnerListFilter) {
  const where: (SQL | undefined)[] = [customerScope(access, customers.id)];
  if (filter.status && filter.status !== "all") {
    where.push(eq(customers.status, filter.status as "active"));
  }
  if (filter.q) {
    const like = `%${filter.q}%`;
    where.push(or(ilike(customers.name, like), ilike(customers.legalName, like), ilike(customers.suburb, like)));
  }
  return where;
}

/**
 * The Business Partners list for one type's tab. Flags are independent, so a
 * record that is several types appears under each — filtering to media must
 * not hide a client who is press. Columns a tab does not show are not
 * computed.
 */
export async function listPartners(filter: PartnerListFilter) {
  const access = await getAccess();
  const where = baseFilters(access, filter);
  if (filter.type !== "all") where.push(eq(customers[PARTNER_TYPE_FIELD[filter.type]], true));
  const quick = PARTNER_QUICK_FILTERS[filter.type].find((f) => f.value === filter.only);
  if (quick) where.push(QUICK[quick.value]);

  const is = (t: PartnerType) => filter.type === t;
  const none = sql<null>`null`;
  return getDb()
    .select({
      customer: customers,
      ownerName: users.name,
      ownerPhoto: users.photo,
      contactCount: sql<number>`(select count(*)::int from ${contacts} where ${contacts.customerId} = ${customers.id} and ${contacts.archivedAt} is null)`,
      activeProjects: is("supplier") || is("media") ? none : LIVE_PROJECTS,
      openQuotes: is("client") ? OPEN_QUOTES : none,
      owing: is("client") ? OWING : none,
      openPos: is("supplier") ? OPEN_PO_COUNT : none,
      openPoValue: is("supplier") ? OPEN_PO_VALUE : none,
      billsDue: is("supplier") ? BILLS_DUE : none,
      contactName: is("media") ? CONTACT_NAME : none,
      contactTitle: is("media") ? CONTACT_TITLE : none,
      contactEmail: is("media") ? CONTACT_EMAIL : none,
      contactPhone: is("media") ? CONTACT_PHONE : none,
    })
    .from(customers)
    .leftJoin(users, eq(users.id, customers.ownerId))
    .where(and(...where))
    .orderBy(asc(customers.name))
    .limit(300);
}

export type PartnerListRow = Awaited<ReturnType<typeof listPartners>>[number];

/** How many partners each tab holds, under the same scope, search and status. */
export async function countPartnerTypes(filter: Omit<PartnerListFilter, "type" | "only">) {
  const access = await getAccess();
  const [row] = await getDb()
    .select({
      client: sql<number>`count(*) filter (where ${customers.isCustomer})::int`,
      supplier: sql<number>`count(*) filter (where ${customers.isSupplier})::int`,
      media: sql<number>`count(*) filter (where ${customers.isMedia})::int`,
      all: sql<number>`count(*)::int`,
    })
    .from(customers)
    .where(and(...baseFilters(access, { ...filter, type: "all" })));
  return row ?? { client: 0, supplier: 0, media: 0, all: 0 };
}

export type CustomerRecord = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;
