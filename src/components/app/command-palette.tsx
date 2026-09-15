"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CircleCheck,
  Clock,
  Columns3,
  CornerDownLeft,
  FolderKanban,
  Gauge,
  Mail,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Target,
  Upload,
  Users,
} from "lucide-react";
import type { SearchHit } from "@/app/api/search/route";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  label: string;
  hint?: string | null;
  group: "Recent" | "Go to" | "Create" | "Results" | "Settings";
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
  keywords?: string;
};

const KIND_ICON = {
  customer: Building2,
  contact: Users,
  lead: Target,
  project: FolderKanban,
} as const;

const RECENT_KEY = "ankord-recent";
const MAX_RECENT = 6;

type Recent = { href: string; label: string; kind: keyof typeof KIND_ICON };

/** Remembers where you have been, so ⌘K can offer it back. */
export function rememberVisit(entry: Recent) {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list: Recent[] = raw ? JSON.parse(raw) : [];
    const next = [entry, ...list.filter((r) => r.href !== entry.href)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* a full or blocked localStorage is not worth failing over */
  }
}

function readRecent(): Recent[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as Recent[]) : [];
  } catch {
    return [];
  }
}

/**
 * ⌘K opens everything: search across records, jump to a section, start a new
 * anything, switch the theme. The fastest path through the CRM for anyone who
 * would rather not reach for the mouse.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [cursor, setCursor] = useState(0);
  const [searching, startSearch] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setCursor(0);
  }, []);

  const show = useCallback(() => {
    setRecent(readRecent());
    setOpen(true);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => {
          if (current) return false;
          setRecent(readRecent());
          return true;
        });
      }
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      startSearch(() => {
        void fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        })
          .then((r) => (r.ok ? r.json() : { hits: [] }))
          .then((data: { hits: SearchHit[] }) => {
            setHits(data.hits);
            setCursor(0);
          })
          .catch(() => undefined);
      });
    }, 150);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  function go(href: string) {
    close();
    router.push(href);
  }

  function setTheme(mode: "light" | "dark" | "system") {
    localStorage.setItem("ankord-theme", mode);
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    window.dispatchEvent(new StorageEvent("storage", { key: "ankord-theme" }));
    close();
  }

  const term = query.trim().toLowerCase();

  const navigation: Item[] = [
    { id: "n-home", label: "Overview", group: "Go to", icon: Gauge, run: () => go("/") },
    {
      id: "n-tasks",
      label: "Follow-ups",
      group: "Go to",
      icon: CircleCheck,
      run: () => go("/tasks"),
      keywords: "tasks todo",
    },
    {
      id: "n-leads",
      label: "Leads",
      group: "Go to",
      icon: Target,
      run: () => go("/leads"),
      keywords: "pipeline board",
    },
    {
      id: "n-customers",
      label: "Business Partners",
      group: "Go to",
      icon: Building2,
      run: () => go("/customers"),
      keywords: "clients accounts",
    },
    { id: "n-people", label: "People", group: "Go to", icon: Users, run: () => go("/contacts") },
    {
      id: "n-projects",
      label: "Projects",
      group: "Go to",
      icon: FolderKanban,
      run: () => go("/projects"),
      keywords: "runbook delivery",
    },
    {
      id: "n-inbox",
      label: "Link email",
      group: "Go to",
      icon: Mail,
      run: () => go("/inbox"),
      keywords: "outlook mail",
    },
    {
      id: "n-import",
      label: "Import from a file",
      group: "Go to",
      icon: Upload,
      run: () => go("/import"),
      keywords: "csv spreadsheet migrate bulk",
    },
    {
      id: "n-reports",
      label: "Reports",
      group: "Go to",
      icon: Columns3,
      run: () => go("/reports"),
      keywords: "analytics charts pipeline",
    },
  ];

  const creates: Item[] = [
    {
      id: "c-lead",
      label: "New lead",
      group: "Create",
      icon: Plus,
      run: () => go("/leads/new"),
      keywords: "add opportunity",
    },
    {
      id: "c-customer",
      label: "New customer",
      group: "Create",
      icon: Plus,
      run: () => go("/customers/new"),
      keywords: "add client account",
    },
    {
      id: "c-project",
      label: "New project",
      group: "Create",
      icon: Plus,
      run: () => go("/projects/new"),
      keywords: "add job runbook",
    },
  ];

  const settings: Item[] = [
    {
      id: "s-light",
      label: "Switch to the light theme",
      group: "Settings",
      icon: Sun,
      run: () => setTheme("light"),
      keywords: "theme appearance",
    },
    {
      id: "s-dark",
      label: "Switch to the dark theme",
      group: "Settings",
      icon: Moon,
      run: () => setTheme("dark"),
      keywords: "theme appearance",
    },
    {
      id: "s-settings",
      label: "Settings",
      group: "Settings",
      icon: Settings,
      run: () => go("/settings"),
      keywords: "sharepoint team permissions",
    },
  ];

  const matches = (item: Item) =>
    !term ||
    item.label.toLowerCase().includes(term) ||
    (item.keywords ?? "").includes(term);

  const items: Item[] = term
    ? [
        ...hits.map((hit) => ({
          id: `${hit.kind}-${hit.id}`,
          label: hit.title,
          hint: hit.subtitle,
          group: "Results" as const,
          icon: KIND_ICON[hit.kind],
          run: () => {
            rememberVisit({ href: hit.href, label: hit.title, kind: hit.kind });
            go(hit.href);
          },
        })),
        ...[...navigation, ...creates, ...settings].filter(matches),
      ]
    : [
        ...recent.map((r) => ({
          id: `r-${r.href}`,
          label: r.label,
          hint: "Recently opened",
          group: "Recent" as const,
          icon: KIND_ICON[r.kind] ?? Clock,
          run: () => go(r.href),
        })),
        ...creates,
        ...navigation,
        ...settings,
      ];

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor, items.length]);

  if (!open) {
    return (
      <button
        type="button"
        data-command-trigger="true"
        onClick={show}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5",
          "text-[13px] text-[var(--text-faint)] transition-colors duration-150",
          "hover:border-[var(--color-coastal-300)] hover:text-[var(--text-muted)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
        )}
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">Search or jump to…</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-sans text-[10px] font-medium sm:block">
          ⌘K
        </kbd>
      </button>
    );
  }

  let lastGroup = "";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <button
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 bg-[var(--color-coastal-950)]/45 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--border-soft)] px-3.5">
          <Search className="size-4 shrink-0 text-[var(--text-faint)]" aria-hidden />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                items[cursor]?.run();
              }
            }}
            placeholder="Search partners, people, projects — or type a command"
            aria-label="Search or run a command"
            className="h-12 flex-1 bg-transparent text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
          {searching ? (
            <span className="text-[11px] text-[var(--text-faint)]">Searching…</span>
          ) : null}
        </div>

        <div ref={listRef} className="max-h-[22rem] overflow-y-auto p-1.5 scrollbar-slim">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-[var(--text-muted)]">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            items.map((item, i) => {
              const heading = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              const Icon = item.icon;
              return (
                <div key={item.id}>
                  {heading ? (
                    <p className="px-2.5 pt-2.5 pb-1 text-[10px] font-semibold tracking-[0.1em] text-[var(--text-faint)] uppercase">
                      {heading}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    data-active={i === cursor}
                    onMouseEnter={() => setCursor(i)}
                    onClick={item.run}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                      i === cursor ? "bg-[var(--surface-3)]" : "hover:bg-[var(--surface-2)]",
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-[var(--color-coastal-500)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-[var(--text)]">
                        {item.label}
                      </span>
                      {item.hint ? (
                        <span className="block truncate text-[12px] text-[var(--text-muted)]">
                          {item.hint}
                        </span>
                      ) : null}
                    </span>
                    {i === cursor ? (
                      <CornerDownLeft className="size-3.5 shrink-0 text-[var(--text-faint)]" />
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <footer className="flex items-center gap-4 border-t border-[var(--border-soft)] px-3.5 py-2 text-[11px] text-[var(--text-faint)]">
          <span className="inline-flex items-center gap-1">
            <ArrowRight className="size-3 rotate-90" />
            <ArrowRight className="size-3 -rotate-90" />
            to move
          </span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="size-3" />
            to open
          </span>
          <span className="ml-auto">esc to close</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
