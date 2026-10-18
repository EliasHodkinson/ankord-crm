"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { savedViews } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { AccessDenied, getAccess } from "@/lib/access";
import { fail, fromZod, type ActionState } from "./shared";

const ENTITIES = [
  "leads",
  "customers",
  "projects",
  "contacts",
  "quotes",
  "sales_orders",
  "invoices",
  "purchase_orders",
  "receipts",
  "bills",
] as const;

/** The list page each entity's views belong to. */
const LIST_PATH: Record<string, string> = {
  quotes: "/sales/quotes",
  sales_orders: "/sales/orders",
  invoices: "/sales/invoices",
  purchase_orders: "/purchasing/orders",
  receipts: "/purchasing/receipts",
  bills: "/purchasing/bills",
};
const listPath = (entity: string) => LIST_PATH[entity] ?? `/${entity}`;

const viewSchema = z.object({
  entity: z.enum(ENTITIES),
  name: z.string().trim().min(1, "Give the view a name.").max(40, "Keep the name short."),
  /** The list page's own query string — what you were looking at when you saved. */
  query: z.string().trim().max(500).default(""),
  isShared: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});

export async function saveView(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireUser();
  const parsed = viewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  // A restricted person keeps their views to themselves, and has no lead list
  // to save a view of.
  const access = await getAccess();
  if (access.restricted) {
    if (parsed.data.entity === "leads") throw new AccessDenied();
    parsed.data.isShared = false;
  }

  const db = getDb();
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${savedViews.position}), -1) + 1` })
    .from(savedViews)
    .where(eq(savedViews.entity, parsed.data.entity));

  await db.insert(savedViews).values({
    entity: parsed.data.entity,
    name: parsed.data.name,
    query: parsed.data.query.replace(/^\?/, ""),
    isShared: parsed.data.isShared,
    // A shared view belongs to the team, not to whoever happened to make it.
    ownerId: parsed.data.isShared ? null : user.id,
    createdById: user.id,
    position: next,
  });

  revalidatePath(listPath(parsed.data.entity));
  return { ok: true, message: "View saved." };
}

export async function deleteView(id: string): Promise<ActionState> {
  const { user } = await requireUser();
  const db = getDb();

  const [view] = await db.select().from(savedViews).where(eq(savedViews.id, id)).limit(1);
  if (!view) return fail("That view has already gone.");
  if (view.ownerId && view.ownerId !== user.id && user.role !== "admin") {
    return fail("That view belongs to someone else.");
  }
  if (!view.ownerId && user.role !== "admin" && view.createdById !== user.id) {
    return fail("Only an admin, or whoever created it, can remove a shared view.");
  }

  await db.delete(savedViews).where(and(eq(savedViews.id, id)));
  revalidatePath(listPath(view.entity));
  return { ok: true };
}
