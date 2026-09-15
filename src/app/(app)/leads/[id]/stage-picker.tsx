"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { setLeadStage } from "@/lib/actions/leads";
import { LEAD_STAGES } from "@/components/ui/status";
import { cn } from "@/lib/utils";

const ORDER = ["new", "contacted", "qualified", "proposal", "negotiation", "won"] as const;

/** A stepper, not a dropdown — the pipeline has an order and it should show. */
export function StagePicker({ leadId, stage }: { leadId: string; stage: string }) {
  const [pending, start] = useTransition();
  const currentIndex = ORDER.indexOf(stage as (typeof ORDER)[number]);

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="Lead stage"
        className={cn(
          "flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1",
          pending && "opacity-60",
        )}
      >
        {ORDER.map((value, i) => {
          const active = value === stage;
          const passed = currentIndex > -1 && i < currentIndex;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              disabled={pending}
              onClick={() => start(() => void setLeadStage(leadId, value))}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium",
                "transition-colors duration-150 disabled:cursor-wait",
                active
                  ? "bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--shadow-sm)]"
                  : passed
                    ? "text-[var(--color-coastal-600)] hover:bg-[var(--surface-3)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]",
              )}
            >
              {passed ? <Check className="size-3" /> : null}
              {LEAD_STAGES[value].label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={pending || stage === "lost"}
        onClick={() => start(() => void setLeadStage(leadId, "lost"))}
        className="self-start text-[12px] text-[var(--text-faint)] transition-colors hover:text-[var(--danger)] disabled:opacity-50"
      >
        {stage === "lost" ? "Marked as lost" : "Mark as lost"}
      </button>
    </div>
  );
}
