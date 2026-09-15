import "server-only";
import { asc, eq } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/lib/db";
import { settings, users } from "@/lib/db/schema";
import { DEFAULT_THRESHOLDS, type StaleThresholds } from "@/lib/staleness";

export const listTeam = cache(async () =>
  getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      photo: users.photo,
      role: users.role,
      jobTitle: users.jobTitle,
    })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.name)),
);

export type TeamMember = Awaited<ReturnType<typeof listTeam>>[number];

export const getSettings = cache(async () => {
  const [row] = await getDb().select().from(settings).where(eq(settings.id, "singleton"));
  return row ?? null;
});

/** How long each kind of record may sit untouched before it is called out. */
export const getThresholds = cache(async (): Promise<StaleThresholds> => {
  const row = await getSettings();
  return {
    lead: row?.staleLeadDays ?? DEFAULT_THRESHOLDS.lead,
    customer: row?.staleCustomerDays ?? DEFAULT_THRESHOLDS.customer,
    project: row?.staleProjectDays ?? DEFAULT_THRESHOLDS.project,
  };
});
