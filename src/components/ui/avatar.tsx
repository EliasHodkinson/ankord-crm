import * as React from "react";
import { cn, initials, tintIndex } from "@/lib/utils";

const tints = [
  "bg-[var(--color-coastal-100)] text-[var(--color-coastal-800)]",
  "bg-[var(--color-sunrise-100)] text-[var(--color-sunrise-800)]",
  "bg-[var(--color-coastal-200)] text-[var(--color-coastal-900)]",
  "bg-[var(--color-sunrise-50)] text-[var(--color-sunrise-700)]",
  "bg-[var(--color-coastal-50)] text-[var(--color-coastal-700)]",
  "bg-[#e4ebe9] text-[var(--color-ink-700)]",
];

const sizes = {
  xs: "size-5 text-[9px]",
  sm: "size-7 text-[11px]",
  md: "size-9 text-[13px]",
  lg: "size-12 text-[16px]",
};

export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const label = name ?? "Unknown";
  if (src) {
    return (
      // Graph photos are data URIs, so next/image would only add indirection.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className={cn(
          "shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]",
          sizes[size],
          className,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tight select-none",
        tints[tintIndex(label, tints.length)],
        sizes[size],
        className,
      )}
    >
      {initials(label)}
    </span>
  );
}
