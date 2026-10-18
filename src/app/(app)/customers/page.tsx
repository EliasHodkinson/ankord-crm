import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  CUSTOMER_STATUS,
  PARTNER_TYPE,
  PartnerTypeBadges,
  StatusBadge,
} from "@/components/ui/status";
import { partnerTypeParam, typeBadges } from "@/lib/contact-kinds";
import { FilterBar } from "@/components/app/filter-bar";
import {
  BulkBar,
  HeaderCheckbox,
  RowCheckbox,
  Selection,
} from "@/components/app/bulk-bar";
import { SavedViews } from "@/components/app/saved-views";
import { money, relativeTime } from "@/lib/utils";
import { getThresholds, listTeam } from "@/lib/data/common";
import { listSavedViews } from "@/lib/data/saved-views";
import {
  countPartnerTypes,
  listPartners,
  PARTNER_QUICK_FILTERS,
} from "@/lib/data/customers";
import { heatOf, heatSummary } from "@/lib/staleness";
import { requireUser } from "@/lib/auth/session";
import { getAccess } from "@/lib/access";
import { PartnerTypeSwitch } from "./type-switch";

export const metadata: Metadata = { title: "Business Partners" };
export const dynamic = "force-dynamic";

const dash = <span className="text-[var(--text-faint)]">—</span>;

