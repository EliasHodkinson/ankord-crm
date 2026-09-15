"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, Settings, ShieldCheck } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function UserMenu({
  name,
  email,
  photo,
  role,
}: {
  name: string;
  email: string;
  photo: string | null;
  role: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-lg py-1 pr-1.5 pl-1 transition-colors duration-150",
          "hover:bg-[var(--surface-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
          open && "bg-[var(--surface-3)]",
        )}
      >
        <Avatar name={name} src={photo} size="sm" />
        <span className="hidden max-w-36 truncate text-[13px] font-medium text-[var(--text)] sm:block">
          {name}
        </span>
        <ChevronDown className="size-3.5 text-[var(--text-faint)]" />
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute top-[calc(100%+0.4rem)] right-0 z-50 w-64 origin-top-right",
            "rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-lg)]",
          )}
        >
          <div className="flex items-center gap-2.5 border-b border-[var(--border-soft)] px-2.5 py-2.5">
            <Avatar name={name} src={photo} size="md" />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-[var(--text)]">{name}</p>
              <p className="truncate text-[12px] text-[var(--text-muted)]">{email}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-2 text-[12px] text-[var(--text-muted)]">
            <ShieldCheck className="size-3.5 text-[var(--color-coastal-500)]" />
            Signed in with Microsoft 365 · {role}
          </div>

          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 sm:hidden">
            <span className="text-[13px] text-[var(--text)]">Theme</span>
            <ThemeToggle />
          </div>

          <MenuLink href="/settings" icon={Settings}>
            Settings
          </MenuLink>
          <a
            href="/api/auth/signout?full=1"
            role="menuitem"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-[var(--text)] transition-colors hover:bg-[var(--surface-3)]"
          >
            <LogOut className="size-4 text-[var(--text-faint)]" />
            Sign out
          </a>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-[var(--text)] transition-colors hover:bg-[var(--surface-3)]"
    >
      <Icon className="size-4 text-[var(--text-faint)]" />
      {children}
    </Link>
  );
}
