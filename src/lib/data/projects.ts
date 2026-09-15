import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { projectAccounts, projectContacts, projectPhases, projectSteps, projects } from "@/lib/db/schema";

export async function getProject(id: string) {
  const project = await getDb().query.projects.findFirst({
    where: eq(projects.id, id),
    with: {
      customer: {
        columns: { id: true, name: true, status: true },
        with: { contacts: { columns: { id: true, firstName: true, lastName: true } } },
      },
      owner: { columns: { id: true, name: true, photo: true } },
      phases: { orderBy: [asc(projectPhases.position)] },
      steps: {
        orderBy: [asc(projectSteps.position)],
        with: { assignee: { columns: { id: true, name: true, photo: true } } },
      },
      keyContacts: { orderBy: [asc(projectContacts.position)] },
      accounts: { orderBy: [asc(projectAccounts.position)] },
    },
  });
  return project ?? null;
}

export type ProjectRecord = NonNullable<Awaited<ReturnType<typeof getProject>>>;
export type ProjectStepRecord = ProjectRecord["steps"][number];

/** Done vs total, ignoring steps marked not applicable. */
export function progressOf(steps: { status: string }[]) {
  const counted = steps.filter((s) => s.status !== "not_applicable");
  const done = counted.filter((s) => s.status === "done").length;
  return {
    done,
    total: counted.length,
    blocked: steps.filter((s) => s.status === "blocked").length,
    percent: counted.length === 0 ? 0 : Math.round((done / counted.length) * 100),
  };
}
