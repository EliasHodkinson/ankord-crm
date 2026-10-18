import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { plannerPlans, projects } from "@/lib/db/schema";
import { planWebUrl } from "@/lib/graph/planner";
import { optionalEnv } from "@/lib/env";

export type PlannerLinkView = {
  planId: string;
  title: string | null;
  webUrl: string | null;
  lastSyncedAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
};

function view(row: typeof plannerPlans.$inferSelect): PlannerLinkView {
  const tenant = optionalEnv("AZURE_AD_TENANT_ID");
  return {
    planId: row.planId,
    title: row.title,
    webUrl: tenant ? planWebUrl(tenant, row.planId) : null,
    lastSyncedAt: row.lastSyncedAt,
    lastAttemptAt: row.lastAttemptAt,
    lastError: row.lastError,
  };
}

export async function getPlannerLink(projectId: string): Promise<PlannerLinkView | null> {
  const [row] = await getDb()
    .select()
    .from(plannerPlans)
    .where(eq(plannerPlans.projectId, projectId));
  return row ? view(row) : null;
}

/** Every linked project, for the sync overview in Settings. */
export async function listPlannerLinks() {
  const rows = await getDb()
    .select({ link: plannerPlans, projectName: projects.name, projectId: projects.id })
    .from(plannerPlans)
    .innerJoin(projects, eq(projects.id, plannerPlans.projectId))
    .orderBy(asc(projects.name));
  return rows.map((r) => ({ projectId: r.projectId, projectName: r.projectName, ...view(r.link) }));
}
