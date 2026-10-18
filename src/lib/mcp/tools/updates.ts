import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/server";
import { getDb } from "@/lib/db";
import { projectSteps, tasks } from "@/lib/db/schema";
import { assertStep, assertTask } from "@/lib/access";
import { getLeadRecord } from "@/lib/data/lists";
import { logCommunication } from "@/lib/actions/communications";
import { createTask, setTaskStatus, updateTask } from "@/lib/actions/tasks";
import {
  addChecklistItem,
  addStep,
  clearStepBlocker,
  setStepStatus,
  toggleChecklistItem,
  updateStepDetail,
} from "@/lib/actions/projects";
import { createLead, setLeadStage, updateLead } from "@/lib/actions/leads";
import { addContactFact } from "@/lib/actions/contacts";
import { assertContact } from "@/lib/access";
import { toWallTime } from "@/lib/utils";
import { expectOk, settle, write, ToolFailure } from "../run";

/** Writes that stay inside The Gangway. Each goes through the same server action as the page. */
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const LEAD_STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

/** Sydney wall time as the forms send it ("2026-10-18T17:00"), or an ISO time with an offset. */
const sydneyDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
    "Use YYYY-MM-DDTHH:mm (Sydney time), or an ISO time with an offset.",
  );

/** FormData the way a page's form would send it: absent means not supplied. */
export function form(values: Record<string, string | number | boolean | null | undefined | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const v of value) data.append(key, v);
    else data.set(key, typeof value === "boolean" ? (value ? "on" : "") : String(value));
  }
  return data;
}

const links = {
  businessPartnerId: z.uuid().optional().describe("The business partner (customer/supplier) it concerns"),
  contactId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  leadId: z.uuid().optional(),
};

