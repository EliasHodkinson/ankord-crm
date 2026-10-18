"use client";

import { TimelineRow } from "./timeline-kit";
import { positionOn, type Span } from "@/lib/runbook-views";
import { bucketLabel, type TrendPoint } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

/**
 * Workload over time, drawn on the timeline's own axis so a peak lines up
 * with the projects causing it. Two charts, not one with two scales: steps
 * (due and done share a unit) and projects running.
 */
export function TrendsBand({
  axis,
  points,
  unit,
}: {
  axis: Span;
  points: TrendPoint[];
  unit: "week" | "month";
}) {
  const maxSteps = Math.max(1, ...points.map((p) => Math.max(p.due, p.done)));
  const maxActive = Math.max(1, ...points.map((p) => p.active));
  const peak = points.reduce<TrendPoint | null>((best, p) => (p.due > (best?.due ?? 0) ? p : best), null);
  const per = unit === "week" ? "week" : "month";

  return (
    <div className="border-b border-[var(--border-soft)] pb-2">
      <TimelineRow
        trackClassName="h-16"
        label={
          <div className="flex flex-col gap-1 py-1">
            <span className="text-[12px] font-semibold text-[var(--text)]">Steps per {per}</span>
            <span className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
              <Key colour="var(--chart-2)">Due</Key>
              <Key colour="var(--chart-6)">Done</Key>
            </span>
            {peak ? (
              <span className="text-[11px] text-[var(--text-muted)]">
                Peak {bucketLabel(peak, unit)} ·{" "}
                <span className="font-semibold text-[var(--text)] tabular">{peak.due}</span> due
              </span>
            ) : null}
          </div>
        }
      >
        {points.map((p) => (
          <Column key={p.key} axis={axis} point={p} unit={unit}>
            <Bar value={p.due} max={maxSteps} colour="var(--chart-2)" />
            <Bar value={p.done} max={maxSteps} colour="var(--chart-6)" />
            {peak && p.key === peak.key ? (
              <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-[var(--text)] tabular">
                {p.due}
              </span>
            ) : null}
          </Column>
        ))}
      </TimelineRow>

      <TimelineRow
        className="mt-1"
        trackClassName="h-8"
        label={<span className="text-[12px] font-semibold text-[var(--text)]">Projects running</span>}
      >
        {points.map((p) => (
          <Column key={p.key} axis={axis} point={p} unit={unit}>
            <Bar value={p.active} max={maxActive} colour="var(--chart-4)" />
          </Column>
        ))}
      </TimelineRow>
    </div>
  );
}

function Key({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className="size-2 rounded-[2px]" style={{ background: colour }} />
      {children}
    </span>
  );
}

/** One bucket's slot on the axis; the whole slot is the hover target. */
function Column({
  axis,
  point,
  unit,
  children,
}: {
  axis: Span;
  point: TrendPoint;
  unit: "week" | "month";
  children: React.ReactNode;
}) {
  const left = positionOn(axis, point.start);
  const right = positionOn(axis, point.end);
  if (right <= left) return null;
  return (
    <div
      title={`${bucketLabel(point, unit)} · ${point.due} due · ${point.done} done · ${point.active} projects running`}
      className="group absolute inset-y-0 flex items-end justify-center gap-0.5 px-px hover:bg-[var(--surface-3)]"
      style={{ left: `${left}%`, width: `${right - left}%` }}
    >
      {children}
    </div>
  );
}

function Bar({ value, max, colour }: { value: number; max: number; colour: string }) {
  return (
    <span
      className={cn("w-full max-w-5 rounded-t-[4px]", value === 0 && "opacity-0")}
      // Leave headroom for the peak's label.
      style={{ height: `${(value / max) * 82}%`, background: colour }}
    />
  );
}

/** "Show the numbers" — the same series as a table, so nothing hides in colour. */
export function TrendsTable({ points, unit }: { points: TrendPoint[]; unit: "week" | "month" }) {
  const rows = points.filter((p) => p.due || p.done || p.active);
  return (
    <div className="max-h-72 overflow-auto rounded-[10px] border border-[var(--border)] scrollbar-slim">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-[var(--surface-2)] text-left text-[11px] text-[var(--text-muted)]">
          <tr>
            <th className="px-3 py-1.5 font-semibold">{unit === "week" ? "Week" : "Month"}</th>
            <th className="px-3 py-1.5 text-right font-semibold">Steps due</th>
            <th className="px-3 py-1.5 text-right font-semibold">Steps done</th>
            <th className="px-3 py-1.5 text-right font-semibold">Projects running</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((p) => (
            <tr key={p.key} className="border-t border-[var(--border-soft)]">
              <td className="px-3 py-1">{bucketLabel(p, unit)}</td>
              <td className="px-3 py-1 text-right">{p.due}</td>
              <td className="px-3 py-1 text-right">{p.done}</td>
              <td className="px-3 py-1 text-right">{p.active}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
