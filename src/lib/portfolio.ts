/**
 * The portfolio: every project the person may see, read as a list, a calendar
 * or a timeline from the Projects page.
 *
 * A plain module, not a `"use server"` file — the client views import the
 * types, URL parsing and trend maths from here, and the read in
 * `lib/data/portfolio.ts` imports the filters.
 *
 * All state lives in the URL so a filtered view can be shared and saved as a
 * saved view, which is how a person keeps "my timeline, by owner".
 */

import {
  addDays,
  bucketsOf,
  dayKey,
  isTimelineZoom,
  parseDay,
  type Bucket,
  type PlacedStep,
  type Span,
  type TimelineZoom,
} from "@/lib/runbook-views";
import { tintIndex } from "@/lib/utils";

/* ───────────────────────── URL ───────────────────────── */

export const PORTFOLIO_VIEWS = ["list", "calendar", "timeline"] as const;
export type PortfolioView = (typeof PORTFOLIO_VIEWS)[number];

export const TIMELINE_GROUPS = ["partner", "owner", "none"] as const;
export type TimelineGroup = (typeof TIMELINE_GROUPS)[number];

export type CalendarMode = "month" | "week";

/** Every search param the Projects page reads. */
export type PortfolioParams = {
  view?: string;
  status?: string;
  q?: string;
  owner?: string;
  partner?: string;
  from?: string;
  to?: string;
  group?: string;
  zoom?: string;
  cal?: string;
  month?: string;
  week?: string;
};

export type PortfolioFilters = {
  /** "live" (planning, active, on hold), "all", or one project status. */
  status: string;
  q?: string;
  /** A user id, or "none" for projects with no lead. */
  owner?: string;
  partner?: string;
  from?: string;
  to?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Unparseable values are dropped rather than sent to Postgres. */
export function parsePortfolioFilters(p: PortfolioParams): PortfolioFilters {
  const day = (v?: string) => (v && DAY.test(v) && parseDay(v) ? v : undefined);
  let from = day(p.from);
  let to = day(p.to);
  if (from && to && from > to) [from, to] = [to, from];
  return {
    status: p.status || "live",
    q: p.q?.trim() || undefined,
    owner: p.owner === "none" || (p.owner && UUID.test(p.owner)) ? p.owner : undefined,
    partner: p.partner && UUID.test(p.partner) ? p.partner : undefined,
    from,
    to,
  };
}

export function portfolioViewOf(value: string | undefined): PortfolioView {
  return (PORTFOLIO_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as PortfolioView)
    : "list";
}

export function timelineGroupOf(value: string | undefined): TimelineGroup {
  return (TIMELINE_GROUPS as readonly string[]).includes(value ?? "")
    ? (value as TimelineGroup)
    : "partner";
}

export function timelineZoomOf(value: string | undefined): TimelineZoom {
  return isTimelineZoom(value) ? value : "month";
}

/** Params that belong to one view and mean nothing in another. */
export const VIEW_PARAMS = ["group", "zoom", "cal", "month", "week"];

/* ───────────────────────── records ───────────────────────── */

export type PortfolioProject = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  health: string;
  customerId: string;
  customerName: string;
  ownerId: string | null;
  ownerName: string | null;
  startDate: string | null;
  targetDate: string | null;
  /** Sydney calendar day the project was marked complete. */
  completedDay: string | null;
};

export type PortfolioPhase = {
  id: string;
  projectId: string;
  num: string;
  label: string;
};

export type PortfolioStep = PlacedStep & {
  projectId: string;
  /** Sydney calendar day the step was ticked off. */
  completedDay: string | null;
};

export type Portfolio = {
  projects: PortfolioProject[];
  phases: PortfolioPhase[];
  steps: PortfolioStep[];
  /** True when there were more projects than the views will draw. */
  truncated: boolean;
};

/**
 * A project's colour on the calendar and timeline. Hashed from its id, so it
 * keeps the same colour whatever is filtered out around it — colour follows
 * the project, never its rank. Six hues repeat across a big portfolio, so
 * every mark also carries the project's name or code.
 */
export function identityVar(projectId: string): string {
  return `var(--identity-${tintIndex(projectId, 6) + 1})`;
}

/** The short name a chip has room for. */
export function projectShortName(p: Pick<PortfolioProject, "code" | "name">): string {
  return p.code || p.name;
}

/**
 * Where a project sits in time: its start and target dates, widened to cover
 * every dated step, so a project with no dates still draws from its runbook.
 */
export function projectSpan(project: PortfolioProject, steps: PortfolioStep[]): Span | null {
  const days = [project.startDate, project.targetDate, project.completedDay]
    .concat(steps.map((s) => s.dueDate))
    .map((v) => parseDay(v))
    .filter((d): d is Date => d !== null);
  if (days.length === 0) return null;
  const sorted = days.sort((a, b) => a.getTime() - b.getTime());
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

/* ───────────────────────── trends ───────────────────────── */

export type TrendPoint = Bucket & {
  due: number;
  done: number;
  active: number;
};

/**
 * Per week or month: steps falling due, steps completed, and how many projects
 * were running. "Running" is the project's span overlapping the bucket — a
 * cancelled project is left out, a completed one counts until it finished.
 */
export function trendsOf(
  axis: Span,
  unit: "week" | "month",
  projects: PortfolioProject[],
  spans: Map<string, Span | null>,
  steps: PortfolioStep[],
): TrendPoint[] {
  const buckets = bucketsOf(axis, unit);
  const index = (day: string | null) => {
    const d = parseDay(day);
    if (!d) return -1;
    // Buckets are sorted and contiguous; a binary search keeps this linear-ish.
    let lo = 0;
    let hi = buckets.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (d.getTime() < buckets[mid].start.getTime()) hi = mid - 1;
      else if (d.getTime() >= buckets[mid].end.getTime()) lo = mid + 1;
      else return mid;
    }
    return -1;
  };

  const points: TrendPoint[] = buckets.map((b) => ({ ...b, due: 0, done: 0, active: 0 }));
  for (const step of steps) {
    if (step.status === "not_applicable") continue;
    const due = index(step.dueDate);
    if (due >= 0) points[due].due += 1;
    const done = step.status === "done" ? index(step.completedDay) : -1;
    if (done >= 0) points[done].done += 1;
  }
  for (const project of projects) {
    if (project.status === "cancelled") continue;
    const span = spans.get(project.id);
    if (!span) continue;
    const end = project.completedDay ? (parseDay(project.completedDay) ?? span.end) : span.end;
    for (const point of points) {
      if (span.start.getTime() < point.end.getTime() && end.getTime() >= point.start.getTime()) {
        point.active += 1;
      }
    }
  }
  return points;
}

/** "w/c 3 Nov" or "Nov 2026", for the band's tooltips and table. */
export function bucketLabel(b: Bucket, unit: "week" | "month"): string {
  if (unit === "month") {
    return b.start.toLocaleDateString("en-AU", { month: "short", year: "numeric" });
  }
  return `w/c ${b.start.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
}

/* ───────────────────────── calendar ───────────────────────── */

/** The days a calendar view covers, inclusive, as `YYYY-MM-DD`. */
export function calendarWindow(mode: CalendarMode, anchor: Date): { from: string; to: string } {
  if (mode === "week") return { from: dayKey(anchor), to: dayKey(addDays(anchor, 6)) };
  // The month grid always shows six weeks, Monday first.
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  return { from: dayKey(start), to: dayKey(addDays(start, 41)) };
}
