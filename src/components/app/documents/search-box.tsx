"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A type-ahead backed by a server action. Results open below the field, so
 * it must not sit inside a scrolling container that would clip them.
 */
export function SearchBox<T>({
  placeholder,
  fetcher,
  getKey,
  render,
  onPick,
  initialQuery = "",
  autoFocus,
  emptyText = "Nothing matches that.",
  label,
  invalid,
}: {
  placeholder: string;
  fetcher: (term: string) => Promise<T[]>;
  getKey: (item: T) => string;
  render: (item: T) => React.ReactNode;
  onPick: (item: T) => void;
  initialQuery?: string;
  autoFocus?: boolean;
  emptyText?: string;
  label: string;
  invalid?: boolean;
}) {
  const [term, setTerm] = React.useState(initialQuery);
  const [results, setResults] = React.useState<T[]>([]);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [pending, start] = React.useTransition();
  const listId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      start(async () => {
        try {
          setResults(await fetcher(term));
          setActive(0);
        } catch {
          setResults([]);
        }
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [term, open, fetcher]);

  function pick(item: T) {
    onPick(item);
    setOpen(false);
    setTerm("");
  }

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--text-faint)]"
        aria-hidden
      />
      <input
        type="search"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid ? true : undefined}
        autoFocus={autoFocus}
        value={term}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            // Enter picks; it never submits the surrounding form.
            e.preventDefault();
            if (results[active]) pick(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={cn(
          "h-9.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pr-8 pl-8 text-sm text-[var(--text)]",
          "transition-colors hover:border-[var(--color-coastal-300)]",
          "focus:border-[var(--ring)] focus:outline-2 focus:outline-offset-0 focus:outline-[var(--ring)]",
          "aria-[invalid=true]:border-[var(--danger)]",
          "[&::-webkit-search-cancel-button]:hidden",
        )}
      />
      {pending ? (
        <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-[var(--text-faint)]" />
      ) : null}
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--shadow-md)] scrollbar-slim"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-[var(--text-muted)]">
              {pending ? "Searching…" : emptyText}
            </li>
          ) : (
            results.map((item, i) => (
              <li
                key={getKey(item)}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(item);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "cursor-pointer px-3 py-2 text-[13px]",
                  i === active ? "bg-[var(--surface-3)]" : "",
                )}
              >
                {render(item)}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
