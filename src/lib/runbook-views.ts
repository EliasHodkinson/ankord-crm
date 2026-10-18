/**
 * Date and grouping maths for the runbook's board, calendar and timeline
 * views.
 *
 * A plain module, not a `"use server"` file — every export here is imported by
 * client components, and only async functions may cross that boundary.
 *
 * Step due dates arrive as `YYYY-MM-DD` strings from a Postgres `date` column.
 * They are parsed as *local* midnight throughout: `new Date("2026-10-02")`
 * parses as UTC and lands on the previous day for anyone east of Greenwich,
 * which is everyone using this.
 *
 * "Today" is Sydney's calendar day wherever the code runs — the server is in
 * UTC, and a server-rendered "today" must agree with the one the browser draws.
 *
 * The same maths serves one runbook and the whole portfolio (`/projects`).
 */

import { APP_TIME_ZONE } from "@/lib/utils";

/** The runbook views, in the order they appear in the switcher. */
export const RUNBOOK_VIEWS = ["list", "board", "calendar", "timeline"] as const;
export type RunbookView = (typeof RUNBOOK_VIEWS)[number];

export function isRunbookView(value: string | undefined): value is RunbookView {
  return !!value && (RUNBOOK_VIEWS as readonly string[]).includes(value);
}

/** A step, reduced to the parts these views actually position and colour. */
export type PlacedStep = {
  id: string;
  title: string;
  tag: string | null;
  ownerLabel: string | null;
  status: string;
  dueDate: string | null;
  phaseId: string;
  warning: string | null;
};

/* ───────────────────────── blockers ───────────────────────── */

/**
 * A step reads as a blocker two ways: its status is Blocked, or it carries the
 * template's free-text BLOCKER tag ("this gates the phase"). Either one can be
 * cleared with `clearStepBlocker`; a finished step is never a live blocker.
 */
export function isBlockerTag(tag: string | null | undefined): boolean {
  return tag?.trim().toUpperCase() === "BLOCKER";
}

export function blockerOf(step: Pick<PlacedStep, "status" | "tag">): "blocked" | "tagged" | null {
  if (step.status === "blocked") return "blocked";
  if (step.status === "done" || step.status === "not_applicable") return null;
  return isBlockerTag(step.tag) ? "tagged" : null;
}

/* ───────────────────────── days ───────────────────────── */

/** `YYYY-MM-DD` → local midnight. Anything else → null. */
export function parseDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const sydneyDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** An instant's Sydney calendar day, `YYYY-MM-DD`. */
export function sydneyDayKey(at: Date = new Date()): string {
  return sydneyDay.format(at);
}

/**
 * Today in Sydney, at local midnight, so day comparisons ignore the clock and
 * the server (UTC) and the browser land on the same day.
 */
export function startOfToday(): Date {
  return parseDay(sydneyDayKey()) as Date;
}

export function addDays(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
}

/** Whole calendar days from a to b — rounded, so a DST change is not a day. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** The Monday on or before the day given. */
export function startOfWeek(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}

export function dayKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/**
 * Where a step sits against the calendar. `done` and `not_applicable` are
 * never overdue — a step finished late is finished, and the view should not
 * keep shouting about it.
 */
export type StepTiming = "done" | "overdue" | "today" | "upcoming" | "undated";

export function timingOf(step: PlacedStep, today = startOfToday()): StepTiming {
  if (step.status === "done" || step.status === "not_applicable") return "done";
  const due = parseDay(step.dueDate);
  if (!due) return "undated";
  if (due.getTime() < today.getTime()) return "overdue";
  if (isSameDay(due, today)) return "today";
  return "upcoming";
}

/* ───────────────────────── months ───────────────────────── */

/** `YYYY-MM`, the calendar view's position in the URL. */
export type MonthKey = string;

