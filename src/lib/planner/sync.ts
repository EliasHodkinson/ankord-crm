import "server-only";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  plannerItems,
  plannerPlans,
  projectPhases,
  projectSteps,
  projects,
  users,
  type PlannerItem,
  type PlannerPlanLink,
  type ProjectPhase,
  type ProjectStep,
} from "@/lib/db/schema";
import { GraphError } from "@/lib/graph/client";
import { describeGraphFailure } from "@/lib/graph/errors";
import {
  byOrderHint,
  createBucket,
  createTask,
  decodeReferenceKey,
  deleteBucket,
  deleteTask,
  encodeReferenceKey,
  etagOf,
  getPlan,
  getTaskDetails,
  getTaskDetailsMany,
  hintAfter,
  listBuckets,
  listTasks,
  planGroupId,
  updateBucket,
  updatePlan,
  updateTask,
  updateTaskDetails,
  type DetailsWrite,
  type PlannerBucket,
  type PlannerTask,
  type PlannerTaskDetails,
  type TaskWrite,
} from "@/lib/graph/planner";
import { appUrl } from "@/lib/env";
import { touchRecords } from "@/lib/actions/shared";
import {
  BACKLINK_ALIAS,
  TASK_FIELDS,
  backlinkUrl,
  bucketName,
  changedFields,
  dueFromPlanner,
  dueToPlanner,
  merge3,
  normaliseProgress,
  parseBacklink,
  parseBucketName,
  progressOf,
  sameValue,
  orderChecklist,
  sortChecklist,
  sortLinks,
  statusFor,
  type BucketView,
  type ChecklistItem,
  type PlanView,
  type TaskView,
} from "./mapping";

/**
 * Two-way sync between one project and its Planner plan.
 *
 * Planner offers no change notifications and its delta query is beta-only, so
 * this is a full read of the plan compared against the last agreed state of
 * every bucket and task (the `base` on planner_items). That makes it
 * idempotent: run it twice and the second run finds nothing to do, because
 * both sides now equal the base.
 *
 * It runs with whichever signed-in person triggered it, using their delegated
 * token — there is no background service account. It is triggered when a
 * linked project is opened (and polled while it stays open), after any edit
 * to a linked runbook, and from "Sync now".
 */

export type SyncSummary = {
  skipped?: "locked" | "recent";
  pulled: number;
  pushed: number;
  createdHere: number;
  createdThere: number;
  deletedHere: number;
  deletedThere: number;
  conflicts: number;
  /** Items that failed on their own; the rest of the sync still went through. */
  itemErrors: string[];
};

const LOCK_STALE = sql`now() - interval '3 minutes'`;
/** Automatic syncs closer together than this are skipped, not queued. */
const MIN_GAP = sql`now() - interval '20 seconds'`;

const empty = (): SyncSummary => ({
  pulled: 0,
  pushed: 0,
  createdHere: 0,
  createdThere: 0,
  deletedHere: 0,
  deletedThere: 0,
  conflicts: 0,
  itemErrors: [],
});

export function summaryChangedHere(s: SyncSummary) {
  return s.pulled + s.createdHere + s.deletedHere > 0;
}

/**
 * Takes the project's sync lock, runs a sync, and records the outcome on the
 * link — including the failure, which is what the project page shows.
 * Never throws for a Graph problem; the error is the return value.
 */
export async function syncPlannerProject(
  projectId: string,
  token: string,
  opts: { force?: boolean } = {},
): Promise<{ summary: SyncSummary; error: string | null }> {
  const db = getDb();

  const [link] = await db
    .update(plannerPlans)
    .set({ lockedAt: new Date(), lastAttemptAt: new Date() })
    .where(
      and(
        eq(plannerPlans.projectId, projectId),
        or(isNull(plannerPlans.lockedAt), lt(plannerPlans.lockedAt, LOCK_STALE)),
        opts.force
          ? undefined
          : or(isNull(plannerPlans.lastAttemptAt), lt(plannerPlans.lastAttemptAt, MIN_GAP)),
      ),
    )
    .returning();

  if (!link) {
    const [exists] = await db
      .select({ lockedAt: plannerPlans.lockedAt })
      .from(plannerPlans)
      .where(eq(plannerPlans.projectId, projectId));
    if (!exists) return { summary: empty(), error: "This project is not linked to a plan." };
    return {
      summary: { ...empty(), skipped: exists.lockedAt ? "locked" : "recent" },
      error: null,
    };
  }

  const summary = empty();
  let error: string | null = null;
  try {
    await runSync(link, token, summary);
    if (summary.itemErrors.length > 0) {
      const n = summary.itemErrors.length;
      error = `${n} item${n === 1 ? "" : "s"} could not sync: ${summary.itemErrors[0]}`;
    }
  } catch (e) {
    error =
      e instanceof GraphError && e.isNotFound
        ? "The linked plan is no longer in Planner — it may have been deleted. Unlink it to carry on."
        : describeGraphFailure(e);
  }

  await db
    .update(plannerPlans)
    .set({
      lockedAt: null,
      lastError: error,
      ...(error && summary.itemErrors.length === 0 ? {} : { lastSyncedAt: new Date() }),
    })
    .where(eq(plannerPlans.projectId, projectId));

  return { summary, error };
}

