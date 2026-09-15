"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type RecordSection = { id: string; label: string; count?: number };

/**
 * Section navigation for a long record page.
 *
 * A business partner now carries projects, people, history, an account
 * register, Xero and more, which is further than anyone wants to scroll to
 * check one thing.
 *
 * Highlights whichever section is nearest the top of the viewport rather than
 * whichever is merely visible — on a tall screen several are on screen at once,
 * and "topmost" is the one a reader considers current.
 */
export function RecordNav({
  sections,
  className,
}: {
  sections: RecordSection[];
  className?: string;
}) {
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null);

  useEffect(() => {
    const targets = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const onScreen = entries.filter((e) => e.isIntersecting);
        if (onScreen.length === 0) return;
        const topmost = onScreen.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        setActive(topmost.target.id);
      },
      // Ignores the bottom two-thirds so a section counts as current only once
      // it reaches the upper part of the viewport.
      { rootMargin: "-80px 0px -66% 0px", threshold: 0 },
    );

    for (const el of targets) observer.observe(el);
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav
      aria-label="Sections on this record"
      className={cn("xl:sticky xl:top-20 xl:self-start", className)}
    >
      {/* A horizontal strip below xl, a rail beside the content above it. */}
      <ul className="flex gap-1 overflow-x-auto pb-1 scrollbar-slim xl:flex-col xl:overflow-visible xl:pb-0">
        {sections.map((s) => {
          const current = active === s.id;
          return (
            <li key={s.id} className="shrink-0 xl:shrink">
              <a
                href={`#${s.id}`}
                aria-current={current ? "true" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors",
                  current
                    ? "bg-[var(--surface-3)] text-[var(--text)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
                )}
              >
                {/* The marker is the one accent on this control, and only on
                    the current item — it is a position indicator, not decoration. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-3.5 w-0.5 rounded-full transition-colors",
                    current ? "bg-[var(--accent)]" : "bg-transparent",
                  )}
                />
                {s.label}
                {typeof s.count === "number" && s.count > 0 ? (
                  <span className="text-[11px] tabular-nums text-[var(--text-faint)]">
                    {s.count}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
