import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ChartFrame,
  Columns,
  Meter,
  OrdinalBars,
  StatTile,
  StatusBar,
} from "@/components/ui/charts";
import { getDb } from "@/lib/db";
import { communications, customers, leads, projects } from "@/lib/db/schema";
import { getThresholds } from "@/lib/data/common";
import { heatOf, heatSummary } from "@/lib/staleness";
import { daysBack, formatDate, money, monthsBack } from "@/lib/utils";
import { requireUser } from "@/lib/auth/session";
import { LEAD_STAGES } from "@/components/ui/status";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const FUNNEL = ["new", "contacted", "qualified", "proposal", "negotiation"] as const;

const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00`).toLocaleDateString("en-AU", { month: "short" });

export default async function ReportsPage() {
  await requireUser();
  const db = getDb();

  const sixMonthsAgo = monthsBack(5);
  const twelveWeeksAgo = daysBack(84);

  const [byStage, closed, wonByMonth, activityByWeek, projectHealth, quiet, thresholds] =
    await Promise.all([
      db
        .select({
          stage: leads.stage,
          count: sql<number>`count(*)::int`,
          value: sql<number>`coalesce(sum(${leads.valueAud}), 0)::float`,
        })
        .from(leads)
        .groupBy(leads.stage),

      db
        .select({
          stage: leads.stage,
          count: sql<number>`count(*)::int`,
          value: sql<number>`coalesce(sum(${leads.valueAud}), 0)::float`,
          avgDays: sql<number>`coalesce(avg(extract(epoch from (${leads.updatedAt} - ${leads.createdAt})) / 86400), 0)::float`,
        })
        .from(leads)
        .where(sql`${leads.stage} in ('won','lost')`)
        .groupBy(leads.stage),

      db
        .select({
          month: sql<string>`to_char(coalesce(${leads.convertedAt}, ${leads.updatedAt}), 'YYYY-MM')`,
          value: sql<number>`coalesce(sum(${leads.valueAud}), 0)::float`,
        })
        .from(leads)
        .where(
          and(
            eq(leads.stage, "won"),
            gte(sql`coalesce(${leads.convertedAt}, ${leads.updatedAt})`, sixMonthsAgo),
          ),
        )
        .groupBy(sql`to_char(coalesce(${leads.convertedAt}, ${leads.updatedAt}), 'YYYY-MM')`),

      db
        .select({
          week: sql<string>`to_char(date_trunc('week', ${communications.occurredAt}), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(communications)
        .where(gte(communications.occurredAt, twelveWeeksAgo))
        .groupBy(sql`date_trunc('week', ${communications.occurredAt})`),

      db
        .select({
          status: projects.status,
          health: projects.health,
          count: sql<number>`count(*)::int`,
        })
        .from(projects)
        .groupBy(projects.status, projects.health),

      db
        .select({
          id: customers.id,
          name: customers.name,
          lastActivityAt: customers.lastActivityAt,
          createdAt: customers.createdAt,
        })
        .from(customers)
        .where(and(eq(customers.status, "active"), isNotNull(customers.id)))
        .limit(200),

      getThresholds(),
    ]);

  const stageMap = new Map(byStage.map((r) => [r.stage, r]));
  const funnel = FUNNEL.map((stage) => ({
    label: LEAD_STAGES[stage].label,
    value: stageMap.get(stage)?.value ?? 0,
    count: stageMap.get(stage)?.count ?? 0,
  }));

  const won = closed.find((c) => c.stage === "won");
  const lost = closed.find((c) => c.stage === "lost");
  const decided = (won?.count ?? 0) + (lost?.count ?? 0);
  const winRate = decided === 0 ? 0 : Math.round(((won?.count ?? 0) / decided) * 100);

  const openValue = funnel.reduce((sum, f) => sum + f.value, 0);
  const openCount = funnel.reduce((sum, f) => sum + f.count, 0);

  // Six months of buckets, so a quiet month shows as a gap rather than vanishing.
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(sixMonthsAgo);
    d.setMonth(d.getMonth() + i);
    return monthKey(d);
  });
  const wonMap = new Map(wonByMonth.map((r) => [r.month, r.value]));
  const wonSeries = months.map((m) => ({ label: monthLabel(m), value: wonMap.get(m) ?? 0 }));

  const weeks = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(twelveWeeksAgo.getTime() + i * 7 * 86_400_000);
    const day = d.getDay();
    // Postgres weeks start on Monday; line the buckets up with that.
    d.setDate(d.getDate() - ((day + 6) % 7));
    return d.toISOString().slice(0, 10);
  });
  const activityMap = new Map(activityByWeek.map((r) => [r.week, r.count]));
  const activitySeries = weeks.map((w, i) => ({
    label: i % 2 === 0 ? formatDate(w, "day") : "",
    value: activityMap.get(w) ?? 0,
  }));

  const live = projectHealth.filter((p) =>
    ["planning", "active", "on_hold"].includes(p.status),
  );
  const healthSegments = [
    {
      label: "On track",
      value: live.filter((p) => p.health === "on_track").reduce((s, p) => s + p.count, 0),
      tone: "ok" as const,
    },
    {
      label: "At risk",
      value: live.filter((p) => p.health === "at_risk").reduce((s, p) => s + p.count, 0),
      tone: "warn" as const,
    },
    {
      label: "Off track",
      value: live.filter((p) => p.health === "off_track").reduce((s, p) => s + p.count, 0),
      tone: "danger" as const,
    },
  ];

  const goneQuiet = quiet
    .map((c) => ({ ...c, ...heatOf(c.lastActivityAt, c.createdAt, thresholds.customer) }))
    .filter((c) => c.heat !== "fresh")
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
    .slice(0, 8);

  return (
    <>
      <PageHeader
        title="Reports"
        description="The shape of the pipeline, what closed, and where the work is going quiet."
      />

      <PageBody className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Open pipeline"
            value={money(openValue)}
            detail={`${openCount} ${openCount === 1 ? "lead" : "leads"} still in play`}
          />
          <StatTile
            label="Won this period"
            value={money(won?.value ?? 0)}
            detail={`${won?.count ?? 0} closed`}
            tone={won?.count ? "ok" : undefined}
          />
          <StatTile
            label="Win rate"
            value={decided === 0 ? "—" : `${winRate}%`}
            detail={decided === 0 ? "Nothing decided yet" : `of ${decided} decided`}
          />
          <StatTile
            label="Average time to close"
            value={
              won?.avgDays ? `${Math.round(won.avgDays)} days` : "—"
            }
            detail="From first contact to won"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartFrame
            title="Pipeline by stage"
            subtitle="Value still open at each stage, earliest first"
            table={{
              head: ["Stage", "Leads", "Value"],
              rows: funnel.map((f) => [f.label, f.count, money(f.value)]),
            }}
          >
            <OrdinalBars
              data={funnel.map((f) => ({
                label: f.label,
                value: f.value,
                caption: `${money(f.value)} · ${f.count}`,
              }))}
            />
          </ChartFrame>

          <ChartFrame
            title="Won by month"
            subtitle="Value of leads marked won, last six months"
            table={{
              head: ["Month", "Value"],
              rows: wonSeries.map((w) => [w.label, money(w.value)]),
            }}
          >
            <Columns
              data={wonSeries}
              format={(n) => money(n)}
              emptyLabel="Nothing marked won in the last six months"
            />
          </ChartFrame>

          <ChartFrame
            title="Conversations logged"
            subtitle="Calls, meetings, notes and linked emails, per week"
            table={{
              head: ["Week beginning", "Logged"],
              rows: weeks.map((w, i) => [formatDate(w), activitySeries[i].value]),
            }}
          >
            <Columns
              data={activitySeries}
              emptyLabel="Nothing logged in the last twelve weeks"
            />
          </ChartFrame>

          <ChartFrame
            title="Delivery health"
            subtitle="Every project that is planning, active or on hold"
          >
            <div className="flex flex-col gap-5">
              <StatusBar segments={healthSegments} />
              <Meter
                value={winRate}
                label="Leads that end up won"
                caption={
                  decided === 0
                    ? "No leads have been decided yet."
                    : `${won?.count ?? 0} won and ${lost?.count ?? 0} lost so far.`
                }
                tone={winRate >= 50 ? "ok" : winRate >= 25 ? "series" : "warn"}
              />
            </div>
          </ChartFrame>
        </div>

        <Card>
          <CardHeader
            title="Business partners going quiet"
            meta={`No contact in over ${thresholds.customer} days`}
          />
          {goneQuiet.length === 0 ? (
            <EmptyState
              compact
              title="Everyone has been spoken to"
              description={`No active customer has gone more than ${thresholds.customer} days without contact.`}
            />
          ) : (
            <CardBody className="flex flex-col gap-1.5">
              {goneQuiet.map((c) => (
                <Link
                  key={c.id}
                  href={`/customers/${c.id}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--surface-2)]"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text)]">
                    {c.name}
                  </span>
                  <span className="shrink-0 text-[12px] text-[var(--text-muted)]">
                    Last spoke {formatDate(c.lastActivityAt ?? c.createdAt)}
                  </span>
                  <Badge tone={c.heat === "cold" ? "danger" : "warn"} dot>
                    {heatSummary(c.heat, c.days)}
                  </Badge>
                </Link>
              ))}
            </CardBody>
          )}
        </Card>
      </PageBody>
    </>
  );
}
