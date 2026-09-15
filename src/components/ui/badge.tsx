import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "brand" | "accent" | "ok" | "warn" | "danger" | "info" | "muted";

const tones: Record<Tone, string> = {
  neutral: "bg-[var(--surface-3)] text-[var(--text-muted)] ring-[var(--border)]",
  brand: "bg-[var(--color-coastal-50)] text-[var(--color-coastal-800)] ring-[var(--color-coastal-200)] dark:bg-[var(--color-coastal-900)] dark:text-[var(--color-coastal-200)] dark:ring-[var(--color-coastal-700)]",
  accent: "bg-[var(--color-sunrise-50)] text-[var(--color-sunrise-700)] ring-[var(--color-sunrise-200)] dark:bg-[var(--color-sunrise-900)] dark:text-[var(--color-sunrise-200)] dark:ring-[var(--color-sunrise-700)]",
  ok: "bg-[var(--ok-bg)] text-[var(--ok)] ring-current/20",
  warn: "bg-[var(--warn-bg)] text-[var(--warn)] ring-current/20",
  danger: "bg-[var(--danger-bg)] text-[var(--danger)] ring-current/20",
  info: "bg-[var(--info-bg)] text-[var(--info)] ring-current/20",
  muted: "bg-transparent text-[var(--text-faint)] ring-[var(--border)]",
};

export function Badge({
  tone = "neutral",
  className,
  dot,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        "leading-4 ring-1 ring-inset whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {props.children}
    </span>
  );
}
