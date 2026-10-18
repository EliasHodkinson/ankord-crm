import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  boolean,
  integer,
  date,
  jsonb,
  numeric,
  index,
  uniqueIndex,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { DEFAULT_CLIENT_FOLDER_TEXT } from "../folder-template";

/* ───────────────────────── enums ───────────────────────── */

/**
 * `restricted` sees nothing by default — only the business partners granted to
 * them in customer_grants, and everything hanging off those. Used for VAs and
 * other people who should not see the whole book. See lib/access.ts.
 */
export const userRoleEnum = pgEnum("user_role", ["admin", "member", "viewer", "restricted"]);

/**
 * Where a person's role came from. `entra` means the last sign-in carried an
 * app-role claim, so the tenant is the authority and the in-app editor steps
 * aside. `manual` is the pre-Entra default.
 */
export const roleSourceEnum = pgEnum("role_source", ["entra", "manual"]);

export const leadStageEnum = pgEnum("lead_stage", [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
]);

export const customerStatusEnum = pgEnum("customer_status", [
  "prospect",
  "active",
  "on_hold",
  "former",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "planning",
  "active",
  "on_hold",
  "complete",
  "cancelled",
]);

export const projectHealthEnum = pgEnum("project_health", [
  "on_track",
  "at_risk",
  "off_track",
]);

export const stepStatusEnum = pgEnum("step_status", [
  "todo",
  "in_progress",
  "blocked",
  "done",
  "not_applicable",
]);

export const priorityEnum = pgEnum("priority", ["low", "normal", "high", "urgent"]);

export const commTypeEnum = pgEnum("comm_type", [
  "email",
  "call",
  "meeting",
  "note",
  "teams",
]);

export const commDirectionEnum = pgEnum("comm_direction", [
  "inbound",
  "outbound",
  "internal",
]);

export const visibilityEnum = pgEnum("visibility", ["team", "private"]);

export const factKindEnum = pgEnum("fact_kind", [
  "preference",
  "personal",
  "event",
  "mention",
]);

export const taskStatusEnum = pgEnum("task_status", ["open", "done", "cancelled"]);

/* ───────────────────────── identity ───────────────────────── */

/** Everyone who has signed in through the Ankor'd Microsoft 365 tenant. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Entra ID object id (`oid`) — the stable per-tenant identifier. */
    azureOid: text("azure_oid").notNull(),
    tenantId: text("tenant_id").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    jobTitle: text("job_title"),
    /** Base64 data URI of the Graph profile photo, refreshed on sign-in. */
    photo: text("photo"),
    role: userRoleEnum("role").notNull().default("member"),
    /** A cache of the last Entra app-role claim — see roleSourceEnum. */
    roleSource: roleSourceEnum("role_source").notNull().default("manual"),
    isActive: boolean("is_active").notNull().default(true),
    /** An Entra B2B guest — someone from outside Ankor'd, without a licence. */
    isGuest: boolean("is_guest").notNull().default(false),
    /** Set when an admin added this person from Settings, before they signed in. */
    invitedById: uuid("invited_by_id"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_azure_oid_idx").on(t.azureOid),
    uniqueIndex("users_email_idx").on(t.email),
  ],
);

/**
 * A signed-in browser session. Microsoft tokens live here (encrypted at rest
 * with APP_ENCRYPTION_KEY) rather than in the cookie, so revoking a session
 * revokes Graph access with it.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessTokenEnc: text("access_token_enc"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenEnc: text("refresh_token_enc"),
    scope: text("scope"),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* ───────────────────────── customers & people ───────────────────────── */

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    abn: text("abn"),
    /**
     * What this organisation is to Ankor'd. Independent flags rather than one
     * kind: a single value forced "both" into existence to express customer +
     * supplier, and every additional kind would double the combinations again.
     * Flags also mirror Xero, which carries its own IsCustomer and IsSupplier.
     *
     * Any combination is legal, including none — a contact worth keeping that
     * is not yet any of these.
     */
    isCustomer: boolean("is_customer").notNull().default(true),
    isSupplier: boolean("is_supplier").notNull().default(false),
    isMedia: boolean("is_media").notNull().default(false),
    status: customerStatusEnum("status").notNull().default("active"),
    /** The Xero ContactID this organisation is linked to, if any. */
    xeroContactId: text("xero_contact_id"),
    industry: text("industry"),
    website: text("website"),
    phone: text("phone"),
    email: text("email"),
    /** Free-text so it survives whatever the business calls its segments. */
    segment: text("segment"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),

    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    suburb: text("suburb"),
    state: text("state"),
    postcode: text("postcode"),
    country: text("country").default("Australia"),

    /** SharePoint document library folder that backs this customer's files. */
    spDriveId: text("sp_drive_id"),
    spItemId: text("sp_item_id"),
    spWebUrl: text("sp_web_url"),
    /**
     * When the Copilot brief was last written into SharePoint. Shown in the
     * record so a stale brief is visible rather than quietly wrong.
     */
    briefWrittenAt: timestamp("brief_written_at", { withTimezone: true }),

    /**
     * Payment terms in days, for invoices to them and bills from them. Null
     * falls back to the defaults in settings. 0 is legal: due on the day.
     */
    termsDays: integer("terms_days"),
    supplierTermsDays: integer("supplier_terms_days"),

    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    notes: text("notes"),
    /** Last real contact — a call, meeting, note or linked email. */
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("customers_status_idx").on(t.status),
    index("customers_last_activity_idx").on(t.lastActivityAt),
    index("customers_owner_idx").on(t.ownerId),
    index("customers_name_idx").on(t.name),
    index("customers_customer_idx").on(t.isCustomer),
    index("customers_supplier_idx").on(t.isSupplier),
    index("customers_media_idx").on(t.isMedia),
    index("customers_xero_idx").on(t.xeroContactId),
  ],
);

