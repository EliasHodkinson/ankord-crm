"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  CalendarDays,
  ChartNoAxesGantt,
  Columns3,
  ListChecks,
  Rows3,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewOption = { value: string; label: string; icon: LucideIcon };

/** The leads pipeline: board or list. */
export const PIPELINE_VIEWS: ViewOption[] = [
  { value: "board", label: "Board", icon: Columns3 },
  { value: "list", label: "List", icon: Rows3 },
];

/** A project runbook: the same steps, read four ways. */
export const RUNBOOK_VIEW_OPTIONS: ViewOption[] = [
  { value: "list", label: "Runbook", icon: ListChecks },
  { value: "board", label: "Board", icon: Columns3 },
  { value: "calendar", label: "Calendar", icon: CalendarDays },
  { value: "timeline", label: "Timeline", icon: ChartNoAxesGantt },
];

/**
 * Which view you are in, remembered in the URL so a link opens the same way
 * and the back button behaves.
 *
 * `clears` names the parameters that belong to one view and mean nothing in
 * another — the calendar's month, a deep link to a single step — so switching
 * never carries stale position across.
 */
export function ViewToggle({
  views = PIPELINE_VIEWS,
  param = "view",
  defaultView = "board",
  clears = [],
  label = "View",
}: {
  views?: ViewOption[];
  param?: string;
  defaultView?: string;
  clears?: string[];
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, start] = useTransition();
  const current = params.get(param) ?? defaultView;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5"
    >
      {views.map(({ value, label: text, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            for (const key of clears) next.delete(key);
            if (value === defaultView) next.delete(param);
            else next.set(param, value);
            start(() =>
              router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false }),
            );
          }}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium",
            "transition-colors duration-150",
            current === value
              ? "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]"
              : "text-[var(--text-muted)] hover:text-[var(--text)]",
          )}
        >
          <Icon className="size-3.5" />
          {text}
        </button>
      ))}
    </div>
  );
}
