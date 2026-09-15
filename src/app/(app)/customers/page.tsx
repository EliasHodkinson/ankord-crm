import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { and, asc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CUSTOMER_STATUS, StatusBadge } from "@/components/ui/status";
import { FilterBar } from "@/components/app/filter-bar";
import {
  BulkBar,
  HeaderCheckbox,
  RowCheckbox,
  Selection,
} from "@/components/app/bulk-bar";
import { SavedViews } from "@/components/app/saved-views";
import { getDb } from "@/lib/db";
import { contacts, customers, projects, users } from "@/lib/db/schema";
import { relativeTime } from "@/lib/utils";
import { getThresholds, listTeam } from "@/lib/data/common";
import { listSavedViews } from "@/lib/data/saved-views";
import { heatOf, heatSummary } from "@/lib/staleness";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; kind?: string; q?: string }>;
}) {
  const { user } = await requireUser();
  const { status, kind, q } = await searchParams;
  const db = getDb();

  const filters: SQL[] = [];
  if (status && status !== "all") {
    filters.push(eq(customers.status, status as "active"));
  }
  if (kind === "customer" || kind === "supplier") {
    // A record marked "both" is genuinely both, so it belongs in either list.
    filters.push(inArray(customers.kind, [kind, "both"]));
  }
  if (q) {
    filters.push(
      or(
        ilike(customers.name, `%${q}%`),
        ilike(customers.legalName, `%${q}%`),
        ilike(customers.suburb, `%${q}%`),
      )!,
    );
  }

  const [rows, thresholds, team, views] = await Promise.all([
    db
      .select({
        customer: customers,
        ownerName: users.name,
        ownerPhoto: users.photo,
        contactCount: sql<number>`(select count(*)::int from ${contacts} where ${contacts.customerId} = ${customers.id} and ${contacts.archivedAt} is null)`,
        activeProjects: sql<number>`(select count(*)::int from ${projects} where ${projects.customerId} = ${customers.id} and ${projects.status} in ('planning','active','on_hold'))`,
      })
      .from(customers)
      .leftJoin(users, eq(users.id, customers.ownerId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(customers.name))
      .limit(300),
    getThresholds(),
    listTeam(),
    listSavedViews("customers"),
  ]);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Every business Ankor'd works with — customers, suppliers, the people inside them, and what's running right now."
        meta={
          <p className="text-[13px] text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text)]">
              {rows.length}
            </span>{" "}
            {rows.length === 1 ? "customer" : "customers"} shown
          </p>
        }
        actions={
          <ButtonLink href="/customers/new" variant="primary">
            <Plus />
            New customer
          </ButtonLink>
        }
      />

      <PageBody className="flex flex-col gap-4">
        <SavedViews entity="customers" views={views} currentUserId={user.id} />

        <FilterBar
          searchPlaceholder="Search customers…"
          filters={[
            {
              param: "kind",
              label: "Relationship",
              defaultValue: "all",
              options: [
                { value: "all", label: "Customers & suppliers" },
                { value: "customer", label: "Customers" },
                { value: "supplier", label: "Suppliers" },
              ],
            },
            {
              param: "status",
              label: "Status",
              defaultValue: "all",
              options: [
                { value: "all", label: "All statuses" },
                ...Object.entries(CUSTOMER_STATUS).map(
                  ([value, { label }]) => ({
                    value,
                    label,
                  }),
                ),
              ],
            },
          ]}
        />

        {rows.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState
              title={
                q || status || kind ? "Nothing matches that" : "No customers yet"
              }
              description={
                q || status || kind
                  ? "Try a different relationship or status, or clear the search."
                  : "Add a business Ankor'd works for. You can also convert a won lead, which brings its contact and history across."
              }
              action={
                <ButtonLink href="/customers/new" variant="primary">
                  <Plus />
                  New customer
                </ButtonLink>
              }
            />
          </div>
        ) : (
          <Selection>
            <BulkBar entity="customers" team={team} />
            <TableShell>
              <Table>
                <thead>
                  <tr>
                    <Th className="w-9">
                      <HeaderCheckbox ids={rows.map((r) => r.customer.id)} />
                    </Th>
                    <Th>Customer</Th>
                    <Th>Status</Th>
                    <Th>Industry</Th>
                    <Th numeric>People</Th>
                    <Th numeric>Live projects</Th>
                    <Th>Owner</Th>
                    <Th>Last spoke</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const { heat, days } = heatOf(
                      row.customer.lastActivityAt,
                      row.customer.createdAt,
                      thresholds.customer,
                    );
                    return (
                      <Tr key={row.customer.id}>
                        <Td>
                          <RowCheckbox
                            id={row.customer.id}
                            label={row.customer.name}
                          />
                        </Td>
                        <Td className="max-w-72">
                          <Link
                            href={`/customers/${row.customer.id}`}
                            className="block truncate font-medium text-[var(--text)] hover:text-[var(--accent)] hover:underline underline-offset-2"
                          >
                            {row.customer.name}
                          </Link>
                          {row.customer.suburb ? (
                            <span className="block truncate text-[12px] text-[var(--text-muted)]">
                              {[row.customer.suburb, row.customer.state]
                                .filter(Boolean)
                                .join(", ")}
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge
                              map={CUSTOMER_STATUS}
                              value={row.customer.status}
                              dot
                            />
                            {row.customer.kind !== "customer" ? (
                              <Badge tone="neutral">
                                {row.customer.kind === "supplier"
                                  ? "Supplier"
                                  : "Both"}
                              </Badge>
                            ) : null}
                          </span>
                        </Td>
                        <Td className="text-[var(--text-muted)]">
                          {row.customer.industry ?? "—"}
                        </Td>
                        <Td numeric>{row.contactCount}</Td>
                        <Td numeric>
                          {row.activeProjects > 0 ? (
                            <span className="font-medium">
                              {row.activeProjects}
                            </span>
                          ) : (
                            <span className="text-[var(--text-faint)]">—</span>
                          )}
                        </Td>
                        <Td>
                          {row.ownerName ? (
                            <span className="flex items-center gap-1.5">
                              <Avatar
                                name={row.ownerName}
                                src={row.ownerPhoto}
                                size="xs"
                              />
                              <span className="truncate text-[12px]">
                                {row.ownerName}
                              </span>
                            </span>
                          ) : (
                            <span className="text-[var(--text-faint)]">
                              Unassigned
                            </span>
                          )}
                        </Td>
                        <Td className="text-[12px] text-[var(--text-muted)]">
                          {heat === "fresh" ? (
                            relativeTime(
                              row.customer.lastActivityAt ??
                                row.customer.createdAt,
                            )
                          ) : (
                            <Badge
                              tone={heat === "cold" ? "danger" : "warn"}
                              dot
                            >
                              {heatSummary(heat, days)}
                            </Badge>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableShell>
          </Selection>
        )}
      </PageBody>
    </>
  );
}
