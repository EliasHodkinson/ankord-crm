import "server-only";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { savedViews } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";

/** Views this person can see: their own, plus anything shared with the team. */
export async function listSavedViews(entity: string) {
  const { user } = await requireUser();
  return getDb()
    .select()
    .from(savedViews)
    .where(
      and(
        eq(savedViews.entity, entity),
        or(eq(savedViews.isShared, true), eq(savedViews.ownerId, user.id), isNull(savedViews.ownerId))!,
      ),
    )
    .orderBy(asc(savedViews.position), asc(savedViews.name));
}
