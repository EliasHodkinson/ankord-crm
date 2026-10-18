import "server-only";
import { GraphError, graphFetch, graphList } from "./client";

/**
 * Microsoft Planner, for keeping a project's runbook and a Planner plan in
 * step. Always the signed-in person's delegated token: `Tasks.ReadWrite`
 * covers reading and writing plans in any group they belong to, and listing
 * their own groups needs nothing beyond `User.Read`.
 *
 * Planner versions everything with etags, and every PATCH and DELETE must
 * send the last one seen as If-Match. A 412 means someone changed the item
 * since — the sync re-reads and merges on its next pass rather than forcing.
 */

const seg = (id: string) => encodeURIComponent(id);

type Etagged = { "@odata.etag"?: string };

export type PlannerGroup = { id: string; displayName: string };

export type PlannerPlan = Etagged & {
  id: string;
  title: string;
  container?: { containerId?: string; type?: string };
  /** Older plans carry the group here rather than in container. */
  owner?: string;
};

export type PlannerBucket = Etagged & {
  id: string;
  name: string;
  planId: string;
  orderHint: string;
};

export type PlannerAssignment = {
  "@odata.type"?: string;
  assignedDateTime?: string;
  orderHint?: string;
};

export type PlannerTask = Etagged & {
  id: string;
  planId: string;
  bucketId: string | null;
  title: string;
  orderHint: string;
  percentComplete: number;
  dueDateTime: string | null;
  assignments: Record<string, PlannerAssignment>;
};

export type PlannerChecklistItem = {
  "@odata.type"?: string;
  title: string;
  isChecked: boolean;
  orderHint: string;
};

export type PlannerReference = {
  "@odata.type"?: string;
  alias?: string | null;
  type?: string | null;
  previewPriority?: string;
};

export type PlannerTaskDetails = Etagged & {
  id: string;
  description: string | null;
  checklist: Record<string, PlannerChecklistItem> | null;
  references: Record<string, PlannerReference> | null;
};

export const etagOf = (item: Etagged) => item["@odata.etag"] ?? null;

/** Returns the written item, so the new etag is known without another read. */
const WRITE_HEADERS = { prefer: "return=representation" };

/* ── groups and plans ────────────────────────────────────────────── */

/**
 * The Microsoft 365 groups the signed-in person is a member of — the only
 * kind that can hold a plan.
 *
 * Group names and types need GroupMember.Read.All. Without that consent Graph
 * still lists the memberships but blanks every property except the id; those
 * are kept (the type cannot be checked) under a placeholder name, so a missing
 * consent degrades the picker rather than emptying it.
 */
