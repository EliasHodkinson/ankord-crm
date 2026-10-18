import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarWindow,
  parsePortfolioFilters,
  projectSpan,
  trendsOf,
  type PortfolioProject,
  type PortfolioStep,
} from "./portfolio";
import { bucketsOf, dayKey, parseDay, startOfWeek, ticksFor } from "./runbook-views";

const project = (over: Partial<PortfolioProject> = {}): PortfolioProject => ({
  id: "p1",
  name: "Onboarding",
  code: null,
  status: "active",
  health: "on_track",
  customerId: "c1",
  customerName: "Mister Fixed",
  ownerId: null,
  ownerName: null,
  startDate: null,
  targetDate: null,
  completedDay: null,
  ...over,
});

const step = (over: Partial<PortfolioStep> = {}): PortfolioStep => ({
  id: "s1",
  projectId: "p1",
  phaseId: "ph1",
  title: "Kick-off",
  tag: null,
  ownerLabel: null,
  status: "todo",
  dueDate: null,
  warning: null,
  completedDay: null,
  ...over,
});

test("filters drop anything that is not a uuid or a date, and order the range", () => {
  const f = parsePortfolioFilters({
    owner: "x'; drop table",
    partner: "8f0e7d9a-1b2c-4d3e-8f90-123456789abc",
    from: "2026-12-01",
    to: "2026-11-01",
  });
  assert.equal(f.owner, undefined);
  assert.equal(f.partner, "8f0e7d9a-1b2c-4d3e-8f90-123456789abc");
  assert.equal(f.from, "2026-11-01");
  assert.equal(f.to, "2026-12-01");
  assert.equal(f.status, "live");
  assert.equal(parsePortfolioFilters({ owner: "none" }).owner, "none");
});

test("a project's span widens to its steps", () => {
  const span = projectSpan(project({ startDate: "2026-10-05", targetDate: "2026-11-30" }), [
    step({ dueDate: "2026-12-10" }),
  ]);
  assert.equal(dayKey(span!.start), "2026-10-05");
  assert.equal(dayKey(span!.end), "2026-12-10");
  assert.equal(projectSpan(project(), [step()]), null);
});

test("weeks start on Monday and month buckets are calendar months", () => {
  assert.equal(dayKey(startOfWeek(parseDay("2026-10-18")!)), "2026-10-12");
  const weeks = bucketsOf({ start: parseDay("2026-10-14")!, end: parseDay("2026-10-27")! }, "week");
  assert.deepEqual(weeks.map((b) => b.key), ["2026-10-12", "2026-10-19", "2026-10-26"]);
  const months = bucketsOf({ start: parseDay("2026-10-14")!, end: parseDay("2026-12-02")! }, "month");
  assert.deepEqual(months.map((b) => b.key), ["2026-10-01", "2026-11-01", "2026-12-01"]);
});

test("quarter ticks fall on the first month of each quarter", () => {
  const ticks = ticksFor({ start: parseDay("2026-08-20")!, end: parseDay("2027-02-10")! }, "quarter");
  assert.deepEqual(ticks.map((t) => t.label), ["Q4 2026", "Q1 2027"]);
});

test("trends count due, done and running projects per bucket", () => {
  const axis = { start: parseDay("2026-10-12")!, end: parseDay("2026-10-25")! };
  const p1 = project({ id: "p1", startDate: "2026-10-12", targetDate: "2026-10-16" });
  const p2 = project({ id: "p2", startDate: "2026-10-14", targetDate: "2026-10-30" });
  const p3 = project({ id: "p3", status: "cancelled", startDate: "2026-10-12", targetDate: "2026-10-30" });
  const steps = [
    step({ id: "a", dueDate: "2026-10-13" }),
    step({ id: "b", dueDate: "2026-10-14", status: "done", completedDay: "2026-10-20" }),
    step({ id: "c", dueDate: "2026-10-21" }),
    step({ id: "d", dueDate: "2026-10-21", status: "not_applicable" }),
  ];
  const spans = new Map([p1, p2, p3].map((p) => [p.id, projectSpan(p, [])]));
  const points = trendsOf(axis, "week", [p1, p2, p3], spans, steps);
  assert.deepEqual(
    points.map((p) => [p.key, p.due, p.done, p.active]),
    [
      ["2026-10-12", 2, 0, 2],
      ["2026-10-19", 1, 1, 1],
    ],
  );
});

test("the month calendar always spans six weeks from a Monday", () => {
  const w = calendarWindow("month", parseDay("2026-10-01")!);
  assert.equal(w.from, "2026-09-28");
  assert.equal(w.to, "2026-11-08");
  assert.deepEqual(calendarWindow("week", parseDay("2026-10-12")!), { from: "2026-10-12", to: "2026-10-18" });
});
