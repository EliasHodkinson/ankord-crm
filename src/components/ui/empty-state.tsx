import * as React from "react";
import { cn } from "@/lib/utils";
import { AnkordMark } from "@/components/brand/logo";

/**
 * Empty states teach the screen rather than announcing emptiness — the title
 * says what this area is for, the body says how to fill it.
 */
export function EmptyState({
  title,
  description,
  action,
  compact,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden text-center",
        compact ? "gap-2 px-6 py-10" : "gap-3 px-6 py-16",
        className,
      )}
    >
      <AnkordMark
        className={cn(
          "pointer-events-none absolute -right-6 -bottom-8 rotate-12 text-[var(--color-coastal-800)] opacity-[0.035]",
          compact ? "size-32" : "size-48",
        )}
      />
      <p className="relative text-[14px] font-semibold text-[var(--text)]">{title}</p>
      {description ? (
        <p className="relative max-w-[46ch] text-[13px] leading-6 text-[var(--text-muted)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="relative mt-2">{action}</div> : null}
    </div>
  );
}
