import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, ilike, isNull, or, type SQL } from "drizzle-orm";
import { Cake, Coffee, Mail, Phone } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { getDb } from "@/lib/db";
import { contacts, customers } from "@/lib/db/schema";
import { daysUntilAnniversary, formatDate } from "@/lib/utils";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "People" };
export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string }>;
}) {
  await requireUser();
  const { q, sort } = await searchParams;

  const filters: SQL[] = [isNull(contacts.archivedAt)];
  if (q) {
    filters.push(
      or(
        ilike(contacts.firstName, `%${q}%`),
        ilike(contacts.lastName, `%${q}%`),
        ilike(contacts.email, `%${q}%`),
        ilike(contacts.jobTitle, `%${q}%`),
        ilike(customers.name, `%${q}%`),
      )!,
    );
  }

  const rows = await getDb()
    .select({
      contact: contacts,
      customerId: customers.id,
      customerName: customers.name,
    })
    .from(contacts)
    .innerJoin(customers, eq(customers.id, contacts.customerId))
    .where(and(...filters))
    .orderBy(desc(contacts.isPrimary), asc(contacts.firstName))
    .limit(400);

  const sorted =
    sort === "birthday"
      ? [...rows].sort(
          (a, b) =>
            (daysUntilAnniversary(a.contact.birthday) ?? 9999) -
            (daysUntilAnniversary(b.contact.birthday) ?? 9999),
        )
      : rows;

  return (
    <>
      <PageHeader
        title="People"
        description="Everyone across every business partner — including the details that make the next conversation land."
        meta={
          <p className="text-[13px] text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text)]">{rows.length}</span>{" "}
            {rows.length === 1 ? "person" : "people"}
          </p>
        }
        actions={
          <ButtonLink href="/customers" variant="secondary">
            Add via a customer
          </ButtonLink>
        }
      />

      <PageBody className="flex flex-col gap-4">
        <FilterBar
          searchPlaceholder="Search people…"
          filters={[
            {
              param: "sort",
              label: "Sort",
              defaultValue: "name",
              options: [
                { value: "name", label: "By name" },
                { value: "birthday", label: "Birthday soonest" },
              ],
            },
          ]}
        />

        {sorted.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState
              title={q ? "Nobody matches that" : "No people recorded yet"}
              description={
                q
                  ? "Try a name, an email address or a company."
                  : "People are added against a customer, so their history and their projects stay together."
              }
              action={
                <ButtonLink href="/customers" variant="primary">
                  Go to customers
                </ButtonLink>
              }
            />
          </div>
        ) : (
          <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {sorted.map(({ contact, customerId, customerName }) => {
              const days = daysUntilAnniversary(contact.birthday);
              return (
                <li key={contact.id}>
                  <Link
                    href={`/customers/${customerId}`}
                    className="flex h-full flex-col gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow-sm)] transition-colors duration-150 hover:border-[var(--color-coastal-300)]"
                  >
                    <div className="flex items-start gap-2.5">
                      <Avatar
                        name={`${contact.firstName} ${contact.lastName ?? ""}`}
                        size="md"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-[14px] font-semibold text-[var(--text)]">
                            {contact.firstName} {contact.lastName}
                          </span>
                          {contact.isPrimary ? <Badge tone="brand">Primary</Badge> : null}
                        </p>
                        <p className="truncate text-[12px] text-[var(--text-muted)]">
                          {contact.jobTitle ? `${contact.jobTitle} · ` : ""}
                          {customerName}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">
                      {contact.email ? (
                        <span className="flex items-center gap-1.5 truncate">
                          <Mail className="size-3.5 shrink-0" />
                          {contact.email}
                        </span>
                      ) : null}
                      {contact.mobile ?? contact.phone ? (
                        <span className="flex items-center gap-1.5">
                          <Phone className="size-3.5 shrink-0" />
                          {contact.mobile ?? contact.phone}
                        </span>
                      ) : null}
                    </div>

                    {contact.coffeeOrder || contact.birthday ? (
                      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                        {contact.coffeeOrder ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--surface-3)] px-2 py-1 text-[11px] text-[var(--text-muted)]">
                            <Coffee className="size-3" />
                            {contact.coffeeOrder}
                          </span>
                        ) : null}
                        {contact.birthday ? (
                          <span
                            className={
                              days !== null && days <= 14
                                ? "inline-flex items-center gap-1.5 rounded-md bg-[var(--color-sunrise-50)] px-2 py-1 text-[11px] text-[var(--color-sunrise-700)] dark:bg-[var(--color-sunrise-900)]/40 dark:text-[var(--color-sunrise-200)]"
                                : "inline-flex items-center gap-1.5 rounded-md bg-[var(--surface-3)] px-2 py-1 text-[11px] text-[var(--text-muted)]"
                            }
                          >
                            <Cake className="size-3" />
                            {formatDate(contact.birthday, "day")}
                            {days !== null && days <= 14
                              ? ` · ${days === 0 ? "today" : `${days}d`}`
                              : ""}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PageBody>
    </>
  );
}