/** A person at a customer. The soft details live here and in contact_facts. */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    jobTitle: text("job_title"),
    email: text("email"),
    phone: text("phone"),
    mobile: text("mobile"),
    linkedin: text("linkedin"),
    isPrimary: boolean("is_primary").notNull().default(false),
    isDecisionMaker: boolean("is_decision_maker").notNull().default(false),

    /* The things that make a relationship feel personal */
    coffeeOrder: text("coffee_order"),
    /** Stored without a year so "birthday" never implies an age. */
    birthday: date("birthday"),
    dietary: text("dietary"),
    pronouns: text("pronouns"),
    preferredContact: text("preferred_contact"),

    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contacts_customer_idx").on(t.customerId),
    index("contacts_email_idx").on(t.email),
  ],
);

/**
 * Anything worth remembering about a person that does not deserve its own
 * column — "kids play for Riverbend Tigers", "moving house in March",
 * "hates being called Michael". Events can carry a date and a reminder.
 */
export const contactFacts = pgTable(
  "contact_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: factKindEnum("kind").notNull().default("mention"),
    label: text("label").notNull(),
    detail: text("detail"),
    onDate: date("on_date"),
    /** Repeats every year on `onDate` — anniversaries, birthdays, renewals. */
    recurring: boolean("recurring").notNull().default(false),
    remindDaysBefore: integer("remind_days_before"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contact_facts_contact_idx").on(t.contactId),
    index("contact_facts_date_idx").on(t.onDate),
  ],
);

/* ───────────────────────── leads ───────────────────────── */

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyName: text("company_name").notNull(),
    contactName: text("contact_name"),
    jobTitle: text("job_title"),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    suburb: text("suburb"),
    state: text("state"),

    stage: leadStageEnum("stage").notNull().default("new"),
    source: text("source"),
    /** What they're after — "website rebuild + M365 migration". */
    interest: text("interest"),
    valueAud: numeric("value_aud", { precision: 12, scale: 2 }),
    probability: integer("probability"),
    expectedCloseDate: date("expected_close_date"),

    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    nextAction: text("next_action"),
    nextActionAt: date("next_action_at"),

    spDriveId: text("sp_drive_id"),
    spItemId: text("sp_item_id"),
    spWebUrl: text("sp_web_url"),

    lostReason: text("lost_reason"),
    /** Set when the lead is converted, so the history survives the handover. */
    convertedCustomerId: uuid("converted_customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),

    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    notes: text("notes"),
    /** Last real contact, used to work out whether a lead is going cold. */
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    /** Manual ordering within a pipeline column on the board. */
    boardPosition: integer("board_position").notNull().default(0),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leads_stage_idx").on(t.stage, t.boardPosition),
    index("leads_last_activity_idx").on(t.lastActivityAt),
    index("leads_owner_idx").on(t.ownerId),
    index("leads_next_action_idx").on(t.nextActionAt),
  ],
);

/* ───────────────────────── projects ───────────────────────── */

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Short human reference, e.g. MSK-ONB. */
    code: text("code"),
    status: projectStatusEnum("status").notNull().default("planning"),
    health: projectHealthEnum("health").notNull().default("on_track"),
    priority: priorityEnum("priority").notNull().default("normal"),
    summary: text("summary"),
    /** The "act first" banner at the top of the runbook. */
    headline: text("headline"),
    headlineDetail: text("headline_detail"),

    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    startDate: date("start_date"),
    targetDate: date("target_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    budgetAud: numeric("budget_aud", { precision: 12, scale: 2 }),

    spDriveId: text("sp_drive_id"),
    spItemId: text("sp_item_id"),
    spWebUrl: text("sp_web_url"),

    /** Current-state / target-state narrative, as in the systems map. */
    stateBefore: text("state_before"),
    stateAfter: text("state_after"),

    templateKey: text("template_key"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("projects_customer_idx").on(t.customerId),
    index("projects_status_idx").on(t.status),
    index("projects_owner_idx").on(t.ownerId),
  ],
);

export const projectPhases = pgTable(
  "project_phases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    num: text("num").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    accent: text("accent"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_phases_project_idx").on(t.projectId, t.position)],
);

