import * as React from "react";
import { cn } from "@/lib/utils";

export function TableShell({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]",
        "shadow-[var(--shadow-sm)] scrollbar-slim",
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full min-w-[46rem] border-collapse", className)} {...props} />;
}

export function Th({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2",
        "text-[11px] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase",
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-[var(--border-soft)] px-3 py-2 text-[13px] text-[var(--text)] align-middle",
        numeric && "tabular text-right",
        className,
      )}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "transition-colors duration-150 hover:bg-[var(--surface-2)]",
        "has-[a:focus-visible]:bg-[var(--surface-2)]",
        className,
      )}
      {...props}
    />
  );
}