/** A money cell that fades to a dash at zero, so the live amounts stand out. */
function Amount({ value }: { value: number | null }) {
  return value ? <span className="font-medium">{money(value)}</span> : dash;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    kind?: string;
    status?: string;
    q?: string;
    only?: string;
  }>;
}) {
  const { user } = await requireUser();
  const access = await getAccess();
  const params = await searchParams;
  const { status, q, only } = params;
  const type = partnerTypeParam(params.type, params.kind);
  const quickFilters = PARTNER_QUICK_FILTERS[type];
  const quick = quickFilters.find((f) => f.value === only);

  const [rows, counts, thresholds, team, views] = await Promise.all([
    listPartners({ type, status, q, only }),
    countPartnerTypes({ status, q }),
    getThresholds(),
    listTeam(),
    listSavedViews("customers"),
  ]);

  const noun =
    type === "all"
      ? rows.length === 1
        ? "business partner"
        : "business partners"
      : rows.length === 1
        ? PARTNER_TYPE[type].label.toLowerCase()
        : PARTNER_TYPE[type].plural.toLowerCase();
  const newHref = type === "all" ? "/customers/new" : `/customers/new?type=${type}`;

  return (
    <>
      <PageHeader
        title="Business Partners"
        description="Everyone Ankor'd deals with — clients, suppliers, media, the people inside them, and what's running right now."
        meta={
          <p className="text-[13px] text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text)]">
              {rows.length}
            </span>{" "}
            {noun} shown
          </p>
        }
        actions={
          access.restricted ? null : (
            <ButtonLink href={newHref} variant="primary">
              <Plus />
              Create Business Partner
            </ButtonLink>
          )
        }
      />

      <PageBody className="flex flex-col gap-4">
        <PartnerTypeSwitch current={type} counts={counts} params={params} />

        <SavedViews entity="customers" views={views} currentUserId={user.id} />

        <FilterBar
          searchPlaceholder={`Search ${type === "all" ? "business partners" : PARTNER_TYPE[type].plural.toLowerCase()}…`}
          keep={["type"]}
          filters={[
            {
              param: "only",
              label: "Show",
              defaultValue: "",
              options: [
                { value: "", label: type === "all" ? "Everyone" : `All ${PARTNER_TYPE[type].plural.toLowerCase()}` },
                ...quickFilters,
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
                q || (status && status !== "all") || quick
                  ? "Nothing matches that"
                  : access.restricted
                    ? "Nothing has been shared with you yet"
                    : type === "all"
                      ? "No business partners yet"
                      : `No ${PARTNER_TYPE[type].plural.toLowerCase()} yet`
              }
              description={
                q || (status && status !== "all") || quick
                  ? "Try another tab or status, or clear the search."
                  : access.restricted
                    ? "An Ankor'd admin decides which business partners you can see. Once they share one, it appears here."
                    : type === "media"
                      ? "Add a publication, station or journalist's outlet, or tick Media on an existing partner."
                      : type === "supplier"
                        ? "Add a business that bills Ankor'd, or tick Supplier on an existing partner. Contacts imported from Xero arrive with it already set."
                        : "Add a business Ankor'd deals with — a client, a supplier, a media contact. You can also convert a won lead, which brings its contact and history across."
              }
              action={
                access.restricted ? undefined : (
                  <ButtonLink href={newHref} variant="primary">
                    <Plus />
                    Create Business Partner
                  </ButtonLink>
                )
              }
            />
          </div>
        ) : (
          <Selection>
            {access.restricted ? null : <BulkBar entity="customers" team={team} />}
            <TableShell>
              <Table>
                <thead>
                  <tr>
                    <Th className="w-9">
                      <HeaderCheckbox ids={rows.map((r) => r.customer.id)} />
                    </Th>
                    <Th>{type === "media" ? "Outlet" : "Business partner"}</Th>
                    <Th>Status</Th>
                    {type === "media" ? (
                      <>
                        <Th>Contact</Th>
                        <Th>Email</Th>
                        <Th>Phone</Th>
                      </>
                    ) : (
                      <>
                        <Th>Industry</Th>
                        <Th numeric>People</Th>
                      </>
                    )}
                    {type === "client" || type === "all" ? (
                      <Th numeric>Live projects</Th>
                    ) : null}
                    {type === "client" ? (
                      <>
                        <Th numeric>Open quotes</Th>
                        <Th numeric>Owing</Th>
                      </>
                    ) : null}
                    {type === "supplier" ? (
                      <>
                        <Th numeric>Open POs</Th>
                        <Th numeric>Bills to pay</Th>
                      </>
                    ) : null}
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
                    const email = row.contactEmail ?? row.customer.email;
                    const phone = row.contactPhone ?? row.customer.phone;
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
                          {type === "media" && row.customer.website ? (
                            <span className="block truncate text-[12px] text-[var(--text-muted)]">
                              {row.customer.website.replace(/^https?:\/\//, "")}
                            </span>
                          ) : row.customer.suburb ? (
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
                            <PartnerTypeBadges
                              types={typeBadges(
                                row.customer,
                                type === "all" ? undefined : type,
                              )}
                            />
                          </span>
                        </Td>
                        {type === "media" ? (
                          <>
                            <Td className="max-w-56">
                              {row.contactName ? (
                                <>
                                  <span className="block truncate">{row.contactName}</span>
                                  {row.contactTitle ? (
                                    <span className="block truncate text-[12px] text-[var(--text-muted)]">
                                      {row.contactTitle}
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                dash
                              )}
                            </Td>
                            <Td className="max-w-56">
                              {email ? (
                                <a
                                  href={`mailto:${email}`}
                                  className="block truncate text-[var(--text-muted)] hover:text-[var(--text)] hover:underline underline-offset-2"
                                >
                                  {email}
                                </a>
                              ) : (
                                dash
                              )}
                            </Td>
                            <Td className="whitespace-nowrap">
                              {phone ? (
                                <a
                                  href={`tel:${phone.replace(/\s/g, "")}`}
                                  className="tabular text-[var(--text-muted)] hover:text-[var(--text)]"
                                >
                                  {phone}
                                </a>
                              ) : (
                                dash
                              )}
                            </Td>
                          </>
                        ) : (
                          <>
                            <Td className="text-[var(--text-muted)]">
                              {row.customer.industry ?? "—"}
                            </Td>
                            <Td numeric>{row.contactCount}</Td>
                          </>
                        )}
                        {type === "client" || type === "all" ? (
                          <Td numeric>
                            {row.activeProjects ? (
                              <span className="font-medium">
                                {row.activeProjects}
                              </span>
                            ) : (
                              dash
                            )}
                          </Td>
                        ) : null}
                        {type === "client" ? (
                          <>
                            <Td numeric>
                              <Amount value={row.openQuotes} />
                            </Td>
                            <Td numeric>
                              <Amount value={row.owing} />
                            </Td>
                          </>
                        ) : null}
                        {type === "supplier" ? (
                          <>
                            <Td numeric>
                              {row.openPos ? (
                                <span>
                                  <span className="font-medium">{row.openPos}</span>
                                  <span className="text-[var(--text-muted)]">
                                    {" · "}
                                    {money(row.openPoValue)}
                                  </span>
                                </span>
                              ) : (
                                dash
                              )}
                            </Td>
                            <Td numeric>
                              <Amount value={row.billsDue} />
                            </Td>
                          </>
                        ) : null}
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
