"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { projectAccounts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import {
  fromZod,
  logActivity,
  optionalDate,
  optionalNumber,
  optionalText,
  optionalUrl,
  optionalUuid,
  type ActionState,
} from "./shared";

/**
 * The account register records where a credential lives, never the credential.
 * There is deliberately no password field anywhere in this schema.
 */
const accountSchema = z.object({
  projectId: optionalUuid,
  customerId: optionalUuid,
  system: z.string().trim().min(1, "Name the system."),
  loginUrl: optionalUrl,
  username: optionalText,
  mfaMethod: optionalText,
  recoveryCodesLocation: optionalText,
  vaultRecord: optionalText,
  ownedBy: optionalText,
  renewalDate: optionalDate,
  costAud: optionalNumber,
  purpose: optionalText,
  notes: optionalText,
  revalidate: z.string().default("/"),
});

export async function saveAccount(
  id: string | null,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  const { revalidate, costAud, ...values } = parsed.data;
  const row = { ...values, costAud: costAud?.toString() ?? null };
  const db = getDb();

  if (id) {
    await db
      .update(projectAccounts)
      .set({ ...row, updatedAt: new Date() })
      .where(eq(projectAccounts.id, id));
  } else {
    await db.insert(projectAccounts).values(row);
  }

  await logActivity({
    entityType: "account",
    entityId: id ?? values.system,
    customerId: values.customerId,
    projectId: values.projectId,
    verb: id ? "updated" : "created",
    summary: `${id ? "Updated" : "Added"} ${values.system} in the account register`,
  });

  revalidatePath(revalidate);
  return { ok: true, message: "Saved." };
}

export async function deleteAccount(id: string, revalidate: string): Promise<void> {
  await requireUser();
  await getDb().delete(projectAccounts).where(eq(projectAccounts.id, id));
  revalidatePath(revalidate);
}
