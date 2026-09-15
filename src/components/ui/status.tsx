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
