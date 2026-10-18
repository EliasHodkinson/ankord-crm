"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { plannerItems, plannerPlans, projects, settings } from "@/lib/db/schema";
import { getGraphToken, requireAdmin, requireUser } from "@/lib/auth/session";
import { describeGraphFailure } from "@/lib/graph/errors";
import {
  createPlan,
  etagOf,
  getPlan,
  listMyGroups,
  listPlans,
  planGroupId,
} from "@/lib/graph/planner";
import { syncPlannerProject, summaryChangedHere, type SyncSummary } from "@/lib/planner/sync";
import { autoProvisionFolder } from "./files";
import { fail, fromZod, logActivity, type ActionState } from "./shared";

/**
 * Linking projects to Microsoft Planner plans, and running the sync.
 *
 * Every call here uses the signed-in person's delegated token, so a person
 * can only link, create or sync plans in groups they belong to — Planner's
 * own permissions, not the CRM's, decide what they can reach.
 */

async function token(): Promise<string> {
  return getGraphToken();
}

/* ── sync ────────────────────────────────────────────────────────── */

export type PlannerSyncState = ActionState & {
  /** Something changed in The Gangway, so the page should re-render. */
  changedHere?: boolean;
  summary?: SyncSummary;
};

/**
 * Syncs one linked project. `force` is "Sync now"; without it a sync that ran
 * in the last few seconds is skipped, which is what lets every open tab poll
 * without hammering Graph.
 */
export async function syncPlanner(
  projectId: string,
  opts: { force?: boolean } = {},
): Promise<PlannerSyncState> {
  await requireUser();
  let access: string;
  try {
    access = await token();
  } catch (error) {
    return fail(describeGraphFailure(error));
  }

  const { summary, error } = await syncPlannerProject(projectId, access, opts);
  const changedHere = summaryChangedHere(summary);
  if (changedHere) {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/projects");
  }
  if (error) return { ok: false, message: error, changedHere, summary };
  return { ok: true, message: describeSummary(summary), changedHere, summary };
}

function describeSummary(s: SyncSummary): string {
  if (s.skipped) return "Up to date.";
  const parts = [
    s.createdHere + s.pulled + s.deletedHere > 0
      ? `${s.createdHere + s.pulled + s.deletedHere} from Planner`
      : null,
    s.createdThere + s.pushed + s.deletedThere > 0
      ? `${s.createdThere + s.pushed + s.deletedThere} to Planner`
      : null,
  ].filter(Boolean);
  const conflicts =
    s.conflicts > 0
      ? ` ${s.conflicts} edit${s.conflicts === 1 ? " was" : "s were"} made in both places — Planner's kept.`
      : "";
  return parts.length ? `Synced — ${parts.join(", ")}.${conflicts}` : "Up to date.";
}

/* ── finding groups and plans ────────────────────────────────────── */

export type GroupOption = { id: string; name: string };
export type PlanOption = { id: string; title: string; groupId: string | null; linkedTo: string | null };

export async function listPlannerGroups(): Promise<
  ActionState & { groups?: GroupOption[]; defaultGroupId?: string | null }
> {
  await requireUser();
  try {
    const [groups, [row]] = await Promise.all([
      listMyGroups(await token()),
      getDb()
        .select({ id: settings.plannerGroupId })
        .from(settings)
        .where(eq(settings.id, "singleton")),
    ]);
    return {
      ok: true,
      groups: groups.map((g) => ({ id: g.id, name: g.displayName })),
      defaultGroupId: row?.id ?? null,
    };
  } catch (error) {
    return fail(describeGraphFailure(error));
  }
}

