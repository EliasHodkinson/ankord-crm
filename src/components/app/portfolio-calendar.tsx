"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarDays, CalendarRange, Flag, Play } from "lucide-react";
import { CalendarGrid, CalendarNav } from "./calendar-kit";
import { StepChip } from "./step-chip";
import { ViewToggle, type ViewOption } from "./view-toggle";
import {
  addDays,
  addMonths,
  dayKey,
  monthGrid,
  monthKeyOf,
  monthLabel,
  parseDay,
  parseMonthKey,
  startOfToday,
  startOfWeek,
} from "@/lib/runbook-views";
import {
  identityVar,
  projectShortName,
  type CalendarMode,
  type Portfolio,
  type PortfolioProject,
  type PortfolioStep,
} from "@/lib/portfolio";
import { formatDate } from "@/lib/utils";

const MODES: ViewOption[] = [
  { value: "month", label: "Month", icon: CalendarDays },
  { value: "week", label: "Week", icon: CalendarRange },
];

type Item =
  | { kind: "step"; step: PortfolioStep; project: PortfolioProject }
  | { kind: "milestone"; which: "start" | "target"; project: PortfolioProject };

/**
 * Every project's steps and milestones on one calendar, each in its project's
 * colour. The page has already narrowed the steps to the days on screen.
 */
export function PortfolioCalendar({
  portfolio,
  mode,
  anchor,
}: {
  portfolio: Portfolio;
  mode: CalendarMode;
  /** The month's first day, or the week's Monday. */
  anchor: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, start] = useTransition();
  const today = startOfToday();

  const anchorDay = parseDay(anchor) ?? today;
  const monthKey = monthKeyOf(anchorDay);
  const monday = startOfWeek(anchorDay);
  const days = mode === "week" ? Array.from({ length: 7 }, (_, i) => addDays(monday, i)) : monthGrid(monthKey);
  const monthOf = parseMonthKey(monthKey);
  const visible = new Set(days.map(dayKey));

  const projectsById = new Map(portfolio.projects.map((p) => [p.id, p]));
  const byDay = new Map<string, Item[]>();
  const put = (key: string | null, item: Item) => {
    if (!key || !visible.has(key)) return;
    const bucket = byDay.get(key);
    if (bucket) bucket.push(item);
    else byDay.set(key, [item]);
  };
  for (const project of portfolio.projects) {
    put(project.startDate, { kind: "milestone", which: "start", project });
    put(project.targetDate, { kind: "milestone", which: "target", project });
  }
  for (const step of portfolio.steps) {
    const project = projectsById.get(step.projectId);
    if (project) put(step.dueDate, { kind: "step", step, project });
  }
  // Milestones first, then by project, so a busy day reads in blocks.
  for (const items of byDay.values()) {
    items.sort(
      (a, b) =>
        Number(a.kind === "step") - Number(b.kind === "step") ||
        a.project.name.localeCompare(b.project.name),
    );
  }

  const items = [...byDay.values()].flat();
  const shownIds = new Set(items.map((i) => i.project.id));
  const onScreen = portfolio.projects.filter((p) => shownIds.has(p.id));
  // The summary speaks for the month, not the spill-over days around it.
  const counted =
    mode === "week" ? items : [...byDay.entries()].filter(([key]) => key.startsWith(monthKey)).flatMap(([, v]) => v);
  const stepCount = counted.filter((i) => i.kind === "step").length;
  const projectCount = new Set(counted.filter((i) => i.kind === "step").map((i) => i.project.id)).size;

  function goto(param: "month" | "week", value: string, isCurrent: boolean) {
    const next = new URLSearchParams(params.toString());
    if (isCurrent) next.delete(param);
    else next.set(param, value);
    start(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  }

  const title =
    mode === "week"
      ? `${formatDate(dayKey(monday), "day")} – ${formatDate(dayKey(addDays(monday, 6)))}`
      : monthLabel(monthKey);

  return (
    <div className="flex flex-col gap-3">
      <CalendarNav
        title={title}
        unit={mode}
        onMove={(delta) =>
          mode === "week"
            ? goto("week", dayKey(addDays(monday, delta * 7)), false)
            : goto("month", addMonths(monthKey, delta), false)
        }
        onToday={() => goto(mode, mode === "week" ? dayKey(startOfWeek(today)) : monthKeyOf(today), true)}
      >
        <ViewToggle views={MODES} param="cal" defaultView="month" clears={["month", "week"]} label="Calendar range" />
      </CalendarNav>

      <p className="text-[12px] text-[var(--text-muted)]">
        <span className="font-semibold text-[var(--text)] tabular">{stepCount}</span>{" "}
        {stepCount === 1 ? "step" : "steps"} due across{" "}
        <span className="font-semibold text-[var(--text)] tabular">{projectCount}</span>{" "}
        {projectCount === 1 ? "project" : "projects"}
      </p>

      <CalendarGrid
        days={days}
        itemsOn={(key) => byDay.get(key) ?? []}
        inMonth={(day) => mode === "week" || (!!monthOf && day.getMonth() === monthOf.getMonth())}
        limit={mode === "week" ? 12 : 3}
        tall={mode === "week"}
        showWeekday={mode === "week"}
        render={(item) =>
          item.kind === "step" ? (
            <StepChip
              key={item.step.id}
              step={item.step}
              href={`/projects/${item.project.id}?step=${item.step.id}`}
              project={{
                label: projectShortName(item.project),
                name: `${item.project.name} · ${item.project.customerName}`,
                colour: identityVar(item.project.id),
              }}
            />
          ) : (
            <Milestone key={`${item.which}-${item.project.id}`} which={item.which} project={item.project} />
          )
        }
      />

      {onScreen.length > 0 ? (
        <section aria-label="Projects on this calendar" className="flex flex-wrap gap-x-3 gap-y-1.5">
          {onScreen.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
            >
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: identityVar(p.id) }} />
              <span>
                {p.code ? <span className="font-semibold text-[var(--text)]">{p.code} </span> : null}
                {p.name} <span className="text-[var(--text-faint)]">· {p.customerName}</span>
              </span>
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function Milestone({ which, project }: { which: "start" | "target"; project: PortfolioProject }) {
  const Icon = which === "start" ? Play : Flag;
  const what = which === "start" ? "Starts" : "Target";
  return (
    <Link
      href={`/projects/${project.id}`}
      title={`${project.name} · ${project.customerName} · ${what} ${formatDate(which === "start" ? project.startDate : project.targetDate)}`}
      className="flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-left transition-colors duration-150 hover:bg-[var(--surface-3)]"
    >
      <Icon aria-hidden className="size-3 shrink-0" style={{ color: identityVar(project.id) }} />
      <span className="min-w-0 flex-1 truncate text-[11px] leading-4 font-semibold text-[var(--text)]">
        {what} · {projectShortName(project)}
      </span>
    </Link>
  );
}