export function monthKeyOf(d: Date): MonthKey {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}`;
}

export function parseMonthKey(key: string | undefined): Date | null {
  if (!key) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addMonths(key: MonthKey, delta: number): MonthKey {
  const base = parseMonthKey(key) ?? new Date();
  return monthKeyOf(new Date(base.getFullYear(), base.getMonth() + delta, 1));
}

export function monthLabel(key: MonthKey): string {
  const d = parseMonthKey(key);
  if (!d) return "—";
  return d.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}

/** Short form for the timeline axis — "Oct 26". */
export function monthTickLabel(d: Date): string {
  return d.toLocaleDateString("en-AU", { month: "short", year: "2-digit" });
}

/**
 * Six weeks of days covering the month, Monday first. Always 42 cells so the
 * grid never changes height as you page through months.
 */
export function monthGrid(key: MonthKey): Date[] {
  const first = parseMonthKey(key) ?? new Date();
  // getDay() is Sunday-0; shift so Monday is the first column.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
  return Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * Which month the calendar should open on: the current month when the project
 * runs through it, otherwise the month holding the earliest due date. Landing
 * on an empty grid is the one thing a calendar must not do.
 */
export function defaultMonth(steps: PlacedStep[], today = startOfToday()): MonthKey {
  const days = steps
    .map((s) => parseDay(s.dueDate))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  if (days.length === 0) return monthKeyOf(today);

  const current = monthKeyOf(today);
  if (days.some((d) => monthKeyOf(d) === current)) return current;

  const next = days.find((d) => d.getTime() >= today.getTime());
  return monthKeyOf(next ?? days[days.length - 1]);
}

/** Steps bucketed by `YYYY-MM-DD`, for dropping into calendar cells. */
export function groupByDay(steps: PlacedStep[]): Map<string, PlacedStep[]> {
  const out = new Map<string, PlacedStep[]>();
  for (const step of steps) {
    const due = parseDay(step.dueDate);
    if (!due) continue;
    const key = dayKey(due);
    const bucket = out.get(key);
    if (bucket) bucket.push(step);
    else out.set(key, [step]);
  }
  return out;
}

/* ───────────────────────── spans ───────────────────────── */

export type Span = { start: Date; end: Date };

/** Earliest to latest due date across the steps given. */
export function spanOf(steps: PlacedStep[]): Span | null {
  const days = steps
    .map((s) => parseDay(s.dueDate))
    .filter((d): d is Date => d !== null);
  if (days.length === 0) return null;
  let start = days[0];
  let end = days[0];
  for (const d of days) {
    if (d.getTime() < start.getTime()) start = d;
    if (d.getTime() > end.getTime()) end = d;
  }
  return { start, end };
}

/** Roughly a fortnight of breathing room at each end of the axis. */
const AXIS_PAD_DAYS = 10;

/**
 * The timeline's axis: whole months at each end, widened to include today so
 * the "today" rule is always somewhere on the chart.
 *
 * Then padded by a few days on both sides. Without it a step due on the first
 * or last day of the range sits at exactly 0% or 100%, and half its marker is
 * clipped by the scroll container.
 */
export function axisOf(steps: PlacedStep[], today = startOfToday()): Span | null {
  const span = spanOf(steps);
  return span ? axisAround([span], today) : null;
}

/** The smallest span covering every span given. */
export function unionOf(spans: Span[]): Span | null {
  if (spans.length === 0) return null;
  let { start, end } = spans[0];
  for (const s of spans) {
    if (s.start.getTime() < start.getTime()) start = s.start;
    if (s.end.getTime() > end.getTime()) end = s.end;
  }
  return { start, end };
}

/** `axisOf` for any set of spans — a portfolio of projects, not one runbook. */
export function axisAround(spans: Span[], today = startOfToday()): Span | null {
  const span = unionOf(spans);
  if (!span) return null;

  const lo = new Date(Math.min(span.start.getTime(), today.getTime()));
  const hi = new Date(Math.max(span.end.getTime(), today.getTime()));

  return {
    start: new Date(lo.getFullYear(), lo.getMonth(), 1 - AXIS_PAD_DAYS),
    // Day 0 of the following month is the last day of this one.
    end: new Date(hi.getFullYear(), hi.getMonth() + 1, AXIS_PAD_DAYS),
  };
}

/** Where a date sits on the axis, 0–100, clamped to the ends. */
export function positionOn(axis: Span, date: Date): number {
  const total = axis.end.getTime() - axis.start.getTime();
  if (total <= 0) return 0;
  const pct = ((date.getTime() - axis.start.getTime()) / total) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * First-of-month ticks across the axis, for gridlines and labels. Ticks
 * falling inside the axis padding are skipped rather than clamped, which
 * would stack a label on the very edge of the chart.
 */
export function monthTicks(axis: Span): Date[] {
  const ticks: Date[] = [];
  const cursor = new Date(axis.start.getFullYear(), axis.start.getMonth(), 1);
  while (cursor.getTime() <= axis.end.getTime()) {
    if (cursor.getTime() >= axis.start.getTime()) ticks.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return ticks;
}

/* ───────────────────────── zoom ───────────────────────── */

/** How much of the calendar a timeline shows at once. */
export const TIMELINE_ZOOMS = ["week", "month", "quarter"] as const;
export type TimelineZoom = (typeof TIMELINE_ZOOMS)[number];

export function isTimelineZoom(value: string | undefined): value is TimelineZoom {
  return !!value && (TIMELINE_ZOOMS as readonly string[]).includes(value);
}

/** Pixels per day: roughly a month, a quarter or a year across a laptop screen. */
export const DAY_PX: Record<TimelineZoom, number> = { week: 26, month: 7, quarter: 2.4 };

export type Tick = { at: Date; label: string };

/**
 * Gridlines for a zoom level — Mondays, first-of-months or first-of-quarters
 * inside the axis. As with `monthTicks`, ticks in the padding are skipped.
 */
export function ticksFor(axis: Span, zoom: TimelineZoom): Tick[] {
  if (zoom === "week") {
    const ticks: Tick[] = [];
    for (let at = startOfWeek(axis.start); at.getTime() <= axis.end.getTime(); at = addDays(at, 7)) {
      if (at.getTime() < axis.start.getTime()) continue;
      ticks.push({ at, label: at.toLocaleDateString("en-AU", { day: "numeric", month: "short" }) });
    }
    return ticks;
  }
  return monthTicks(axis)
    .filter((at) => zoom === "month" || at.getMonth() % 3 === 0)
    .map((at) => ({
      at,
      label: zoom === "quarter" ? `Q${at.getMonth() / 3 + 1} ${at.getFullYear()}` : monthTickLabel(at),
    }));
}

/** A run of days the trends band counts over: `[start, end)`. */
export type Bucket = { key: string; start: Date; end: Date };

/** Weeks (Monday first) or calendar months covering the axis. */
export function bucketsOf(axis: Span, unit: "week" | "month"): Bucket[] {
  const out: Bucket[] = [];
  let start =
    unit === "week"
      ? startOfWeek(axis.start)
      : new Date(axis.start.getFullYear(), axis.start.getMonth(), 1);
  while (start.getTime() <= axis.end.getTime()) {
    const end =
      unit === "week" ? addDays(start, 7) : new Date(start.getFullYear(), start.getMonth() + 1, 1);
    out.push({ key: dayKey(start), start, end });
    start = end;
  }
  return out;
}

/**
 * Phases are ordinal, so they take the ordinal chart ramp rather than the
 * per-phase accent — six steps, wrapping if a runbook ever runs longer.
 */
export function phaseRampVar(index: number): string {
  return `var(--chart-${(index % 6) + 1})`;
}
