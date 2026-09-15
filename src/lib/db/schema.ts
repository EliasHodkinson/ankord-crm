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
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { DEFAULT_CLIENT_FOLDER_TEXT } from "../folder-template";

/* ───────────────────────── enums ───────────────────────── */

export const userRoleEnum = pgEnum("user_role", ["admin", "member", "viewer"]);

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

  /* How long something can sit untouched before the CRM says something */
  staleLeadDays: integer("stale_lead_days").notNull().default(7),
  staleCustomerDays: integer("stale_customer_days").notNull().default(90),
  staleProjectDays: integer("stale_project_days").notNull().default(14),
  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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

  connectedById: uuid("connected_by_id").references(() => users.id, { onDelete: "set null" }),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────────── relations ───────────────────────── */

export const usersRelations = relations(users, ({ many }) => ({
  ownedCustomers: many(customers),
  sessions: many(sessions),
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
