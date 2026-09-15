"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { customers, leads } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { comparableName } from "@/lib/csv";
import type { ImportKind, ImportPreviewRow } from "@/lib/import-fields";
import { fail, logActivity, type ActionState } from "./shared";

const payloadSchema = z.object({
  kind: z.enum(["customers", "leads"]),
  rows: z.array(z.record(z.string(), z.string())).max(2000, "That's more than 2,000 rows — split the file."),
  skip: z.array(z.number().int()).default([]),
});

/**
 * Checks a parsed file against what is already here, so the same client is not
 * added twice under a slightly different spelling. Nothing is written yet.
 */
export async function previewImport(
  kind: ImportKind,
  rows: Record<string, string>[],
): Promise<{ ok: true; rows: ImportPreviewRow[] } | { ok: false; message: string }> {
  await requireUser();
  const parsed = payloadSchema.safeParse({ kind, rows });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "That file could not be read." };
  }

  const db = getDb();
  const nameKey = kind === "customers" ? "name" : "companyName";

  const existing =
    kind === "customers"
      ? await db
          .select({ id: customers.id, name: customers.name, email: customers.email })
          .from(customers)
      : await db
          .select({ id: leads.id, name: leads.companyName, email: leads.email })
          .from(leads);

  const byName = new Map(existing.map((e) => [comparableName(e.name), e]));
  const byEmail = new Map(
    existing.filter((e) => e.email).map((e) => [e.email!.toLowerCase(), e]),
  );

  // Also catch two rows inside the file itself that are the same business.
  const seen = new Map<string, number>();

  const preview: ImportPreviewRow[] = rows.map((values, index) => {
    const name = values[nameKey]?.trim() ?? "";
    const key = comparableName(name);
    const email = values.email?.trim().toLowerCase();

    let duplicateOf: ImportPreviewRow["duplicateOf"] = null;
    if (key && byName.has(key)) {
      const match = byName.get(key)!;
      duplicateOf = { id: match.id, name: match.name, reason: "name" };
    } else if (email && byEmail.has(email)) {
      const match = byEmail.get(email)!;
      duplicateOf = { id: match.id, name: match.name, reason: "email" };
    } else if (key && seen.has(key)) {
      duplicateOf = { id: "", name: `row ${seen.get(key)! + 1} of this file`, reason: "name" };
    }

    if (key && !seen.has(key)) seen.set(key, index);
    return { index, values, duplicateOf };
  });

  return { ok: true, rows: preview };
}

/** Writes the rows the person chose to keep. */
export async function commitImport(
  kind: ImportKind,
  rows: Record<string, string>[],
): Promise<ActionState & { created?: number }> {
  const { user } = await requireUser();
  const parsed = payloadSchema.safeParse({ kind, rows });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "That file could not be read.");
  }

  const db = getDb();
  const clean = (v: string | undefined) => {
    const t = v?.trim();
    return t ? t : null;
  };
  const url = (v: string | undefined) => {
    const t = clean(v);
    if (!t) return null;
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  };
  const number = (v: string | undefined) => {
    const t = clean(v)?.replace(/[^0-9.]/g, "");
    return t && Number.isFinite(Number(t)) ? Number(t).toString() : null;
  };

  let created = 0;

  if (kind === "customers") {
    const values = rows
      .filter((r) => clean(r.name))
      .map((r) => ({
        name: r.name.trim(),
        legalName: clean(r.legalName),
        abn: clean(r.abn),
        email: clean(r.email)?.toLowerCase() ?? null,
        phone: clean(r.phone),
        website: url(r.website),
        industry: clean(r.industry),
        addressLine1: clean(r.addressLine1),
        suburb: clean(r.suburb),
        state: clean(r.state)?.toUpperCase() ?? null,
        postcode: clean(r.postcode),
        notes: clean(r.notes),
        ownerId: user.id,
        createdById: user.id,
      }));
    if (values.length === 0) return fail("No rows had a company name.");
    await db.insert(customers).values(values);
    created = values.length;
  } else {
    const values = rows
      .filter((r) => clean(r.companyName))
      .map((r) => ({
        companyName: r.companyName.trim(),
        contactName: clean(r.contactName),
        jobTitle: clean(r.jobTitle),
        email: clean(r.email)?.toLowerCase() ?? null,
        phone: clean(r.phone),
        website: url(r.website),
        source: clean(r.source),
        interest: clean(r.interest),
        valueAud: number(r.valueAud),
        suburb: clean(r.suburb),
        state: clean(r.state)?.toUpperCase() ?? null,
        ownerId: user.id,
        createdById: user.id,
      }));
    if (values.length === 0) return fail("No rows had a company name.");
    await db.insert(leads).values(values);
    created = values.length;
  }

  await logActivity({
    entityType: kind,
    entityId: user.id,
    verb: "imported",
    summary: `Imported ${created} ${kind === "customers" ? "customers" : "leads"} from a file`,
  });

  revalidatePath(`/${kind}`);
  return { ok: true, message: `Imported ${created} ${created === 1 ? "row" : "rows"}.`, created };
}
