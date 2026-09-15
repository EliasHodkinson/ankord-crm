import "server-only";
import { graphFetch, graphList } from "./client";

/**
 * Microsoft To Do, for mirroring CRM follow-ups into the place people actually
 * look — To Do surfaces in Outlook's My Day, which the CRM's own list never
 * will.
 *
 * Everything here is `/me`. To Do has no application-permission path, so a
 * person's list can only be written with that person's own delegated token.
 * A follow-up assigned to someone else therefore reaches their To Do when they
 * next sync, not the moment it is set — the Teams message is what tells them
 * immediately.
 */

/** Kept out of the default Tasks list so a sync never disturbs personal items. */
export const CRM_LIST_NAME = "Ankor'd CRM";

type TodoList = { id: string; displayName: string; wellknownListName?: string };

export type TodoTask = {
  id: string;
  title: string;
  status: string;
  lastModifiedDateTime?: string;
};

/** Finds the CRM list in this person's To Do, creating it the first time. */
export async function ensureCrmList(token: string): Promise<string> {
  const lists = await graphList<TodoList>(token, "/me/todo/lists", 50);
  const existing = lists.find((l) => l.displayName === CRM_LIST_NAME);
  if (existing) return existing.id;

  const created = await graphFetch<TodoList>(token, "/me/todo/lists", {
    method: "POST",
    body: JSON.stringify({ displayName: CRM_LIST_NAME }),
  });
  return created.id;
}

export function listTodoTasks(token: string, listId: string): Promise<TodoTask[]> {
  return graphList<TodoTask>(
    token,
    `/me/todo/lists/${listId}/tasks?$select=id,title,status,lastModifiedDateTime`,
    100,
  );
}

/** CRM priorities collapse to To Do's three; urgent and high both read high. */
function importanceFor(priority: string): "low" | "normal" | "high" {
  if (priority === "low") return "low";
  if (priority === "high" || priority === "urgent") return "high";
  return "normal";
}

/**
 * To Do wants a dateTime even for what it treats as a date. Midday UTC is used
 * deliberately: midnight lands on the previous day for anyone behind UTC, which
 * in Australia would show every follow-up a day early.
 */
function dueFor(dueDate: string | null) {
  if (!dueDate) return null;
  return { dateTime: `${dueDate}T12:00:00.0000000`, timeZone: "UTC" };
}

export type TodoPayload = {
  title: string;
  detail: string | null;
  dueDate: string | null;
  priority: string;
  /** Deep link back to the record the follow-up belongs to. */
  url: string;
};

function bodyFor(input: TodoPayload) {
  return {
    title: input.title,
    importance: importanceFor(input.priority),
    ...(input.detail
      ? { body: { content: input.detail, contentType: "text" } }
      : {}),
    ...(dueFor(input.dueDate) ? { dueDateTime: dueFor(input.dueDate) } : {}),
    // Shows in To Do as a link straight back to the record, so the task is
    // actionable from there rather than just a reminder to open the CRM.
    linkedResources: [
      {
        webUrl: input.url,
        applicationName: "The Gangway",
        displayName: input.title,
      },
    ],
  };
}

export function createTodoTask(
  token: string,
  listId: string,
  input: TodoPayload,
): Promise<TodoTask> {
  return graphFetch<TodoTask>(token, `/me/todo/lists/${listId}/tasks`, {
    method: "POST",
    body: JSON.stringify(bodyFor(input)),
  });
}

export function completeTodoTask(
  token: string,
  listId: string,
  taskId: string,
): Promise<TodoTask> {
  return graphFetch<TodoTask>(token, `/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "completed" }),
  });
}

export function deleteTodoTask(
  token: string,
  listId: string,
  taskId: string,
): Promise<void> {
  return graphFetch<void>(token, `/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: "DELETE",
  });
}
