"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  ChartNoAxesColumn,
  CircleCheck,
  FolderKanban,
  Gauge,
  Mail,
  Settings,
  Target,
  Upload,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SECTIONS: { heading?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/", label: "Overview", icon: Gauge, exact: true },
      { href: "/tasks", label: "Follow-ups", icon: CircleCheck, badge: "due" },
    ],
  },
  {
    heading: "Pipeline",
    items: [
      { href: "/leads", label: "Leads", icon: Target },
      { href: "/customers", label: "Business Partners", icon: Building2 },
      { href: "/contacts", label: "People", icon: Users },
    ],
  },
  {
    heading: "Delivery",
    items: [
      { href: "/projects", label: "Projects", icon: FolderKanban },
      { href: "/inbox", label: "Link email", icon: Mail },
      { href: "/reports", label: "Reports", icon: ChartNoAxesColumn },
      { href: "/import", label: "Import", icon: Upload },
    ],
  },
];

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  /** Key into the counts the server passes in. */
  badge?: "due";
};

export function Nav({
  onNavigate,
  counts,
}: {
  onNavigate?: () => void;
  /** Live numbers for the rail, e.g. how many follow-ups are due. */
  counts?: { due?: number };
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4 scrollbar-slim">
      {SECTIONS.map((section, i) => (
        <div key={section.heading ?? i} className="flex flex-col gap-0.5">
          {section.heading ? (
            <p className="mb-1.5 px-2.5 text-[10px] font-semibold tracking-[0.12em] text-[var(--nav-fg-dim)] uppercase">
              {section.heading}
            </p>
          ) : null}
          {section.items.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={
                item.exact ? pathname === item.href : pathname.startsWith(item.href)
              }
              count={item.badge ? counts?.[item.badge] : undefined}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}

      <div className="mt-auto flex flex-col gap-0.5 pt-4">
        <NavLink
          item={{ href: "/settings", label: "Settings", icon: Settings }}
          active={pathname.startsWith("/settings")}
          onNavigate={onNavigate}
        />
      </div>
    </nav>
  );
}

function NavLink({
  item,
  active,
  count,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  count?: number;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium",
        "transition-colors duration-150 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-sunrise-400)]",
        active
          ? "bg-[var(--nav-active)] text-white"
          : "text-[var(--nav-fg)] hover:bg-[var(--nav-active)]/60 hover:text-white",
      )}
    >
      {/* The single Sunrise mark in the rail: where you are. */}
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 left-0 h-4 w-[3px] -translate-x-2 -translate-y-1/2 rounded-r-full bg-[var(--color-sunrise-500)]",
          "transition-opacity duration-150",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <Icon
        className={cn(
          "size-4 transition-colors",
          active ? "text-[var(--color-sunrise-400)]" : "text-[var(--nav-fg-dim)] group-hover:text-[var(--nav-fg)]",
        )}
      />
      {item.label}
      {count ? (
        <span
          className={cn(
            "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular",
            "bg-[var(--color-sunrise-500)] text-white",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
