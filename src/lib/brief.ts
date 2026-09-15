/**
 * The Copilot brief: a plain-English summary of a business partner, written
 * into their SharePoint folder as Markdown.
 *
 * Why this exists: Copilot grounds on the tenant — SharePoint, Outlook, Teams —
 * and cannot reach Neon. Without a file, "what's happening with Art Parts?"
 * returns their documents and emails and nothing from the CRM: no status, no
 * next action, not a single contact fact. A file closes that gap without a
 * single row leaving the database.
 *
 * Written for retrieval, not for looks. Short labelled lines beat prose, every
 * section says what it is, and nothing is abbreviated — Copilot has no schema
 * to consult, so the file has to explain itself.
 *
 * Deliberately excludes money. Xero balances change with every payment, which
 * would make the brief wrong faster than anything else in it, and copying
 * financial position into a document store is not worth a convenience. The CRM
 * shows it live instead.
 */

export const BRIEF_FILE_NAME = "_Brief.md";

/**
 * Kept out of the client folder's top level: the subfolder is a clear signal
 * that this is ours, and gives somewhere to put anything else generated later.
 *
 * It inherits the client folder's permissions, so if a folder is ever shared
 * externally the brief travels with it. That is the trade for living beside
 * the files Copilot already indexes.
 */
export const BRIEF_FOLDER = "_internal";

export type BriefInput = {
  name: string;
  legalName: string | null;
  isCustomer: boolean;
  isSupplier: boolean;
  isMedia: boolean;
  status: string;
  industry: string | null;
  segment: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  ownerName: string | null;
  tags: string[];
  notes: string | null;
  lastActivityAt: Date | null;
  contacts: {
    name: string;
    jobTitle: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
    isDecisionMaker: boolean;
    coffeeOrder: string | null;
    dietary: string | null;
    pronouns: string | null;
    notes: string | null;
    facts: { label: string; detail: string | null }[];
  }[];
  projects: {
    name: string;
    status: string;
    health: string;
    summary: string | null;
    targetDate: string | null;
  }[];
  communications: {
    occurredAt: Date;
    type: string;
    direction: string;
    subject: string | null;
    preview: string | null;
  }[];
  tasks: { title: string; dueDate: string | null; assigneeName: string | null }[];
  generatedAt: Date;
  crmUrl: string;
};

const DATE = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function day(value: Date | string | null): string {
  if (!value) return "not set";
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "not set" : DATE.format(d);
}

/** Enum values are snake_case in the database and unreadable in prose. */
function words(value: string): string {
  return value.replace(/_/g, " ");
}

function relationship(input: BriefInput): string {
  const kinds = [
    input.isCustomer && "customer",
    input.isSupplier && "supplier",
    input.isMedia && "media contact",
  ].filter(Boolean) as string[];
  if (kinds.length === 0) return "no relationship recorded yet";
  if (kinds.length === 1) return `a ${kinds[0]}`;
  return `a ${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)}`;
}

export function buildBrief(input: BriefInput): string {
  const L: string[] = [];

  L.push(`# ${input.name}`);
  L.push("");
  L.push(
    `${input.name} is ${relationship(input)} of Ankor'd. This brief is generated from the Ankor'd CRM and was last written on ${day(input.generatedAt)}. Do not edit it — it is overwritten whenever the record changes.`,
  );
  L.push("");

  /* ── the facts ── */
  L.push("## About them");
  L.push("");
  if (input.legalName && input.legalName !== input.name) {
    L.push(`- Legal name: ${input.legalName}`);
  }
  L.push(`- Relationship to Ankor'd: ${relationship(input)}`);
  L.push(`- Status: ${words(input.status)}`);
  if (input.industry) L.push(`- Industry: ${input.industry}`);
  if (input.segment) L.push(`- Segment: ${input.segment}`);
  if (input.ownerName) L.push(`- Account owner at Ankor'd: ${input.ownerName}`);
  if (input.phone) L.push(`- Phone: ${input.phone}`);
  if (input.email) L.push(`- Email: ${input.email}`);
  if (input.website) L.push(`- Website: ${input.website}`);
  if (input.address) L.push(`- Address: ${input.address}`);
  if (input.tags.length) L.push(`- Tags: ${input.tags.join(", ")}`);
  L.push(
    `- Last real contact: ${input.lastActivityAt ? day(input.lastActivityAt) : "never recorded"}`,
  );
  L.push("");

  /* ── people ── */
  L.push("## People");
  L.push("");
  if (input.contacts.length === 0) {
    L.push("No people recorded against them yet.");
  } else {
    for (const c of input.contacts) {
      const role = [
        c.jobTitle,
        c.isPrimary ? "primary contact" : null,
        c.isDecisionMaker ? "decision maker" : null,
      ]
        .filter(Boolean)
        .join(", ");
      L.push(`### ${c.name}${role ? ` — ${role}` : ""}`);
      if (c.pronouns) L.push(`- Pronouns: ${c.pronouns}`);
      if (c.email) L.push(`- Email: ${c.email}`);
      if (c.phone) L.push(`- Phone: ${c.phone}`);
      if (c.coffeeOrder) L.push(`- Coffee order: ${c.coffeeOrder}`);
      if (c.dietary) L.push(`- Dietary needs: ${c.dietary}`);
      if (c.notes) L.push(`- Notes: ${c.notes}`);
      for (const f of c.facts) {
        L.push(`- Worth remembering: ${f.label}${f.detail ? ` — ${f.detail}` : ""}`);
      }
      L.push("");
    }
  }
  L.push("");

  /* ── work ── */
  L.push("## Projects");
  L.push("");
  if (input.projects.length === 0) {
    L.push("No projects on record.");
  } else {
    for (const p of input.projects) {
      L.push(
        `- **${p.name}** — ${words(p.status)}, ${words(p.health)}, target ${day(p.targetDate)}${p.summary ? `. ${p.summary}` : ""}`,
      );
    }
  }
  L.push("");

  /* ── what was said ── */
  L.push("## Recent conversations");
  L.push("");
  if (input.communications.length === 0) {
    L.push("Nothing logged yet.");
  } else {
    for (const c of input.communications) {
      const what = c.subject ?? c.preview ?? "(no subject)";
      L.push(`- ${day(c.occurredAt)} — ${words(c.direction)} ${c.type}: ${what}`);
    }
  }
  L.push("");

  /* ── what happens next ── */
  L.push("## Open follow-ups");
  L.push("");
  if (input.tasks.length === 0) {
    L.push("Nothing outstanding.");
  } else {
    for (const t of input.tasks) {
      L.push(
        `- ${t.title} — due ${day(t.dueDate)}${t.assigneeName ? `, ${t.assigneeName}` : ""}`,
      );
    }
  }
  L.push("");

  if (input.notes) {
    L.push("## Notes");
    L.push("");
    L.push(input.notes);
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push(
    `Account balances and invoice history are deliberately not in this file — they change with every payment and would make it stale. See the record in The Gangway: ${input.crmUrl}`,
  );
  L.push("");

  return L.join("\n");
}
