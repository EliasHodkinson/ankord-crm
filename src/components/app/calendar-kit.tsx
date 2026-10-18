"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dayKey, isSameDay, startOfToday, WEEKDAY_LABELS } from "@/lib/runbook-views";
import { cn } from "@/lib/utils";

/**
 * The pieces every calendar is made of — one runbook's month, or the whole
 * portfolio's month or week. What goes in a cell is up to the caller.
 */

/** The title, and previous / today / next. */
export function CalendarNav({
  title,
  unit,
  onMove,
  onToday,
  children,
}: {
  title: string;
  unit: string;
  onMove: (delta: number) => void;
  onToday: () => void;
  /** Extra controls, to the left of the arrows. */
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</h3>
      <div className="flex flex-wrap items-center gap-1">
        {children}
        <Button variant="ghost" size="sm" aria-label={`Previous ${unit}`} onClick={() => onMove(-1)}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="sm" onClick={onToday}>
          Today
        </Button>
        <Button variant="ghost" size="sm" aria-label={`Next ${unit}`} onClick={() => onMove(1)}>
          <ChevronRight />
        </Button>
      </div>
    </header>
  );
}

/**
 * Seven columns of days, Monday first. Each cell shows `limit` items and then
 * "+N more", which opens the rest in place.
 */
export function CalendarGrid<T>({
  days,
  itemsOn,
  render,
  inMonth = () => true,
  limit = 3,
  tall = false,
  showWeekday = false,
}: {
  days: Date[];
  itemsOn: (key: string) => T[];
  render: (item: T) => React.ReactNode;
  inMonth?: (day: Date) => boolean;
  limit?: number;
  /** Week view: taller cells, each headed with its date. */
  tall?: boolean;
  showWeekday?: boolean;
}) {
  const today = startOfToday();

  return (
    <div className="overflow-x-auto scrollbar-slim">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 gap-px">
          {WEEKDAY_LABELS.map((day) => (
            <div
              key={day}
              className="px-2 py-1.5 text-[11px] font-semibold tracking-[0.02em] text-[var(--text-faint)]"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--border-soft)]">
          {days.map((day) => (
            <DayCell
              key={dayKey(day)}
              day={day}
              items={itemsOn(dayKey(day))}
              render={render}
              inMonth={inMonth(day)}
              isToday={isSameDay(day, today)}
              limit={limit}
              tall={tall}
              showMonth={showWeekday}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayCell<T>({
  day,
  items,
  render,
  inMonth,
  isToday,
  limit,
  tall,
  showMonth,
}: {
  day: Date;
  items: T[];
  render: (item: T) => React.ReactNode;
  inMonth: boolean;
  isToday: boolean;
  limit: number;
  tall: boolean;
  showMonth: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const overflow = items.length - limit;
  const shown = expanded ? items : items.slice(0, limit);

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 p-1.5",
        tall ? "min-h-72" : "min-h-24",
        inMonth ? "bg-[var(--surface)]" : "bg-[var(--surface-2)]",
      )}
    >
      <span
        className={cn(
          "self-start rounded-full px-1.5 text-[11px] leading-5 tabular",
          isToday
            ? "bg-[var(--accent)] font-semibold text-[var(--accent-fg)]"
            : inMonth
              ? "text-[var(--text-muted)]"
              : "text-[var(--text-faint)]",
        )}
      >
        {showMonth ? day.toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : day.getDate()}
      </span>

      {shown.map(render)}

      {overflow > 0 && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="self-start px-1 text-[10px] font-medium text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
        >
          +{overflow} more
        </button>
      ) : null}
    </div>
  );
}
