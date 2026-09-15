"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";
import { Nav } from "./nav";
import { AnkordLogo } from "@/components/brand/logo";

export function MobileNav({ counts }: { counts?: { due?: number } }) {
  // `open` can only become true from a click, so the portal is never reached
  // during server rendering and no mounted flag is needed.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)] lg:hidden"
      >
        <Menu className="size-5" />
      </button>

      {/*
        Portalled to the body: the app header uses backdrop-filter, which makes
        it a containing block for fixed positioning and would otherwise clip
        this drawer to the height of the header.
      */}
      {open
        ? createPortal(
            <div className="fixed inset-0 z-[60] lg:hidden">
              <button
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
                className="absolute inset-0 bg-[var(--color-coastal-950)]/55 backdrop-blur-[2px]"
              />
              <div className="relative flex h-full w-72 max-w-[85vw] flex-col bg-[var(--nav-bg)] shadow-[var(--shadow-lg)]">
                <div className="flex items-center justify-between px-4 py-4">
                  <AnkordLogo className="h-5 w-auto text-white" />
                  <button
                    type="button"
                    aria-label="Close navigation"
                    onClick={() => setOpen(false)}
                    className="grid size-8 place-items-center rounded-lg text-[var(--nav-fg-dim)] transition-colors hover:bg-[var(--nav-active)] hover:text-white"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <Nav counts={counts} onNavigate={() => setOpen(false)} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