/* ── the sync itself ─────────────────────────────────────────────── */

type Ctx = {
  token: string;
  link: PlannerPlanLink;
  projectId: string;
  firstSync: boolean;
  summary: SyncSummary;
  oidToUser: Map<string, string>;
  userToOid: Map<string, string>;
  phaseToBucket: Map<string, string>;
  bucketToPhase: Map<string, string>;
  statusChanged: boolean;
};

async function runSync(link: PlannerPlanLink, token: string, summary: SyncSummary) {
  const db = getDb();
  const projectId = link.projectId;

  // Remote first: if Planner cannot be read, nothing local is touched.
  const plan = await getPlan(token, link.planId);
  const [buckets, tasks] = await Promise.all([
    listBuckets(token, link.planId),
    listTasks(token, link.planId),
  ]);
  const details = await getTaskDetailsMany(
    token,
    tasks.map((t) => t.id),
  );

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return;

  const people = await db.select({ id: users.id, oid: users.azureOid }).from(users);

  const ctx: Ctx = {
    token,
    link,
    projectId,
    firstSync: link.lastSyncedAt == null,
    summary,
    oidToUser: new Map(people.map((p) => [p.oid, p.id])),
    userToOid: new Map(people.map((p) => [p.id, p.oid])),
    phaseToBucket: new Map(),
    bucketToPhase: new Map(),
    statusChanged: false,
  };

  /* plan ↔ project */
  const planBase = link.base as Partial<PlanView> | null;
  const { merged: planMerged, conflicts: planConflicts } = merge3<PlanView>(
    ["title"],
    { title: project.name },
    { title: plan.title },
    planBase,
  );
  summary.conflicts += planConflicts.length;
  if (planMerged.title !== project.name) {
    await db
      .update(projects)
      .set({ name: planMerged.title, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    summary.pulled += 1;
  }
  let planEtag = etagOf(plan);
  if (planMerged.title !== plan.title && planEtag) {
    const written = await updatePlan(token, plan.id, planEtag, { title: planMerged.title });
    planEtag = etagOf(written) ?? planEtag;
    summary.pushed += 1;
  }
  await db
    .update(plannerPlans)
    .set({
      title: planMerged.title,
      etag: planEtag,
      base: planMerged,
      groupId: planGroupId(plan) ?? link.groupId,
    })
    .where(eq(plannerPlans.projectId, projectId));

  const items = await db.select().from(plannerItems).where(eq(plannerItems.projectId, projectId));

  await syncBuckets(ctx, buckets, items.filter((i) => i.kind === "bucket"));

  // Re-read: bucket handling can delete phases (and their steps with them).
  const [phases, steps, taskItems] = await Promise.all([
    db.select().from(projectPhases).where(eq(projectPhases.projectId, projectId)),
    db.select().from(projectSteps).where(eq(projectSteps.projectId, projectId)),
    db
      .select()
      .from(plannerItems)
      .where(and(eq(plannerItems.projectId, projectId), eq(plannerItems.kind, "task"))),
  ]);

  await syncTasks(ctx, phases, steps, tasks, details, taskItems);

  // A step ticked off in Planner is work done on the project, as it is here.
  if (ctx.statusChanged) await touchRecords({ projectId });
}

/* ── buckets ↔ phases ────────────────────────────────────────────── */

async function syncBuckets(ctx: Ctx, buckets: PlannerBucket[], items: PlannerItem[]) {
  const db = getDb();
  const { token, projectId, summary } = ctx;

  const phases = await db
    .select()
    .from(projectPhases)
    .where(eq(projectPhases.projectId, projectId));
  const phaseById = new Map(phases.map((p) => [p.id, p]));
  const bucketById = new Map(buckets.map((b) => [b.id, b]));
  const linkedPhases = new Set<string>();
  const linkedBuckets = new Set<string>();

  for (const item of items) {
    const phase = phaseById.get(item.localId);
    const bucket = bucketById.get(item.plannerId);

    if (phase && bucket) {
      linkedPhases.add(phase.id);
      linkedBuckets.add(bucket.id);
      await guard(ctx, `Phase "${phase.label}"`, async () => {
        const local: BucketView = { name: bucketName(phase.num, phase.label) };
        const remote: BucketView = { name: bucket.name };
        const { merged, conflicts } = merge3<BucketView>(
          ["name"],
          local,
          remote,
          item.base as Partial<BucketView> | null,
        );
        summary.conflicts += conflicts.length;

        if (merged.name !== local.name) {
          const parsed = parseBucketName(merged.name);
          await db
            .update(projectPhases)
            .set({ num: parsed.num ?? "", label: parsed.label })
            .where(eq(projectPhases.id, phase.id));
          summary.pulled += 1;
        }
        let etag = etagOf(bucket) ?? item.etag;
        if (merged.name !== remote.name && etag) {
          const written = await updateBucket(token, bucket.id, etag, { name: merged.name });
          etag = etagOf(written) ?? etag;
          summary.pushed += 1;
        }
        await saveItem(item.id, { etag, base: merged });
      });
      continue;
    }

    if (!phase && bucket) {
      // Removed here → remove there. Planner deletes the bucket's tasks with
      // it, and their steps went with the phase, so the two stay matched.
      await guard(ctx, `Bucket "${bucket.name}"`, async () => {
        const etag = etagOf(bucket) ?? item.etag;
        if (etag) await deleteBucket(token, bucket.id, etag);
        await dropItem(item.id);
        summary.deletedThere += 1;
      });
      linkedBuckets.add(bucket.id);
      continue;
    }

    if (phase && !bucket) {
      /**
       * Removed in Planner. If nothing in the phase has been touched here
       * since the last sync, follow Planner and remove it. If anything has,
       * an edit beats a delete: the bucket is recreated below instead.
       */
      const untouched = await phaseUntouchedSince(ctx, phase, item.plannerId);
      await dropItem(item.id);
      if (untouched) {
        await db.delete(projectPhases).where(eq(projectPhases.id, phase.id));
        phaseById.delete(phase.id);
        summary.deletedHere += 1;
      }
      continue;
    }

    await dropItem(item.id);
  }

  /* Buckets new in Planner */
  const ordered = [...buckets].sort(byOrderHint);
  for (const bucket of ordered) {
    if (linkedBuckets.has(bucket.id)) continue;
    await guard(ctx, `Bucket "${bucket.name}"`, async () => {
      const parsed = parseBucketName(bucket.name);
      const match = ctx.firstSync
        ? [...phaseById.values()].find(
            (p) =>
              !linkedPhases.has(p.id) &&
              (p.label.trim().toLowerCase() === parsed.label.toLowerCase() ||
                bucketName(p.num, p.label).toLowerCase() === bucket.name.trim().toLowerCase()),
          )
        : undefined;

      if (match) {
        // First link of an existing plan to an existing project: same phase.
        linkedPhases.add(match.id);
        if (bucketName(match.num, match.label) !== bucket.name) {
          await db
            .update(projectPhases)
            .set({ num: parsed.num ?? "", label: parsed.label })
            .where(eq(projectPhases.id, match.id));
          summary.pulled += 1;
        }
        await insertItem("bucket", match.id, bucket.id, etagOf(bucket), { name: bucket.name });
        return;
      }

      const position = phaseById.size;
      const [created] = await db
        .insert(projectPhases)
        .values({
          projectId,
          // An unnumbered bucket stays unnumbered: inventing a number here
          // would rename the bucket in Planner on the next sync.
          num: parsed.num ?? "",
          label: parsed.label,
          position,
        })
        .returning();
      phaseById.set(created.id, created);
      linkedPhases.add(created.id);
      await insertItem("bucket", created.id, bucket.id, etagOf(bucket), { name: bucket.name });
      summary.createdHere += 1;
    });
  }

  /* Phases new here */
  let lastHint = ordered.at(-1)?.orderHint ?? null;
  const localOrder = [...phaseById.values()].sort((a, b) => a.position - b.position);
  for (const phase of localOrder) {
    if (linkedPhases.has(phase.id)) continue;
    await guard(ctx, `Phase "${phase.label}"`, async () => {
      const name = bucketName(phase.num, phase.label);
      const created = await createBucket(token, {
        planId: ctx.link.planId,
        name,
        orderHint: hintAfter(lastHint),
      });
      lastHint = created.orderHint ?? lastHint;
      buckets.push(created); // so the ordering pass below can place it
      await insertItem("bucket", phase.id, created.id, etagOf(created), { name });
      summary.createdThere += 1;
    });
  }

  /* Bucket order is Planner's: phases follow it. */
  const links = await db
    .select({ localId: plannerItems.localId, plannerId: plannerItems.plannerId })
    .from(plannerItems)
    .where(and(eq(plannerItems.projectId, projectId), eq(plannerItems.kind, "bucket")));
  for (const l of links) {
    ctx.phaseToBucket.set(l.localId, l.plannerId);
    ctx.bucketToPhase.set(l.plannerId, l.localId);
  }

  const hints = new Map(buckets.map((b) => [b.id, b.orderHint]));
  const sortable = [...phaseById.values()].filter((p) => {
    const b = ctx.phaseToBucket.get(p.id);
    return b && hints.has(b);
  });
  if (sortable.length === phaseById.size) {
    sortable.sort((a, b) =>
      byOrderHint(
        { orderHint: hints.get(ctx.phaseToBucket.get(a.id)!)! },
        { orderHint: hints.get(ctx.phaseToBucket.get(b.id)!)! },
      ),
    );
    for (const [index, phase] of sortable.entries()) {
      if (phase.position !== index) {
        await db.update(projectPhases).set({ position: index }).where(eq(projectPhases.id, phase.id));
      }
    }
  }
}

/** True when no step in the phase changed since the last sync. */
async function phaseUntouchedSince(
  ctx: Ctx,
  phase: ProjectPhase,
  bucketId: string,
): Promise<boolean> {
  const db = getDb();
  const steps = await db.select().from(projectSteps).where(eq(projectSteps.phaseId, phase.id));
  if (steps.length === 0) return true;

  const links = await db
    .select()
    .from(plannerItems)
    .where(
      and(
        eq(plannerItems.kind, "task"),
        inArray(
          plannerItems.localId,
          steps.map((s) => s.id),
        ),
      ),
    );
  const byStep = new Map(links.map((l) => [l.localId, l]));

  // Score the steps against the bucket they were in, which is what the base holds.
  const phaseToBucket = new Map(ctx.phaseToBucket);
  phaseToBucket.set(phase.id, bucketId);
  return steps.every((step) => {
    const link = byStep.get(step.id);
    return link?.base != null && sameValue(localView({ ...ctx, phaseToBucket }, step), link.base);
  });
}

/* ── tasks ↔ steps ───────────────────────────────────────────────── */

function localView(ctx: Pick<Ctx, "phaseToBucket" | "userToOid">, step: ProjectStep): TaskView {
  return {
    title: step.title,
    bucket: ctx.phaseToBucket.get(step.phaseId) ?? null,
    assignee: step.assigneeId ? (ctx.userToOid.get(step.assigneeId) ?? null) : null,
    due: step.dueDate,
    progress: progressOf(step.status),
    description: step.description ?? "",
    checklist: sortChecklist(step.checklist.map((c) => ({ id: c.id, title: c.title, done: c.done }))),
    links: sortLinks(step.links.map((l) => ({ url: l.url, label: l.label }))),
  };
}

function remoteView(ctx: Ctx, task: PlannerTask, info: PlannerTaskDetails | undefined): TaskView {
  // The first assignee who also uses The Gangway; Planner allows several.
  const assignee =
    Object.entries(task.assignments ?? {})
      .filter(([, a]) => a != null)
      .sort(([, a], [, b]) => (a.assignedDateTime ?? "").localeCompare(b.assignedDateTime ?? ""))
      .map(([oid]) => oid)
      .find((oid) => ctx.oidToUser.has(oid)) ?? null;

  const checklist: ChecklistItem[] = sortChecklist(
    Object.entries(info?.checklist ?? {})
      .filter(([, c]) => c != null)
      .map(([id, c]) => ({ id, title: c.title, done: Boolean(c.isChecked) })),
  );

  const links = sortLinks(
    Object.entries(info?.references ?? {})
      .filter(([, r]) => r != null)
      .map(([key, r]) => ({ url: decodeReferenceKey(key), label: r.alias || decodeReferenceKey(key) }))
      .filter((l) => !parseBacklink(l.url)),
  );

  return {
    title: task.title,
    bucket: task.bucketId || null,
    assignee,
    due: dueFromPlanner(task.dueDateTime),
    progress: normaliseProgress(task.percentComplete),
    description: info?.description ?? "",
    checklist,
    links,
  };
}

/** Checklist ids in the order Planner shows them. */
function plannerChecklistOrder(info: PlannerTaskDetails | undefined): string[] {
  return Object.entries(info?.checklist ?? {})
    .filter(([, c]) => c != null)
    .sort(([, a], [, b]) => byOrderHint(a, b))
    .map(([id]) => id);
}

function backlinkFor(details: PlannerTaskDetails | undefined) {
  for (const key of Object.keys(details?.references ?? {})) {
    const hit = parseBacklink(decodeReferenceKey(key));
    if (hit) return { ...hit, key };
  }
  return null;
}

async function syncTasks(
  ctx: Ctx,
  phases: ProjectPhase[],
  steps: ProjectStep[],
  tasks: PlannerTask[],
  details: Map<string, PlannerTaskDetails>,
  items: PlannerItem[],
) {
  const db = getDb();
  const { token, projectId, summary } = ctx;

  const stepById = new Map(steps.map((s) => [s.id, s]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const linkedSteps = new Set<string>();
  const linkedTasks = new Set<string>();

  const reconcileQueue: (() => Promise<void>)[] = [];

  for (const item of items) {
    const step = stepById.get(item.localId);
    const task = taskById.get(item.plannerId);

    if (step && task) {
      linkedSteps.add(step.id);
      linkedTasks.add(task.id);
      reconcileQueue.push(() =>
        guard(ctx, `Step "${step.title}"`, () =>
          reconcile(ctx, step, task, details.get(task.id), item.base as Partial<TaskView> | null, item),
        ),
      );
      continue;
    }

    if (!step && task) {
      linkedTasks.add(task.id);
      await guard(ctx, `Task "${task.title}"`, async () => {
        const etag = etagOf(task) ?? item.etag;
        if (etag) await deleteTask(token, task.id, etag);
        await dropItem(item.id);
        summary.deletedThere += 1;
      });
      continue;
    }

    if (step && !task) {
      // Deleted in Planner: follow it unless the step was edited here since.
      await dropItem(item.id);
      if (item.base != null && sameValue(localView(ctx, step), item.base)) {
        await db.delete(projectSteps).where(eq(projectSteps.id, step.id));
        stepById.delete(step.id);
        summary.deletedHere += 1;
      }
      continue;
    }

    await dropItem(item.id);
  }

  await pool(reconcileQueue, 4);

  /* Tasks new in Planner */
  const phaseList = [...phases].sort((a, b) => a.position - b.position);
  const nextPosition = new Map<string, number>();
  for (const s of stepById.values()) {
    nextPosition.set(s.phaseId, Math.max(nextPosition.get(s.phaseId) ?? 0, s.position + 1));
  }

  const adopt: (() => Promise<void>)[] = [];
  for (const task of [...tasks].sort(byOrderHint)) {
    if (linkedTasks.has(task.id)) continue;
    const info = details.get(task.id);
    const back = backlinkFor(info);
    const remote = remoteView(ctx, task, info);

    let match: ProjectStep | undefined;
    if (back && back.projectId === projectId) {
      const s = stepById.get(back.stepId);
      if (s && !linkedSteps.has(s.id)) match = s;
    }
    if (!match && ctx.firstSync) {
      const phaseId = task.bucketId ? ctx.bucketToPhase.get(task.bucketId) : undefined;
      match = [...stepById.values()].find(
        (s) =>
          !linkedSteps.has(s.id) &&
          s.title.trim().toLowerCase() === task.title.trim().toLowerCase() &&
          (!phaseId || s.phaseId === phaseId),
      );
    }

    if (match) {
      const step = match;
      linkedSteps.add(step.id);
      linkedTasks.add(task.id);
      adopt.push(() =>
        guard(ctx, `Step "${step.title}"`, async () => {
          const item = await insertItem("task", step.id, task.id, etagOf(task), null, etagOf(info ?? {}));
          await reconcile(ctx, step, task, info, null, item);
        }),
      );
      continue;
    }

    linkedTasks.add(task.id);
    const phaseId =
      (task.bucketId ? ctx.bucketToPhase.get(task.bucketId) : undefined) ?? phaseList[0]?.id;
    if (!phaseId) continue; // a plan with tasks but no buckets cannot happen in practice
    const position = nextPosition.get(phaseId) ?? 0;
    nextPosition.set(phaseId, position + 1);

    adopt.push(() =>
      guard(ctx, `Task "${task.title}"`, async () => {
        const status = statusFor(remote.progress, "todo");
        const [created] = await db
          .insert(projectSteps)
          .values({
            projectId,
            phaseId,
            title: remote.title,
            assigneeId: remote.assignee ? (ctx.oidToUser.get(remote.assignee) ?? null) : null,
            dueDate: remote.due,
            status: status as ProjectStep["status"],
            completedAt: status === "done" ? new Date() : null,
            description: remote.description || null,
            checklist: orderChecklist(remote.checklist, plannerChecklistOrder(info)),
            links: remote.links,
            position,
          })
          .returning();
        summary.createdHere += 1;

        // Give the task its link back to the step, then remember both.
        let detailsEtag = etagOf(info ?? {});
        if (info && detailsEtag) {
          const url = backlinkUrl(appUrl(), projectId, created.id);
          const written = await updateTaskDetails(token, task.id, detailsEtag, {
            references: {
              [encodeReferenceKey(url)]: {
                "@odata.type": "microsoft.graph.plannerExternalReference",
                alias: BACKLINK_ALIAS,
                type: "Other",
              },
            },
          });
          detailsEtag = etagOf(written) ?? detailsEtag;
        }
        await insertItem("task", created.id, task.id, etagOf(task), remote, detailsEtag);
      }),
    );
  }
  await pool(adopt, 4);

  /* Steps new here */
  let lastHint = [...tasks].sort(byOrderHint).at(-1)?.orderHint ?? null;
  const create: (() => Promise<void>)[] = [];
  for (const step of [...stepById.values()].sort((a, b) => a.position - b.position)) {
    if (linkedSteps.has(step.id)) continue;
    const view = localView(ctx, step);
    if (!view.bucket) continue; // its phase failed to sync; it is retried next time
    const orderHint = hintAfter(lastHint);
    create.push(() =>
      guard(ctx, `Step "${step.title}"`, async () => {
        const task = await createTask(token, {
          planId: ctx.link.planId,
          bucketId: view.bucket!,
          title: view.title,
          percentComplete: view.progress,
          dueDateTime: dueToPlanner(view.due),
          orderHint,
          ...(view.assignee
            ? {
                assignments: {
                  [view.assignee]: {
                    "@odata.type": "#microsoft.graph.plannerAssignment",
                    orderHint: " !",
                  },
                },
              }
            : {}),
        });
        lastHint = task.orderHint ?? lastHint;

        // Recorded straight away with what Planner now holds, so a failure
        // writing the details below is pushed again next time rather than
        // read back as "Planner cleared the description".
        const asCreated: TaskView = {
          ...view,
          description: "",
          checklist: [],
          links: [],
        };
        const item = await insertItem("task", step.id, task.id, etagOf(task), asCreated);
        summary.createdThere += 1;

        const info = await getTaskDetails(token, task.id);
        const write = detailsWrite(asCreated, view, info, backlinkUrl(appUrl(), projectId, step.id));
        const etag = etagOf(info);
        if (write && etag) {
          const written = await updateTaskDetails(token, task.id, etag, write);
          await saveItem(item.id, { detailsEtag: etagOf(written) ?? etag, base: view });
        }
      }),
    );
  }
  await pool(create, 4);
}

/** Brings one linked step and task into agreement. */
async function reconcile(
  ctx: Ctx,
  step: ProjectStep,
  task: PlannerTask,
  info: PlannerTaskDetails | undefined,
  base: Partial<TaskView> | null,
  item: PlannerItem,
) {
  const db = getDb();
  const { token, summary } = ctx;
  const local = localView(ctx, step);
  const remote = remoteView(ctx, task, info);
  const { merged, conflicts } = merge3<TaskView>(TASK_FIELDS, local, remote, base);
  summary.conflicts += conflicts.length;

  /* Here */
  const changedHere = changedFields<TaskView>(TASK_FIELDS, local, merged);
  if (changedHere.length > 0) {
    const set: Partial<typeof projectSteps.$inferInsert> = { updatedAt: new Date() };
    for (const field of changedHere) {
      if (field === "title") set.title = merged.title;
      if (field === "bucket" && merged.bucket) {
        const phaseId = ctx.bucketToPhase.get(merged.bucket);
        if (phaseId) set.phaseId = phaseId;
      }
      if (field === "assignee") {
        set.assigneeId = merged.assignee ? (ctx.oidToUser.get(merged.assignee) ?? null) : null;
      }
      if (field === "due") set.dueDate = merged.due;
      if (field === "progress") {
        const status = statusFor(merged.progress, step.status) as ProjectStep["status"];
        set.status = status;
        set.completedAt = status === "done" ? new Date() : null;
        set.completedById = null;
        set.blockedSince = status === "blocked" ? step.blockedSince : null;
        ctx.statusChanged = true;
      }
      if (field === "description") set.description = merged.description || null;
      if (field === "checklist") {
        // Keep this side's order; items new from Planner follow in Planner's.
        set.checklist = orderChecklist(merged.checklist, [
          ...step.checklist.map((c) => c.id),
          ...plannerChecklistOrder(info),
        ]);
      }
      if (field === "links") set.links = merged.links;
    }
    await db.update(projectSteps).set(set).where(eq(projectSteps.id, step.id));
    summary.pulled += 1;
  }

  /* There — the task itself, then its details, each with its own etag. */
  const nextBase: TaskView = { ...merged };
  const taskFields = ["title", "bucket", "assignee", "due", "progress"] as const;
  const taskChanged = changedFields<TaskView>(taskFields, remote, merged);
  let etag = etagOf(task) ?? item.etag;
  let detailsEtag = etagOf(info ?? {}) ?? item.detailsEtag;

  if (taskChanged.length > 0 && etag) {
    const patch: TaskWrite = {};
    if (taskChanged.includes("title")) patch.title = merged.title;
    if (taskChanged.includes("bucket") && merged.bucket) patch.bucketId = merged.bucket;
    if (taskChanged.includes("due")) patch.dueDateTime = dueToPlanner(merged.due);
    if (taskChanged.includes("progress")) patch.percentComplete = merged.progress;
    if (taskChanged.includes("assignee")) {
      patch.assignments = {};
      if (remote.assignee) patch.assignments[remote.assignee] = null;
      if (merged.assignee) {
        patch.assignments[merged.assignee] = {
          "@odata.type": "#microsoft.graph.plannerAssignment",
          orderHint: " !",
        };
      }
    }
    const ok = await softWrite(async () => {
      const written = await updateTask(token, task.id, etag!, patch);
      etag = etagOf(written) ?? etag;
    });
    if (ok) summary.pushed += 1;
    else for (const f of taskChanged) Object.assign(nextBase, { [f]: remote[f] });
  }

  const backlink = backlinkUrl(appUrl(), ctx.projectId, step.id);
  const write = detailsWrite(remote, merged, info, backlink);
  if (write && detailsEtag) {
    const ok = await softWrite(async () => {
      const written = await updateTaskDetails(token, task.id, detailsEtag!, write);
      detailsEtag = etagOf(written) ?? detailsEtag;
    });
    if (ok) {
      if (changedFields<TaskView>(["description", "checklist", "links"], remote, merged).length) {
        summary.pushed += 1;
      }
    } else {
      nextBase.description = remote.description;
      nextBase.checklist = remote.checklist;
      nextBase.links = remote.links;
    }
  }

  await saveItem(item.id, { etag, detailsEtag, base: nextBase });
}

/**
 * The details PATCH that turns `from` into `to`: description, checklist items
 * added/changed/removed, and references — always including the back-link to
 * the step. Returns null when there is nothing to write.
 */
function detailsWrite(
  from: TaskView,
  to: TaskView,
  info: PlannerTaskDetails | undefined,
  backlink: string,
): DetailsWrite | null {
  const write: DetailsWrite = {};

  if (from.description !== to.description) write.description = to.description;

  if (!sameValue(from.checklist, to.checklist)) {
    const checklist: NonNullable<DetailsWrite["checklist"]> = {};
    const before = new Map(from.checklist.map((c) => [c.id, c]));
    const after = new Set(to.checklist.map((c) => c.id));
    const existingHints = Object.values(info?.checklist ?? {})
      .filter(Boolean)
      .map((c) => c.orderHint)
      .sort();
    const lastHint = existingHints.at(-1) ?? null;

    for (const id of before.keys()) if (!after.has(id)) checklist[id] = null;
    for (const item of to.checklist) {
      const prev = before.get(item.id);
      if (!prev) {
        checklist[item.id] = {
          "@odata.type": "microsoft.graph.plannerChecklistItem",
          title: item.title,
          isChecked: item.done,
          orderHint: hintAfter(lastHint),
        };
      } else if (prev.title !== item.title || prev.done !== item.done) {
        checklist[item.id] = {
          "@odata.type": "microsoft.graph.plannerChecklistItem",
          title: item.title,
          isChecked: item.done,
        };
      }
    }
    if (Object.keys(checklist).length > 0) write.checklist = checklist;
  }

  const references: NonNullable<DetailsWrite["references"]> = {};
  if (!sameValue(from.links, to.links)) {
    const before = new Map(from.links.map((l) => [l.url, l]));
    const after = new Set(to.links.map((l) => l.url));
    for (const url of before.keys()) if (!after.has(url)) references[encodeReferenceKey(url)] = null;
    for (const link of to.links) {
      const prev = before.get(link.url);
      if (!prev || prev.label !== link.label) {
        references[encodeReferenceKey(link.url)] = {
          "@odata.type": "microsoft.graph.plannerExternalReference",
          alias: link.label,
          type: "Other",
        };
      }
    }
  }
  // One back-link, to this step. A task relinked to another project (or seen
  // from another deployment) drops the stale ones.
  let hasBacklink = false;
  for (const key of Object.keys(info?.references ?? {})) {
    const url = decodeReferenceKey(key);
    if (url === backlink) hasBacklink = true;
    else if (parseBacklink(url) && appUrlOf(url) === appUrlOf(backlink)) references[key] = null;
  }
  if (!hasBacklink) {
    references[encodeReferenceKey(backlink)] = {
      "@odata.type": "microsoft.graph.plannerExternalReference",
      alias: BACKLINK_ALIAS,
      type: "Other",
    };
  }
  if (Object.keys(references).length > 0) write.references = references;

  return Object.keys(write).length > 0 ? write : null;
}

/* ── small helpers ───────────────────────────────────────────────── */

/**
 * The origin a back-link points at. Only links from this deployment are
 * tidied — a production sync must not strip the link a local test added, or
 * the two would delete each other's on every pass.
 */
function appUrlOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/**
 * Runs a write, treating "someone changed it first" (412/409) and "it is gone"
 * (404) as a skip rather than a failure — the next sync re-reads and merges.
 */
async function softWrite(fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (error) {
    if (error instanceof GraphError && [404, 409, 412].includes(error.status)) return false;
    throw error;
  }
}

/** Isolates one item's failure so the rest of the plan still syncs. */
async function guard(ctx: Ctx, label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (error instanceof GraphError && [409, 412].includes(error.status)) return;
    ctx.summary.itemErrors.push(`${label}: ${describeGraphFailure(error)}`);
  }
}

async function pool(jobs: (() => Promise<void>)[], size: number) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, jobs.length) }, async () => {
      while (next < jobs.length) await jobs[next++]();
    }),
  );
}