export function registerUpdateTools(server: McpServer) {
  /* ── conversations ─────────────────────────────────────────────── */

  server.registerTool(
    "log_communication",
    {
      title: "Log a communication",
      description:
        "Record a call, meeting, email, Teams conversation or note against a business partner, contact, project and/or lead, and optionally set a follow-up for yourself. This is what counts as activity: it resets 'going cold'. occurredAt is Sydney wall time (YYYY-MM-DDTHH:mm); omit it for now.",
      inputSchema: z.object({
        type: z.enum(["call", "meeting", "email", "teams", "note"]),
        direction: z.enum(["inbound", "outbound", "internal"]).default("outbound"),
        subject: z.string().max(300).optional(),
        body: z.string().min(1).describe("What was said or agreed — the part worth remembering"),
        occurredAt: sydneyDateTime.optional(),
        visibility: z.enum(["team", "private"]).default("team"),
        followUpTitle: z.string().max(300).optional(),
        followUpDate: z.iso.date().optional(),
        ...links,
      }),
      annotations: WRITE,
    },
    (args) =>
      write("log_communication", async () => {
        requireLink(args);
        const state = expectOk(
          await logCommunication(
            undefined,
            form({
              type: args.type,
              direction: args.direction,
              visibility: args.visibility,
              subject: args.subject,
              body: args.body,
              occurredAt: args.occurredAt ?? toWallTime(),
              followUpTitle: args.followUpTitle,
              followUpDate: args.followUpDate,
              customerId: args.businessPartnerId,
              contactId: args.contactId,
              projectId: args.projectId,
              leadId: args.leadId,
            }),
          ),
        );
        return { result: state.message, audit: null };
      }),
  );

  server.registerTool(
    "add_note",
    {
      title: "Add a note",
      description:
        "Add an internal note to the timeline of a business partner, contact, project or lead — something the team should know that wasn't a conversation with them.",
      inputSchema: z.object({
        body: z.string().min(1),
        subject: z.string().max(300).optional(),
        visibility: z.enum(["team", "private"]).default("team"),
        ...links,
      }),
      annotations: WRITE,
    },
    (args) =>
      write("add_note", async () => {
        requireLink(args);
        const state = expectOk(
          await logCommunication(
            undefined,
            form({
              type: "note",
              direction: "internal",
              visibility: args.visibility,
              subject: args.subject,
              body: args.body,
              occurredAt: toWallTime(),
              customerId: args.businessPartnerId,
              contactId: args.contactId,
              projectId: args.projectId,
              leadId: args.leadId,
            }),
          ),
        );
        return { result: state.message, audit: null };
      }),
  );

  server.registerTool(
    "add_contact_detail",
    {
      title: "Remember something about a contact",
      description:
        "Keep a dated or one-off detail about an existing contact — a preference, something personal, an upcoming event (with a date, optionally yearly and with a reminder), or something they mentioned. These sit in a list under the contact. To add a new person use create_contact; to change their name, role, email, phone, coffee order, birthday and the like use update_contact.",
      inputSchema: z.object({
        contactId: z.uuid(),
        kind: z.enum(["preference", "personal", "event", "mention"]),
        label: z.string().min(1).max(200),
        detail: z.string().max(2000).optional(),
        onDate: z.iso.date().optional(),
        recurring: z.boolean().default(false),
        remindDaysBefore: z.number().int().min(0).max(365).optional(),
      }),
      annotations: WRITE,
    },
    (args) =>
      write("add_contact_detail", async () => {
        const customerId = await assertContact(args.contactId);
        const state = expectOk(
          await addContactFact(
            undefined,
            form({ ...args, customerId, recurring: args.recurring }),
          ),
        );
        return {
          result: state.message,
          audit: {
            entityType: "contact",
            entityId: args.contactId,
            customerId,
            summary: `Noted about a contact: ${args.label}`,
          },
        };
      }),
  );

  /* ── follow-ups ────────────────────────────────────────────────── */

  server.registerTool(
    "create_task",
    {
      title: "Create a task",
      description:
        "Set a follow-up, optionally against a business partner, contact, project or lead. Unassigned means yours. Assigning someone else notifies them in Teams.",
      inputSchema: z.object({
        title: z.string().min(1).max(300),
        detail: z.string().max(4000).optional(),
        priority: z.enum(PRIORITIES).default("normal"),
        dueDate: z.iso.date().optional(),
        assigneeId: z.uuid().optional(),
        ...links,
      }),
      annotations: WRITE,
    },
    (args) =>
      write("create_task", async () => {
        const state = expectOk(
          await createTask(
            undefined,
            form({
              title: args.title,
              detail: args.detail,
              priority: args.priority,
              dueDate: args.dueDate,
              assigneeId: args.assigneeId,
              customerId: args.businessPartnerId,
              contactId: args.contactId,
              projectId: args.projectId,
              leadId: args.leadId,
            }),
          ),
        );
        return { result: state.message, audit: null };
      }),
  );

  server.registerTool(
    "update_task",
    {
      title: "Update a task",
      description:
        "Change a follow-up's title, detail, priority or due date, or mark it done / reopen it. Only the fields given change. Pass dueDate null to clear it.",
      inputSchema: z.object({
        id: z.uuid(),
        title: z.string().min(1).max(300).optional(),
        detail: z.string().max(4000).nullable().optional(),
        priority: z.enum(PRIORITIES).optional(),
        dueDate: z.iso.date().nullable().optional(),
        done: z.boolean().optional(),
      }),
      annotations: WRITE,
    },
    (args) =>
      write("update_task", async () => {
        await assertTask(args.id);
        const [task] = await getDb().select().from(tasks).where(eq(tasks.id, args.id)).limit(1);
        if (!task) throw new ToolFailure("That task no longer exists.");
        const edits = args.title !== undefined || args.detail !== undefined || args.priority || args.dueDate !== undefined;
        if (edits) {
          expectOk(
            await updateTask(args.id, {
              title: args.title ?? task.title,
              detail: args.detail === undefined ? task.detail : args.detail,
              priority: args.priority ?? task.priority,
              dueDate: args.dueDate === undefined ? task.dueDate : args.dueDate,
            }),
          );
        }
        if (args.done !== undefined) expectOk(await setTaskStatus(args.id, args.done));
        return {
          result: args.done === true ? "Marked done." : args.done === false ? "Reopened." : "Task updated.",
          audit: {
            entityType: "task",
            entityId: task.id,
            customerId: task.customerId,
            projectId: task.projectId,
            leadId: task.leadId,
            summary:
              args.done === true
                ? `Completed follow-up: ${task.title}`
                : `Updated follow-up: ${args.title ?? task.title}`,
          },
        };
      }),
  );

  /* ── runbook steps ─────────────────────────────────────────────── */

  server.registerTool(
    "update_step",
    {
      title: "Update a runbook step",
      description:
        "Change a project step: its status (todo, in_progress, blocked, done, not_applicable), what it is blocked on, its assignee, due date, tag, warning or working notes, and tick checklist items. Only the fields given change; pass null to clear one. Get step ids from get_project. Linked Planner plans are updated too.",
      inputSchema: z.object({
        stepId: z.uuid(),
        status: z.enum(["todo", "in_progress", "blocked", "done", "not_applicable"]).optional(),
        blockedOn: z.string().max(500).nullable().optional().describe("Who or what the step is waiting on"),
        notes: z.string().max(8000).nullable().optional(),
        assigneeId: z.uuid().nullable().optional(),
        dueDate: z.iso.date().nullable().optional(),
        tag: z.string().max(60).nullable().optional(),
        warning: z.string().max(1000).nullable().optional(),
        checklist: z
          .array(z.object({ itemId: z.string(), done: z.boolean() }))
          .optional()
          .describe("Tick or untick existing checklist items by id"),
        addChecklistItems: z.array(z.string().min(1).max(100)).max(20).optional(),
      }),
      annotations: WRITE,
    },
    (args) =>
      write("update_step", async () => {
        const projectId = await assertStep(args.stepId);
        const [step] = await getDb().select().from(projectSteps).where(eq(projectSteps.id, args.stepId)).limit(1);
        if (!step) throw new ToolFailure("That step no longer exists.");
        const changes: string[] = [];

        const pick = <K extends "notes" | "assigneeId" | "dueDate" | "blockedOn" | "tag" | "warning">(key: K) =>
          args[key] === undefined ? step[key] : args[key];
        const detailKeys = ["notes", "assigneeId", "dueDate", "blockedOn", "tag", "warning"] as const;
        if (detailKeys.some((k) => args[k] !== undefined)) {
          expectOk(
            await updateStepDetail(
              args.stepId,
              undefined,
              form({
                projectId,
                notes: pick("notes"),
                assigneeId: pick("assigneeId"),
                dueDate: pick("dueDate"),
                blockedOn: pick("blockedOn"),
                tag: pick("tag"),
                warning: pick("warning"),
              }),
            ),
          );
          changes.push(...detailKeys.filter((k) => args[k] !== undefined));
        }
        // After the details, so a "blocked" status keeps the blockedOn just set.
        if (args.status && args.status !== step.status) {
          expectOk(await setStepStatus(args.stepId, args.status, projectId));
          changes.push(`status → ${args.status}`);
        }
        for (const item of args.checklist ?? []) {
          expectOk(await toggleChecklistItem(args.stepId, projectId, item.itemId, item.done));
        }
        if (args.checklist?.length) changes.push("checklist");
        for (const title of args.addChecklistItems ?? []) {
          expectOk(await addChecklistItem(args.stepId, projectId, title));
        }
        if (args.addChecklistItems?.length) changes.push("checklist items added");
        if (!changes.length) return { result: "Nothing to change.", audit: null };

        return {
          result: `Updated "${step.title}": ${changes.join(", ")}.`,
          audit: {
            entityType: "step",
            entityId: step.id,
            projectId,
            summary: `Updated step "${step.title}" (${changes.join(", ")})`,
          },
        };
      }),
  );

  server.registerTool(
    "clear_step_blocker",
    {
      title: "Clear a step's blocker",
      description:
        "Unblock a runbook step: a Blocked status goes back to In progress, a BLOCKER tag is dropped and 'waiting on' is emptied. Other tags, the warning and notes are kept.",
      inputSchema: z.object({ stepId: z.uuid() }),
      annotations: WRITE,
    },
    ({ stepId }) =>
      write("clear_step_blocker", async () => {
        const projectId = await assertStep(stepId);
        const [step] = await getDb().select({ title: projectSteps.title }).from(projectSteps).where(eq(projectSteps.id, stepId));
        expectOk(await clearStepBlocker(stepId));
        return {
          result: "Blocker cleared.",
          audit: { entityType: "step", entityId: stepId, projectId, summary: `Cleared the blocker on "${step?.title}"` },
        };
      }),
  );

  server.registerTool(
    "add_step",
    {
      title: "Add a runbook step",
      description: "Add a step to the end of a project phase. Get phase ids from get_project.",
      inputSchema: z.object({
        projectId: z.uuid(),
        phaseId: z.uuid(),
        title: z.string().min(1).max(300),
        description: z.string().max(4000).optional(),
        tag: z.string().max(60).optional(),
        ownerLabel: z.string().max(60).optional().describe("Who owns it, as a label (e.g. 'Ankor'd', 'Client')"),
      }),
      annotations: WRITE,
    },
    (args) =>
      write("add_step", async () => {
        const state = expectOk(await addStep(undefined, form(args)));
        return {
          result: state.message,
          audit: { entityType: "project", entityId: args.projectId, projectId: args.projectId, summary: `Added step "${args.title}"` },
        };
      }),
  );

  /* ── leads (staff only) ────────────────────────────────────────── */

  server.registerTool(
    "set_lead_stage",
    {
      title: "Move a lead to a stage",
      description:
        "Move a lead through the pipeline: new, contacted, qualified, proposal, negotiation, won, lost (staff only). Reaching proposal is announced to the team in Teams.",
      inputSchema: z.object({ leadId: z.uuid(), stage: z.enum(LEAD_STAGES) }),
      annotations: WRITE,
    },
    ({ leadId, stage }) =>
      write("set_lead_stage", async () => {
        if (!(await getLeadRecord(leadId))) throw new ToolFailure("That lead doesn't exist.");
        expectOk(await setLeadStage(leadId, stage));
        return { result: `Moved to ${stage}.`, audit: null };
      }),
  );

  const leadFields = {
    contactName: z.string().max(200).nullable().optional(),
    jobTitle: z.string().max(200).nullable().optional(),
    email: z.email().nullable().optional(),
    phone: z.string().max(60).nullable().optional(),
    website: z.string().max(300).nullable().optional(),
    suburb: z.string().max(100).nullable().optional(),
    state: z.string().max(20).nullable().optional(),
    source: z.string().max(200).nullable().optional(),
    interest: z.string().max(500).nullable().optional(),
    valueAud: z.number().nonnegative().nullable().optional(),
    probability: z.number().int().min(0).max(100).nullable().optional(),
    expectedCloseDate: z.iso.date().nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    nextAction: z.string().max(500).nullable().optional(),
    nextActionAt: z.iso.date().nullable().optional(),
    lostReason: z.string().max(500).nullable().optional(),
    tags: z.array(z.string().max(60)).optional(),
    notes: z.string().max(8000).nullable().optional(),
  };

  server.registerTool(
    "create_lead",
    {
      title: "Create a lead",
      description: "Add a new sales lead (staff only). It is owned by you unless ownerId is given.",
      inputSchema: z.object({
        companyName: z.string().min(1).max(200),
        stage: z.enum(LEAD_STAGES).default("new"),
        ...leadFields,
      }),
      annotations: WRITE,
    },
    (args) =>
      write("create_lead", async () => {
        const state = expectOk(
          await settle(() => createLead(undefined, form({ ...args, tags: args.tags?.join(", ") }))),
        );
        return { result: { created: true, href: state.data?.href }, audit: null };
      }),
  );

  server.registerTool(
    "update_lead",
    {
      title: "Update a lead",
      description:
        "Change a lead's details — value, probability, expected close, next action and date, owner, notes and so on (staff only). Only the fields given change; pass null to clear one. Use set_lead_stage to move its stage.",
      inputSchema: z.object({
        leadId: z.uuid(),
        companyName: z.string().min(1).max(200).optional(),
        ...leadFields,
      }),
      annotations: WRITE,
    },
    ({ leadId, ...patch }) =>
      write("update_lead", async () => {
        const lead = await getLeadRecord(leadId);
        if (!lead) throw new ToolFailure("That lead doesn't exist.");
        const merged = {
          companyName: lead.companyName,
          contactName: lead.contactName,
          jobTitle: lead.jobTitle,
          email: lead.email,
          phone: lead.phone,
          website: lead.website,
          suburb: lead.suburb,
          state: lead.state,
          stage: lead.stage,
          source: lead.source,
          interest: lead.interest,
          valueAud: lead.valueAud,
          probability: lead.probability,
          expectedCloseDate: lead.expectedCloseDate,
          ownerId: lead.ownerId,
          nextAction: lead.nextAction,
          nextActionAt: lead.nextActionAt,
          lostReason: lead.lostReason,
          tags: lead.tags.join(", "),
          notes: lead.notes,
        } as Record<string, string | number | null>;
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) continue;
          merged[key] = Array.isArray(value) ? value.join(", ") : value;
        }
        expectOk(await updateLead(leadId, undefined, form(merged)));
        return { result: "Lead updated.", audit: null };
      }),
  );
}

function requireLink(args: { businessPartnerId?: string; contactId?: string; projectId?: string; leadId?: string }) {
  if (!args.businessPartnerId && !args.contactId && !args.projectId && !args.leadId) {
    throw new ToolFailure("Say what it is about: a business partner, contact, project or lead.");
  }
}
