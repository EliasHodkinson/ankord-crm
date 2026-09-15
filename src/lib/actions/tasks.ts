"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { tasks, users } from "@/lib/db/schema";
import { notifyTeams } from "@/lib/notify";
import { appUrl } from "@/lib/env";
import { requireUser } from "@/lib/auth/session";
import {
  fail,
  fromZod,
  logActivity,
  optionalDate,
  optionalText,
  optionalUuid,
  type ActionState,
} from "./shared";

const taskSchema = z.object({
  title: z.string().trim().min(1, "What needs doing?"),
  detail: optionalText,
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  dueDate: optionalDate,
  assigneeId: optionalUuid,
  customerId: optionalUuid,
  contactId: optionalUuid,
  projectId: optionalUuid,
  leadId: optionalUuid,
  revalidate: z.string().default("/tasks"),
});

export async function createTask(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireUser();
  const parsed = taskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  const { revalidate, ...values } = parsed.data;
  const [row] = await getDb()
    .insert(tasks)
    .values({
      ...values,
      // An unassigned follow-up is nobody's follow-up.
      assigneeId: values.assigneeId ?? user.id,
      createdById: user.id,
    })
    .returning({ id: tasks.id });

  await logActivity({
    entityType: "task",
    entityId: row.id,
    customerId: values.customerId,
    projectId: values.projectId,
    leadId: values.leadId,
    verb: "created",
    summary: `Added follow-up: ${values.title}`,
  });

  // Tell the assignee in Teams, unless they set it for themselves — nobody
  // needs a notification about a note they just wrote.
  const assigneeId = values.assigneeId ?? user.id;
  if (assigneeId !== user.id) {
    await notifyAssignee(assigneeId, user.name, values);
  }

  revalidatePath(revalidate);
  revalidatePath("/tasks");
  return { ok: true, message: "Follow-up set." };
}

/**
 * Direct-messages the person a follow-up was assigned to, with a brief and a
 * link straight to the record it belongs to.
 *
 * Delivered by a Power Automate flow acting as Flow bot, so it arrives from
 * Flow bot rather than from The Gangway — the card carries the name instead.
 * Rebranding the sender would need a registered Teams bot.
 */
async function notifyAssignee(
  assigneeId: string,
  assignedBy: string,
  values: {
    title: string;
    detail: string | null;
    dueDate: string | null;
    priority: string;
    customerId: string | null;
    projectId: string | null;
    leadId: string | null;
  },
): Promise<void> {
  const [assignee] = await getDb()
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, assigneeId))
    .limit(1);
  if (!assignee?.email) return;

  // Land them on the record the follow-up is about, not a generic task list.
  const target = values.projectId
    ? `/projects/${values.projectId}`
    : values.customerId
      ? `/customers/${values.customerId}`
      : values.leadId
        ? `/leads/${values.leadId}`
        : "/tasks";

  await notifyTeams({
    toEmail: assignee.email,
    title: `${assignedBy} assigned you a follow-up`,
    subtitle: values.title,
    tone: values.priority === "urgent" ? "attention" : "default",
    facts: [
      ...(values.detail ? [{ title: "Detail", value: values.detail }] : []),
      { title: "Due", value: values.dueDate ?? "No date set" },
      { title: "Priority", value: values.priority },
      { title: "Set by", value: assignedBy },
    ],
    url: `${appUrl()}${target}`,
    urlLabel: "Open it in The Gangway",
  });
}

/** The parts of a follow-up worth changing after the fact. */
const editSchema = z.object({
  title: z.string().trim().min(1, "What needs doing?"),
  detail: optionalText,
  priority: z.enum(["low", "normal", "high", "urgent"]),
  dueDate: optionalDate,
});

/**
 * Edits an existing follow-up. Snoozing only ever pushes the due date a week
 * out from today, so this is the way to set a specific date — or to fix a
 * typo in the title, which was previously only possible by deleting it.
 */
export async function updateTask(
  id: string,
  values: {
    title: string;
    detail: string | null;
    priority: string;
    dueDate: string | null;
  },
  revalidate = "/tasks",
): Promise<ActionState> {
  await requireUser();
  const parsed = editSchema.safeParse(values);
  if (!parsed.success) return fromZod(parsed.error);

  await getDb()
    .update(tasks)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(tasks.id, id));

  revalidatePath(revalidate);
  revalidatePath("/tasks");
  return { ok: true, message: "Follow-up updated." };
}

export async function setTaskStatus(
  id: string,
  done: boolean,
  revalidate = "/tasks",
): Promise<ActionState> {
  await requireUser();
  await getDb()
    .update(tasks)
    .set({
      status: done ? "done" : "open",
      completedAt: done ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, id));

  revalidatePath(revalidate);
  revalidatePath("/tasks");
  return { ok: true };
}

/** Push a task out without opening it — "not today". */
export async function snoozeTask(
  id: string,
  days: number,
  revalidate = "/tasks",
): Promise<ActionState> {
  await requireUser();
  const parsed = z.number().int().min(1).max(365).safeParse(days);
  if (!parsed.success) return fail("That is not a sensible number of days.");

  const due = new Date();
  due.setDate(due.getDate() + parsed.data);

  await getDb()
    .update(tasks)
    .set({ dueDate: due.toISOString().slice(0, 10), updatedAt: new Date() })
    .where(eq(tasks.id, id));

  revalidatePath(revalidate);
  revalidatePath("/tasks");
  return { ok: true };
}

export async function deleteTask(id: string, revalidate = "/tasks"): Promise<ActionState> {
  const { user } = await requireUser();
  const db = getDb();

  const [row] = await db
    .select({ createdById: tasks.createdById, assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);
  if (!row) return fail("That task has already gone.");
  if (row.createdById !== user.id && row.assigneeId !== user.id && user.role !== "admin") {
    return fail("That task belongs to someone else.");
  }

  await db.delete(tasks).where(eq(tasks.id, id));
  revalidatePath(revalidate);
  revalidatePath("/tasks");
  return { ok: true };
}
