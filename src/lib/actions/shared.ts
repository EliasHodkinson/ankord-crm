import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activity, customers, leads, projects } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";

/** The shape every server action returns, so forms can render errors uniformly. */
export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

export const OK: ActionState = { ok: true };

export function fail(message: string, fieldErrors?: Record<string, string[]>): ActionState {
  return { ok: false, message, fieldErrors };
}

export function fromZod(error: z.ZodError): ActionState {
  const flat = z.flattenError(error);
  const fieldErrors = flat.fieldErrors as Record<string, string[]>;
  const first = Object.values(fieldErrors).flat()[0];
  return {
    ok: false,
    message: first ?? "Some fields need attention.",
    fieldErrors,
  };
}

/**
 * Normalises "nothing was supplied" to null. That covers an empty input and a
 * field that was not in the form at all — a section that had not been expanded,
 * a control hidden behind a toggle. Without the second case an optional field
 * fails validation the moment it is conditionally rendered.
 */
export const emptyToNull = (value: unknown) =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "")
    ? null
    : value;

export const optionalText = z.preprocess(emptyToNull, z.string().trim().nullable());
export const optionalEmail = z.preprocess(
  emptyToNull,
  z.email("That doesn't look like an email address.").nullable(),
);
export const optionalUrl = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
    .pipe(z.url("That doesn't look like a web address."))
    .nullable(),
);
export const optionalDate = z.preprocess(emptyToNull, z.iso.date().nullable());
export const optionalUuid = z.preprocess(emptyToNull, z.uuid().nullable());
export const optionalNumber = z.preprocess(
  emptyToNull,
  z.coerce.number().nonnegative().nullable(),
);

/** Comma-separated tag input → clean array. */
export const tagList = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : (v ?? []),
  z.array(z.string()).default([]),
);

export async function logActivity(entry: {
  entityType: string;
  entityId: string;
  verb: string;
  summary: string;
  customerId?: string | null;
  projectId?: string | null;
  leadId?: string | null;
  meta?: Record<string, unknown>;
}) {
  const { user } = await requireUser();
  await getDb()
    .insert(activity)
    .values({ ...entry, actorId: user.id });
}

/**
 * Records that a record was genuinely worked on — a call logged, an email
 * linked, a step completed. Editing a field is not activity; talking to
 * someone is. This is what "going cold" is measured against.
 */
export async function touchRecords(scope: {
  customerId?: string | null;
  projectId?: string | null;
  leadId?: string | null;
  at?: Date;
}) {
  const db = getDb();
  const at = scope.at ?? new Date();

  await Promise.all([
    scope.customerId
      ? db
          .update(customers)
          .set({ lastActivityAt: at })
          .where(eq(customers.id, scope.customerId))
      : null,
    scope.projectId
      ? db.update(projects).set({ lastActivityAt: at }).where(eq(projects.id, scope.projectId))
      : null,
    scope.leadId
      ? db.update(leads).set({ lastActivityAt: at }).where(eq(leads.id, scope.leadId))
      : null,
  ]);
}
