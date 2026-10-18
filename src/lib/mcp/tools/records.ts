import "server-only";
import { z } from "zod";
import { and, ilike, or } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/server";
import { getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { documentScope, getAccess } from "@/lib/access";
import { requireUser } from "@/lib/auth/session";
import { getCustomer } from "@/lib/data/customers";
import { getProject, progressOf } from "@/lib/data/projects";
import { listTasks } from "@/lib/data/tasks";
import { listCommunications } from "@/lib/data/communications";
import { listTeam } from "@/lib/data/common";
import { searchEverything } from "@/lib/data/search";
import {
  getLeadRecord,
  listContactRows,
  listCustomerRows,
  listLeadRows,
  listProjectRows,
} from "@/lib/data/lists";
import {
  documentPayments,
  documentsForPartner,
  documentsForProject,
  getDocument,
  listDocuments,
  relatedDocuments,
} from "@/lib/data/documents";
import { listItems } from "@/lib/data/items";
import { shipmentsFor, trackingForSales } from "@/lib/data/stock";
import { DOC_TYPES, type DocType } from "@/lib/sales/doc-types";
import { appUrl } from "@/lib/env";
import { read, sydneyTime } from "../run";
import { campaignReport, getCampaign, listCampaigns } from "@/lib/data/campaigns";
import { percent } from "@/lib/campaigns/model";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const DOC_TYPE_KEYS = Object.keys(DOC_TYPES) as [DocType, ...DocType[]];

const link = (path: string) => `${appUrl()}${path}`;

/** A document by id, or by number (QU-0042, SO-0007, INV-0028, PO-0011…) among those visible. */
export async function findDocumentId(ref: string): Promise<string | null> {
  if (z.uuid().safeParse(ref).success) return ref;
  const access = await getAccess();
  const [row] = await getDb()
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        or(ilike(documents.number, ref.trim()), ilike(documents.supplierInvoiceNumber, ref.trim())),
        documentScope(access),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export function registerRecordTools(server: McpServer) {
  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "The person this connection acts as: name, email and role in The Gangway. Restricted people see only the business partners granted to them, and only the sections of The Gangway switched on for them; viewers read but do not write sales documents.",
      inputSchema: z.object({}),
      annotations: READ,
    },
    () =>
      read(async () => {
        const { user } = await requireUser();
        const access = await getAccess();
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          grantedBusinessPartners: access.restricted ? access.customerIds.length : "all",
          sections: access.restricted ? access.sections : "all",
          appUrl: appUrl(),
          timeZone: "Australia/Sydney",
        };
      }),
  );

  server.registerTool(
    "search",
    {
      title: "Search The Gangway",
      description:
        "Search business partners (clients, suppliers, media), contacts, leads, projects and sales/purchasing documents by name, email, project code, document number or reference. With partnerType, only partners of that type and the people at them. Start here to find the id of a record.",
      inputSchema: z.object({
        query: z.string().min(2).describe("At least two characters"),
        perKind: z.number().int().min(1).max(25).default(8).describe("Results per kind of record"),
        partnerType: z
          .enum(["client", "supplier", "media"])
          .optional()
          .describe("Only business partners of this type, and their contacts"),
      }),
      annotations: READ,
    },
    ({ query, perKind, partnerType }) =>
      read(async () => {
        const hits = await searchEverything(query.trim(), perKind, { partnerType });
        return hits.map((h) => ({ ...h, url: link(h.href), href: undefined }));
      }),
  );

  server.registerTool(
    "list_team",
    {
      title: "List the team",
      description: "Active people in The Gangway, with their ids — for assigning tasks, steps and owners.",
      inputSchema: z.object({}),
      annotations: READ,
    },
    () =>
      read(async () => {
        await requireUser();
        return (await listTeam()).map(({ id, name, email, role, jobTitle }) => ({ id, name, email, role, jobTitle }));
      }),
  );

  /* ── business partners and people ──────────────────────────────── */

  server.registerTool(
    "list_business_partners",
    {
      title: "List business partners",
      description:
        "Business partners (clients, suppliers, media) you can see, filtered by name/suburb, status or kind. One partner can be several kinds. Archived ones are left out unless asked for.",
      inputSchema: z.object({
        query: z.string().optional(),
        status: z.enum(["prospect", "active", "on_hold", "former"]).optional(),
        kind: z
          .enum(["client", "customer", "supplier", "media"])
          .optional()
          .describe('"client" and "customer" mean the same: someone Ankor\'d invoices'),
        includeArchived: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: READ,
    },
    (args) => read(() => listCustomerRows({ ...args, q: args.query })),
  );

  server.registerTool(
    "get_business_partner",
    {
      title: "Get a business partner",
      description:
        "One business partner in full: details, contacts (with the personal details the team keeps), projects, account register (where credentials live — never the credentials), recent communications, open tasks and recent documents.",
      inputSchema: z.object({ id: z.uuid() }),
      annotations: READ,
    },
    ({ id }) =>
      read(async () => {
        const customer = await getCustomer(id);
        if (!customer) return null;
        const [communications, tasks, docs] = await Promise.all([
          listCommunications({ customerId: id, limit: 15 }),
          listTasks({ customerId: id, assigneeId: "everyone", limit: 50 }),
          documentsForPartner(id),
        ]);
        return {
          ...customer,
          url: link(`/customers/${id}`),
          recentCommunications: communications.map(timelineRow),
          openTasks: tasks.map(taskRow),
          recentDocuments: docs,
        };
      }),
  );

  server.registerTool(
    "list_contacts",
    {
      title: "List contacts",
      description: "People at business partners, by name, email or job title, optionally for one partner.",
      inputSchema: z.object({
        query: z.string().optional(),
        businessPartnerId: z.uuid().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: READ,
    },
    ({ query, businessPartnerId, limit }) =>
      read(() => listContactRows({ q: query, customerId: businessPartnerId, limit })),
  );

  /* ── leads (staff only) ─────────────────────────────────────────── */

  server.registerTool(
    "list_leads",
    {
      title: "List leads",
      description:
        "Sales leads in the pipeline (staff only). Stages: new, contacted, qualified, proposal, negotiation, won, lost.",
      inputSchema: z.object({
        query: z.string().optional(),
        stages: z.array(z.enum(["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"])).optional(),
        ownerId: z.uuid().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: READ,
    },
    (args) => read(() => listLeadRows({ ...args, q: args.query })),
  );

  server.registerTool(
    "get_lead",
    {
      title: "Get a lead",
      description: "One lead in full, with its recent communications and open tasks (staff only).",
      inputSchema: z.object({ id: z.uuid() }),
      annotations: READ,
    },
    ({ id }) =>
      read(async () => {
        const lead = await getLeadRecord(id);
        if (!lead) return null;
        const [communications, tasks] = await Promise.all([
          listCommunications({ leadId: id, limit: 15 }),
          listTasks({ leadId: id, assigneeId: "everyone", limit: 50 }),
        ]);
        return {
          ...lead,
          url: link(`/leads/${id}`),
          recentCommunications: communications.map(timelineRow),
          openTasks: tasks.map(taskRow),
        };
      }),
  );

  /* ── email campaigns (staff) ───────────────────────────────────── */

  server.registerTool(
    "list_campaigns",
    {
      title: "List email campaigns",
      description:
        "Marketing email campaigns (staff only), newest first, with recipients, sent, unique opens and clicks, unsubscribes and bounces. Statuses: drafts, active (scheduled, sending, testing, paused), sent. Read-only — campaigns are written and sent from The Gangway itself, never through this connection.",
      inputSchema: z.object({
        query: z.string().optional(),
        status: z.enum(["all", "drafts", "active", "sent"]).default("all"),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: READ,
    },
    ({ query, status, limit }) =>
      read(async () => {
        if ((await getAccess()).restricted) return null;
        const rows = await listCampaigns({ q: query, status });
        return rows.slice(0, limit).map(({ campaign: c, stats, senderName }) => ({
          id: c.id,
          name: c.name,
          subject: c.subject,
          status: c.status,
          from: c.fromAddress ?? c.fromMode,
          sender: senderName,
          scheduledAt: c.scheduledAt ? sydneyTime(c.scheduledAt) : null,
          startedAt: c.startedAt ? sydneyTime(c.startedAt) : null,
          ...stats,
          openRate: percent(stats.opened, stats.sent),
          clickRate: percent(stats.clicked, stats.sent),
          url: `${appUrl()}/campaigns/${c.id}`,
        }));
      }),
  );

  server.registerTool(
    "get_campaign_report",
    {
      title: "Get an email campaign's report",
      description:
        "One campaign's results: totals, each link with its clicks, the subject-line test if there was one, and the most engaged recipients. Opens are approximate (Apple Mail opens everything); clicks are the better signal.",
      inputSchema: z.object({ id: z.uuid() }),
      annotations: READ,
    },
    ({ id }) =>
      read(async () => {
        if ((await getAccess()).restricted) return null;
        const found = await getCampaign(id);
        if (!found) return null;
        const report = await campaignReport(id);
        const { campaign: c, stats } = found;
        return {
          name: c.name,
          subject: c.subject,
          status: c.status,
          lastError: c.lastError,
          ...stats,
          openRate: percent(stats.opened, stats.sent),
          clickRate: percent(stats.clicked, stats.sent),
          abTest: c.abTest?.subjectB
            ? { a: { subject: c.subject, ...report.variants.a }, b: { subject: c.abTest.subjectB, ...report.variants.b }, winner: c.abWinner }
            : null,
          links: report.links.map((l) => ({ url: l.url, label: l.label, clicks: l.clicks, people: l.people })),
          topRecipients: report.recipients.slice(0, 25).map((r) => ({
            name: [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
            email: r.email,
            company: r.company,
            status: r.status,
            opens: r.openCount,
            clicks: r.clickCount,
            unsubscribed: Boolean(r.unsubscribedAt),
            bounced: Boolean(r.bouncedAt),
          })),
          url: `${appUrl()}/campaigns/${c.id}`,
        };
      }),
  );

  /* ── projects and runbooks ─────────────────────────────────────── */

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "Delivery projects you can see, with progress counts. Statuses: planning, active, on_hold, complete, cancelled.",
      inputSchema: z.object({
        query: z.string().optional(),
        businessPartnerId: z.uuid().optional(),
        statuses: z.array(z.enum(["planning", "active", "on_hold", "complete", "cancelled"])).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: READ,
    },
    ({ query, businessPartnerId, statuses, limit }) =>
      read(() => listProjectRows({ q: query, customerId: businessPartnerId, statuses, limit })),
  );

  server.registerTool(
    "get_project",
    {
      title: "Get a project runbook",
      description:
        "One project with its runbook: numbered phases, each with its steps (id, status, assignee, due date, blocker, warning, notes, checklist), key contacts, account register, recent communications, open tasks and documents. Step ids here are what update_step takes.",
      inputSchema: z.object({ id: z.uuid() }),
      annotations: READ,
    },
    ({ id }) =>
      read(async () => {
        const project = await getProject(id);
        if (!project) return null;
        const [communications, tasks, docs] = await Promise.all([
          listCommunications({ projectId: id, limit: 10 }),
          listTasks({ projectId: id, assigneeId: "everyone", limit: 50 }),
          documentsForProject(id),
        ]);
        const { phases, steps, ...rest } = project;
        return {
          ...rest,
          url: link(`/projects/${id}`),
          progress: progressOf(steps),
          phases: phases.map((phase) => ({
            id: phase.id,
            num: phase.num,
            label: phase.label,
            description: phase.description,
            steps: steps
              .filter((s) => s.phaseId === phase.id)
              .map((step) => ({
                id: step.id,
                title: step.title,
                status: step.status,
                tag: step.tag,
                ownerLabel: step.ownerLabel,
                assignee: step.assignee?.name ?? null,
                assigneeId: step.assigneeId,
                dueDate: step.dueDate,
                description: step.description,
                warning: step.warning,
                blockedOn: step.blockedOn,
                blockedSince: step.blockedSince,
                notes: step.notes,
                checklist: step.checklist,
                links: step.links,
                completedAt: step.completedAt,
              })),
          })),
          recentCommunications: communications.map(timelineRow),
          openTasks: tasks.map(taskRow),
          documents: docs,
        };
      }),
  );

  /* ── tasks and the timeline ────────────────────────────────────── */

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks (follow-ups)",
      description:
        "Follow-ups, oldest due first. By default your own open ones; pass assignee 'everyone' or a person's id, and/or a record to see what hangs off it.",
      inputSchema: z.object({
        assignee: z.union([z.literal("me"), z.literal("everyone"), z.uuid()]).default("me"),
        businessPartnerId: z.uuid().optional(),
        projectId: z.uuid().optional(),
        leadId: z.uuid().optional(),
        includeDone: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(100),
      }),
      annotations: READ,
    },
    (args) =>
      read(async () => {
        const { user } = await requireUser();
        const rows = await listTasks({
          assigneeId: args.assignee === "me" ? user.id : args.assignee,
          customerId: args.businessPartnerId,
          projectId: args.projectId,
          leadId: args.leadId,
          includeDone: args.includeDone,
          limit: args.limit,
        });
        return rows.map(taskRow);
      }),
  );

  server.registerTool(
    "list_communications",
    {
      title: "List communications",
      description:
        "The conversation timeline — calls, meetings, emails, Teams messages and notes — for a business partner, contact, project or lead, newest first. Times are Sydney time.",
      inputSchema: z.object({
        businessPartnerId: z.uuid().optional(),
        contactId: z.uuid().optional(),
        projectId: z.uuid().optional(),
        leadId: z.uuid().optional(),
        limit: z.number().int().min(1).max(100).default(30),
        fullBody: z.boolean().default(false).describe("Include each entry's full text, not just its preview"),
      }),
      annotations: READ,
    },
    (args) =>
      read(async () => {
        if (!args.businessPartnerId && !args.contactId && !args.projectId && !args.leadId) {
          return "Name a business partner, contact, project or lead.";
        }
        if (args.leadId) await getLeadRecord(args.leadId);
        const rows = await listCommunications({
          customerId: args.businessPartnerId,
          contactId: args.contactId,
          projectId: args.projectId,
          leadId: args.leadId,
          limit: args.limit,
        });
        return rows.map((row) => ({ ...timelineRow(row), ...(args.fullBody ? { body: row.body } : {}) }));
      }),
  );

  /* ── sales and purchasing documents ────────────────────────────── */

  server.registerTool(
    "list_documents",
    {
      title: "List sales or purchasing documents",
      description:
        "Quotes, sales orders, invoices, deliveries, purchase orders, goods receipts or bills. Status 'live' (default) is draft and open; or draft, open, closed, cancelled, all. 'overdue' is open invoices past due with money owing.",
      inputSchema: z.object({
        type: z.enum(DOC_TYPE_KEYS),
        status: z.enum(["live", "draft", "open", "closed", "cancelled", "all"]).default("live"),
        query: z.string().optional().describe("Number, partner name, reference or title"),
        businessPartnerId: z.uuid().optional(),
        projectId: z.uuid().optional(),
        mine: z.boolean().default(false),
        overdue: z.boolean().default(false),
        xeroProblems: z.boolean().default(false),
        page: z.number().int().min(1).default(1),
      }),
      annotations: READ,
    },
    (args) =>
      read(async () => {
        const { user } = await requireUser();
        const { rows, count, page } = await listDocuments(
          args.type,
          {
            status: args.status,
            q: args.query,
            partner: args.businessPartnerId,
            project: args.projectId,
            owner: args.mine ? "me" : undefined,
            overdue: args.overdue ? "1" : undefined,
            xero: args.xeroProblems ? "problems" : undefined,
            page: String(args.page),
          },
          user.id,
        );
        return {
          total: count,
          page,
          documents: rows.map(({ doc, ownerName }) => ({
            id: doc.id,
            number: doc.number,
            status: doc.status,
            partner: doc.partnerName,
            partnerId: doc.partnerId,
            reference: doc.reference,
            title: doc.title,
            docDate: doc.docDate,
            dueDate: doc.dueDate,
            total: doc.total,
            amountDue: doc.amountDue,
            fulfilment: doc.fulfilment,
            isReserve: doc.isReserve,
            xeroSyncState: doc.xeroSyncState,
            owner: ownerName,
          })),
        };
      }),
  );

  server.registerTool(
    "get_document",
    {
      title: "Get a document",
      description:
        "One quote, order, invoice, PO, receipt, bill or delivery by id or number (e.g. QU-0042, SO-0007, INV-0028, PO-0011): header, lines with their quantities drawn/ordered/received/invoiced, related documents, payments, and for a PO its shipments and tracking. Line ids here are what receive_goods takes.",
      inputSchema: z.object({ idOrNumber: z.string().min(2) }),
      annotations: READ,
    },
    ({ idOrNumber }) =>
      read(async () => {
        const id = await findDocumentId(idOrNumber);
        const detail = id ? await getDocument(id) : null;
        if (!detail) return null;
        const { doc } = detail;
        const [related, payments, shipments, tracking] = await Promise.all([
          relatedDocuments(doc),
          documentPayments(doc.id),
          doc.type === "purchase_order" ? shipmentsFor(doc.id) : Promise.resolve([]),
          doc.type === "sales_order" || doc.type === "invoice" ? trackingForSales(doc.id) : Promise.resolve(null),
        ]);
        return {
          ...detail,
          url: link(`${DOC_TYPES[doc.type].base}/${doc.id}`),
          related,
          payments,
          shipments: shipments.map(({ shipment, receiptNumber }) => ({ ...shipment, receiptNumber })),
          trackingByLine: tracking ? Object.fromEntries(tracking) : undefined,
        };
      }),
  );

  server.registerTool(
    "list_items",
    {
      title: "List items",
      description:
        "The item catalogue (staff only): codes, names, sale and purchase prices, Xero accounts and tax types, and whether stock is tracked. Use an item's id on quote and order lines.",
      inputSchema: z.object({
        query: z.string().optional(),
        show: z.enum(["active", "stock", "services", "archived"]).default("active"),
      }),
      annotations: READ,
    },
    ({ query, show }) =>
      read(async () =>
        (await listItems({ q: query, show })).slice(0, 100).map(({ item, supplierName }) => ({
          ...item,
          preferredSupplier: supplierName,
        })),
      ),
  );
}

/* ── row shapes ─────────────────────────────────────────────────── */

type TimelineRow = Awaited<ReturnType<typeof listCommunications>>[number];
type TaskListRow = Awaited<ReturnType<typeof listTasks>>[number];

function timelineRow(row: TimelineRow) {
  return {
    id: row.id,
    type: row.type,
    direction: row.direction,
    visibility: row.visibility,
    occurredAt: row.occurredAt,
    subject: row.subject,
    preview: row.preview,
    from: row.fromName ?? row.fromEmail,
    loggedBy: row.loggedBy?.name ?? null,
    contact: row.contact ? [row.contact.firstName, row.contact.lastName].filter(Boolean).join(" ") : null,
    project: row.project?.name ?? null,
    outlookLink: row.graphWebLink,
  };
}

function taskRow({ task, assigneeName, customerName, projectName, leadName }: TaskListRow) {
  return {
    id: task.id,
    title: task.title,
    detail: task.detail,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    assignee: assigneeName,
    assigneeId: task.assigneeId,
    businessPartner: customerName,
    businessPartnerId: task.customerId,
    project: projectName,
    projectId: task.projectId,
    lead: leadName,
    leadId: task.leadId,
    contactId: task.contactId,
  };
}