export const projectSteps = pgTable(
  "project_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    phaseId: uuid("phase_id")
      .notNull()
      .references(() => projectPhases.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Free-text label shown as a chip — REQUIRED, CRITICAL, SIGN-OFF… */
    tag: text("tag"),
    /** Who does it, in words, e.g. "Ankor'd · Wendy & Theo". */
    ownerLabel: text("owner_label"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    description: text("description"),
    /** The red "do not do this" callout carried by many runbook steps. */
    warning: text("warning"),

    status: stepStatusEnum("status").notNull().default("todo"),
    blockedOn: text("blocked_on"),
    blockedSince: timestamp("blocked_since", { withTimezone: true }),
    dueDate: date("due_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedById: uuid("completed_by_id").references(() => users.id, { onDelete: "set null" }),

    /** Working notes typed against the step as the job progresses. */
    notes: text("notes"),
    links: jsonb("links").$type<{ url: string; label: string }[]>().notNull().default(sql`'[]'::jsonb`),
    /**
     * Ticked sub-items. Mirrors a Planner task's checklist, so item ids are
     * GUIDs — Planner uses them as the keys of the checklist object.
     */
    checklist: jsonb("checklist")
      .$type<{ id: string; title: string; done: boolean }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("project_steps_project_idx").on(t.projectId),
    index("project_steps_phase_idx").on(t.phaseId, t.position),
    index("project_steps_status_idx").on(t.status),
  ],
);

/** Key Contacts for a project — internal staff, client people, third parties. */
export const projectContacts = pgTable(
  "project_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Set when the person already exists as a customer contact. */
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    organisation: text("organisation"),
    role: text("role"),
    email: text("email"),
    phone: text("phone"),
    /** "What we need from them" — the thing that unblocks the project. */
    needed: text("needed"),
    bestContactMethod: text("best_contact_method"),
    isBlocker: boolean("is_blocker").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_contacts_project_idx").on(t.projectId, t.position)],
);

/**
 * The account register. Deliberately has no password column — the register
 * records where the credential lives (the vault record), never the secret.
 */
export const projectAccounts = pgTable(
  "project_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    system: text("system").notNull(),
    loginUrl: text("login_url"),
    username: text("username"),
    mfaMethod: text("mfa_method"),
    recoveryCodesLocation: text("recovery_codes_location"),
    /** Pointer into the password manager — never the password itself. */
    vaultRecord: text("vault_record"),
    ownedBy: text("owned_by"),
    renewalDate: date("renewal_date"),
    costAud: numeric("cost_aud", { precision: 12, scale: 2 }),
    purpose: text("purpose"),
    notes: text("notes"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("project_accounts_project_idx").on(t.projectId, t.position),
    index("project_accounts_customer_idx").on(t.customerId),
  ],
);

/* ───────────────────────── communications ───────────────────────── */

/**
 * A logged interaction. Email rows are linked from Microsoft 365 and keep the
 * Graph identifiers so the original message can always be reopened in Outlook.
 */
export const communications = pgTable(
  "communications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),

    type: commTypeEnum("type").notNull().default("note"),
    direction: commDirectionEnum("direction").notNull().default("outbound"),
    visibility: visibilityEnum("visibility").notNull().default("team"),

    subject: text("subject"),
    preview: text("preview"),
    body: text("body"),
    bodyIsHtml: boolean("body_is_html").notNull().default(false),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),

    fromName: text("from_name"),
    fromEmail: text("from_email"),
    toRecipients: jsonb("to_recipients")
      .$type<{ name?: string; address: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ccRecipients: jsonb("cc_recipients")
      .$type<{ name?: string; address: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    hasAttachments: boolean("has_attachments").notNull().default(false),

    /* Microsoft Graph provenance */
    graphMessageId: text("graph_message_id"),
    graphInternetMessageId: text("graph_internet_message_id"),
    graphConversationId: text("graph_conversation_id"),
    graphWebLink: text("graph_web_link"),
    /** Whose mailbox it was pulled from. */
    linkedFromUserId: uuid("linked_from_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    loggedById: uuid("logged_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("comms_customer_idx").on(t.customerId, t.occurredAt),
    index("comms_project_idx").on(t.projectId, t.occurredAt),
    index("comms_lead_idx").on(t.leadId, t.occurredAt),
    index("comms_contact_idx").on(t.contactId),
    /* One CRM record per Microsoft message, so double-linking is impossible. */
    uniqueIndex("comms_graph_internet_id_idx")
      .on(t.graphInternetMessageId)
      .where(sql`${t.graphInternetMessageId} is not null`),
  ],
);

/* ───────────────────────── files ───────────────────────── */

/**
 * Pointers to items that live in SharePoint. Files are never copied into the
 * CRM — this table only records what has been pinned and where it sits.
 */
export const pinnedFiles = pgTable(
  "pinned_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    driveId: text("drive_id").notNull(),
    itemId: text("item_id").notNull(),
    name: text("name").notNull(),
    webUrl: text("web_url").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    isFolder: boolean("is_folder").notNull().default(false),
    label: text("label"),
    pinnedById: uuid("pinned_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pinned_files_customer_idx").on(t.customerId),
    index("pinned_files_project_idx").on(t.projectId),
    uniqueIndex("pinned_files_item_idx").on(t.driveId, t.itemId, t.customerId, t.projectId),
  ],
);

/* ───────────────────────── tasks & activity ───────────────────────── */

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    detail: text("detail"),
    status: taskStatusEnum("status").notNull().default("open"),
    priority: priorityEnum("priority").notNull().default("normal"),
    dueDate: date("due_date"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /**
     * The mirrored task in the assignee's Microsoft To Do, if it has been
     * synced. Set only by that person's own sync — To Do cannot be written on
     * someone else's behalf.
     */
    todoTaskId: text("todo_task_id"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_assignee_idx").on(t.assigneeId, t.status),
    index("tasks_due_idx").on(t.dueDate),
  ],
);

/** Append-only trail of who did what, rendered as the record timeline. */
export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    verb: text("verb").notNull(),
    summary: text("summary").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("activity_customer_idx").on(t.customerId, t.createdAt),
  ],
);

