"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type PickerCustomer = { id: string; name: string; hasFolder?: boolean; archived?: boolean };

/**
 * Business partners as a filterable checklist. Each ticked partner submits as
 * `customerIds`, and — when folder levels are shown — its level as
 * `access:<id>`. Rows hidden by the filter stay in the form, so searching
 * never drops a partner that was already ticked.
 */
export function CustomerPicker({
  customers,
  initial,
  showAccess = true,
  defaultAccess = "write",
}: {
  customers: PickerCustomer[];
  /** Partner id → folder level, for what is granted now. */
  initial?: Record<string, "read" | "write">;
  showAccess?: boolean;
  defaultAccess?: "read" | "write";
}) {
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<string>>(() => new Set(Object.keys(initial ?? {})));

  // Ticked partners first, so what someone has is visible without scrolling.
  const ordered = useMemo(() => {
    const has = new Set(Object.keys(initial ?? {}));
    return [...customers].sort((a, b) => Number(has.has(b.id)) - Number(has.has(a.id)));
  }, [customers, initial]);

  const term = query.trim().toLowerCase();

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-faint)]" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a business partner…"
          aria-label="Find a business partner"
          className="pl-9"
        />
      </div>
      <p className="text-[12px] text-[var(--text-muted)]">
        {checked.size === 0
          ? "None selected — they will see an empty CRM."
          : `${checked.size} selected`}
      </p>
      <ul className="max-h-80 divide-y divide-[var(--border-soft)] overflow-y-auto rounded-lg border border-[var(--border)] scrollbar-slim">
        {ordered.map((customer) => {
          const isChecked = checked.has(customer.id);
          const visible = !term || customer.name.toLowerCase().includes(term);
          return (
            <li
              key={customer.id}
              className={cn(
                "flex items-center gap-3 px-3 py-2",
                isChecked && "bg-[var(--surface-2)]",
                !visible && "hidden",
              )}
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  name="customerIds"
                  value={customer.id}
                  checked={isChecked}
                  onChange={(e) => {
                    const next = new Set(checked);
                    if (e.target.checked) next.add(customer.id);
                    else next.delete(customer.id);
                    setChecked(next);
                  }}
                  className="size-4 accent-[var(--accent)]"
                />
                <span className="truncate text-[13px] text-[var(--text)]">{customer.name}</span>
                {customer.archived ? (
                  <span className="shrink-0 text-[11px] text-[var(--text-faint)]">archived</span>
                ) : null}
                {customer.hasFolder === false ? (
                  <span className="shrink-0 text-[11px] text-[var(--text-faint)]">no folder yet</span>
                ) : null}
              </label>
              {showAccess && isChecked ? (
                <Select
                  name={`access:${customer.id}`}
                  defaultValue={initial?.[customer.id] ?? defaultAccess}
                  aria-label={`Folder access for ${customer.name}`}
                  className="h-8 w-auto min-w-32 text-[12px]"
                >
                  <option value="write">Can edit files</option>
                  <option value="read">Can view files</option>
                </Select>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
