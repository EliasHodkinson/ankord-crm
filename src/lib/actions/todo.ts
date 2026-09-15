"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { getGraphToken, requireUser, GraphAuthError } from "@/lib/auth/session";
import {
  completeTodoTask,
  createTodoTask,
  ensureCrmList,
  listTodoTasks,
} from "@/lib/graph/todo";
import { describeGraphFailure } from "@/lib/graph/errors";
import { appUrl } from "@/lib/env";
import { fail, type ActionState } from "./shared";

/**
 * Mirrors the signed-in person's open follow-ups into their Microsoft To Do.
 *
 * Only ever `/me`: To Do has no application-permission path, so this runs with
 * the caller's own delegated token and touches nobody else's list. A follow-up
 * assigned to someone else appears in their To Do the next time *they* sync.
 *
 * The CRM stays the source of truth. Completion travels in both directions,
 * but nothing else does — editing a mirrored task in To Do will be overwritten
 * by the CRM's copy, which is the trade for not having two systems that both
 * believe they own the same item.
 */

/** Where the follow-up actually lives, so To Do can link straight to it. */
function targetFor(row: {
  projectId: string | null;
  customerId: string | null;
  leadId: string | null;
}): string {
  if (row.projectId) return `/projects/${row.projectId}`;
  if (row.customerId) return `/customers/${row.customerId}`;
  if (row.leadId) return `/leads/${row.leadId}`;
  return "/tasks";
}

export type SyncResult = ActionState & {
  created?: number;
  completedHere?: number;
  completedThere?: number;
};

export async function syncMyTodo(): Promise<SyncResult> {
  const { user } = await requireUser();
  const db = getDb();

  let token: string;
  try {
    token = await getGraphToken();
  } catch (error) {
    if (error instanceof GraphAuthError) {
      return fail("Sign in again to sync with Microsoft To Do.");
    }
    return fail(describeGraphFailure(error));
  }

  try {
    const listId = await ensureCrmList(token);
    const mine = await db
      .select()
      .from(tasks)
      .where(eq(tasks.assigneeId, user.id));

    const remote = await listTodoTasks(token, listId);
    const remoteById = new Map(remote.map((t) => [t.id, t]));

    let created = 0;
    let completedHere = 0;
    let completedThere = 0;

    for (const row of mine) {
      const open = row.status === "open";

      /* Open here, not yet mirrored → put it in To Do. */
      if (open && !row.todoTaskId) {
        const made = await createTodoTask(token, listId, {
          title: row.title,
          detail: row.detail,
          dueDate: row.dueDate,
          priority: row.priority,
          url: `${appUrl()}${targetFor(row)}`,
        });
        await db
          .update(tasks)
          .set({ todoTaskId: made.id })
          .where(eq(tasks.id, row.id));
        created += 1;
        continue;
      }

      if (!row.todoTaskId) continue;
      const mirrored = remoteById.get(row.todoTaskId);

      /* Ticked in To Do → close it here too. */
      if (open && mirrored?.status === "completed") {
        await db
          .update(tasks)
          .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
          .where(eq(tasks.id, row.id));
        completedHere += 1;
        continue;
      }

      /**
       * Gone from To Do entirely. Deliberately treated as "unmirror and let it
       * come back", not as completion — deleting is too easy to do by accident
       * to be worth closing a follow-up over. Tick it in To Do to complete it.
       */
      if (open && !mirrored) {
        await db.update(tasks).set({ todoTaskId: null }).where(eq(tasks.id, row.id));
        continue;
      }

      /* Closed here → tidy it out of their To Do. */
      if (!open && mirrored && mirrored.status !== "completed") {
        await completeTodoTask(token, listId, row.todoTaskId);
        completedThere += 1;
      }
    }

    if (created || completedHere || completedThere) {
      revalidatePath("/tasks");
    }

    return {
      ok: true,
      created,
      completedHere,
      completedThere,
      message:
        created || completedHere || completedThere
          ? `Synced — ${created} added, ${completedHere} closed here, ${completedThere} closed in To Do.`
          : "Already up to date.",
    };
  } catch (error) {
    return fail(describeGraphFailure(error));
  }
}

/** Clears every mirror link so the next sync rebuilds the list from scratch. */
export async function resetMyTodoLinks(): Promise<ActionState> {
  const { user } = await requireUser();
  await getDb()
    .update(tasks)
    .set({ todoTaskId: null })
    .where(and(eq(tasks.assigneeId, user.id), isNotNull(tasks.todoTaskId), ne(tasks.status, "done")));

  revalidatePath("/tasks");
  return { ok: true, message: "Links cleared. The next sync will rebuild them." };
}