/**
 * A named, filtered view of a list — "My open leads", "At risk this quarter".
 * The filter is stored as the query string the list page already understands,
 * so saving a view is just remembering the URL you are looking at.
 */
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Which list this belongs to: leads, customers, projects, contacts. */
    entity: text("entity").notNull(),
    name: text("name").notNull(),
    query: text("query").notNull(),
    icon: text("icon"),
    /** Null when shared with the whole team. */
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    isShared: boolean("is_shared").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("saved_views_entity_idx").on(t.entity, t.position)],
);

/* ───────────────────────── access ───────────────────────── */

export const fileAccessEnum = pgEnum("file_access", ["read", "write"]);

/**
 * Which business partners a restricted person may see. Granting a customer
 * grants everything hanging off it: its contacts, projects, communications,
 * follow-ups and SharePoint folder. Staff and admins do not need rows here.
 */
export const customerGrants = pgTable(
  "customer_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** What they get on the customer's SharePoint folder. */
    fileAccess: fileAccessEnum("file_access").notNull().default("write"),
    grantedById: uuid("granted_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customer_grants_user_customer_idx").on(t.userId, t.customerId),
    index("customer_grants_customer_idx").on(t.customerId),
  ],
);

export const spGrantStatusEnum = pgEnum("sp_grant_status", [
  /** The app added this permission, and it is still there as far as we know. */
  "applied",
  /** They already had a direct permission. The app did not add it and will not remove it. */
  "preexisting",
  /** Graph refused. `error` says why; Settings offers a retry. */
  "failed",
  /** Removed by the app. */
  "revoked",
  /** The app tried to remove it and Graph refused — it may still be in place. */
  "revoke_failed",
]);

/**
 * A ledger of every SharePoint permission the CRM has changed, so revoking
 * removes exactly what the CRM added and nothing a person set up by hand.
 * Rows are kept after revocation as the audit trail.
 */
export const sharepointGrants = pgTable(
  "sharepoint_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    driveId: text("drive_id").notNull(),
    itemId: text("item_id").notNull(),
    /** The Graph permission id the invite returned. Null unless status is applied. */
    permissionId: text("permission_id"),
    role: fileAccessEnum("role").notNull(),
    status: spGrantStatusEnum("status").notNull(),
    error: text("error"),
    appliedById: uuid("applied_by_id").references(() => users.id, { onDelete: "set null" }),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    revokedById: uuid("revoked_by_id").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("sharepoint_grants_user_idx").on(t.userId, t.customerId),
    index("sharepoint_grants_item_idx").on(t.driveId, t.itemId),
  ],
);

/* ───────────────────────── org settings ───────────────────────── */

