import * as React from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] " +
  "shadow-[inset_0_1px_1px_rgb(8_57_58_/_0.03)] transition-colors duration-150 " +
  "hover:border-[var(--color-coastal-300)] " +
  "focus:border-[var(--ring)] focus:outline-2 focus:outline-offset-0 focus:outline-[var(--ring)] " +
  "disabled:cursor-not-allowed disabled:bg-[var(--surface-3)] disabled:text-[var(--text-faint)] " +
  "aria-[invalid=true]:border-[var(--danger)] aria-[invalid=true]:outline-[var(--danger)]";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-9.5", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-24 py-2 leading-6", className)} {...props} />;
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        control,
        "h-9.5 appearance-none bg-no-repeat pr-9",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22none%22 stroke=%22%235b6b69%22 stroke-width=%221.6%22 stroke-linecap=%22round%22><path d=%22M6 8l4 4 4-4%22/></svg>')]",
        "bg-[position:right_0.6rem_center] bg-[size:1.1rem]",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  required,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  htmlFor?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="text-[12px] font-medium tracking-[0.01em] text-[var(--text-muted)]"
      >
        {label}
        {required ? <span className="ml-0.5 text-[var(--accent)]">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] text-[var(--danger)]">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-[var(--text-faint)]">{hint}</p>
      ) : null}
    </div>
  );
}

/** A read-only label/value pair, the workhorse of every record page. */
export function DataRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-[8.5rem_1fr] items-baseline gap-3 py-1.5", className)}>
      <dt className="text-[12px] text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 text-[13px] text-[var(--text)]">{children ?? "—"}</dd>
    </div>
  );
}
