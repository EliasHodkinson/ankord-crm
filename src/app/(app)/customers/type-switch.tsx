import Link from "next/link";
import { PARTNER_TYPE } from "@/components/ui/status";
import { PARTNER_TYPES, type PartnerType } from "@/lib/contact-kinds";
import { cn } from "@/lib/utils";

/**
 * Clients, Suppliers, Media, All — separate relationships, one table. Plain
 * links rather than buttons, so each tab is an address you can reload, share
 * and open in a new tab. Search and status carry across; the quick filter
 * belongs to one tab and does not.
 */
export function PartnerTypeSwitch({
  current,
  counts,
  params,
}: {
  current: PartnerType | "all";
  counts: Record<PartnerType | "all", number>;
  params: Record<string, string | undefined>;
}) {
  const href = (type: PartnerType | "all") => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== "type" && key !== "kind" && key !== "only") next.set(key, value);
    }
    // Clients is the default, so it gets the clean address.
    if (type !== "client") next.set("type", type);
    return next.size ? `/customers?${next}` : "/customers";
  };

  const tabs = [
    ...PARTNER_TYPES.map((t) => ({ value: t, label: PARTNER_TYPE[t].plural })),
    { value: "all" as const, label: "All" },
  ];

  return (
    <nav aria-label="Type of business partner" className="max-w-full overflow-x-auto">
      <ul className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
        {tabs.map((tab) => {
          const active = tab.value === current;
          return (
            <li key={tab.value}>
              <Link
                href={href(tab.value)}
                aria-current={active ? "page" : undefined}
                scroll={false}
                className={cn(
                  "inline-flex h-8 items-center gap-2 rounded-md px-3 text-[13px] font-medium whitespace-nowrap",
                  "transition-colors duration-150",
                  active
                    ? "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]",
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-center text-[11px] leading-4 tabular-nums",
                    active
                      ? "bg-[var(--surface-3)] text-[var(--text)]"
                      : "bg-transparent text-[var(--text-faint)]",
                  )}
                >
                  {counts[tab.value]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
