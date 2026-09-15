import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { LEAD_STAGES, StatusBadge } from "@/components/ui/status";
import { FilterBar } from "@/components/app/filter-bar";
import { ViewToggle } from "@/components/app/view-toggle";
import { SavedViews } from "@/components/app/saved-views";
import {
  BulkBar,
  HeaderCheckbox,
  RowCheckbox,
  Selection,
} from "@/components/app/bulk-bar";
import { PipelineBoard, type BoardLead } from "./pipeline-board";
import { getDb } from "@/lib/db";
import { leads, users } from "@/lib/db/schema";
import { getThresholds, listTeam } from "@/lib/data/common";
import { listSavedViews } from "@/lib/data/saved-views";
import { heatOf, heatSummary } from "@/lib/staleness";
import { formatDate, money } from "@/lib/utils";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

const OPEN_STAGES = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "negotiation",
] as const;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    stage?: string;
    q?: string;
    owner?: string;
    view?: string;
  }>;
}) {
  const { user } = await requireUser();
  const { stage, q, owner, view } = await searchParams;
  const board = view !== "list";
  const db = getDb();

  const filters: SQL[] = [];
  if (stage && stage !== "all" && stage !== "open") {
    filters.push(eq(leads.stage, stage as (typeof OPEN_STAGES)[number]));
  }
  if (!board && (!stage || stage === "open")) {
    filters.push(
      sql`${leads.stage} = ANY(ARRAY['new','contacted','qualified','proposal','negotiation']::lead_stage[])`,
    );
  }
  // The board always shows the whole pipeline through to won.
  if (board) filters.push(sql`${leads.stage} <> 'lost'`);
  if (owner === "me") filters.push(eq(leads.ownerId, user.id));
  if (q) {
    filters.push(
      or(
        ilike(leads.companyName, `%${q}%`),
        ilike(leads.contactName, `%${q}%`),
        ilike(leads.interest, `%${q}%`),
      )!,
    );
  }

  const [rows, totals, thresholds, views, team] = await Promise.all([
    db
      .select({ lead: leads, ownerName: users.name, ownerPhoto: users.photo })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(
        board
          ? asc(leads.boardPosition)
          : desc(
              sql`coalesce(${leads.nextActionAt}, ${leads.updatedAt}::date)`,
            ),
      )
      .limit(400),
    db
      .select({
        stage: leads.stage,
        count: sql<number>`count(*)::int`,
        value: sql<number>`coalesce(sum(${leads.valueAud}), 0)::float`,
      })
      .from(leads)
      .groupBy(leads.stage),
    getThresholds(),
    listSavedViews("leads"),
    listTeam(),
  ]);

  const openTotal = totals
    .filter((t) => (OPEN_STAGES as readonly string[]).includes(t.stage))
    .reduce((sum, t) => sum + t.value, 0);
  const openCount = totals
    .filter((t) => (OPEN_STAGES as readonly string[]).includes(t.stage))
    .reduce((sum, t) => sum + t.count, 0);

  const cards: BoardLead[] = rows.map(({ lead, ownerName, ownerPhoto }) => ({
    id: lead.id,
    companyName: lead.companyName,
    contactName: lead.contactName,
    stage: lead.stage,
    valueAud: lead.valueAud,
    nextAction: lead.nextAction,
    nextActionAt: lead.nextActionAt,
    interest: lead.interest,
    ownerName,
    ownerPhoto,
    lastActivityAt: lead.lastActivityAt,
    createdAt: lead.createdAt,
    boardPosition: lead.boardPosition,
  }));

  return (
    <>
      <PageHeader
        title="Leads"
        description="Everyone Ankor'd is talking to who isn't a customer yet. Drag a card to move it on."
        meta={
          <p className="text-[13px] text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text)]">
              {openCount}
            </span>{" "}
            open ·{" "}
            <span className="font-semibold text-[var(--text)] tabular">
              {money(openTotal)}
            </span>{" "}
            in the pipeline
          </p>
        }
        actions={
          <>
            <ViewToggle />
            <ButtonLink href="/leads/new" variant="primary">
              <Plus />
              New lead
            </ButtonLink>
          </>
        }
      />

      <PageBody className="flex flex-col gap-4">
        <SavedViews entity="leads" views={views} currentUserId={user.id} />

        <FilterBar
          searchPlaceholder="Search leads…"
          filters={[
            {
              param: "owner",
              label: "Owner",
              defaultValue: "all",
              options: [
                { value: "all", label: "Everyone" },
                { value: "me", label: "Mine" },
              ],
            },
            ...(board
              ? []
              : [
                  {
                    param: "stage",
                    label: "Stage",
                    defaultValue: "open",
                    options: [
                      { value: "open", label: "Open" },
                      { value: "all", label: "All stages" },
                      ...Object.entries(LEAD_STAGES).map(
                        ([value, { label }]) => ({
                          value,
                          label,
                        }),
                      ),
                    ],
                  },
                ]),
          ]}
        />

        {rows.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState
              title={
                q || stage || owner
                  ? "No leads match that"
                  : "The pipeline starts here"
              }
              description={
                q || stage || owner
                  ? "Try a different filter, or clear the search."
                  : "Add the businesses Ankor'd is in conversation with. Give each one an owner and a next action, and this board becomes the weekly sales meeting."
              }
              action={
                <ButtonLink href="/leads/new" variant="primary">
                  <Plus />
                  New lead
                </ButtonLink>
              }
            />
          </div>
        ) : board ? (
          <PipelineBoard leads={cards} thresholds={thresholds} />
        ) : (
          <Selection>
            <BulkBar entity="leads" team={team} />
            <TableShell>
              <Table>
                <thead>
                  <tr>
                    <Th className="w-9">
                      <HeaderCheckbox ids={rows.map((r) => r.lead.id)} />
                    </Th>
                    <Th>Company</Th>
                    <Th>Stage</Th>
                    <Th>What they want</Th>
                    <Th>Owner</Th>
                    <Th numeric>Value</Th>
                    <Th>Next action</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ lead, ownerName, ownerPhoto }) => {
                    const { heat, days } = heatOf(
                      lead.lastActivityAt,
                      lead.createdAt,
                      thresholds.lead,
                    );
                    return (
                      <Tr key={lead.id}>
                        <Td>
                          <RowCheckbox id={lead.id} label={lead.companyName} />
                        </Td>
                        <Td className="max-w-64">
                          <Link
                            href={`/leads/${lead.id}`}
                            className="block truncate font-medium text-[var(--text)] hover:text-[var(--accent)] hover:underline underline-offset-2"
                          >
                            {lead.companyName}
                          </Link>
                          {lead.contactName ? (
                            <span className="block truncate text-[12px] text-[var(--text-muted)]">
                              {lead.contactName}
                              {lead.suburb ? ` · ${lead.suburb}` : ""}
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge
                              map={LEAD_STAGES}
                              value={lead.stage}
                              dot
                            />
                            {heat !== "fresh" ? (
                              <Badge tone={heat === "cold" ? "danger" : "warn"}>
                                {heatSummary(heat, days)}
                              </Badge>
                            ) : null}
                          </span>
                        </Td>
                        <Td className="max-w-64">
                          <span className="block truncate text-[var(--text-muted)]">
                            {lead.interest ?? "—"}
                          </span>
                        </Td>
                        <Td>
                          {ownerName ? (
                            <span className="flex items-center gap-1.5">
                              <Avatar
                                name={ownerName}
                                src={ownerPhoto}
                                size="xs"
                              />
                              <span className="truncate text-[12px]">
                                {ownerName}
                              </span>
                            </span>
                          ) : (
                            <span className="text-[var(--text-faint)]">
                              Unassigned
                            </span>
                          )}
                        </Td>
                        <Td numeric>{money(lead.valueAud)}</Td>
                        <Td className="max-w-56">
                          {lead.nextAction ? (
                            <>
                              <span className="block truncate">
                                {lead.nextAction}
                              </span>
                              <span className="block text-[12px] text-[var(--text-muted)]">
                                {formatDate(lead.nextActionAt)}
                              </span>
                            </>
                          ) : (
                            <span className="text-[var(--text-faint)]">
                              Nothing scheduled
                            </span>
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
