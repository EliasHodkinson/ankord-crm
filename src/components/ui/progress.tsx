import { cn } from "@/lib/utils";

/**
 * Steps completed, with anything blocked called out in the same bar — a
 * project at 80% with two blockers is not the same as one at 80% without.
 */
export function ProgressBar({
  done,
  total,
  blocked = 0,
  className,
  showLabel = true,
}: {
  done: number;
  total: number;
  blocked?: number;
  className?: string;
  showLabel?: boolean;
}) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const blockedPercent = total === 0 ? 0 : Math.round((blocked / total) * 100);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${done} of ${total} steps done`}
        className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]"
      >
        <div className="flex h-full">
          <span
            className="h-full bg-[var(--color-coastal-500)] transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
          {blockedPercent > 0 ? (
            <span
              className="h-full bg-[var(--danger)] transition-[width] duration-300 ease-out"
              style={{ width: `${blockedPercent}%` }}
            />
          ) : null}
        </div>
      </div>
      {showLabel ? (
        <span className="shrink-0 text-[11px] text-[var(--text-muted)] tabular">
          {total === 0 ? "—" : `${done}/${total}`}
        </span>
      ) : null}
    </div>
  );
}
