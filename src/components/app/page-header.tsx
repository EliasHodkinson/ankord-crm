import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

/**
 * Every screen opens the same way: where you are, what it is, what you can do.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  crumbs,
  actions,
  meta,
  className,
}: {
  title: React.ReactNode;
  /** Rendered as breadcrumb trail context, not a decorative kicker. */
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-[var(--border)] bg-[var(--surface)]", className)}>
      <div className="mx-auto w-full max-w-[88rem] px-4 py-5 sm:px-6">
        {crumbs?.length ? (
          <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-[12px]">
            {crumbs.map((crumb, i) => (
              <span key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                {i > 0 ? (
                  <ChevronRight className="size-3 text-[var(--text-faint)]" aria-hidden />
                ) : null}
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="text-[var(--text-muted)] transition-colors hover:text-[var(--text)] hover:underline underline-offset-2"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-[var(--text-faint)]">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.025em] text-balance text-[var(--text)]">
                {title}
              </h1>
              {eyebrow}
            </div>
            {description ? (
              <p className="mt-1.5 max-w-[70ch] text-[13px] leading-6 text-[var(--text-muted)]">
                {description}
              </p>
            ) : null}
            {meta ? <div className="mt-2.5">{meta}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function PageBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6", className)}
      {...props}
    />
  );
}