export async function listMyGroups(token: string): Promise<PlannerGroup[]> {
  const rows = await graphList<{
    "@odata.type"?: string;
    id: string;
    displayName?: string | null;
    groupTypes?: string[];
  }>(token, "/me/memberOf?$select=id,displayName,groupTypes", 500);

  return rows
    .filter((r) => r["@odata.type"] === "#microsoft.graph.group")
    .filter((r) => r.displayName == null || r.groupTypes?.includes("Unified"))
    .map((r) => ({ id: r.id, displayName: r.displayName ?? `Group ${r.id.slice(0, 8)}` }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Plans in a group, together with every plan shared with the person — the
 * latter catches plans in groups they reach some other way, and the newer
 * plans that live outside any group.
 */
export async function listPlans(token: string, groupId?: string | null): Promise<PlannerPlan[]> {
  const [inGroup, shared] = await Promise.all([
    groupId
      ? graphList<PlannerPlan>(token, `/groups/${seg(groupId)}/planner/plans`, 500)
      : Promise.resolve([]),
    graphList<PlannerPlan>(token, "/me/planner/plans", 500),
  ]);
  const byId = new Map([...shared, ...inGroup].map((p) => [p.id, p]));
  return [...byId.values()];
}

export function getPlan(token: string, planId: string): Promise<PlannerPlan> {
  return graphFetch<PlannerPlan>(token, `/planner/plans/${seg(planId)}`);
}

export function createPlan(token: string, groupId: string, title: string): Promise<PlannerPlan> {
  return graphFetch<PlannerPlan>(token, "/planner/plans", {
    method: "POST",
    body: JSON.stringify({
      container: { url: `https://graph.microsoft.com/v1.0/groups/${groupId}` },
      title,
    }),
  });
}

export function updatePlan(
  token: string,
  planId: string,
  etag: string,
  patch: { title: string },
): Promise<PlannerPlan> {
  return graphFetch<PlannerPlan>(token, `/planner/plans/${seg(planId)}`, {
    method: "PATCH",
    headers: { "if-match": etag, ...WRITE_HEADERS },
    body: JSON.stringify(patch),
  });
}

export function planGroupId(plan: PlannerPlan): string | null {
  return plan.container?.containerId ?? plan.owner ?? null;
}

/* ── buckets ─────────────────────────────────────────────────────── */

export function listBuckets(token: string, planId: string): Promise<PlannerBucket[]> {
  return graphList<PlannerBucket>(token, `/planner/plans/${seg(planId)}/buckets`, 5000);
}

export function createBucket(
  token: string,
  input: { planId: string; name: string; orderHint: string },
): Promise<PlannerBucket> {
  return graphFetch<PlannerBucket>(token, "/planner/buckets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateBucket(
  token: string,
  bucketId: string,
  etag: string,
  patch: { name?: string },
): Promise<PlannerBucket> {
  return graphFetch<PlannerBucket>(token, `/planner/buckets/${seg(bucketId)}`, {
    method: "PATCH",
    headers: { "if-match": etag, ...WRITE_HEADERS },
    body: JSON.stringify(patch),
  });
}

export function deleteBucket(token: string, bucketId: string, etag: string): Promise<void> {
  return graphFetch<void>(token, `/planner/buckets/${seg(bucketId)}`, {
    method: "DELETE",
    headers: { "if-match": etag },
  });
}

/* ── tasks ───────────────────────────────────────────────────────── */

export function listTasks(token: string, planId: string): Promise<PlannerTask[]> {
  // Graph pages at 400 here; the limit is far above any real runbook.
  return graphList<PlannerTask>(token, `/planner/plans/${seg(planId)}/tasks`, 10000);
}

export type TaskWrite = Partial<
  Pick<PlannerTask, "title" | "bucketId" | "percentComplete" | "dueDateTime" | "orderHint">
> & { assignments?: Record<string, PlannerAssignment | null> };

export function createTask(
  token: string,
  input: TaskWrite & { planId: string; bucketId: string; title: string },
): Promise<PlannerTask> {
  return graphFetch<PlannerTask>(token, "/planner/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTask(
  token: string,
  taskId: string,
  etag: string,
  patch: TaskWrite,
): Promise<PlannerTask> {
  return graphFetch<PlannerTask>(token, `/planner/tasks/${seg(taskId)}`, {
    method: "PATCH",
    headers: { "if-match": etag, ...WRITE_HEADERS },
    body: JSON.stringify(patch),
  });
}

export function deleteTask(token: string, taskId: string, etag: string): Promise<void> {
  return graphFetch<void>(token, `/planner/tasks/${seg(taskId)}`, {
    method: "DELETE",
    headers: { "if-match": etag },
  });
}

export function getTaskDetails(token: string, taskId: string): Promise<PlannerTaskDetails> {
  return graphFetch<PlannerTaskDetails>(token, `/planner/tasks/${seg(taskId)}/details`);
}

export type DetailsWrite = {
  description?: string;
  checklist?: Record<string, Partial<PlannerChecklistItem> | null>;
  references?: Record<string, PlannerReference | null>;
};

export function updateTaskDetails(
  token: string,
  taskId: string,
  etag: string,
  patch: DetailsWrite,
): Promise<PlannerTaskDetails> {
  return graphFetch<PlannerTaskDetails>(token, `/planner/tasks/${seg(taskId)}/details`, {
    method: "PATCH",
    headers: { "if-match": etag, ...WRITE_HEADERS },
    body: JSON.stringify(patch),
  });
}

/**
 * Task details for many tasks, twenty to a JSON batch — one round trip per
 * twenty tasks rather than one per task. A throttled entry is retried once
 * after the wait Graph asks for.
 */
export async function getTaskDetailsMany(
  token: string,
  taskIds: string[],
): Promise<Map<string, PlannerTaskDetails>> {
  const out = new Map<string, PlannerTaskDetails>();

  for (let i = 0; i < taskIds.length; i += 20) {
    let pending = taskIds.slice(i, i + 20);

    for (let attempt = 0; attempt < 3 && pending.length > 0; attempt++) {
      const res = await graphFetch<{
        responses: {
          id: string;
          status: number;
          headers?: Record<string, string>;
          body?: PlannerTaskDetails & { error?: { code?: string; message?: string } };
        }[];
      }>(token, "/$batch", {
        method: "POST",
        body: JSON.stringify({
          requests: pending.map((id, n) => ({
            id: String(n),
            method: "GET",
            url: `/planner/tasks/${seg(id)}/details`,
          })),
        }),
      });

      const retry: string[] = [];
      let wait = 0;
      for (const r of res.responses) {
        const taskId = pending[Number(r.id)];
        if (r.status === 200 && r.body) {
          out.set(taskId, r.body);
        } else if (r.status === 429 || r.status === 503) {
          retry.push(taskId);
          wait = Math.max(wait, Number(r.headers?.["Retry-After"] ?? r.headers?.["retry-after"] ?? 2));
        } else if (r.status === 404) {
          // Deleted between listing and reading — the sync treats it as gone.
        } else {
          throw new GraphError(
            r.status,
            r.body?.error?.code ?? `http_${r.status}`,
            r.body?.error?.message ?? "Planner would not return a task's details.",
          );
        }
      }
      pending = retry;
      if (pending.length > 0) await new Promise((ok) => setTimeout(ok, Math.min(wait, 10) * 1000));
    }

    if (pending.length > 0) {
      throw new GraphError(429, "TooManyRequests", "Planner is throttling requests — try again shortly.");
    }
  }
  return out;
}

/* ── helpers ─────────────────────────────────────────────────────── */

/** Where a person opens the plan in the browser; it redirects to current Planner. */
export function planWebUrl(tenantId: string, planId: string): string {
  return `https://tasks.office.com/${tenantId}/Home/PlanViews/${planId}`;
}

/**
 * Reference keys are the URL itself, with the characters Planner reserves in
 * property names percent-encoded: % first, then . : @ #.
 */
export function encodeReferenceKey(url: string): string {
  return url
    .replace(/%/g, "%25")
    .replace(/\./g, "%2E")
    .replace(/:/g, "%3A")
    .replace(/@/g, "%40")
    .replace(/#/g, "%23");
}

export function decodeReferenceKey(key: string): string {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

/**
 * An order hint that sorts after `previous` (or first, when there is none).
 * Planner computes the stored value from this "{prev} {next}!" form; passing
 * a stored hint back verbatim is rejected.
 */
export function hintAfter(previous: string | null | undefined): string {
  return previous ? `${previous} !` : " !";
}

/** Planner order hints sort by ordinal string comparison, not locale. */
export function byOrderHint<T extends { orderHint: string }>(a: T, b: T): number {
  return a.orderHint < b.orderHint ? -1 : a.orderHint > b.orderHint ? 1 : 0;
}
