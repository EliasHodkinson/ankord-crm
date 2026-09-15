import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { PROJECT_HEALTH, PROJECT_STATUS, StatusBadge } from "@/components/ui/status";
import { FilterBar } from "@/components/app/filter-bar";
import { ProgressBar } from "@/components/ui/progress";
import { getDb } from "@/lib/db";
import { customers, projectSteps, projects, users } from "@/lib/db/schema";
import { formatDate } from "@/lib/utils";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireUser();
  const { status, q } = await searchParams;
  const db = getDb();

  const filters: SQL[] = [];
  if (status && status !== "all" && status !== "live") {
    filters.push(eq(projects.status, status as "active"));
  }
  if (!status || status === "live") {
    filters.push(sql`${projects.status} in ('planning','active','on_hold')`);
  }
  if (q) {
    filters.push(
      or(ilike(projects.name, `%${q}%`), ilike(customers.name, `%${q}%`))!,
    );
  }

  const rows = await db
    .select({
      project: projects,
      customerName: customers.name,
      ownerName: users.name,
      ownerPhoto: users.photo,
      total: sql<number>`(select count(*)::int from ${projectSteps} where ${projectSteps.projectId} = ${projects.id} and ${projectSteps.status} <> 'not_applicable')`,
      done: sql<number>`(select count(*)::int from ${projectSteps} where ${projectSteps.projectId} = ${projects.id} and ${projectSteps.status} = 'done')`,
      blocked: sql<number>`(select count(*)::int from ${projectSteps} where ${projectSteps.projectId} = ${projects.id} and ${projectSteps.status} = 'blocked')`,
    })
    .from(projects)
    .innerJoin(customers, eq(customers.id, projects.customerId))
    .leftJoin(users, eq(users.id, projects.ownerId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(projects.updatedAt))
    .limit(200);

  return (
    <>
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

      <PageBody className="flex flex-col gap-4">
        <FilterBar
          searchPlaceholder="Search projects…"
          filters={[
            {
              param: "status",
              label: "Status",
              defaultValue: "live",
              options: [
                { value: "live", label: "Live work" },
                { value: "all", label: "All projects" },
                ...Object.entries(PROJECT_STATUS).map(([value, { label }]) => ({
                  value,
                  label,
                })),
              ],
            },
          ]}
        />

        {rows.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState
              title={q || status ? "No projects match that" : "No projects running"}
              description={
                q || status
                  ? "Try a different status, or clear the search."
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
