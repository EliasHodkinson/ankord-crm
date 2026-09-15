"use server";

import { revalidatePath } from "next/cache";
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { customers, leads } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { fail, logActivity, type ActionState } from "./shared";

const idsSchema = z.array(z.uuid()).min(1, "Nothing is selected.").max(500);

/**
 * The changes worth making to twenty records at once: who owns them, where
 * they sit, and how they are tagged. Anything more specific belongs on the
 * record itself.
 */
const opSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("owner"), ownerId: z.uuid().nullable() }),
  z.object({
    kind: z.literal("leadStage"),
    stage: z.enum(["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"]),
  }),
  z.object({
    kind: z.literal("customerStatus"),
    status: z.enum(["prospect", "active", "on_hold", "former"]),
  }),
  z.object({ kind: z.literal("addTag"), tag: z.string().trim().min(1).max(30) }),
]);

export type BulkOp = z.infer<typeof opSchema>;

/**
 * Adds a tag without dropping the ones already there, and without adding it
 * twice — Postgres does the union, so two people tagging at the same moment
 * cannot overwrite each other.
 */
function appendTag(column: AnyPgColumn, tag: string) {
  return sql`(
    select array_agg(distinct t)
    from unnest(array_append(${column}, ${tag}::text)) as t
  )`;
}

export async function bulkUpdateLeads(ids: string[], op: BulkOp): Promise<ActionState> {
  await requireUser();
  const parsedIds = idsSchema.safeParse(ids);
  const parsedOp = opSchema.safeParse(op);
  if (!parsedIds.success) return fail(parsedIds.error.issues[0].message);
  if (!parsedOp.success) return fail("That change isn't something we can apply in bulk.");

  const db = getDb();
  const where = inArray(leads.id, parsedIds.data);
  const now = new Date();
  const count = parsedIds.data.length;

  switch (parsedOp.data.kind) {
    case "owner":
      await db.update(leads).set({ ownerId: parsedOp.data.ownerId, updatedAt: now }).where(where);
      break;
    case "leadStage":
      await db.update(leads).set({ stage: parsedOp.data.stage, updatedAt: now }).where(where);
      break;
    case "addTag":
      await db
        .update(leads)
        .set({ tags: appendTag(leads.tags, parsedOp.data.tag), updatedAt: now })
        .where(where);
      break;
    default:
      return fail("That change does not apply to leads.");
  }

  await logActivity({
    entityType: "lead",
    entityId: parsedIds.data[0],
    verb: "bulk_updated",
    summary: `Updated ${count} ${count === 1 ? "lead" : "leads"} at once`,
  });

  revalidatePath("/leads");
  return { ok: true, message: `Updated ${count} ${count === 1 ? "lead" : "leads"}.` };
}

export async function bulkUpdateCustomers(ids: string[], op: BulkOp): Promise<ActionState> {
  await requireUser();
  const parsedIds = idsSchema.safeParse(ids);
  const parsedOp = opSchema.safeParse(op);
  if (!parsedIds.success) return fail(parsedIds.error.issues[0].message);
  if (!parsedOp.success) return fail("That change isn't something we can apply in bulk.");

  const db = getDb();
  const where = inArray(customers.id, parsedIds.data);
  const now = new Date();
  const count = parsedIds.data.length;

  switch (parsedOp.data.kind) {
    case "owner":
      await db
        .update(customers)
        .set({ ownerId: parsedOp.data.ownerId, updatedAt: now })
        .where(where);
      break;
    case "customerStatus":
      await db
        .update(customers)
        .set({ status: parsedOp.data.status, updatedAt: now })
        .where(where);
      break;
    case "addTag":
      await db
        .update(customers)
        .set({ tags: appendTag(customers.tags, parsedOp.data.tag), updatedAt: now })
        .where(where);
      break;
    default:
      return fail("That change does not apply to customers.");
  }

  await logActivity({
    entityType: "customer",
    entityId: parsedIds.data[0],
    verb: "bulk_updated",
    summary: `Updated ${count} ${count === 1 ? "customer" : "customers"} at once`,
  });

  revalidatePath("/customers");
  return { ok: true, message: `Updated ${count} ${count === 1 ? "customer" : "customers"}.` };
}