/** Single-row table holding the tenant-wide configuration. */
export const settings = pgTable("settings", {
  id: text("id").primaryKey().default("singleton"),
  spSiteId: text("sp_site_id"),
  spSiteUrl: text("sp_site_url"),
  spDriveId: text("sp_drive_id"),
  spRootFolder: text("sp_root_folder").default("The Gangway"),
  /** Auto-create a SharePoint folder when a customer or project is created. */
  spAutoProvision: boolean("sp_auto_provision").notNull().default(true),
  /**
   * The folders created inside each new client folder, one per line. Empty
   * means a bare client folder; null means the built-in default.
   */
  spFolderTemplate: text("sp_folder_template").default(DEFAULT_CLIENT_FOLDER_TEXT),
  /**
   * Where lead folders go. Deliberately separate from the client folder so
   * prospects and clients do not sit in the same place. Blank disables lead
   * folders entirely.
   */
  spLeadFolder: text("sp_lead_folder").default("Leads"),
  /**
   * Shared mailboxes people may link email from, as addresses. Graph cannot
   * list the mailboxes a person can open, so an admin names them here; Exchange
   * still decides, per person, whether each one actually opens.
   */
  sharedMailboxes: text("shared_mailboxes").array().notNull().default(sql`ARRAY[]::text[]`),

  /**
   * The Microsoft 365 group new Planner plans are created in. Plans belong to
   * a group, and its members are who can see and edit them in Planner.
   */
  plannerGroupId: text("planner_group_id"),
  plannerGroupName: text("planner_group_name"),

  /* How long something can sit untouched before the CRM says something */
  staleLeadDays: integer("stale_lead_days").notNull().default(7),
  staleCustomerDays: integer("stale_customer_days").notNull().default(90),
  staleProjectDays: integer("stale_project_days").notNull().default(14),

  /*
   * Sales & Xero. Account codes and tax types are Xero's own identifiers,
   * picked from the cached /Accounts and /TaxRates. An item's own choice wins;
   * these are what a line falls back to.
   */
  defaultSalesAccount: text("default_sales_account"),
  defaultPurchaseAccount: text("default_purchase_account"),
  defaultSalesTaxType: text("default_sales_tax_type"),
  defaultPurchaseTaxType: text("default_purchase_tax_type"),
  quoteBrandingThemeId: text("quote_branding_theme_id"),
  invoiceBrandingThemeId: text("invoice_branding_theme_id"),
  poBrandingThemeId: text("po_branding_theme_id"),
  /** Where suppliers deliver to by default — the deliver-to on a PO. */
  deliveryAddress: text("delivery_address"),
  customerTermsDays: integer("customer_terms_days").notNull().default(14),
  supplierTermsDays: integer("supplier_terms_days").notNull().default(30),
  quoteValidityDays: integer("quote_validity_days").notNull().default(30),
  /** Whether The Gangway may approve supplier bills, or leaves that to Xero (Q6). */
  allowBillApproval: boolean("allow_bill_approval").notNull().default(true),
  /** When the Xero pull last completed — the If-Modified-Since for the next. */
  xeroLastPullAt: timestamp("xero_last_pull_at", { withTimezone: true }),

  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────────── planner ───────────────────────── */

/**
 * A project linked to a Microsoft Planner plan. One plan per project.
 *
 * Planner has no change notifications and its delta query is beta-only, so
 * the link is kept in step by polling — see lib/planner/sync.ts. The lock and
 * error columns are what make that safe to run from several browsers at once
 * and visible when it goes wrong.
 */
export const plannerPlans = pgTable(
  "planner_plans",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    planId: text("plan_id").notNull(),
    groupId: text("group_id"),
    /** The plan's title as last seen, for display while Graph is unreachable. */
    title: text("title"),
    etag: text("etag"),
    /** The synced plan fields as both sides last agreed them. */
    base: jsonb("base").$type<Record<string, unknown>>(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    /** Set while a sync runs; stale after a couple of minutes. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    linkedById: uuid("linked_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("planner_plans_plan_idx").on(t.planId)],
);

/**
 * One row per synced bucket (↔ phase) or task (↔ step).
 *
 * `localId` deliberately has no foreign key. When a phase or step is deleted
 * here the row survives, and that is how the next sync knows to delete the
 * Planner side too — it is the tombstone.
 */
export const plannerItems = pgTable(
  "planner_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"bucket" | "task">().notNull(),
    localId: uuid("local_id").notNull(),
    plannerId: text("planner_id").notNull(),
    etag: text("etag"),
    /** Task details (description, checklist, links) carry their own etag. */
    detailsEtag: text("details_etag"),
    base: jsonb("base").$type<Record<string, unknown>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("planner_items_project_idx").on(t.projectId),
    uniqueIndex("planner_items_planner_idx").on(t.kind, t.plannerId),
    uniqueIndex("planner_items_local_idx").on(t.kind, t.localId),
  ],
);

/* ───────────────────────── xero ───────────────────────── */

/**
 * The tenant-wide Xero connection. One row, like settings.
 *
 * Xero refresh tokens are **single use**: every refresh returns a new pair and
 * invalidates the old refresh token. The new one must be written back
 * immediately or the connection dies within the hour. Xero allows a 30-minute
 * grace window in which the previous token can be retried if the response was
 * lost, which is the only reason a failed write is recoverable at all.
 *
 * Tokens are encrypted at rest with APP_ENCRYPTION_KEY, as Microsoft's are.
 */
export const xeroConnection = pgTable("xero_connection", {
  id: text("id").primaryKey().default("singleton"),
  /** Xero organisation ("tenant") this connection is scoped to. */
  tenantId: text("tenant_id"),
  tenantName: text("tenant_name"),

  accessTokenEnc: text("access_token_enc"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenEnc: text("refresh_token_enc"),
  /** When the pair was last rotated — the 60-day clock runs from here. */
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  /**
   * The scopes Xero granted, space-separated, read from the access token. Null
   * on a connection made before this was recorded, which is treated as "has
   * none of the write scopes" so the settings page asks for a reconnect.
   */
  scope: text("scope"),

  connectedById: uuid("connected_by_id").references(() => users.id, { onDelete: "set null" }),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────────── sales & purchasing ───────────────────────── */

/*
 * The design is docs/sales-erp-spec.md. In short: The Gangway runs the
 * workflow and Xero holds the money, the numbers and the outbound documents.
 * Quotes, invoices, purchase orders and bills are created in Xero as drafts on
 * first save and take Xero's number; sales orders, goods receipts and
 * deliveries are Gangway's own and are numbered here.
 */

export const documentTypeEnum = pgEnum("document_type", [
  "quote", // Xero Quote
  "sales_order", // local
  "invoice", // Xero ACCREC; isReserve marks a reserve invoice
  "delivery", // local; only against a reserve invoice
  "purchase_order", // Xero PurchaseOrder
  "goods_receipt", // local
  "bill", // Xero ACCPAY
]);

export const documentStatusEnum = pgEnum("document_status", [
  /** Editable. Xero types exist in Xero as DRAFT already. */
  "draft",
  /** Live: quote sent, order confirmed, invoice/PO/bill approved, receipt or delivery recorded. */
  "open",
  /** Finished — automatically once fully converted, or by hand. */
  "closed",
  /** Voided or deleted. Keeps its number. */
  "cancelled",
]);

export const quoteOutcomeEnum = pgEnum("quote_outcome", ["accepted", "declined", "expired"]);
export const rowTypeEnum = pgEnum("row_type", ["item", "alternative", "text", "subtotal"]);
export const amountsAreEnum = pgEnum("amounts_are", ["exclusive", "inclusive", "no_tax"]);

export const xeroSyncStateEnum = pgEnum("xero_sync_state", [
  "local_only", // sales_order, goods_receipt, delivery
  "pending", // queued
  "pushing", // claimed by a push
  "synced", // Xero matches xeroPushedVersion == version
  "stale", // edited since the last push
  "failed", // last attempt failed (xeroError); retry allowed
  "blocked", // needs a person: contact not linked, account not mapped, Xero not connected
]);

/** Quantities and unit prices carry four places; money carries two. */
const qty = (name: string) => numeric(name, { precision: 14, scale: 4 });
const cash = (name: string) => numeric(name, { precision: 14, scale: 2 });

/**
 * What Ankor'd sells and buys. Synced to Xero as an untracked Item: stock
 * quantities are counted here, never valued in Xero (D4).
 */
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Xero Item.Code — 30 characters at most. */
    code: text("code").notNull(),
    /** Xero Item.Name — 50 characters at most. */
    name: text("name").notNull(),
    /** Default sales line text. */
    description: text("description"),
    /** Default purchase-order line text. */
    purchaseDescription: text("purchase_description"),
    /** Physical goods. Drives ordering, receiving, allocation and delivery. */
    tracksStock: boolean("tracks_stock").notNull().default(false),
    unit: text("unit"),
    isSold: boolean("is_sold").notNull().default(true),
    isPurchased: boolean("is_purchased").notNull().default(false),
    /** Ex GST. A missing buy price is shown as missing, never guessed. */
    salePrice: qty("sale_price"),
    purchasePrice: qty("purchase_price"),
    salesAccountCode: text("sales_account_code"),
    purchaseAccountCode: text("purchase_account_code"),
    salesTaxType: text("sales_tax_type"),
    purchaseTaxType: text("purchase_tax_type"),
    preferredSupplierId: uuid("preferred_supplier_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    xeroItemId: text("xero_item_id"),
    xeroSyncState: xeroSyncStateEnum("xero_sync_state").notNull().default("pending"),
    xeroError: text("xero_error"),
    xeroSyncedAt: timestamp("xero_synced_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("items_code_idx").on(t.code),
    /* One Xero item, one Gangway item — the import keys on it. */
    uniqueIndex("items_xero_idx").on(t.xeroItemId).where(sql`${t.xeroItemId} is not null`),
    index("items_name_idx").on(t.name),
    index("items_sync_idx").on(t.xeroSyncState),
  ],
);

/**
 * Every sales and purchasing document, of every type. One table so copy-to,
 * related documents and the Xero push are written once.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: documentTypeEnum("type").notNull(),
    /**
     * Xero types: Xero's number, written back after the first push (null until
     * then). Bills: the supplier's invoice number. Local types: from
     * number_series on create.
     */
    number: text("number"),
    status: documentStatusEnum("status").notNull().default("draft"),
    isReserve: boolean("is_reserve").notNull().default(false),
    quoteOutcome: quoteOutcomeEnum("quote_outcome"),

    partnerId: uuid("partner_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    partnerName: text("partner_name").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),

    reference: text("reference"),
    supplierInvoiceNumber: text("supplier_invoice_number"),
    docDate: date("doc_date").notNull(),
    /** Quote: valid until. SO and PO: delivery date. Invoice and bill: due date. */
    dueDate: date("due_date"),
    termsDays: integer("terms_days"),
    shipToText: text("ship_to_text"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** The job this traces to — set on POs, receipts, invoices and deliveries. */
    salesOrderId: uuid("sales_order_id").references((): AnyPgColumn => documents.id, {
      onDelete: "set null",
    }),
    amountsAre: amountsAreEnum("amounts_are").notNull().default("exclusive"),

    title: text("title"),
    summary: text("summary"),
    terms: text("terms"),
    remarks: text("remarks"),
    /** Never leaves The Gangway. */
    internalNotes: text("internal_notes"),

    subtotal: cash("subtotal").notNull().default("0"),
    taxTotal: cash("tax_total").notNull().default("0"),
    total: cash("total").notNull().default("0"),
    amountPaid: cash("amount_paid").notNull().default("0"),
    amountDue: cash("amount_due").notNull().default("0"),
    /** Derived summary for lists — see lib/sales/fulfilment.ts. */
    fulfilment: text("fulfilment"),

    /** Optimistic lock. A save carries the version it was opened at. */
    version: integer("version").notNull().default(1),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by").$type<"auto" | "person">(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledById: uuid("cancelled_by_id").references(() => users.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),

    /* Xero — see lib/xero/push.ts */
    xeroId: text("xero_id"),
    xeroStatus: text("xero_status"),
    xeroSyncState: xeroSyncStateEnum("xero_sync_state").notNull(),
    xeroPushedVersion: integer("xero_pushed_version"),
    xeroError: text("xero_error"),
    xeroAttempts: integer("xero_attempts").notNull().default(0),
    xeroLastAttemptAt: timestamp("xero_last_attempt_at", { withTimezone: true }),
    xeroSyncedAt: timestamp("xero_synced_at", { withTimezone: true }),
    /** Xero's UpdatedDateUTC, for change detection on the pull. */
    xeroUpdatedAt: timestamp("xero_updated_at", { withTimezone: true }),
    /** Xero's own Total as last seen, so an edit made in Xero shows up here. */
    xeroTotal: cash("xero_total"),
    /**
     * Set when the document was brought in from Xero rather than created
     * here (lib/xero/import). Re-running the import refreshes its lines only
     * while it is still exactly as imported — see `isPristineImport`.
     */
    importedAt: timestamp("imported_at", { withTimezone: true }),

    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documents_type_status_idx").on(t.type, t.status, t.docDate),
    index("documents_partner_idx").on(t.partnerId, t.type),
    index("documents_sales_order_idx").on(t.salesOrderId),
    index("documents_project_idx").on(t.projectId),
    index("documents_sync_idx").on(t.type, t.xeroSyncState),
    uniqueIndex("documents_number_idx")
      .on(t.type, t.number)
      .where(sql`${t.number} is not null and ${t.type} <> 'bill'`),
    uniqueIndex("documents_xero_idx").on(t.xeroId).where(sql`${t.xeroId} is not null`),
    /* A supplier's invoice number is theirs, so it is unique per supplier. */
    uniqueIndex("documents_bill_number_idx")
      .on(t.partnerId, t.supplierInvoiceNumber)
      .where(sql`${t.type} = 'bill' and ${t.status} <> 'cancelled'`),
  ],
);

export const documentLines = pgTable(
  "document_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    rowType: rowTypeEnum("row_type").notNull().default("item"),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    itemCode: text("item_code"),
    unit: text("unit"),
    tracksStock: boolean("tracks_stock").notNull().default(false),
    description: text("description").notNull().default(""),
    note: text("note"),
    quantity: qty("quantity").notNull().default("0"),
    unitPrice: qty("unit_price").notNull().default("0"),
    discountPercent: numeric("discount_percent", { precision: 7, scale: 4 })
      .notNull()
      .default("0"),
    accountCode: text("account_code"),
    taxType: text("tax_type"),
    taxRate: numeric("tax_rate", { precision: 7, scale: 4 }).notNull().default("0"),
    lineAmount: cash("line_amount").notNull().default("0"),
    taxAmount: cash("tax_amount").notNull().default("0"),
    /** The line this was copied from (quote → order → invoice). */
    baseLineId: uuid("base_line_id").references((): AnyPgColumn => documentLines.id, {
      onDelete: "restrict",
    }),
    /** On a PO line: the sales-order line it was raised for. */
    sourceLineId: uuid("source_line_id").references((): AnyPgColumn => documentLines.id, {
      onDelete: "set null",
    }),

    /* Derived counters — recomputed from the links, never typed. */
    qtyConverted: qty("qty_converted").notNull().default("0"),
    qtyOrdered: qty("qty_ordered").notNull().default("0"),
    qtyAllocated: qty("qty_allocated").notNull().default("0"),
    qtyInvoiced: qty("qty_invoiced").notNull().default("0"),
    qtyDelivered: qty("qty_delivered").notNull().default("0"),
    qtyReceived: qty("qty_received").notNull().default("0"),
    qtyBilled: qty("qty_billed").notNull().default("0"),
  },
  (t) => [
    index("document_lines_document_idx").on(t.documentId, t.position),
    index("document_lines_base_idx").on(t.baseLineId),
    index("document_lines_source_idx").on(t.sourceLineId),
    index("document_lines_item_idx").on(t.itemId),
  ],
);

/** Stock set aside for a sales-order line. Used from phase B. */
export const stockAllocations = pgTable(
  "stock_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salesOrderLineId: uuid("sales_order_line_id")
      .notNull()
      .references(() => documentLines.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    quantity: qty("quantity").notNull(),
    receiptLineId: uuid("receipt_line_id").references(() => documentLines.id, {
      onDelete: "set null",
    }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedById: uuid("released_by_id").references(() => users.id, { onDelete: "set null" }),
    consumed: qty("consumed").notNull().default("0"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_allocations_line_idx").on(t.salesOrderLineId),
    index("stock_allocations_item_idx").on(t.itemId),
  ],
);

/** Stocktake and breakage corrections. Admin only. Used from phase B. */
export const stockAdjustments = pgTable(
  "stock_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    quantity: qty("quantity").notNull(),
    reason: text("reason").notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_adjustments_item_idx").on(t.itemId)],
);

/** Numbering for the documents Xero never sees: SO-, GR-, DN-. */
export const numberSeries = pgTable("number_series", {
  key: text("key").primaryKey(),
  prefix: text("prefix").notNull(),
  nextValue: integer("next_value").notNull().default(1),
  padTo: integer("pad_to").notNull().default(5),
});

/**
 * Notes written onto a Xero document's history, so someone in Xero can follow
 * what happened in The Gangway. Best effort: queued here, written after the
 * document exists in Xero, retried by the cron, never blocking anything.
 */
export const xeroHistoryNotes = pgTable(
  "xero_history_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    details: text("details").notNull(),
    writtenAt: timestamp("written_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("xero_history_notes_pending_idx").on(t.writtenAt, t.createdAt)],
);

/** Every call to Xero's write path, without payloads. Pruned after 90 days. */
export const xeroSyncLog = pgTable(
  "xero_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    httpStatus: integer("http_status"),
    xeroId: text("xero_id"),
    message: text("message"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("xero_sync_log_entity_idx").on(t.entityId, t.createdAt),
    index("xero_sync_log_created_idx").on(t.createdAt),
  ],
);

/** Xero reference data for the pickers: accounts, tax rates, branding themes. */
export const xeroCache = pgTable("xero_cache", {
  key: text("key").primaryKey(),
  data: jsonb("data").$type<unknown>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Payments against invoices and bills, as Xero has them (spec §7). A read
 * model: filled by the import and the pull, never typed here, and shown
 * read-only under the document.
 */
export const xeroPayments = pgTable(
  "xero_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    xeroPaymentId: text("xero_payment_id").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    date: date("date"),
    amount: cash("amount").notNull(),
    reference: text("reference"),
    accountCode: text("account_code"),
    /** AUTHORISED or DELETED. */
    status: text("status"),
    pulledAt: timestamp("pulled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("xero_payments_xero_idx").on(t.xeroPaymentId),
    index("xero_payments_document_idx").on(t.documentId, t.date),
  ],
);

/**
 * Xero records someone chose not to bring in — so far only contacts. Kept so
 * the review screen stops offering them, and so the choice can be undone.
 */
export const xeroImportSkips = pgTable(
  "xero_import_skips",
  {
    kind: text("kind").$type<"contact">().notNull(),
    xeroId: text("xero_id").notNull(),
    name: text("name"),
    skippedById: uuid("skipped_by_id").references(() => users.id, { onDelete: "set null" }),
    skippedAt: timestamp("skipped_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.xeroId] })],
);

/* ───────────────────────── relations ───────────────────────── */

export const usersRelations = relations(users, ({ many }) => ({
  ownedCustomers: many(customers),
  sessions: many(sessions),
  customerGrants: many(customerGrants),
}));

export const customerGrantsRelations = relations(customerGrants, ({ one }) => ({
  user: one(users, { fields: [customerGrants.userId], references: [users.id] }),
  customer: one(customers, { fields: [customerGrants.customerId], references: [customers.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  owner: one(users, { fields: [customers.ownerId], references: [users.id] }),
  contacts: many(contacts),
  projects: many(projects),
  communications: many(communications),
  pinnedFiles: many(pinnedFiles),
  accounts: many(projectAccounts),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  customer: one(customers, { fields: [contacts.customerId], references: [customers.id] }),
  facts: many(contactFacts),
  communications: many(communications),
}));

export const contactFactsRelations = relations(contactFacts, ({ one }) => ({
  contact: one(contacts, { fields: [contactFacts.contactId], references: [contacts.id] }),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  owner: one(users, { fields: [leads.ownerId], references: [users.id] }),
  convertedCustomer: one(customers, {
    fields: [leads.convertedCustomerId],
    references: [customers.id],
  }),
  communications: many(communications),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  customer: one(customers, { fields: [projects.customerId], references: [customers.id] }),
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  phases: many(projectPhases),
  steps: many(projectSteps),
  keyContacts: many(projectContacts),
  accounts: many(projectAccounts),
  communications: many(communications),
}));

export const projectPhasesRelations = relations(projectPhases, ({ one, many }) => ({
  project: one(projects, { fields: [projectPhases.projectId], references: [projects.id] }),
  steps: many(projectSteps),
}));

export const projectStepsRelations = relations(projectSteps, ({ one }) => ({
  project: one(projects, { fields: [projectSteps.projectId], references: [projects.id] }),
  phase: one(projectPhases, { fields: [projectSteps.phaseId], references: [projectPhases.id] }),
  assignee: one(users, { fields: [projectSteps.assigneeId], references: [users.id] }),
}));

export const projectContactsRelations = relations(projectContacts, ({ one }) => ({
  project: one(projects, { fields: [projectContacts.projectId], references: [projects.id] }),
  contact: one(contacts, { fields: [projectContacts.contactId], references: [contacts.id] }),
}));

export const projectAccountsRelations = relations(projectAccounts, ({ one }) => ({
  project: one(projects, { fields: [projectAccounts.projectId], references: [projects.id] }),
  customer: one(customers, { fields: [projectAccounts.customerId], references: [customers.id] }),
}));

export const communicationsRelations = relations(communications, ({ one }) => ({
  customer: one(customers, { fields: [communications.customerId], references: [customers.id] }),
  contact: one(contacts, { fields: [communications.contactId], references: [contacts.id] }),
  project: one(projects, { fields: [communications.projectId], references: [projects.id] }),
  lead: one(leads, { fields: [communications.leadId], references: [leads.id] }),
  loggedBy: one(users, { fields: [communications.loggedById], references: [users.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
  customer: one(customers, { fields: [tasks.customerId], references: [customers.id] }),
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  lead: one(leads, { fields: [tasks.leadId], references: [leads.id] }),
}));

export const savedViewsRelations = relations(savedViews, ({ one }) => ({
  owner: one(users, { fields: [savedViews.ownerId], references: [users.id] }),
}));

export const activityRelations = relations(activity, ({ one }) => ({
  actor: one(users, { fields: [activity.actorId], references: [users.id] }),
  customer: one(customers, { fields: [activity.customerId], references: [customers.id] }),
  project: one(projects, { fields: [activity.projectId], references: [projects.id] }),
}));

/* ───────────────────────── inferred types ───────────────────────── */

export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type ContactFact = typeof contactFacts.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type ProjectPhase = typeof projectPhases.$inferSelect;
export type ProjectStep = typeof projectSteps.$inferSelect;
export type ProjectContact = typeof projectContacts.$inferSelect;
export type ProjectAccount = typeof projectAccounts.$inferSelect;
export type Communication = typeof communications.$inferSelect;
export type PinnedFile = typeof pinnedFiles.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Activity = typeof activity.$inferSelect;
export type SavedView = typeof savedViews.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type CustomerGrant = typeof customerGrants.$inferSelect;
export type SharepointGrant = typeof sharepointGrants.$inferSelect;
export type PlannerPlanLink = typeof plannerPlans.$inferSelect;
export type PlannerItem = typeof plannerItems.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentLine = typeof documentLines.$inferSelect;
export type DocumentType = (typeof documentTypeEnum.enumValues)[number];
export type DocumentStatus = (typeof documentStatusEnum.enumValues)[number];
export type RowType = (typeof rowTypeEnum.enumValues)[number];
export type AmountsAre = (typeof amountsAreEnum.enumValues)[number];
export type XeroSyncState = (typeof xeroSyncStateEnum.enumValues)[number];
export type XeroPayment = typeof xeroPayments.$inferSelect;
