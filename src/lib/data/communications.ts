import "server-only";
import { and, desc, eq, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { communications } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";

export type TimelineScope = {
  customerId?: string;
  projectId?: string;
  leadId?: string;
  contactId?: string;
  limit?: number;
};

/** Timeline rows the current user is allowed to see, newest first. */
export async function listCommunications(scope: TimelineScope) {
  const { user } = await requireUser();

  const targets = [];
  if (scope.customerId) targets.push(eq(communications.customerId, scope.customerId));
  if (scope.projectId) targets.push(eq(communications.projectId, scope.projectId));
  if (scope.leadId) targets.push(eq(communications.leadId, scope.leadId));
  if (scope.contactId) targets.push(eq(communications.contactId, scope.contactId));
  if (targets.length === 0) return [];

  return getDb().query.communications.findMany({
    where: and(
      or(...targets)!,
      // Private entries stay with the person who logged them.
      or(eq(communications.visibility, "team"), eq(communications.loggedById, user.id))!,
    ),
    orderBy: [desc(communications.occurredAt)],
    limit: scope.limit ?? 60,
    with: {
      loggedBy: { columns: { id: true, name: true, photo: true } },
      contact: { columns: { id: true, firstName: true, lastName: true } },
      project: { columns: { id: true, name: true } },
    },
  });
}

export type TimelineEntry = Awaited<ReturnType<typeof listCommunications>>[number];
