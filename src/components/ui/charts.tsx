import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Small, dependency-free charts drawn as SVG on the server.
 *
 * Conventions kept across all of them: marks are thin and capped, the data end
 * is rounded and the baseline end is square, gridlines are hairline and
 * recessive, and every chart carries a table of its own numbers so nothing is
 * gated behind seeing colour.
 */

export function ChartFrame({
  title,
  subtitle,
  children,
  table,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** The same numbers as text — the accessible path, not an afterthought. */
  table?: { head: string[]; rows: (string | number)[][] };
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <figcaption className="mb-3">
        <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--text)]">
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{subtitle}</p>
        ) : null}
      </figcaption>

      {children}

      {table ? (
        <details className="mt-3 border-t border-[var(--border-soft)] pt-2.5">
          <summary className="cursor-pointer text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text-muted)]">
            Show the numbers
          </summary>
          <div className="mt-2 overflow-x-auto scrollbar-slim">
            <table className="w-full text-[12px]">
              <thead>
                <tr>
                  {table.head.map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn(
                        "border-b border-[var(--border-soft)] py-1.5 font-medium text-[var(--text-muted)]",
                        i === 0 ? "text-left" : "text-right",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={cn(
                          "border-b border-[var(--border-soft)] py-1.5 text-[var(--text)]",
                          ci === 0 ? "text-left" : "text-right tabular",
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  );
}

/**
 * Horizontal bars for an ordinal sequence — pipeline stages, where the order is
 * part of the meaning, so the colour carries the order too. Every bar is
 * labelled, which is also what makes the lighter steps safe.
 */
export function OrdinalBars({
  data,
  emptyLabel = "Nothing in the pipeline yet",
}: {
  data: { label: string; value: number; caption?: string }[];
  emptyLabel?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  if (data.every((d) => d.value === 0)) {
    return <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">{emptyLabel}</p>;
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {data.map((row, i) => (
        <li key={row.label} className="grid grid-cols-[7.5rem_1fr] items-center gap-3">
          <span className="truncate text-[12px] text-[var(--text-muted)]">{row.label}</span>
          <span className="flex items-center gap-2">
            <span
              className="h-5 min-w-0.5 rounded-r-[4px]"
              style={{
                width: `${Math.max((row.value / max) * 100, 1.5)}%`,
                background: `var(--chart-${Math.min(i + 1, 6)})`,
              }}
            />
            <span className="shrink-0 text-[12px] font-medium text-[var(--text)] tabular">
              {row.caption ?? row.value}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Columns over discrete periods — one series, so the title names it and there
 * is no legend box. Only the tallest column is labelled; the axis carries the rest.
 */
export function Columns({
  data,
  height = 132,
  format = (n: number) => String(n),
  emptyLabel = "Nothing in this period",
}: {
  data: { label: string; value: number }[];
  height?: number;
  format?: (n: number) => string;
  emptyLabel?: string;
}) {
  // An axis with nothing on it reads as broken; say so instead.
  if (data.every((d) => d.value === 0)) {
    return (
      <p
        className="grid place-items-center text-[13px] text-[var(--text-muted)]"
        style={{ height: height + 20 }}
      >
        {emptyLabel}
      </p>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  // Label only the tallest column — by position, since axis labels are thinned
  // out and several may legitimately be blank.
  const peakIndex = data.reduce(
    (best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best),
    0,
  );

  return (
    <div>
      <div
        className="flex items-end gap-1.5 border-b border-[var(--chart-grid)]"
        style={{ height }}
        role="img"
        aria-label={data
          .filter((d) => d.label)
          .map((d) => `${d.label}: ${format(d.value)}`)
          .join("; ")}
      >
        {data.map((d, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
            {i === peakIndex && d.value > 0 ? (
              <span className="text-[10px] font-medium text-[var(--text)] tabular">
                {format(d.value)}
              </span>
            ) : null}
            <div
              className="w-full max-w-6 rounded-t-[4px] bg-[var(--chart-series)]"
              style={{
                height: d.value === 0 ? 2 : `${Math.max((d.value / max) * (height - 22), 3)}px`,
                opacity: d.value === 0 ? 0.25 : 1,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {data.map((d, i) => (
          <span
            key={i}
            className="flex-1 truncate text-center text-[10px] text-[var(--text-faint)]"
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A single ratio against its limit. Not a two-slice pie. */
export function Meter({
  value,
  max = 100,
  label,
  caption,
  tone = "series",
}: {
  value: number;
  max?: number;
  label: string;
  caption?: string;
  tone?: "series" | "ok" | "warn" | "danger";
}) {
  const pct = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const colour =
    tone === "series" ? "var(--chart-series)" : `var(--${tone})`;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-[var(--text-muted)]">{label}</span>
        <span className="text-[15px] font-semibold text-[var(--text)] tabular">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--chart-track)]"
      >
        <div
          className="h-full rounded-r-[4px] transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%`, background: colour }}
        />
      </div>
      {caption ? (
        <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">{caption}</p>
      ) : null}
    </div>
  );
}

/** A headline number with its supporting line. */
export function StatTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "danger" | "ok";
}) {
  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
      <p className="text-[12px] text-[var(--text-muted)]">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-[26px] leading-none font-semibold tracking-[-0.03em] tabular",
          tone === "danger"
            ? "text-[var(--danger)]"
            : tone === "ok"
              ? "text-[var(--ok)]"
              : "text-[var(--text)]",
        )}
      >
        {value}
      </p>
      {detail ? (
        <p className="mt-1.5 text-[12px] text-[var(--text-faint)]">{detail}</p>
      ) : null}
    </div>
  );
}

/** Part-to-whole across a small fixed set of states, with a 2px surface gap. */
export function StatusBar({
  segments,
}: {
  segments: { label: string; value: number; tone: "ok" | "warn" | "danger" | "muted" }[];
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return (
      <p className="py-4 text-center text-[13px] text-[var(--text-muted)]">
        Nothing running right now
      </p>
    );
  }

  return (
    <div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <span
              key={s.label}
              title={`${s.label}: ${s.value}`}
              style={{ width: `${(s.value / total) * 100}%` }}
              className={cn(
                "h-full first:rounded-l-full last:rounded-r-full",
                s.tone === "ok" && "bg-[var(--ok)]",
                s.tone === "warn" && "bg-[var(--warn)]",
                s.tone === "danger" && "bg-[var(--danger)]",
                s.tone === "muted" && "bg-[var(--chart-track)]",
              )}
            />
          ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5 text-[12px]">
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full",
                s.tone === "ok" && "bg-[var(--ok)]",
                s.tone === "warn" && "bg-[var(--warn)]",
                s.tone === "danger" && "bg-[var(--danger)]",
                s.tone === "muted" && "bg-[var(--chart-track)]",
              )}
            />
            <span className="text-[var(--text-muted)]">{s.label}</span>
            <span className="font-medium text-[var(--text)] tabular">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
