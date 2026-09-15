"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { autoProvisionFolder } from "./files";
import {
  fromZod,
  logActivity,
  optionalEmail,
  optionalText,
  optionalUrl,
  optionalUuid,
  tagList,
  type ActionState,
} from "./shared";

const customerSchema = z.object({
  name: z.string().trim().min(1, "Give the customer a name."),
  legalName: optionalText,
  abn: optionalText,
  kind: z.enum(["customer", "supplier", "both"]).default("customer"),
  status: z.enum(["prospect", "active", "on_hold", "former"]),
  industry: optionalText,
  segment: optionalText,
  website: optionalUrl,
  phone: optionalText,
  email: optionalEmail,
  ownerId: optionalUuid,
  addressLine1: optionalText,
  addressLine2: optionalText,
  suburb: optionalText,
  state: optionalText,
  postcode: optionalText,
  country: optionalText,
  tags: tagList,
  notes: optionalText,
});

export async function createCustomer(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireUser();
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  const [row] = await getDb()
    .insert(customers)
    .values({
      ...parsed.data,
      ownerId: parsed.data.ownerId ?? user.id,
      createdById: user.id,
    })
    .returning({ id: customers.id });

  await logActivity({
    entityType: "customer",
    entityId: row.id,
    customerId: row.id,
    verb: "created",
    summary: `Added customer ${parsed.data.name}`,
  });

  // Best-effort: never throws, so a SharePoint problem cannot lose the record.
  // Must run before redirect(), which throws to unwind.
  await autoProvisionFolder({ customerId: row.id });

  revalidatePath("/customers");
  redirect(`/customers/${row.id}`);
}

export async function updateCustomer(
  id: string,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  await getDb()
    .update(customers)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(customers.id, id));

  await logActivity({
    entityType: "customer",
    entityId: id,
    customerId: id,
    verb: "updated",
    summary: "Updated customer details",
  });

  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  return { ok: true, message: "Saved." };
}

export async function archiveCustomer(id: string): Promise<void> {
  await requireUser();
  await getDb()
    .update(customers)
    .set({ status: "former", archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(customers.id, id));

  await logActivity({
    entityType: "customer",
    entityId: id,
    customerId: id,
    verb: "archived",
    summary: "Marked as a former customer",
  });

  revalidatePath("/customers");
  redirect(`/customers/${id}`);
}
