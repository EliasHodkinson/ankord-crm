import "server-only";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { plannerPlans } from "@/lib/db/schema";
import { getGraphToken } from "@/lib/auth/session";
import { syncPlannerProject } from "./sync";

/**
 * After a runbook edit, carry it to Planner once the response has gone —
 * the person editing never waits on Graph. Uses their own delegated token,
 * read from the session cookie inside `after()`, which server actions allow.
 *
 * Does nothing for a project that is not linked. Failures land on the link's
 * error state, where the project page shows them; they never fail the edit.
 */
export function queuePlannerSync(projectId: string) {
  after(async () => {
    try {
      const [link] = await getDb()
        .select({ projectId: plannerPlans.projectId })
        .from(plannerPlans)
        .where(eq(plannerPlans.projectId, projectId));
      if (!link) return;

      const token = await getGraphToken();

      // Another sync may hold the lock (an open tab polling); give it a moment
      // rather than dropping the edit until the next poll.
      for (let attempt = 0; attempt < 4; attempt++) {
        const { summary } = await syncPlannerProject(projectId, token, { force: true });
        if (summary.skipped !== "locked") return;
        await new Promise((ok) => setTimeout(ok, 2500));
      }
    } catch {
      // No Microsoft token (dev session, expired sign-in): the next sync from
      // a signed-in person picks the edit up.
    }
  });
}
