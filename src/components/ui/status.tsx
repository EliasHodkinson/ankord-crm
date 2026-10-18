import * as React from "react";
import { Badge } from "./badge";

/** Single source of truth for how every enum value is worded and coloured. */

type Tone = React.ComponentProps<typeof Badge>["tone"];
type Entry = { label: string; tone: Tone };

export const LEAD_STAGES: Record<string, Entry> = {
  new: { label: "New", tone: "neutral" },
  contacted: { label: "Contacted", tone: "info" },
  qualified: { label: "Qualified", tone: "brand" },
  proposal: { label: "Proposal out", tone: "accent" },
  negotiation: { label: "Negotiating", tone: "accent" },
  won: { label: "Won", tone: "ok" },
  lost: { label: "Lost", tone: "muted" },
};

export const CUSTOMER_STATUS: Record<string, Entry> = {
  prospect: { label: "Prospect", tone: "info" },
  active: { label: "Active", tone: "ok" },
  on_hold: { label: "On hold", tone: "warn" },
  former: { label: "Former", tone: "muted" },
};

export const PROJECT_STATUS: Record<string, Entry> = {
  planning: { label: "Planning", tone: "info" },
  active: { label: "Active", tone: "brand" },
  on_hold: { label: "On hold", tone: "warn" },
  complete: { label: "Complete", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export const PROJECT_HEALTH: Record<string, Entry> = {
  on_track: { label: "On track", tone: "ok" },
  at_risk: { label: "At risk", tone: "warn" },
  off_track: { label: "Off track", tone: "danger" },
};

export const STEP_STATUS: Record<string, Entry> = {
  todo: { label: "To do", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  blocked: { label: "Blocked", tone: "danger" },
  done: { label: "Done", tone: "ok" },
  not_applicable: { label: "N/A", tone: "muted" },
};

/** Runbook tags are free text; these are the ones worth colouring. */
const STEP_TAG_TONE: Record<string, Tone> = {
  CRITICAL: "danger",
  URGENT: "danger",
  SECURITY: "danger",
  LAUNCH: "danger",
  BLOCKER: "warn",
  "DEPENDS ON INCUMBENT": "warn",
  MONITOR: "warn",
  "SIGN-OFF": "accent",
  MILESTONE: "accent",
  "QUICK WIN": "accent",
  VERIFY: "ok",
  CONFIRM: "ok",
  AUDIT: "ok",
  "CLOSE OUT": "ok",
};

/**
 * A tag's tone. Once the step is finished its tag is history, not a call to
 * action — a done step still tagged BLOCKER should not read as one.
 */
export function stepTagTone(tag: string, status?: string): Tone {
  if (status === "done" || status === "not_applicable") return "muted";
  return STEP_TAG_TONE[tag.trim().toUpperCase()] ?? "neutral";
}

/** How a step that is holding things up is described, wherever it shows. */
export const STEP_BLOCKER = {
  blocked: { label: "Blocked", tone: "danger" },
  tagged: { label: "Blocker", tone: "warn" },
  clear: "Clear blocker",
  clearHint: "Marks it in progress and drops the blocker tag and who it was waiting on.",
} as const satisfies {
  blocked: Entry;
  tagged: Entry;
  clear: string;
  clearHint: string;
};

export const PRIORITY: Record<string, Entry> = {
  low: { label: "Low", tone: "muted" },
  normal: { label: "Normal", tone: "neutral" },
  high: { label: "High", tone: "warn" },
  urgent: { label: "Urgent", tone: "danger" },
};

export const COMM_TYPE: Record<string, Entry> = {
  email: { label: "Email", tone: "brand" },
  call: { label: "Call", tone: "info" },
  meeting: { label: "Meeting", tone: "accent" },
  note: { label: "Note", tone: "neutral" },
  teams: { label: "Teams", tone: "info" },
};

/** "member" is shown as Staff — the ordinary Ankor'd employee, who sees the whole book. */
export const USER_ROLE: Record<string, Entry> = {
  admin: { label: "Admin", tone: "brand" },
  member: { label: "Staff", tone: "neutral" },
  viewer: { label: "Viewer", tone: "neutral" },
  restricted: { label: "Restricted", tone: "accent" },
};

export const USER_ROLE_HINT: Record<string, string> = {
  admin: "Everything, including settings, people and access",
  member: "Every record — create and edit",
  viewer: "Every record, read only",
  restricted: "Only the business partners granted to them",
};

/** What the CRM has done in SharePoint for one person on one folder. */
export const FOLDER_GRANT_STATUS: Record<string, Entry> = {
  applied: { label: "Shared", tone: "ok" },
  preexisting: { label: "Already had access", tone: "info" },
  failed: { label: "Not shared", tone: "danger" },
  revoked: { label: "Removed", tone: "muted" },
  revoke_failed: { label: "Removal failed", tone: "danger" },
};

export const FILE_ACCESS: Record<string, Entry> = {
  write: { label: "Can edit files", tone: "neutral" },
  read: { label: "Can view files", tone: "neutral" },
};

/* ── sales and purchasing documents (spec §4.6) ─────────────────── */

/** Status wording differs by document type; tones do not. */
export const DOCUMENT_STATUS: Record<string, Record<string, Entry>> = {
  quote: {
    draft: { label: "Draft", tone: "neutral" },
    open: { label: "Sent", tone: "info" },
    closed: { label: "Accepted", tone: "ok" },
    cancelled: { label: "Deleted", tone: "muted" },
  },
  sales_order: {
    draft: { label: "Draft", tone: "neutral" },
    open: { label: "Confirmed", tone: "info" },
    closed: { label: "Complete", tone: "ok" },
    cancelled: { label: "Cancelled", tone: "muted" },
  },
  invoice: {
    draft: { label: "Draft", tone: "neutral" },
    open: { label: "Awaiting payment", tone: "info" },
    closed: { label: "Paid", tone: "ok" },
    cancelled: { label: "Voided", tone: "muted" },
  },
  delivery: {
    open: { label: "Delivered", tone: "ok" },
    cancelled: { label: "Cancelled", tone: "muted" },
  },
  purchase_order: {
    draft: { label: "Draft", tone: "neutral" },
    open: { label: "Ordered", tone: "info" },
    closed: { label: "Complete", tone: "ok" },
    cancelled: { label: "Deleted", tone: "muted" },
  },
  goods_receipt: {
    open: { label: "Received", tone: "ok" },
    cancelled: { label: "Cancelled", tone: "muted" },
  },
  bill: {
    draft: { label: "Draft", tone: "neutral" },
    open: { label: "Awaiting payment", tone: "info" },
    closed: { label: "Paid", tone: "ok" },
    cancelled: { label: "Voided", tone: "muted" },
  },
};

/** States derived at display time rather than stored. */
export const DOCUMENT_STATE_EXTRA = {
  quoteAccepted: { label: "Accepted", tone: "ok" },
  quoteDeclined: { label: "Declined", tone: "muted" },
  quoteExpired: { label: "Expired", tone: "warn" },
  closedByHand: { label: "Closed", tone: "neutral" },
  overdue: { label: "Overdue", tone: "warn" },
  partPaid: { label: "Part paid", tone: "info" },
} as const satisfies Record<string, Entry>;

/**
 * The one badge for a document's state, folding in what is derived: a quote's
 * outcome or expiry, an invoice that is overdue or part paid, an order closed
 * by hand rather than completed.
 */
export function documentStatus(doc: {
  type: string;
  status: string;
  quoteOutcome?: string | null;
  closedBy?: string | null;
  dueDate?: string | null;
  amountPaid?: string | null;
  amountDue?: string | null;
  /** ISO date for "today", passed in so rendering stays pure. */
  today: string;
}): Entry {
  const base = DOCUMENT_STATUS[doc.type]?.[doc.status] ?? { label: doc.status, tone: "neutral" as Tone };
  if (doc.type === "quote" && doc.status !== "cancelled") {
    if (doc.quoteOutcome === "declined") return DOCUMENT_STATE_EXTRA.quoteDeclined;
    if (doc.quoteOutcome === "expired") return DOCUMENT_STATE_EXTRA.quoteExpired;
    if (doc.quoteOutcome === "accepted") return DOCUMENT_STATE_EXTRA.quoteAccepted;
    if (doc.status === "open" && doc.dueDate && doc.dueDate < doc.today) {
      return DOCUMENT_STATE_EXTRA.quoteExpired;
    }
  }
  if (doc.status === "closed" && doc.closedBy === "person" && doc.type !== "quote") {
    return DOCUMENT_STATE_EXTRA.closedByHand;
  }
  if ((doc.type === "invoice" || doc.type === "bill") && doc.status === "open") {
    if (Number(doc.amountDue ?? 0) > 0 && doc.dueDate && doc.dueDate < doc.today) {
      return DOCUMENT_STATE_EXTRA.overdue;
    }
    if (Number(doc.amountPaid ?? 0) > 0) return DOCUMENT_STATE_EXTRA.partPaid;
  }
  return base;
}

/** Document-level fulfilment, as stored in documents.fulfilment. */
export const FULFILMENT: Record<string, Entry> = {
  to_order: { label: "To order", tone: "warn" },
  on_order: { label: "On order", tone: "info" },
  ready: { label: "Ready", tone: "ok" },
  part_invoiced: { label: "Part invoiced", tone: "info" },
  invoiced: { label: "Invoiced, to deliver", tone: "info" },
  to_deliver: { label: "To deliver", tone: "warn" },
  delivered: { label: "Delivered", tone: "ok" },
  to_receive: { label: "To receive", tone: "info" },
  part_received: { label: "Part received", tone: "info" },
  received: { label: "Received", tone: "ok" },
};

/** Per sales-order line (lib/sales/fulfilment.ts#lineState). */
export const LINE_STATE: Record<string, Entry> = {
  to_order: { label: "To order", tone: "warn" },
  on_order: { label: "On order", tone: "info" },
  ready: { label: "Ready", tone: "ok" },
  to_invoice: { label: "To invoice", tone: "neutral" },
  invoiced: { label: "Invoiced, to deliver", tone: "info" },
  done: { label: "Done", tone: "ok" },
};

export const QUOTE_OUTCOME: Record<string, Entry> = {
  accepted: { label: "Accepted", tone: "ok" },
  declined: { label: "Declined", tone: "muted" },
  expired: { label: "Expired", tone: "warn" },
};

/** Where a document stands with Xero. */
export const XERO_SYNC: Record<string, Entry> = {
  local_only: { label: "Gangway only", tone: "muted" },
  pending: { label: "Not in Xero yet", tone: "neutral" },
  pushing: { label: "Sending to Xero", tone: "info" },
  synced: { label: "In Xero", tone: "ok" },
  stale: { label: "Updating Xero", tone: "info" },
  failed: { label: "Xero problem", tone: "danger" },
  blocked: { label: "Needs attention", tone: "warn" },
};

/** Import from Xero: why a contact is suggested for a partner (lib/xero/import/match.ts). */
export const IMPORT_MATCH: Record<string, Entry> = {
  linked: { label: "Linked", tone: "ok" },
  abn: { label: "Same ABN", tone: "brand" },
  email: { label: "Same email", tone: "brand" },
  name: { label: "Name only — check", tone: "warn" },
};

/** Import from Xero: what happens to a document (lib/xero/import/scope.ts DocPlan). */
export const IMPORT_DOC_PLAN: Record<string, Entry> = {
  create: { label: "New", tone: "info" },
  update: { label: "Update from Xero", tone: "brand" },
  refresh: { label: "Already here", tone: "neutral" },
  waiting: { label: "Contact not matched", tone: "warn" },
  currency: { label: "Not AUD", tone: "muted" },
};

/** Import from Xero: what happens to an item. */
export const IMPORT_ITEM_PLAN: Record<string, Entry> = {
  create: { label: "New", tone: "info" },
  update: { label: "Update from Xero", tone: "brand" },
  unchanged: { label: "Up to date", tone: "ok" },
  held: { label: "Left as it is", tone: "warn" },
  conflict: { label: "Code clash", tone: "danger" },
};

export const ROW_TYPE: Record<string, { label: string; hint: string }> = {
  item: { label: "Item", hint: "A priced line" },
  alternative: { label: "Alternative", hint: "An optional extra, shown on the quote but not counted" },
  text: { label: "Text", hint: "A heading or note between lines" },
  subtotal: { label: "Subtotal", hint: "Adds up the lines above it" },
};

export const AMOUNTS_ARE: Record<string, { label: string }> = {
  exclusive: { label: "Tax exclusive" },
  inclusive: { label: "Tax inclusive" },
  no_tax: { label: "No tax" },
};

export function StatusBadge({
  map,
  value,
  dot,
  className,
}: {
  map: Record<string, Entry>;
  value: string | null | undefined;
  dot?: boolean;
  className?: string;
}) {
  const entry = (value && map[value]) || { label: value ?? "—", tone: "neutral" as Tone };
  return (
    <Badge tone={entry.tone} dot={dot} className={className}>
      {entry.label}
    </Badge>
  );
}

export const labelFor = (map: Record<string, Entry>, value: string) =>
  map[value]?.label ?? value;

export const optionsFor = (map: Record<string, Entry>) =>
  Object.entries(map).map(([value, { label }]) => ({ value, label }));
