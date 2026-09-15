import { isoDate } from "@/lib/utils";

/**
 * Pure task helpers, safe on both sides of the wire. The queries live in
 * lib/data/tasks.ts, which is server-only — keeping these separate stops a
 * client component dragging the session module into the browser bundle.
 */

export type TaskBucket = "overdue" | "today" | "soon" | "later" | "someday" | "done";

/** Groups tasks the way a person thinks about their day. */
export function bucketOf(task: { dueDate: string | null; status: string }): TaskBucket {
  if (task.status === "done") return "done";
  if (!task.dueDate) return "someday";
  const today = isoDate();
  if (task.dueDate < today) return "overdue";
  if (task.dueDate === today) return "today";
  if (task.dueDate <= isoDate(7)) return "soon";
  return "later";
}

export const BUCKET_LABEL: Record<TaskBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  soon: "This week",
  later: "Later",
  someday: "No date",
  done: "Done",
};

export const BUCKET_ORDER: TaskBucket[] = [
  "overdue",
  "today",
  "soon",
  "later",
  "someday",
  "done",
];
