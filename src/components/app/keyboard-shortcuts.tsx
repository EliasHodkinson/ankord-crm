"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

type Shortcut = { keys: string[]; label: string; href?: string };

const GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: "Anywhere",
    items: [
      { keys: ["⌘", "K"], label: "Search, or run a command" },
      { keys: ["/"], label: "Jump to the search box" },
      { keys: ["?"], label: "Show this list" },
      { keys: ["Esc"], label: "Close whatever is open" },
    ],
  },
  {
    title: "Go to",
    items: [
      { keys: ["G", "O"], label: "Overview", href: "/" },
      { keys: ["G", "F"], label: "Follow-ups", href: "/tasks" },
      { keys: ["G", "L"], label: "Leads", href: "/leads" },
      { keys: ["G", "C"], label: "Customers", href: "/customers" },
      { keys: ["G", "P"], label: "Projects", href: "/projects" },
      { keys: ["G", "E"], label: "Link email", href: "/inbox" },
      { keys: ["G", "R"], label: "Reports", href: "/reports" },
    ],
  },
  {
    title: "Create",
    items: [
      { keys: ["N", "L"], label: "New lead", href: "/leads/new" },
      { keys: ["N", "C"], label: "New customer", href: "/customers/new" },
      { keys: ["N", "P"], label: "New project", href: "/projects/new" },
    ],
  },
];

/** True when the person is typing, so a shortcut never eats a keystroke. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable ||
    Boolean(el.closest?.("[role=dialog]"))
  );
}

/**
 * Two-key sequences in the style people already know from Linear and GitHub:
 * `g` then a letter to go somewhere, `n` then a letter to make something.
 * `?` shows the list, so nothing has to be memorised up front.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const pending = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    const routes = new Map<string, string>();
    for (const group of GROUPS) {
      for (const item of group.items) {
        if (item.href && item.keys.length === 2) {
          routes.set(item.keys.join("").toLowerCase(), item.href);
        }
      }
    }

    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        setSheetOpen(false);
        pending.current = null;
        return;
      }

      if (isTyping(event.target)) return;

      if (event.key === "?") {
        event.preventDefault();
        setSheetOpen((v) => !v);
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        document
          .querySelector<HTMLButtonElement>('[data-command-trigger="true"]')
          ?.click();
        return;
      }

      const key = event.key.toLowerCase();

      // A leader key on its own, waiting for the second press.
      if (!pending.current && (key === "g" || key === "n")) {
        pending.current = { key, at: Date.now() };
        return;
      }

      if (pending.current) {
        const stale = Date.now() - pending.current.at > 1500;
        const combo = pending.current.key + key;
        pending.current = null;
        if (stale) return;
        const href = routes.get(combo);
        if (href) {
          event.preventDefault();
          setSheetOpen(false);
          router.push(href);
        }
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  if (!sheetOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        aria-label="Close"
        onClick={() => setSheetOpen(false)}
        className="absolute inset-0 bg-[var(--color-coastal-950)]/45 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="relative w-full max-w-lg rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lg)]"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]">
              Keyboard shortcuts
            </h2>
            <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
              Press the keys one after the other, not together.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setSheetOpen(false)}
            className="grid size-7 place-items-center rounded-lg text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1.5 text-[10px] font-semibold tracking-[0.1em] text-[var(--text-faint)] uppercase">
                {group.title}
              </h3>
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center justify-between gap-3 text-[13px]"
                  >
                    <span className="text-[var(--text-muted)]">{item.label}</span>
                    <span className="flex shrink-0 gap-1">
                      {item.keys.map((k) => (
                        <kbd
                          key={k}
                          className="min-w-5 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-center font-sans text-[10px] font-medium text-[var(--text)]"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
