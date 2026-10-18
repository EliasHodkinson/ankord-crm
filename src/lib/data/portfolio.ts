import "server-only";
import { and, asc, between, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { customers, projectPhases, projectSteps, projects, users } from "@/lib/db/schema";
import { getAccess, projectListScope, projectScope, type Access } from "@/lib/access";
import type { Portfolio, PortfolioFilters } from "@/lib/portfolio";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { APP_TIME_ZONE } from "@/lib/utils";

/**
 * Reads behind the Projects page — the list, and the portfolio calendar and
 * timeline. Every query is scoped by `lib/access.ts`, so a restricted person
 * sees only the projects of the customers they have been granted.
 */

/** More than this and the views say so rather than drawing a wall. */
const PORTFOLIO_LIMIT = 400;

/** A timestamp as a Sydney calendar day, `YYYY-MM-DD`. */
function sydneyDay(column: AnyPgColumn) {
  return sql<string | null>`to_char(${column} at time zone ${APP_TIME_ZONE}, 'YYYY-MM-DD')`;
}

/**
 * The shared WHERE for every view. A date range keeps projects whose span —
 * start and target dates widened by their steps' due dates — overlaps it, so
 * the list, calendar and timeline agree on what "in range" means.
 */
function portfolioWhere(access: Access, f: PortfolioFilters): SQL | undefined {
  const filters: SQL[] = [];
  const scope = projectListScope(access);
  if (scope) filters.push(scope);

  if (f.status === "live") {
    filters.push(sql`${projects.status} in ('planning','active','on_hold')`);
  } else if (f.status !== "all") {
    filters.push(eq(projects.status, f.status as "active"));
  }
  if (f.q) {
    filters.push(or(ilike(projects.name, `%${f.q}%`), ilike(customers.name, `%${f.q}%`))!);
  }
  if (f.owner === "none") filters.push(isNull(projects.ownerId));
  else if (f.owner) filters.push(eq(projects.ownerId, f.owner));
  if (f.partner) filters.push(eq(projects.customerId, f.partner));

  if (f.from) {
    filters.push(sql`greatest(
      ${projects.targetDate},
      (${projects.completedAt} at time zone ${APP_TIME_ZONE})::date,
      (select max(${projectSteps.dueDate}) from ${projectSteps} where ${projectSteps.projectId} = ${projects.id})
    ) >= ${f.from}::date`);
  }
  if (f.to) {
    filters.push(sql`least(
      ${projects.startDate},
      (select min(${projectSteps.dueDate}) from ${projectSteps} where ${projectSteps.projectId} = ${projects.id})
    ) <= ${f.to}::date`);
  }
  return filters.length ? and(...filters) : undefined;
}

/** The Projects list: one row per project with its progress counts. */
export async function listProjectRows(filters: PortfolioFilters) {
  const access = await getAccess();
  return getDb()
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
    .where(portfolioWhere(access, filters))
    .orderBy(desc(projects.updatedAt))
    .limit(200);
}

/**
 * Projects, phases and steps for the calendar and timeline — three queries
 * however many projects there are. `window` narrows the steps to the days a
 * calendar is showing; the timeline and its trends need them all.
 */
export async function listPortfolio(
  filters: PortfolioFilters,
  window?: { from: string; to: string },
): Promise<Portfolio> {
  const access = await getAccess();
  const db = getDb();

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
      status: projects.status,
      health: projects.health,
      customerId: projects.customerId,
      customerName: customers.name,
      ownerId: projects.ownerId,
      ownerName: users.name,
      startDate: projects.startDate,
      targetDate: projects.targetDate,
      completedDay: sydneyDay(projects.completedAt),
    })
    .from(projects)
    .innerJoin(customers, eq(customers.id, projects.customerId))
    .leftJoin(users, eq(users.id, projects.ownerId))
    .where(portfolioWhere(access, filters))
    .orderBy(asc(customers.name), asc(projects.startDate), asc(projects.name))
    .limit(PORTFOLIO_LIMIT + 1);

  const truncated = rows.length > PORTFOLIO_LIMIT;
  const list = truncated ? rows.slice(0, PORTFOLIO_LIMIT) : rows;
  if (list.length === 0) return { projects: [], phases: [], steps: [], truncated };

  const ids = list.map((p) => p.id);
  // The ids are already scoped; projectScope says so again at the query that
  // returns the children, so the read stands on its own.
  const stepFilters = [inArray(projectSteps.projectId, ids), projectScope(access, projectSteps.projectId)];
  if (window) stepFilters.push(between(projectSteps.dueDate, window.from, window.to));

  const [phases, steps] = await Promise.all([
    db
      .select({
        id: projectPhases.id,
        projectId: projectPhases.projectId,
        num: projectPhases.num,
        label: projectPhases.label,
      })
      .from(projectPhases)
      .where(and(inArray(projectPhases.projectId, ids), projectScope(access, projectPhases.projectId)))
      .orderBy(asc(projectPhases.position)),
    db
      .select({
        id: projectSteps.id,
        projectId: projectSteps.projectId,
        phaseId: projectSteps.phaseId,
        title: projectSteps.title,
        tag: projectSteps.tag,
        ownerLabel: projectSteps.ownerLabel,
        status: projectSteps.status,
        dueDate: projectSteps.dueDate,
        warning: projectSteps.warning,
        completedDay: sydneyDay(projectSteps.completedAt),
      })
      .from(projectSteps)
      .where(and(...stepFilters))
      .orderBy(asc(projectSteps.position)),
  ]);

  return { projects: list, phases, steps, truncated };
}

/** The leads and business partners that appear on projects this person can see. */
export async function listPortfolioFacets() {
  const access = await getAccess();
  const db = getDb();
  const scope = projectListScope(access);
  const [owners, partners] = await Promise.all([
    db
      .selectDistinct({ id: users.id, name: users.name })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.ownerId))
      .where(scope)
      .orderBy(asc(users.name)),
    db
      .selectDistinct({ id: customers.id, name: customers.name })
      .from(projects)
      .innerJoin(customers, eq(customers.id, projects.customerId))
      .where(scope)
      .orderBy(asc(customers.name)),
  ]);
  return { owners, partners };
}
