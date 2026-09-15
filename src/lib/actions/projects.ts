"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { projectContacts, projectPhases, projectSteps, projects } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { findTemplate } from "@/lib/templates";
import { autoProvisionFolder } from "./files";
import { notifyTeams } from "@/lib/notify";
import { appUrl } from "@/lib/env";
import {
  fail,
  fromZod,
  logActivity,
  optionalDate,
  optionalEmail,
  optionalNumber,
  optionalText,
  optionalUuid,
  touchRecords,
  type ActionState,
} from "./shared";

const projectSchema = z.object({
  customerId: z.uuid("Pick the customer this is for."),
  name: z.string().trim().min(1, "Give the project a name."),
  code: optionalText,
  status: z.enum(["planning", "active", "on_hold", "complete", "cancelled"]),
  health: z.enum(["on_track", "at_risk", "off_track"]),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  summary: optionalText,
  headline: optionalText,
  headlineDetail: optionalText,
  ownerId: optionalUuid,
  startDate: optionalDate,
  targetDate: optionalDate,
  budgetAud: optionalNumber,
  stateBefore: optionalText,
  stateAfter: optionalText,
});

export async function createProject(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireUser();
  const parsed = projectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  const templateKey = String(formData.get("templateKey") ?? "blank");
  const template = findTemplate(templateKey);
  if (!template) return fail("That template is no longer available.");

  const db = getDb();
  const [project] = await db
    .insert(projects)
    .values({
      ...parsed.data,
      budgetAud: parsed.data.budgetAud?.toString() ?? null,
      ownerId: parsed.data.ownerId ?? user.id,
      templateKey: template.key,
      createdById: user.id,
    })
    .returning({ id: projects.id });

  // Phases first, then their steps — a step needs its phase id.
  for (const phase of template.phases) {
    const [created] = await db
      .insert(projectPhases)
      .values({
        projectId: project.id,
        num: phase.num,
        label: phase.label,
        description: phase.description,
        accent: phase.accent,
        position: phase.position,
      })
      .returning({ id: projectPhases.id });

    if (phase.steps.length === 0) continue;

    await db.insert(projectSteps).values(
      phase.steps.map((step) => ({
        projectId: project.id,
        phaseId: created.id,
        title: step.title,
        tag: step.tag,
        ownerLabel: step.ownerLabel,
        description: step.description,
        warning: step.warning,
        links: step.links,
        position: step.position,
      })),
    );
  }

  await logActivity({
    entityType: "project",
    entityId: project.id,
    projectId: project.id,
    customerId: parsed.data.customerId,
    verb: "created",
    summary: `Started ${parsed.data.name} from the ${template.name} template`,
  });

  // Best-effort: never throws, so a SharePoint problem cannot lose the record.
  // Must run before redirect(), which throws to unwind.
  await autoProvisionFolder({ projectId: project.id });

  revalidatePath("/projects");
  revalidatePath(`/customers/${parsed.data.customerId}`);
  redirect(`/projects/${project.id}`);
}

export async function updateProject(
  id: string,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = projectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  const db = getDb();
  const [before] = await db
    .select({ health: projects.health, name: projects.name })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  await db
    .update(projects)
    .set({
      ...parsed.data,
      budgetAud: parsed.data.budgetAud?.toString() ?? null,
      completedAt: parsed.data.status === "complete" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id));

  // Only on the way in — re-saving an already off-track project is not news.
  if (before && before.health !== parsed.data.health && parsed.data.health === "off_track") {
    await notifyTeams({
      title: `${before.name} is off track`,
      subtitle: parsed.data.headline ?? "Health was changed to Off Track.",
      tone: "attention",
      facts: [
        { title: "Project", value: before.name },
        { title: "Status", value: parsed.data.status },
        ...(parsed.data.targetDate ? [{ title: "Target", value: parsed.data.targetDate }] : []),
      ],
      url: `${appUrl()}/projects/${id}`,
      urlLabel: "Open the project",
    });
  }

  await logActivity({
    entityType: "project",
    entityId: id,
    projectId: id,
    customerId: parsed.data.customerId,
    verb: "updated",
    summary: "Updated project details",
  });

  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  return { ok: true, message: "Saved." };
}

