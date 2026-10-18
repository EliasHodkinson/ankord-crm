"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Rows3,
  Table2,
  UserRound,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PROJECT_HEALTH, StatusBadge } from "@/components/ui/status";
import { TIMING_DOT } from "./step-chip";
import { LABEL_COL, PhaseRow, StepRow, TimelineFrame, TimelineRow } from "./timeline-kit";
import { TrendsBand, TrendsTable } from "./portfolio-trends";
import { ViewToggle, type ViewOption } from "./view-toggle";
import {
  axisAround,
  DAY_PX,
  daysBetween,
  parseDay,
  positionOn,
  spanOf,
  startOfToday,
  ticksFor,
  timingOf,
  type Span,
  type TimelineZoom,
} from "@/lib/runbook-views";
import {
  identityVar,
  projectSpan,
  trendsOf,
  type Portfolio,
  type PortfolioPhase,
  type PortfolioProject,
  type PortfolioStep,
  type TimelineGroup,
} from "@/lib/portfolio";
import { cn, formatDate } from "@/lib/utils";

const GROUPS: ViewOption[] = [
  { value: "partner", label: "Partner", icon: Building2 },
  { value: "owner", label: "Lead", icon: UserRound },
  { value: "none", label: "None", icon: Rows3 },
];

const ZOOMS: ViewOption[] = [
  { value: "week", label: "Week", icon: ZoomIn },
  { value: "month", label: "Month", icon: ZoomIn },
  { value: "quarter", label: "Quarter", icon: ZoomIn },
];

/**
 * Every project on one axis: a row each, grouped by business partner or lead,
 * with the trends band above so a peak lines up with the work causing it.
 * Opening a row draws that project's phases and steps from `timeline-kit`,
 * the same rows its own runbook timeline uses.
 */