async function insertItem(
  kind: "bucket" | "task",
  localId: string,
  plannerId: string,
  etag: string | null,
  base: Record<string, unknown> | null,
  detailsEtag: string | null = null,
): Promise<PlannerItem> {
  const db = getDb();
  const [projectRow] = await db
    .select({ projectId: kind === "bucket" ? projectPhases.projectId : projectSteps.projectId })
    .from(kind === "bucket" ? projectPhases : projectSteps)
    .where(eq(kind === "bucket" ? projectPhases.id : projectSteps.id, localId));

  const [row] = await db
    .insert(plannerItems)
    .values({
      projectId: projectRow.projectId,
      kind,
      localId,
      plannerId,
      etag,
      detailsEtag,
      base,
    })
    .onConflictDoUpdate({
      target: [plannerItems.kind, plannerItems.plannerId],
      set: { localId, etag, detailsEtag, base, updatedAt: new Date() },
    })
    .returning();
  return row;
}

async function saveItem(
  id: string,
  values: { etag?: string | null; detailsEtag?: string | null; base?: Record<string, unknown> },
) {
  await getDb()
    .update(plannerItems)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(plannerItems.id, id));
}

async function dropItem(id: string) {
  await getDb().delete(plannerItems).where(eq(plannerItems.id, id));
}