/* ── steps ───────────────────────────────────────────────────────── */

const STEP_STATUSES = ["todo", "in_progress", "blocked", "done", "not_applicable"] as const;

export async function setStepStatus(
  stepId: string,
  status: string,
  projectId: string,
): Promise<ActionState> {
  const { user } = await requireUser();
  const parsed = z.enum(STEP_STATUSES).safeParse(status);
  if (!parsed.success) return fail("Unknown status.");

  const done = parsed.data === "done";
  await getDb()
    .update(projectSteps)
    .set({
      status: parsed.data,
      completedAt: done ? new Date() : null,
      completedById: done ? user.id : null,
      blockedSince: parsed.data === "blocked" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(projectSteps.id, stepId));

  await touchRecords({ projectId });
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

const stepDetailSchema = z.object({
  projectId: z.uuid(),
  notes: optionalText,
  assigneeId: optionalUuid,
  dueDate: optionalDate,
  blockedOn: optionalText,
});

export async function updateStepDetail(
  stepId: string,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = stepDetailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  const { projectId, ...values } = parsed.data;
  await getDb()
    .update(projectSteps)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(projectSteps.id, stepId));

  revalidatePath(`/projects/${projectId}`);
  return { ok: true, message: "Saved." };
}

const newStepSchema = z.object({
  projectId: z.uuid(),
  phaseId: z.uuid(),
  title: z.string().trim().min(1, "The step needs a title."),
  tag: optionalText,
  ownerLabel: optionalText,
  description: optionalText,
});

export async function addStep(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = newStepSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  const db = getDb();
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${projectSteps.position}), -1) + 1` })
    .from(projectSteps)
    .where(eq(projectSteps.phaseId, parsed.data.phaseId));

  await db.insert(projectSteps).values({ ...parsed.data, position: next });

  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true, message: "Step added." };
}

export async function deleteStep(stepId: string, projectId: string): Promise<void> {
  await requireUser();
  await getDb().delete(projectSteps).where(eq(projectSteps.id, stepId));
  revalidatePath(`/projects/${projectId}`);
}

const phaseSchema = z.object({
  projectId: z.uuid(),
  num: z.string().trim().min(1, "Number the phase."),
  label: z.string().trim().min(1, "Name the phase."),
  description: optionalText,
});

export async function addPhase(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = phaseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  const db = getDb();
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${projectPhases.position}), -1) + 1` })
    .from(projectPhases)
    .where(eq(projectPhases.projectId, parsed.data.projectId));

  await db.insert(projectPhases).values({ ...parsed.data, position: next });
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true, message: "Phase added." };
}

/* ── key contacts ────────────────────────────────────────────────── */

const keyContactSchema = z.object({
  projectId: z.uuid(),
  contactId: optionalUuid,
  name: z.string().trim().min(1, "Who is it?"),
  organisation: optionalText,
  role: optionalText,
  email: optionalEmail,
  phone: optionalText,
  needed: optionalText,
  bestContactMethod: optionalText,
  isBlocker: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});

export async function saveKeyContact(
  id: string | null,
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = keyContactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  const db = getDb();
  if (id) {
    await db.update(projectContacts).set(parsed.data).where(eq(projectContacts.id, id));
  } else {
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(${projectContacts.position}), -1) + 1` })
      .from(projectContacts)
      .where(eq(projectContacts.projectId, parsed.data.projectId));
    await db.insert(projectContacts).values({ ...parsed.data, position: next });
  }

  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true, message: "Saved." };
}

export async function deleteKeyContact(id: string, projectId: string): Promise<void> {
  await requireUser();
  await getDb()
    .delete(projectContacts)
    .where(and(eq(projectContacts.id, id), eq(projectContacts.projectId, projectId)));
  revalidatePath(`/projects/${projectId}`);
}