export function PortfolioTimeline({
  portfolio,
  group,
  zoom,
  range,
}: {
  portfolio: Portfolio;
  group: TimelineGroup;
  zoom: TimelineZoom;
  /** The date-range filter, when set: the axis then covers exactly that. */
  range?: { from?: string; to?: string };
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [numbers, setNumbers] = useState(false);
  const today = startOfToday();

  const { stepsOf, phasesOf, spans } = useMemo(() => {
    const stepsOf = new Map<string, PortfolioStep[]>();
    for (const s of portfolio.steps) {
      const list = stepsOf.get(s.projectId);
      if (list) list.push(s);
      else stepsOf.set(s.projectId, [s]);
    }
    const phasesOf = new Map<string, PortfolioPhase[]>();
    for (const ph of portfolio.phases) {
      const list = phasesOf.get(ph.projectId);
      if (list) list.push(ph);
      else phasesOf.set(ph.projectId, [ph]);
    }
    const spans = new Map<string, Span | null>(
      portfolio.projects.map((p) => [p.id, projectSpan(p, stepsOf.get(p.id) ?? [])]),
    );
    return { stepsOf, phasesOf, spans };
  }, [portfolio]);

  const dated = portfolio.projects.filter((p) => spans.get(p.id));
  const undated = portfolio.projects.filter((p) => !spans.get(p.id));

  const from = range?.from;
  const to = range?.to;
  const unit = zoom === "quarter" ? "month" : "week";
  const { axis, points } = useMemo(() => {
    const fromDay = parseDay(from);
    const toDay = parseDay(to);
    const fitted = axisAround(
      [...spans.values()].filter((s): s is Span => s !== null),
      startOfToday(),
    );
    const axis: Span | null =
      fitted && (fromDay || toDay)
        ? { start: fromDay ?? fitted.start, end: toDay ?? fitted.end }
        : fitted;
    const points = axis ? trendsOf(axis, unit, portfolio.projects, spans, portfolio.steps) : [];
    return { axis, points };
  }, [portfolio, spans, unit, from, to]);

  const trackWidth = axis ? Math.max(600, daysBetween(axis.start, axis.end) * DAY_PX[zoom]) : 0;

  // Open on today, a third of the way in, and again whenever the zoom changes.
  const todayAt = axis ? positionOn(axis, today) : 0;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, (todayAt / 100) * trackWidth - (el.clientWidth - 224) / 3);
  }, [zoom, trackWidth, todayAt]);

  function nudge(direction: number) {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: direction * (el.clientWidth - 224) * 0.8, behavior: "smooth" });
  }

  const groups = groupProjects(dated, group);

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-[var(--text-muted)]">Group</span>
          <ViewToggle views={GROUPS} param="group" defaultView="partner" label="Group by" />
          <span className="ml-1 text-[12px] text-[var(--text-muted)]">Zoom</span>
          <ViewToggle views={ZOOMS} param="zoom" defaultView="month" label="Zoom" />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setNumbers((v) => !v)} aria-pressed={numbers}>
            <Table2 />
            {numbers ? "Hide the numbers" : "Show the numbers"}
          </Button>
          <Button variant="ghost" size="sm" aria-label="Earlier" onClick={() => nudge(-1)}>
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const el = scroller.current;
              if (el) {
                el.scrollTo({
                  left: Math.max(0, (todayAt / 100) * trackWidth - (el.clientWidth - 224) / 3),
                  behavior: "smooth",
                });
              }
            }}
          >
            Today
          </Button>
          <Button variant="ghost" size="sm" aria-label="Later" onClick={() => nudge(1)}>
            <ChevronRight />
          </Button>
        </div>
      </header>

      {!axis ? (
        <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
          None of these projects has a date yet — give them a start, a target or dated steps and the
          timeline draws itself.
        </p>
      ) : (
        <TimelineFrame
          ref={scroller}
          axis={axis}
          ticks={ticksFor(axis, zoom)}
          trackWidth={trackWidth}
          above={<TrendsBand axis={axis} points={points} unit={unit} />}
        >
          {groups.map(({ key, label, projects }) => (
            <section key={key} aria-label={label ?? "Projects"}>
              {label ? (
                <TimelineRow
                  className="mt-2 border-b border-[var(--border-soft)]"
                  trackClassName="h-7"
                  label={
                    <span className="flex items-baseline gap-2 py-1">
                      <span className="truncate text-[12px] font-semibold tracking-[0.02em] text-[var(--text)]">
                        {label}
                      </span>
                      <span className="text-[11px] text-[var(--text-faint)] tabular">{projects.length}</span>
                    </span>
                  }
                />
              ) : null}
              {projects.map((project) => (
                <ProjectRows
                  key={project.id}
                  project={project}
                  span={spans.get(project.id)!}
                  steps={stepsOf.get(project.id) ?? []}
                  phases={phasesOf.get(project.id) ?? []}
                  axis={axis}
                  meta={group === "owner" ? project.customerName : (project.ownerName ?? "No lead")}
                  open={open.has(project.id)}
                  onToggle={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(project.id)) next.delete(project.id);
                      else next.add(project.id);
                      return next;
                    })
                  }
                />
              ))}
            </section>
          ))}
        </TimelineFrame>
      )}

      {numbers && axis ? <TrendsTable points={points} unit={unit} /> : null}

      {portfolio.truncated ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          Showing the first {portfolio.projects.length} projects — narrow the filters to see the rest.
        </p>
      ) : null}

      {undated.length > 0 ? (
        <section className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
          <h4 className="mb-1.5 text-[11px] font-semibold tracking-[0.02em] text-[var(--text-muted)]">
            Not on the timeline — no dates yet · {undated.length}
          </h4>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {undated.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="text-[12px] text-[var(--text)] underline-offset-2 hover:text-[var(--accent)] hover:underline"
                >
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function groupProjects(projects: PortfolioProject[], group: TimelineGroup) {
  if (group === "none") return [{ key: "all", label: null, projects }];
  const out = new Map<string, { key: string; label: string; projects: PortfolioProject[] }>();
  for (const p of projects) {
    const key = group === "owner" ? (p.ownerId ?? "none") : p.customerId;
    const label = group === "owner" ? (p.ownerName ?? "No lead") : p.customerName;
    const bucket = out.get(key);
    if (bucket) bucket.projects.push(p);
    else out.set(key, { key, label, projects: [p] });
  }
  // "No lead" goes last; everything else alphabetically.
  return [...out.values()].sort(
    (a, b) => Number(a.key === "none") - Number(b.key === "none") || a.label.localeCompare(b.label),
  );
}

/** A project's summary row, and — opened — its phases and steps. */
function ProjectRows({
  project,
  span,
  steps,
  phases,
  axis,
  meta,
  open,
  onToggle,
}: {
  project: PortfolioProject;
  span: Span;
  steps: PortfolioStep[];
  phases: PortfolioPhase[];
  axis: Span;
  meta: string;
  open: boolean;
  onToggle: () => void;
}) {
  const colour = identityVar(project.id);
  const left = positionOn(axis, span.start);
  const right = positionOn(axis, span.end);
  const target = parseDay(project.targetDate);
  const quiet = project.status === "on_hold" || project.status === "complete" || project.status === "cancelled";
  const href = (stepId: string) => `/projects/${project.id}?step=${stepId}`;

  return (
    <div className={cn(open && "pb-2")}>
      <div className="group flex items-center">
        <div className={cn(LABEL_COL, "flex items-center gap-1 py-1")}>
          <button
            type="button"
            // Focusing a button in the sticky column makes the browser scroll
            // the timeline back to where the column would sit unstuck.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? `Hide ${project.name}'s steps` : `Show ${project.name}'s steps`}
            className="grid size-5 shrink-0 place-items-center rounded text-[var(--text-faint)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
          >
            <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} />
          </button>
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: colour }} />
          <span className="min-w-0 flex-1">
            <Link
              href={`/projects/${project.id}`}
              className="block truncate text-[12px] leading-4 font-medium text-[var(--text)] underline-offset-2 hover:text-[var(--accent)] hover:underline"
            >
              {project.name}
            </Link>
            <span className="block truncate text-[11px] leading-4 text-[var(--text-muted)]">
              {meta}
              {project.status === "on_hold" ? " · On hold" : project.status === "complete" ? " · Complete" : ""}
            </span>
          </span>
          {project.status === "active" && project.health !== "on_track" ? (
            <StatusBadge map={PROJECT_HEALTH} value={project.health} dot />
          ) : null}
        </div>

        <div className="relative h-10 flex-1">
          {/* The project's span, with its phases laid over it. */}
          <span
            title={`${project.name} · ${formatDate(span.start)} to ${formatDate(span.end)}`}
            className={cn("absolute top-2 h-3 rounded-full", quiet && "opacity-50")}
            style={{
              left: `${left}%`,
              width: `max(0.75rem, ${right - left}%)`,
              background: `color-mix(in oklab, ${colour} 22%, var(--surface))`,
            }}
          />
          {phases.map((phase) => {
            const ps = spanOf(steps.filter((s) => s.phaseId === phase.id));
            if (!ps) return null;
            const l = positionOn(axis, ps.start);
            const r = positionOn(axis, ps.end);
            return (
              <span
                key={phase.id}
                title={`${phase.num} ${phase.label} · ${formatDate(ps.start)} to ${formatDate(ps.end)}`}
                className={cn(
                  "absolute top-2 h-3 rounded-full ring-2 ring-[var(--surface)]",
                  quiet && "opacity-50",
                )}
                style={{ left: `${l}%`, width: `max(0.5rem, ${r - l}%)`, background: colour }}
              />
            );
          })}
          {target ? (
            <span
              title={`${project.name} · Target ${formatDate(project.targetDate)}`}
              className="absolute top-[0.8rem] size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] ring-2 ring-[var(--surface)]"
              style={{ left: `${positionOn(axis, target)}%`, background: "var(--text)" }}
            />
          ) : null}
          {/* Steps, as markers under the bar. */}
          {steps.map((step) => {
            const due = parseDay(step.dueDate);
            if (!due || step.status === "not_applicable") return null;
            const timing = timingOf(step);
            return (
              <Link
                key={step.id}
                href={href(step.id)}
                title={`${step.title} · Due ${formatDate(step.dueDate)}${timing === "overdue" ? " · Overdue" : ""}`}
                className={cn(
                  "absolute bottom-1 size-2 -translate-x-1/2 rounded-full ring-1 ring-[var(--surface)] hover:scale-150",
                  timing === "upcoming" ? "" : TIMING_DOT[timing],
                  step.status === "blocked" && "ring-2 ring-[var(--danger)]",
                )}
                style={{
                  left: `${positionOn(axis, due)}%`,
                  ...(timing === "upcoming" ? { background: colour } : {}),
                }}
              />
            );
          })}
        </div>
      </div>

      {open
        ? phases.map((phase) => {
            const phaseSteps = steps.filter((s) => s.phaseId === phase.id && s.dueDate);
            if (phaseSteps.length === 0) return null;
            return (
              <section key={phase.id}>
                <PhaseRow
                  num={phase.num}
                  label={phase.label}
                  span={spanOf(phaseSteps)}
                  axis={axis}
                  colour={colour}
                  count={phaseSteps.length}
                  indent
                />
                {phaseSteps.map((step) => (
                  <StepRow key={step.id} step={step} axis={axis} colour={colour} href={href(step.id)} indent />
                ))}
              </section>
            );
          })
        : null}
    </div>
  );
}
