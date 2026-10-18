"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/campaigns", label: "Campaigns", exact: true },
  { href: "/campaigns/templates", label: "Templates" },
  { href: "/campaigns/audience", label: "Audience" },
  { href: "/campaigns/settings", label: "Settings" },
];

/** The marketing area's own sections, under its page header. */
export function CampaignTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Marketing" className="-mb-px flex gap-1 overflow-x-auto">
      {TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
              active
                ? "border-[var(--accent-mark)] text-[var(--text)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
