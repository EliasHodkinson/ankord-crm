import "server-only";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/server";
import { getDb } from "@/lib/db";
import { contacts, projects } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { assertContact, assertProject } from "@/lib/access";
import { createContact, updateContact } from "@/lib/actions/contacts";
import { createProject, updateProject } from "@/lib/actions/projects";
import { provisionFolder } from "@/lib/actions/files";
import { TEMPLATES, templateSize } from "@/lib/templates";
import { expectOk, read, settle, write, ToolFailure } from "../run";
import { form } from "./updates";

/**
 * Creating and editing contacts and projects, through the same actions as
 * the New contact and New project forms. A restricted person can do both for
 * the business partners granted to them, exactly as on the web — the actions
 * assert the partner (and, for an edit, the record as it is).
 */

const LOCAL = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const REACHES_MICROSOFT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key) as [string, ...string[]];
const PROJECT_STATUSES = ["planning", "active", "on_hold", "complete", "cancelled"] as const;
const HEALTH = ["on_track", "at_risk", "off_track"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

/** The contact form's fields. Null clears one on update. */
const contactFields = {
  lastName: z.string().max(100).nullable().optional(),
  jobTitle: z.string().max(200).nullable().optional().describe("Their title or role"),
  email: z.email().nullable().optional(),
  phone: z.string().max(60).nullable().optional(),
  mobile: z.string().max(60).nullable().optional(),
  linkedin: z.string().max(300).nullable().optional(),
  isPrimary: z.boolean().optional().describe("The main contact at this partner (only one can be)"),
  isDecisionMaker: z.boolean().optional(),
  coffeeOrder: z.string().max(200).nullable().optional(),
  birthday: z.iso.date().nullable().optional(),
  dietary: z.string().max(200).nullable().optional(),
  pronouns: z.string().max(60).nullable().optional(),
  preferredContact: z.string().max(200).nullable().optional().describe("How they like to be reached"),
  notes: z.string().max(8000).nullable().optional(),
};

/** The project form's fields. Null clears one on update. */
const projectFields = {
  code: z.string().max(60).nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  health: z.enum(HEALTH).optional(),
  priority: z.enum(PRIORITIES).optional(),
  summary: z.string().max(8000).nullable().optional(),
  headline: z.string().max(300).nullable().optional().describe("The one line that says where it stands"),
  headlineDetail: z.string().max(4000).nullable().optional(),
  ownerId: z.uuid().nullable().optional().describe("From list_team; defaults to you"),
  startDate: z.iso.date().nullable().optional(),
  targetDate: z.iso.date().nullable().optional(),
  budgetAud: z.number().nonnegative().nullable().optional(),
  stateBefore: z.string().max(8000).nullable().optional(),
  stateAfter: z.string().max(8000).nullable().optional(),
};

const templateList = TEMPLATES.map((t) => {
  const size = templateSize(t);
  return `${t.key} (${t.name}: ${size.phases} phases, ${size.steps} steps)`;
}).join("; ");

export function registerRecordWriteTools(server: McpServer) {
  /* ── contacts ──────────────────────────────────────────────────── */

  server.registerTool(
    "create_contact",
    {
      title: "Create a contact",
      description:
        "Add a person at a business partner: name, title/role, email, phone, mobile, LinkedIn, whether they are the primary contact or a decision-maker, and the human details the contact form keeps (coffee order, birthday, dietary, pronouns, how they like to be reached, notes). For a dated or one-off detail about an existing contact, use add_contact_detail instead.",
      inputSchema: z.object({
        businessPartnerId: z.uuid(),
        firstName: z.string().min(1).max(100),
        ...contactFields,
      }),
      annotations: LOCAL,
    },
    ({ businessPartnerId, ...fields }) =>
      write("create_contact", async () => {
        const { user } = await requireUser();
        expectOk(await createContact(undefined, form({ ...fields, customerId: businessPartnerId })));
        const [row] = await getDb()
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.customerId, businessPartnerId), eq(contacts.createdById, user.id)))
          .orderBy(desc(contacts.createdAt))
          .limit(1);
        return { result: { message: "Contact added.", id: row?.id }, audit: null };
      }),
  );

  server.registerTool(
    "update_contact",
    {
      title: "Update a contact",
      description:
        "Change a contact's details. Only the fields given change; pass null to clear one. Get contact ids from list_contacts or get_business_partner.",
      inputSchema: z.object({
        contactId: z.uuid(),
        firstName: z.string().min(1).max(100).optional(),
        ...contactFields,
      }),
      annotations: LOCAL,
    },
    ({ contactId, ...patch }) =>
      write("update_contact", async () => {
        await assertContact(contactId);
        const [contact] = await getDb().select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
        if (!contact) throw new ToolFailure("That contact no longer exists.");
        const merged: Record<string, string | boolean | null> = {
          customerId: contact.customerId,
          firstName: contact.firstName,
          lastName: contact.lastName,
          jobTitle: contact.jobTitle,
          email: contact.email,
          phone: contact.phone,
          mobile: contact.mobile,
          linkedin: contact.linkedin,
          isPrimary: contact.isPrimary,
          isDecisionMaker: contact.isDecisionMaker,
          coffeeOrder: contact.coffeeOrder,
          birthday: contact.birthday,
          dietary: contact.dietary,
          pronouns: contact.pronouns,
          preferredContact: contact.preferredContact,
          // Not editable here, but carried so an update never clears it.
          marketingConsent: contact.marketingConsent,
          notes: contact.notes,
        };
        for (const [key, value] of Object.entries(patch)) {
          if (value !== undefined) merged[key] = value;
        }
        expectOk(await updateContact(contactId, undefined, form(merged)));
        return { result: "Contact updated.", audit: null };
      }),
  );

  /* ── projects ──────────────────────────────────────────────────── */

  server.registerTool(
    "list_project_templates",
    {
      title: "List project templates",
      description: "The runbook templates a new project can start from, with their phases and step titles.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    () =>
      read(async () => {
        await requireUser();
        return TEMPLATES.map((t) => ({
          key: t.key,
          name: t.name,
          description: t.description,
          phases: t.phases.map((p) => ({ num: p.num, label: p.label, steps: p.steps.map((s) => s.title) })),
        }));
      }),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create a project",
      description: `Start a delivery project for a business partner, with its runbook copied from a template: ${templateList}. Owned by you unless ownerId is given. REACHES SHAREPOINT: if automatic folders are on in Settings, the project's folder is created under the partner's; createSharePointFolder: true creates it even when they are off. Use update_step and add_step to work the runbook afterwards.`,
      inputSchema: z.object({
        businessPartnerId: z.uuid(),
        name: z.string().min(1).max(200),
        template: z.enum(TEMPLATE_KEYS).default("blank"),
        createSharePointFolder: z.boolean().default(false),
        ...projectFields,
      }),
      annotations: REACHES_MICROSOFT,
    },
    ({ businessPartnerId, template, createSharePointFolder, ...fields }) =>
      write("create_project", async () => {
        const state = expectOk(
          await settle(() =>
            createProject(
              undefined,
              form({
                ...fields,
                status: fields.status ?? "planning",
                health: fields.health ?? "on_track",
                priority: fields.priority ?? "normal",
                customerId: businessPartnerId,
                templateKey: template,
              }),
            ),
          ),
        );
        const id = state.data?.href?.split("/").pop();
        let folder: string | undefined;
        if (id) {
          const [row] = await getDb().select({ spWebUrl: projects.spWebUrl }).from(projects).where(eq(projects.id, id));
          folder = row?.spWebUrl ?? undefined;
          if (!folder && createSharePointFolder) {
            const made = await provisionFolder({ projectId: id });
            if (!made.ok) folder = `Not created: ${made.message}`;
            else {
              const [after] = await getDb().select({ spWebUrl: projects.spWebUrl }).from(projects).where(eq(projects.id, id));
              folder = after?.spWebUrl ?? undefined;
            }
          }
        }
        return { result: { message: "Project created.", id, href: state.data?.href, sharePointFolder: folder ?? null }, audit: null };
      }),
  );

  server.registerTool(
    "update_project",
    {
      title: "Update a project",
      description:
        "Change a project's name, code, status, health, priority, owner, dates, budget, headline and summary. Only the fields given change; pass null to clear one. A linked Microsoft Planner plan is renamed to match. Moving to off_track health announces it in Teams.",
      inputSchema: z.object({
        projectId: z.uuid(),
        name: z.string().min(1).max(200).optional(),
        ...projectFields,
      }),
      annotations: REACHES_MICROSOFT,
    },
    ({ projectId, ...patch }) =>
      write("update_project", async () => {
        await assertProject(projectId);
        const [project] = await getDb().select().from(projects).where(eq(projects.id, projectId)).limit(1);
        if (!project) throw new ToolFailure("That project no longer exists.");
        const merged: Record<string, string | number | null> = {
          customerId: project.customerId,
          name: project.name,
          code: project.code,
          status: project.status,
          health: project.health,
          priority: project.priority,
          summary: project.summary,
          headline: project.headline,
          headlineDetail: project.headlineDetail,
          ownerId: project.ownerId,
          startDate: project.startDate,
          targetDate: project.targetDate,
          budgetAud: project.budgetAud,
          stateBefore: project.stateBefore,
          stateAfter: project.stateAfter,
        };
        for (const [key, value] of Object.entries(patch)) {
          if (value !== undefined) merged[key] = value;
        }
        expectOk(await updateProject(projectId, undefined, form(merged)));
        return { result: "Project updated.", audit: null };
      }),
  );
}