/** Plans in a group, or every plan the person can see. Linked ones are marked. */
export async function listPlannerPlans(
  groupId: string | null,
): Promise<ActionState & { plans?: PlanOption[] }> {
  await requireUser();
  try {
    const [plans, links] = await Promise.all([
      listPlans(await token(), groupId),
      getDb()
        .select({ planId: plannerPlans.planId, projectId: plannerPlans.projectId })
        .from(plannerPlans),
    ]);
    const linked = new Map(links.map((l) => [l.planId, l.projectId]));
    return {
      ok: true,
      plans: plans
        .map((p) => ({
          id: p.id,
          title: p.title,
          groupId: planGroupId(p),
          linkedTo: linked.get(p.id) ?? null,
        }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    };
  } catch (error) {
    return fail(describeGraphFailure(error));
  }
}

/* ── linking ─────────────────────────────────────────────────────── */

async function alreadyLinked(planId: string, projectId: string): Promise<string | null> {
  const db = getDb();
  const [byPlan] = await db
    .select({ projectId: plannerPlans.projectId })
    .from(plannerPlans)
    .where(eq(plannerPlans.planId, planId));
  if (byPlan && byPlan.projectId !== projectId) {
    return "That plan is already linked to another project.";
  }
  const [byProject] = await db
    .select({ planId: plannerPlans.planId })
    .from(plannerPlans)
    .where(eq(plannerPlans.projectId, projectId));
  if (byProject) return "This project is already linked to a plan. Unlink it first.";
  return null;
}

/**
 * Links an existing plan to an existing project, then runs the first sync.
 * On that first sync, phases and buckets with the same name are paired up,
 * as are steps and tasks with the same title; everything else is copied
 * across in both directions.
 */
export async function linkPlannerPlan(projectId: string, planId: string): Promise<PlannerSyncState> {
  const { user } = await requireUser();
  const problem = await alreadyLinked(planId, projectId);
  if (problem) return fail(problem);

  try {
    const plan = await getPlan(await token(), planId);
    await getDb().insert(plannerPlans).values({
      projectId,
      planId,
      groupId: planGroupId(plan),
      title: plan.title,
      linkedById: user.id,
    });
  } catch (error) {
    return fail(describeGraphFailure(error));
  }

  await logActivity({
    entityType: "project",
    entityId: projectId,
    projectId,
    verb: "linked",
    summary: "Linked the project to a Microsoft Planner plan",
  });
  return syncPlanner(projectId, { force: true });
}

/** Creates a plan for the project in the chosen group, and syncs into it. */
export async function createPlannerPlan(
  projectId: string,
  groupId: string,
): Promise<PlannerSyncState> {
  const { user } = await requireUser();
  if (!groupId) return fail("Choose the Microsoft 365 group the plan belongs to.");

  const db = getDb();
  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return fail("That project no longer exists.");

  const [existing] = await db
    .select({ planId: plannerPlans.planId })
    .from(plannerPlans)
    .where(eq(plannerPlans.projectId, projectId));
  if (existing) return fail("This project is already linked to a plan.");

  try {
    const plan = await createPlan(await token(), groupId, project.name);
    await db.insert(plannerPlans).values({
      projectId,
      planId: plan.id,
      groupId,
      title: plan.title,
      etag: etagOf(plan),
      base: { title: plan.title },
      linkedById: user.id,
    });
  } catch (error) {
    return fail(describeGraphFailure(error));
  }

  await logActivity({
    entityType: "project",
    entityId: projectId,
    projectId,
    verb: "linked",
    summary: "Created a Microsoft Planner plan for the project",
  });
  return syncPlanner(projectId, { force: true });
}

/**
 * Stops syncing. Nothing is deleted on either side — the plan stays in
 * Planner and the runbook stays here; they simply stop following each other.
 */
export async function unlinkPlannerPlan(projectId: string): Promise<ActionState> {
  await requireUser();
  const db = getDb();
  await db.delete(plannerItems).where(eq(plannerItems.projectId, projectId));
  await db.delete(plannerPlans).where(eq(plannerPlans.projectId, projectId));

  await logActivity({
    entityType: "project",
    entityId: projectId,
    projectId,
    verb: "unlinked",
    summary: "Unlinked the project from Microsoft Planner",
  });
  revalidatePath(`/projects/${projectId}`);
  return { ok: true, message: "Unlinked. The plan is untouched in Planner." };
}

/* ── a new project from a plan ───────────────────────────────────── */

const fromPlanSchema = z.object({
  planId: z.string().trim().min(1, "Choose the plan to start from."),
  customerId: z.uuid("Pick the customer this is for."),
});

/** Creates a project from a plan: its buckets become phases, tasks steps. */
export async function createProjectFromPlan(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireUser();
  const parsed = fromPlanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);
  const { planId, customerId } = parsed.data;

  const db = getDb();
  const [taken] = await db
    .select({ projectId: plannerPlans.projectId })
    .from(plannerPlans)
    .where(eq(plannerPlans.planId, planId));
  if (taken) return fail("That plan is already linked to a project.");

  let projectId: string;
  try {
    const plan = await getPlan(await token(), planId);
    const [project] = await db
      .insert(projects)
      .values({
        customerId,
        name: plan.title,
        ownerId: user.id,
        templateKey: "planner",
        createdById: user.id,
      })
      .returning({ id: projects.id });
    projectId = project.id;

    await db.insert(plannerPlans).values({
      projectId,
      planId,
      groupId: planGroupId(plan),
      title: plan.title,
      etag: etagOf(plan),
      base: { title: plan.title },
      linkedById: user.id,
    });
  } catch (error) {
    return fail(describeGraphFailure(error));
  }

  await logActivity({
    entityType: "project",
    entityId: projectId,
    projectId,
    customerId,
    verb: "created",
    summary: "Started the project from a Microsoft Planner plan",
  });

  // The first sync builds the runbook. Its outcome is shown on the project
  // page either way, so a Planner hiccup does not lose the new project.
  await syncPlanner(projectId, { force: true });
  await autoProvisionFolder({ projectId });

  revalidatePath("/projects");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/projects/${projectId}`);
}

/* ── settings ────────────────────────────────────────────────────── */

const groupSchema = z.object({
  plannerGroupId: z.string().trim().min(1, "Choose a group."),
  plannerGroupName: z.string().trim().min(1),
});

/** The group new plans are created in by default. Admin only. */
export async function savePlannerGroup(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireAdmin();
  const parsed = groupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  await getDb()
    .insert(settings)
    .values({ id: "singleton", ...parsed.data, updatedById: user.id })
    .onConflictDoUpdate({
      target: settings.id,
      set: { ...parsed.data, updatedById: user.id, updatedAt: new Date() },
    });

  revalidatePath("/settings");
  return { ok: true, message: `New plans will be created in ${parsed.data.plannerGroupName}.` };
}
