"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { settings, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import {
  emptyToNull,
  fail,
  fromZod,
  logActivity,
  optionalText,
  type ActionState,
} from "./shared";

const librarySchema = z.object({
  spSiteId: z.string().trim().min(1, "Choose a SharePoint site."),
  spSiteUrl: optionalText,
  spDriveId: z.string().trim().min(1, "Choose a document library."),
  // Blank is allowed: it puts customer folders straight at the library root.
  spRootFolder: z.preprocess(
    emptyToNull,
    z.string().trim().nullable(),
  ),
  // Blank switches lead folders off entirely.
  spLeadFolder: z.preprocess(emptyToNull, z.string().trim().nullable()),
  spAutoProvision: z.preprocess(
    (v) => v === "on" || v === "true" || v === true,
    z.boolean(),
  ),
  // One folder per line. A textarea sends \r\n, and blank is a real choice —
  // it means the client folder is created with nothing inside it.
  spFolderTemplate: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : ""),
    z.string(),
  ),
});

/** Points the CRM at the document library that holds client files. */
export async function saveLibrary(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireAdmin();
  const parsed = librarySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  await getDb()
    .insert(settings)
    .values({ id: "singleton", ...parsed.data, updatedById: user.id })
    .onConflictDoUpdate({
      target: settings.id,
      set: { ...parsed.data, updatedById: user.id, updatedAt: new Date() },
    });

  await logActivity({
    entityType: "settings",
    entityId: "singleton",
    verb: "updated",
    summary: "Changed the SharePoint library the CRM stores files in",
  });

  revalidatePath("/settings");
  return { ok: true, message: "SharePoint library saved." };
}

const roleSchema = z.enum(["admin", "member", "viewer"]);

export async function setUserRole(userId: string, role: string): Promise<ActionState> {
  const { user } = await requireAdmin();
  const parsed = roleSchema.safeParse(role);
  if (!parsed.success) return fail("Unknown role.");

  if (userId === user.id && parsed.data !== "admin") {
    return fail("You can't remove your own admin access — ask another admin to do it.");
  }

  const db = getDb();

  // Entra wins where it is in play. Writing here would be silently reverted at
  // the person's next sign-in, so refuse and say where the real switch is.
  const [target] = await db
    .select({ roleSource: users.roleSource })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (target?.roleSource === "entra") {
    return fail(
      "This person's access is managed in Entra. Change their app role assignment there — a change made here would be overwritten at their next sign-in.",
    );
  }

  await db
    .update(users)
    .set({ role: parsed.data, updatedAt: new Date() })
    .where(eq(users.id, userId));

  revalidatePath("/settings");
  return { ok: true, message: "Role updated." };
}

export async function setUserActive(userId: string, isActive: boolean): Promise<ActionState> {
  const { user } = await requireAdmin();
  if (userId === user.id && !isActive) {
    return fail("You can't switch off your own access.");
  }

  await getDb()
    .update(users)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(users.id, userId));

  revalidatePath("/settings");
  return { ok: true };
}
