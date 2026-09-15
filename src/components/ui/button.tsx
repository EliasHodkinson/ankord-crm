import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap " +
  "transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-out " +
  "disabled:pointer-events-none disabled:opacity-45 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] " +
  "[&_svg]:shrink-0";

const variants: Record<Variant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--shadow-sm)] " +
    "hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)]",
  secondary:
    "bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] shadow-[var(--shadow-sm)] " +
    "hover:bg-[var(--surface-2)] hover:border-[var(--color-coastal-300)] active:bg-[var(--surface-3)]",
  ghost:
    "text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] active:bg-[var(--surface-3)]",
  subtle:
    "bg-[var(--surface-3)] text-[var(--text)] hover:bg-[var(--color-coastal-100)] " +
    "dark:hover:bg-[var(--color-coastal-800)]",
  danger:
    "bg-[var(--danger)] text-white shadow-[var(--shadow-sm)] hover:brightness-95 active:brightness-90",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] [&_svg]:size-4",
  md: "h-9.5 px-4 text-sm [&_svg]:size-4",
  lg: "h-11 px-5 text-[15px] [&_svg]:size-[18px]",
  icon: "size-9 [&_svg]:size-4",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({
  className,
  variant = "secondary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  );
}

export type ButtonLinkProps = React.ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
};

export function ButtonLink({
  className,
  variant = "secondary",
  size = "md",
  ...props
}: ButtonLinkProps) {
  return <Link className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}
