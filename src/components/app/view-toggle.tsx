"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Columns3, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";

const VIEWS = [
  { value: "board", label: "Board", icon: Columns3 },
  { value: "list", label: "List", icon: Rows3 },
] as const;

/** Board or list, remembered in the URL so a link opens the same way. */
export function ViewToggle({ defaultView = "board" }: { defaultView?: "board" | "list" }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, start] = useTransition();
  const current = params.get("view") ?? defaultView;

  return (
    <div
      role="radiogroup"
      aria-label="View"
      className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5"
    >
      {VIEWS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            if (value === defaultView) next.delete("view");
            else next.set("view", value);
            start(() =>
              router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false }),
            );
          }}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium",
            "transition-colors duration-150",
            current === value
              ? "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]"
              : "text-[var(--text-muted)] hover:text-[var(--text)]",
          )}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
