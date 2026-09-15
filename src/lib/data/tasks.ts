import "server-only";
import { and, asc, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { customers, leads, projects, tasks, users } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { isoDate } from "@/lib/utils";

export { BUCKET_LABEL, BUCKET_ORDER, bucketOf, type TaskBucket } from "@/lib/tasks";

export type TaskRow = Awaited<ReturnType<typeof listTasks>>[number];

/** Open work, with just enough of the parent record to say what it relates to. */
export async function listTasks(scope: {
  assigneeId?: string | "everyone";
  customerId?: string;
  projectId?: string;
  leadId?: string;
  includeDone?: boolean;
  limit?: number;
}) {
  const { user } = await requireUser();
  const where = [];

  if (scope.customerId) where.push(eq(tasks.customerId, scope.customerId));
  if (scope.projectId) where.push(eq(tasks.projectId, scope.projectId));
  if (scope.leadId) where.push(eq(tasks.leadId, scope.leadId));

  const assignee = scope.assigneeId ?? user.id;
  const filters = [
    where.length ? or(...where)! : undefined,
    assignee === "everyone" ? undefined : eq(tasks.assigneeId, assignee),
    scope.includeDone ? undefined : eq(tasks.status, "open"),
  ].filter(Boolean);

  return getDb()
    .select({
      task: tasks,
      assigneeName: users.name,
      assigneePhoto: users.photo,
      customerName: customers.name,
      projectName: projects.name,
      leadName: leads.companyName,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(customers, eq(customers.id, tasks.customerId))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(leads, eq(leads.id, tasks.leadId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(
      // Anything with a date comes first, oldest due date at the top.
      sql`${tasks.dueDate} nulls last`,
      desc(tasks.priority),
      asc(tasks.createdAt),
    )
    .limit(scope.limit ?? 200);
}

/** How many open tasks are due today or already late — for the nav badge. */
export async function dueCount(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.assigneeId, userId),
        eq(tasks.status, "open"),
        isNotNull(tasks.dueDate),
        sql`${tasks.dueDate} <= ${isoDate()}`,
      ),
    );
  return row?.total ?? 0;
}
