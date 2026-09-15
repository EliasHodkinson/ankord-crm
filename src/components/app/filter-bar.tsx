"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type FilterSpec = {
  param: string;
  label: string;
  defaultValue?: string;
  options: { value: string; label: string }[];
};

/**
 * Filters live in the URL so a filtered list can be shared, bookmarked and
 * reloaded — the state belongs to the address bar, not to a component.
 */
export function FilterBar({
  filters = [],
  searchPlaceholder = "Search…",
  searchParam = "q",
}: {
  filters?: FilterSpec[];
  searchPlaceholder?: string;
  searchParam?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [term, setTerm] = useState(params.get(searchParam) ?? "");

  function push(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    startTransition(() => {
      router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
    });
  }

  useEffect(() => {
    const current = params.get(searchParam) ?? "";
    if (term === current) return;
    const timer = setTimeout(() => {
      push((next) => (term ? next.set(searchParam, term) : next.delete(searchParam)));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const active =
    Boolean(params.get(searchParam)) ||
    filters.some((f) => {
      const v = params.get(f.param);
      return v && v !== f.defaultValue;
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-52 flex-1 sm:max-w-72">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--text-faint)]"
          aria-hidden
        />
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className={cn(
            "h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pr-8 pl-8",
            "text-[13px] text-[var(--text)] transition-colors",
            "hover:border-[var(--color-coastal-300)]",
            "focus:border-[var(--ring)] focus:outline-2 focus:outline-offset-0 focus:outline-[var(--ring)]",
            "[&::-webkit-search-cancel-button]:hidden",
          )}
        />
        {pending ? (
          <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-[var(--text-faint)]" />
        ) : null}
      </div>

      {filters.map((filter) => (
        <label key={filter.param} className="flex items-center gap-1.5">
          <span className="sr-only">{filter.label}</span>
          <Select
            value={params.get(filter.param) ?? filter.defaultValue ?? ""}
            onChange={(e) =>
              push((next) => {
                const value = e.target.value;
                if (!value || value === filter.defaultValue) next.delete(filter.param);
                else next.set(filter.param, value);
              })
            }
            className="h-9 w-auto min-w-36 text-[13px]"
          >
            {filter.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
      ))}

      {active ? (
        <button
          type="button"
          onClick={() => {
            setTerm("");
            startTransition(() => router.replace(pathname, { scroll: false }));
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
        >
          <X className="size-3.5" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
