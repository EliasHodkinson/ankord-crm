import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { PROJECT_HEALTH, PROJECT_STATUS, StatusBadge } from "@/components/ui/status";
import { FilterBar } from "@/components/app/filter-bar";
import { PortfolioCalendar } from "@/components/app/portfolio-calendar";
import { PortfolioTimeline } from "@/components/app/portfolio-timeline";
import { SavedViews } from "@/components/app/saved-views";
import { PORTFOLIO_VIEW_OPTIONS, ViewToggle } from "@/components/app/view-toggle";
import { ProgressBar } from "@/components/ui/progress";
import { formatDate } from "@/lib/utils";
import { requireUser } from "@/lib/auth/session";
import { listPortfolio, listPortfolioFacets, listProjectRows } from "@/lib/data/portfolio";
import { listSavedViews } from "@/lib/data/saved-views";
import {
  calendarWindow,
  parsePortfolioFilters,
  portfolioViewOf,
  timelineGroupOf,
  timelineZoomOf,
  VIEW_PARAMS,
  type PortfolioParams,
} from "@/lib/portfolio";
import { dayKey, parseDay, parseMonthKey, startOfToday, startOfWeek } from "@/lib/runbook-views";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

/**
 * Every project, three ways: the list, a calendar of what falls due, and a
 * timeline with the workload trend above it. Filters and the view live in the
 * URL, so a saved view remembers "timeline, by lead, this quarter".
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<PortfolioParams>;
}) {
  const { user } = await requireUser();
  const params = await searchParams;
  const view = portfolioViewOf(params.view);
  const filters = parsePortfolioFilters(params);
  const filtered = Boolean(
    filters.q || params.status || filters.owner || filters.partner || filters.from || filters.to,
  );

  const [facets, views] = await Promise.all([listPortfolioFacets(), listSavedViews("projects")]);

  const header = (
    <PageHeader
      title="Projects"
      description="The delivery work — phases, steps, the people holding things up, and where the files live."
      actions={
        <ButtonLink href="/projects/new" variant="primary">
          <Plus />
          New project
        </ButtonLink>
      }
    />
  );

  const toolbar = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SavedViews entity="projects" views={views} currentUserId={user.id} />
        <ViewToggle
          views={PORTFOLIO_VIEW_OPTIONS}
          defaultView="list"
          clears={VIEW_PARAMS}
          label="Projects view"
        />
      </div>
      <FilterBar
        searchPlaceholder="Search projects…"
        keep={["view", ...VIEW_PARAMS]}
        dateRange={{ from: "from", to: "to" }}
        filters={[
          {
            param: "status",
            label: "Status",
            defaultValue: "live",
            options: [
              { value: "live", label: "Live work" },
              { value: "all", label: "All projects" },
              ...Object.entries(PROJECT_STATUS).map(([value, { label }]) => ({ value, label })),
            ],
          },
          {
            param: "owner",
            label: "Lead",
            defaultValue: "",
            options: [
              { value: "", label: "Any lead" },
              ...facets.owners.map((o) => ({ value: o.id, label: o.name ?? "Unnamed" })),
              { value: "none", label: "No lead" },
            ],
          },
          {
            param: "partner",
            label: "Business partner",
            defaultValue: "",
            options: [
              { value: "", label: "Any business partner" },
              ...facets.partners.map((p) => ({ value: p.id, label: p.name })),
            ],
          },
        ]}
      />
    </>
  );

  if (view !== "list") {
    const today = startOfToday();
    const mode = params.cal === "week" ? "week" : "month";
    const anchor =
      mode === "week"
        ? startOfWeek(parseDay(params.week) ?? today)
        : (parseMonthKey(params.month) ?? new Date(today.getFullYear(), today.getMonth(), 1));
    // The calendar only needs the steps on screen; the timeline's trends need them all.
    const portfolio = await listPortfolio(
      filters,
      view === "calendar" ? calendarWindow(mode, anchor) : undefined,
    );

    return (
      <>
        {header}
        <PageBody className="flex flex-col gap-4">
          {toolbar}
          <Card>
            <CardBody>
              {view === "calendar" ? (
                <PortfolioCalendar portfolio={portfolio} mode={mode} anchor={dayKey(anchor)} />
              ) : (
                <PortfolioTimeline
                  portfolio={portfolio}
                  group={timelineGroupOf(params.group)}
                  zoom={timelineZoomOf(params.zoom)}
                  range={{ from: filters.from, to: filters.to }}
                />
              )}
            </CardBody>
          </Card>
        </PageBody>
      </>
    );
  }

  const rows = await listProjectRows(filters);

  return (
    <>
      {header}

      <PageBody className="flex flex-col gap-4">
        {toolbar}

        {rows.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState
              title={filtered ? "No projects match that" : "No projects running"}
              description={
                filtered
                  ? "Try a different status, or clear the filters."
                  : "Start one from a runbook template — the onboarding template alone lays out five phases and forty-one steps, warnings included."
              }
              action={
                <ButtonLink href="/projects/new" variant="primary">
                  <Plus />
                  New project
                </ButtonLink>
              }
            />
          </div>
        ) : (
          <TableShell>
            <Table>
              <thead>
                <tr>
                  <Th>Project</Th>
                  <Th>Status</Th>
                  <Th className="w-48">Progress</Th>
                  <Th>Lead</Th>
                  <Th>Target</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Tr key={row.project.id}>
                    <Td className="max-w-80">
                      <Link
                        href={`/projects/${row.project.id}`}
                        className="block truncate font-medium text-[var(--text)] hover:text-[var(--accent)] hover:underline underline-offset-2"
                      >
                        {row.project.name}
                      </Link>
                      <span className="block truncate text-[12px] text-[var(--text-muted)]">
                        {row.customerName}
                        {row.project.code ? ` · ${row.project.code}` : ""}
                      </span>
                    </Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge map={PROJECT_STATUS} value={row.project.status} />
                        {row.project.status === "active" ? (
                          <StatusBadge
                            map={PROJECT_HEALTH}
                            value={row.project.health}
                            dot
                          />
                        ) : null}
                      </span>
                    </Td>
                    <Td>
                      <ProgressBar
                        done={row.done}
                        total={row.total}
                        blocked={row.blocked}
                      />
                    </Td>
                    <Td>
                      {row.ownerName ? (
                        <span className="flex items-center gap-1.5">
                          <Avatar name={row.ownerName} src={row.ownerPhoto} size="xs" />
                          <span className="truncate text-[12px]">{row.ownerName}</span>
                        </span>
                      ) : (
                        <span className="text-[var(--text-faint)]">Unassigned</span>
                      )}
                    </Td>
                    <Td className="text-[12px] text-[var(--text-muted)]">
                      {formatDate(row.project.targetDate)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableShell>
        )}
      </PageBody>
    </>
  );
}
