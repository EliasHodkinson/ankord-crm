import Link from "next/link";
import { and, desc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  ArrowRight,
  Building2,
  CalendarHeart,
  FolderKanban,
  OctagonAlert,
  Target,
} from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { LEAD_STAGES, StatusBadge } from "@/components/ui/status";
import { getThresholds } from "@/lib/data/common";
import { heatOf, heatSummary } from "@/lib/staleness";
import { getDb } from "@/lib/db";
import {
  activity,
  contactFacts,
  contacts,
  customers,
  leads,
  projectSteps,
  projects,
  users,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import {
  daysAway,
  daysUntilAnniversary,
  formatDate,
  isoDate,
  money,
  relativeTime,
  timeOfDayGreeting,
  todayLongDate,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

const today = () => isoDate();
const inDays = (n: number) => isoDate(n);

export default async function DashboardPage() {
  const { user } = await requireUser();
  const db = getDb();

  const [
    pipeline,
    activeProjects,
    myLeads,
    blockedSteps,
    myWork,
    upcoming,
    recent,
    counts,
  ] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)::int`,
        value: sql<number>`coalesce(sum(${leads.valueAud}), 0)::float`,
      })
      .from(leads)
      .where(sql`${leads.stage} not in ('won','lost')`),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(eq(projects.status, "active")),

    db
      .select({ lead: leads })
      .from(leads)
      .where(
        and(
          eq(leads.ownerId, user.id),
          sql`${leads.stage} not in ('won','lost')`,
          or(isNull(leads.nextActionAt), lte(leads.nextActionAt, inDays(7)))!,
        ),
      )
      .orderBy(sql`${leads.nextActionAt} nulls last`)
      .limit(6),

    db
      .select({
        step: projectSteps,
        projectName: projects.name,
        customerName: customers.name,
      })
      .from(projectSteps)
      .innerJoin(projects, eq(projects.id, projectSteps.projectId))
      .innerJoin(customers, eq(customers.id, projects.customerId))
      .where(and(eq(projectSteps.status, "blocked"), ne(projects.status, "cancelled")))
      .orderBy(projectSteps.blockedSince)
      .limit(8),

    db
      .select({
        step: projectSteps,
        projectName: projects.name,
      })
      .from(projectSteps)
      .innerJoin(projects, eq(projects.id, projectSteps.projectId))
      .where(
        and(
          eq(projectSteps.assigneeId, user.id),
          sql`${projectSteps.status} in ('todo','in_progress')`,
        ),
      )
      .orderBy(sql`${projectSteps.dueDate} nulls last`)
      .limit(6),

    db
      .select({
        id: contacts.id,
        customerId: contacts.customerId,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        customerName: customers.name,
        birthday: contacts.birthday,
        label: sql<string | null>`null`,
      })
      .from(contacts)
      .innerJoin(customers, eq(customers.id, contacts.customerId))
      .where(sql`${contacts.birthday} is not null`)
      .limit(60),

    db
      .select({
        entry: activity,
        actorName: users.name,
        actorPhoto: users.photo,
      })
      .from(activity)
      .leftJoin(users, eq(users.id, activity.actorId))
      .orderBy(desc(activity.createdAt))
      .limit(10),

    db
      .select({
        customers: sql<number>`(select count(*)::int from ${customers} where ${customers.status} = 'active')`,
      })
      .from(sql`(select 1) as one`),
  ]);

  const thresholds = await getThresholds();

  const events = await db
    .select({
      fact: contactFacts,
      contactId: contacts.id,
      customerId: contacts.customerId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      customerName: customers.name,
    })
    .from(contactFacts)
    .innerJoin(contacts, eq(contacts.id, contactFacts.contactId))
    .innerJoin(customers, eq(customers.id, contacts.customerId))
    .where(
      and(
        sql`${contactFacts.onDate} is not null`,
        or(
          eq(contactFacts.recurring, true),
          and(gte(contactFacts.onDate, today()), lte(contactFacts.onDate, inDays(45))),
        )!,
      ),
    )
    .limit(40);

  // Birthdays and dated facts share one "coming up" list, sorted by proximity.
  const comingUp = [
    ...upcoming
      .map((c) => ({
        key: `b-${c.id}`,
        days: daysUntilAnniversary(c.birthday) ?? 999,
        who: `${c.firstName} ${c.lastName ?? ""}`.trim(),
        where: c.customerName,
        customerId: c.customerId,
        what: "Birthday",
        date: c.birthday,
      }))
      .filter((e) => e.days <= 45),
    ...events
      .map((e) => ({
        key: `f-${e.fact.id}`,
        days: daysAway(e.fact.onDate, e.fact.recurring) ?? 999,
        who: `${e.firstName} ${e.lastName ?? ""}`.trim(),
        where: e.customerName,
        customerId: e.customerId,
        what: e.fact.label,
        date: e.fact.onDate,
      }))
      .filter((e) => e.days >= 0 && e.days <= 45),
  ]
    .sort((a, b) => a.days - b.days)
    .slice(0, 6);

  const firstName = user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={`${timeOfDayGreeting()}, ${firstName}`}
        description={todayLongDate()}
        actions={
          <>
            <ButtonLink href="/leads/new" variant="secondary">
              New lead
            </ButtonLink>
            <ButtonLink href="/projects/new" variant="primary">
              New project
            </ButtonLink>
          </>
        }
      />

      <PageBody className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            href="/leads"
            icon={Target}
            label="Open pipeline"
            value={money(pipeline[0]?.value ?? 0)}
            detail={`${pipeline[0]?.count ?? 0} leads in play`}
          />
          <Stat
            href="/projects"
            icon={FolderKanban}
            label="Active projects"
            value={String(activeProjects[0]?.count ?? 0)}
            detail="Currently being delivered"
          />
          <Stat
            href="/projects?status=all"
            icon={OctagonAlert}
            label="Blocked steps"
            value={String(blockedSteps.length)}
            detail={blockedSteps.length > 0 ? "Waiting on someone" : "Nothing stuck"}
            urgent={blockedSteps.length > 0}
          />
          <Stat
            href="/customers"
            icon={Building2}
            label="Business partners"
            value={String(counts[0]?.customers ?? 0)}
            detail="On the books"
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Your leads"
              meta="Yours to chase, soonest first"
              action={
                <Link
                  href="/leads"
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-coastal-600)] hover:underline underline-offset-2"
                >
                  All leads
                  <ArrowRight className="size-3" />
                </Link>
              }
            />
            {myLeads.length === 0 ? (
              <EmptyState
                compact
                title="Nothing waiting on you"
                description="Leads you own with an action due in the next week show up here."
              />
            ) : (
              <ul className="divide-y divide-[var(--border-soft)]">
                {myLeads.map(({ lead }) => {
                  const overdue = lead.nextActionAt && lead.nextActionAt < today();
                  const { heat, days } = heatOf(
                    lead.lastActivityAt,
                    lead.createdAt,
                    thresholds.lead,
                  );
                  return (
                    <li key={lead.id}>
                      <Link
                        href={`/leads/${lead.id}`}
                        className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--surface-2)]"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-[var(--text)]">
                            {lead.companyName}
                          </p>
                          <p className="truncate text-[12px] text-[var(--text-muted)]">
                            {lead.nextAction ?? "No next action set"}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {heat === "fresh" ? (
                            <StatusBadge map={LEAD_STAGES} value={lead.stage} />
                          ) : (
                            <Badge tone={heat === "cold" ? "danger" : "warn"} dot>
                              {heatSummary(heat, days)}
                            </Badge>
                          )}
                          {lead.nextActionAt ? (
                            <span
                              className={
                                overdue
                                  ? "text-[11px] font-medium text-[var(--danger)]"
                                  : "text-[11px] text-[var(--text-faint)]"
                              }
                            >
                              {formatDate(lead.nextActionAt)}
                            </span>
                          ) : null}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Blocked" meta="Steps waiting on someone else" />
            {blockedSteps.length === 0 ? (
              <EmptyState
                compact
                title="Nothing is stuck"
                description="When a runbook step gets marked blocked, it appears here so it can be chased before it costs a week."
              />
            ) : (
              <ul className="divide-y divide-[var(--border-soft)]">
                {blockedSteps.map(({ step, projectName, customerName }) => (
                  <li key={step.id}>
                    <Link
                      href={`/projects/${step.projectId}`}
                      className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--surface-2)]"
                    >
                      <OctagonAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--danger)]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-[var(--text)]">
                          {step.title}
                        </p>
                        <p className="truncate text-[12px] text-[var(--text-muted)]">
                          {customerName} · {projectName}
                          {step.blockedOn ? ` · waiting on ${step.blockedOn}` : ""}
                        </p>
                      </div>
                      {step.blockedSince ? (
                        <span className="shrink-0 text-[11px] text-[var(--text-faint)]">
                          {relativeTime(step.blockedSince)}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Assigned to you" meta="Runbook steps with your name on them" />
            {myWork.length === 0 ? (
              <EmptyState
                compact
                title="No steps assigned to you"
                description="Open a project runbook and assign yourself a step — it will show up here with its due date."
              />
            ) : (
              <ul className="divide-y divide-[var(--border-soft)]">
                {myWork.map(({ step, projectName }) => (
                  <li key={step.id}>
                    <Link
                      href={`/projects/${step.projectId}`}
                      className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--surface-2)]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-[var(--text)]">
                          {step.title}
                        </p>
                        <p className="truncate text-[12px] text-[var(--text-muted)]">
                          {projectName}
                        </p>
                      </div>
                      {step.dueDate ? (
                        <span
                          className={
                            step.dueDate < today()
                              ? "shrink-0 text-[11px] font-medium text-[var(--danger)]"
                              : "shrink-0 text-[11px] text-[var(--text-faint)]"
                          }
                        >
                          {formatDate(step.dueDate)}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Coming up"
              meta="Birthdays and the things people mentioned"
            />
            {comingUp.length === 0 ? (
              <EmptyState
                compact
                title="Nothing in the next six weeks"
                description="Add a birthday or a note like “daughter's wedding in March” against a contact and it will surface here in time to do something about it."
              />
            ) : (
              <ul className="divide-y divide-[var(--border-soft)]">
                {comingUp.map((event) => (
                  <li key={event.key}>
                    <Link
                      href={`/customers/${event.customerId}`}
                      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--surface-2)]"
                    >
                      <CalendarHeart className="size-3.5 shrink-0 text-[var(--color-sunrise-500)]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-[var(--text)]">
                          <span className="font-medium">{event.who}</span> —{" "}
                          {event.what}
                        </p>
                        <p className="truncate text-[12px] text-[var(--text-muted)]">
                          {event.where} · {formatDate(event.date, "day")}
                        </p>
                      </div>
                      <Badge tone={event.days <= 7 ? "accent" : "neutral"}>
                        {event.days === 0 ? "Today" : `${event.days}d`}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader title="Recent activity" meta="What the team has been doing" />
          {recent.length === 0 ? (
            <EmptyState
              compact
              title="Nothing has happened yet"
              description="Add a lead or a business partner and the trail starts here."
            />
          ) : (
            <CardBody>
              <ol className="flex flex-col gap-2.5">
                {recent.map(({ entry, actorName, actorPhoto }) => (
                  <li key={entry.id} className="flex items-center gap-2.5">
                    <Avatar name={actorName ?? "System"} src={actorPhoto} size="xs" />
                    <p className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
                      <span className="font-medium">{actorName ?? "Someone"}</span>{" "}
                      <span className="text-[var(--text-muted)]">{entry.summary}</span>
                    </p>
                    <span className="shrink-0 text-[11px] text-[var(--text-faint)]">
                      {relativeTime(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            </CardBody>
          )}
        </Card>
      </PageBody>
    </>
  );
}

function Stat({
  href,
  icon: Icon,
  label,
  value,
  detail,
  urgent,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  urgent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] transition-colors duration-150 hover:border-[var(--color-coastal-300)]"
    >
      <span className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-muted)]">
        <Icon
          className={
            urgent
              ? "size-3.5 text-[var(--danger)]"
              : "size-3.5 text-[var(--color-coastal-500)]"
          }
        />
        {label}
      </span>
      <p className="mt-2 text-[26px] leading-none font-semibold tracking-[-0.03em] text-[var(--text)] tabular">
        {value}
      </p>
      <p className="mt-1.5 text-[12px] text-[var(--text-faint)]">{detail}</p>
    </Link>
  );
}
