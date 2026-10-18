"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PARTNER_TYPE } from "@/components/ui/status";
import { setPartnerType } from "@/lib/actions/customers";
import {
  PARTNER_TYPES,
  PARTNER_TYPE_FIELD,
  type ContactKinds,
  type PartnerType,
} from "@/lib/contact-kinds";

/**
 * The record's types, settable in place: a ticked type is its badge, an
 * unticked one a faint "+ Media" to add it. The full form keeps the same
 * checkboxes for anyone already editing.
 */
export function PartnerTypeToggles({ customerId, kinds }: { customerId: string; kinds: ContactKinds }) {
  const [optimistic, set] = useOptimistic(kinds, (state, change: { type: PartnerType; on: boolean }) => ({
    ...state,
    [PARTNER_TYPE_FIELD[change.type]]: change.on,
  }));
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span role="group" aria-label="Type" className="inline-flex flex-wrap items-center gap-1.5">
      {PARTNER_TYPES.map((t) => {
        const on = optimistic[PARTNER_TYPE_FIELD[t]];
        const entry = PARTNER_TYPE[t];
        return (
          <button
            key={t}
            type="button"
            aria-pressed={on}
            title={on ? `Untick ${entry.label}` : `Mark as ${entry.label}`}
            onClick={() =>
              start(async () => {
                setError(null);
                set({ type: t, on: !on });
                const result = await setPartnerType(customerId, t, !on);
                if (!result.ok) setError(result.message ?? "That didn't save.");
              })
            }
            className="rounded-md transition-opacity duration-150 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
          >
            <Badge tone={on ? entry.tone : "muted"}>
              {on ? <Check className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
              {entry.label}
            </Badge>
          </button>
        );
      })}
      {error ? (
        <span role="alert" className="text-[12px] text-[var(--danger)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}
