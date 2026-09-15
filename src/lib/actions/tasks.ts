"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
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

  revalidatePath(revalidate);
  revalidatePath("/tasks");
  return { ok: true, message: "Follow-up set." };
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
