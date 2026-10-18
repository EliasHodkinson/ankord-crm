/**
 * How a runbook maps onto Microsoft Planner, as pure functions. No I/O here,
 * so the sync's decisions can be reasoned about (and checked) in isolation.
 *
 *   project ↔ plan      name ↔ title
 *   phase   ↔ bucket    "01 · Discovery" ↔ num + label
 *   step    ↔ task      title, bucket, assignee, due date, progress,
 *                       description, checklist, links (references)
 *
 * Every synced field is two-way. Each side is compared against the value both
 * agreed at the last sync (the "base"): a field changed on one side only takes
 * that side; a field changed on both sides to different values is a genuine
 * conflict, and Planner wins — it is where people tick tasks off in Teams.
 *
 * Planner has nothing for a step's tag, owner label, warning, working notes or
 * "waiting on", and Gangway has no task priority, start date or labels. Those
 * stay on their own side and are never touched by a sync.
 */

export type ChecklistItem = { id: string; title: string; done: boolean };
export type StepLink = { url: string; label: string };
export type Progress = 0 | 50 | 100;

export type TaskView = {
  title: string;
  /** Planner bucket id the step's phase is linked to. */
  bucket: string | null;
  /** Entra object id of the assignee who is also a Gangway user. */
  assignee: string | null;
  /** yyyy-mm-dd, as Ankor'd reads it. */
  due: string | null;
  progress: Progress;
  description: string;
  checklist: ChecklistItem[];
  links: StepLink[];
};

export type BucketView = { name: string };
export type PlanView = { title: string };

export const TASK_FIELDS = [
  "title",
  "bucket",
  "assignee",
  "due",
  "progress",
  "description",
  "checklist",
  "links",
] as const satisfies readonly (keyof TaskView)[];

/* ── phases ↔ buckets ────────────────────────────────────────────── */

/** "01" + "Discovery" → "01 · Discovery". */
export function bucketName(num: string, label: string): string {
  return num.trim() ? `${num.trim()} · ${label.trim()}` : label.trim();
}

/**
 * The reverse, tolerant of how people actually type bucket names in Planner:
 * "01 · Discovery", "1. Discovery", "02 - Build", or just "Launch".
 */
export function parseBucketName(name: string): { num: string | null; label: string } {
  const match = name.trim().match(/^(\d{1,3}[a-z]?)\s*[·.:)\-–—]\s*(.+)$/i);
  if (match) return { num: match[1], label: match[2].trim() };
  return { num: null, label: name.trim() || "Untitled" };
}

/* ── status ↔ percentComplete ────────────────────────────────────── */

/**
 * Planner only knows not started / in progress / complete. Blocked reads as
 * in progress and not-applicable as complete over there; a sync only changes
 * the Gangway status when the Planner value moves out of that band, so a
 * blocked step stays blocked while Planner says "in progress".
 */
export function progressOf(status: string): Progress {
  if (status === "done" || status === "not_applicable") return 100;
  if (status === "in_progress" || status === "blocked") return 50;
  return 0;
}

export function statusFor(progress: Progress, current: string): string {
  if (progressOf(current) === progress) return current;
  return progress === 100 ? "done" : progress === 50 ? "in_progress" : "todo";
}

export function normaliseProgress(percent: number | null | undefined): Progress {
  if (!percent) return 0;
  return percent >= 100 ? 100 : 50;
}

/* ── due dates ───────────────────────────────────────────────────── */

export const PLANNER_TIME_ZONE = "Australia/Sydney";

const dayIn = new Intl.DateTimeFormat("en-CA", {
  timeZone: PLANNER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Planner stores a due *instant*. Read it as the date it falls on in
 * Australia, so a task due "Tuesday" set from Planner (midnight local, which
 * is Monday afternoon UTC) is Tuesday here too.
 */
export function dueFromPlanner(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : dayIn.format(d);
}

/**
 * Midday UTC is evening of the same day across Australia, so the date reads
 * the same wherever it is opened — midnight UTC would not.
 */
export function dueToPlanner(date: string | null): string | null {
  return date ? `${date}T12:00:00Z` : null;
}

/* ── back-links ──────────────────────────────────────────────────── */

/** The reference each synced task carries back to its step. */
export const BACKLINK_ALIAS = "Open in The Gangway";

export function backlinkUrl(appUrl: string, projectId: string, stepId: string): string {
  return `${appUrl}/projects/${projectId}?step=${stepId}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BACKLINK = new RegExp(`/projects/(${UUID})\\?step=(${UUID})$`, "i");

/**
 * Recognises a back-link from any deployment (preview, local, production) so
 * it is never mistaken for an ordinary link. It also lets a sync that crashed
 * between creating a task and recording it find the task again rather than
 * creating a duplicate.
 */
export function parseBacklink(url: string): { projectId: string; stepId: string } | null {
  const match = url.match(BACKLINK);
  return match ? { projectId: match[1], stepId: match[2] } : null;
}

/* ── normalising and comparing ───────────────────────────────────── */

export function sortLinks(links: StepLink[]): StepLink[] {
  return [...links].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

/**
 * Checklists are compared by content, not order. Planner stores its own order
 * hints and re-sequences items written together, so order is left to each
 * side rather than synced — otherwise every write would read back as an edit.
 */
export function sortChecklist(items: ChecklistItem[]): ChecklistItem[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Puts items in the order of `ids`; anything not listed goes last. */
export function orderChecklist(items: ChecklistItem[], ids: string[]): ChecklistItem[] {
  const rank = new Map<string, number>();
  ids.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  const last = ids.length;
  return [...items].sort((a, b) => (rank.get(a.id) ?? last) - (rank.get(b.id) ?? last));
}

/**
 * Deep equality that ignores object key order. The base comes back out of a
 * jsonb column, and Postgres stores jsonb keys sorted — so `{id, title, done}`
 * written is `{done, id, title}` read, and a plain JSON.stringify comparison
 * would see every field as changed on both sides.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  return canonical(a ?? null) === canonical(b ?? null);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export type MergeResult<T> = {
  merged: T;
  /** Fields where both sides moved to different values; Planner's was kept. */
  conflicts: (keyof T)[];
};

/**
 * Three-way merge, field by field. With no base (a first link, where two
 * existing items were matched up) any difference counts as a conflict and
 * Planner's value is taken.
 */
export function merge3<T extends Record<string, unknown>>(
  fields: readonly (keyof T)[],
  local: T,
  remote: T,
  base: Partial<T> | null | undefined,
): MergeResult<T> {
  const merged = { ...local };
  const conflicts: (keyof T)[] = [];

  for (const field of fields) {
    const l = local[field];
    const r = remote[field];
    if (sameValue(l, r)) continue;

    const hasBase = base != null && field in base;
    if (hasBase && sameValue(l, base[field])) {
      merged[field] = r; // only Planner changed
    } else if (hasBase && sameValue(r, base[field])) {
      merged[field] = l; // only Gangway changed
    } else {
      merged[field] = r; // both changed: Planner wins
      conflicts.push(field);
    }
  }
  return { merged, conflicts };
}

export function changedFields<T extends Record<string, unknown>>(
  fields: readonly (keyof T)[],
  from: T,
  to: T,
): (keyof T)[] {
  return fields.filter((f) => !sameValue(from[f], to[f]));
}
