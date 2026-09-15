"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { AlertTriangle, Loader2, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { bulkUpdateCustomers, bulkUpdateLeads, type BulkOp } from "@/lib/actions/bulk";
import type { TeamMember } from "@/lib/data/common";
import { cn } from "@/lib/utils";

type SelectionValue = {
  selected: Set<string>;
  toggle: (id: string) => void;
  toggleAll: (ids: string[]) => void;
  clear: () => void;
};

const SelectionContext = createContext<SelectionValue | null>(null);

export function useSelection() {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("useSelection must be used inside <Selection>");
  return value;
}

export function Selection({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const value: SelectionValue = {
    selected,
    toggle: (id) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    toggleAll: (ids) =>
      setSelected((current) =>
        ids.every((id) => current.has(id)) ? new Set() : new Set(ids),
      ),
    clear: () => setSelected(new Set()),
  };

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/** The checkbox in a row, wired to the shared selection. */
export function RowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      aria-label={`Select ${label}`}
      onChange={() => toggle(id)}
      className="size-3.5 accent-[var(--accent)]"
    />
  );
}

export function HeaderCheckbox({ ids }: { ids: string[] }) {
  const { selected, toggleAll } = useSelection();
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      checked={all}
      aria-label={all ? "Clear selection" : "Select everything shown"}
      onChange={() => toggleAll(ids)}
      className="size-3.5 accent-[var(--accent)]"
    />
  );
}

const STAGE_OPTIONS = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal", label: "Proposal out" },
  { value: "negotiation", label: "Negotiating" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

const STATUS_OPTIONS = [
  { value: "prospect", label: "Prospect" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "former", label: "Former" },
];

/**
 * Appears only once something is selected, and sits above the content rather
 * than floating over it — nothing is hidden behind the bar.
 */
export function BulkBar({
  entity,
  team,
}: {
  entity: "leads" | "customers";
  team: TeamMember[];
}) {
  const { selected, clear } = useSelection();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tagging, setTagging] = useState(false);

  if (selected.size === 0) return null;
  const ids = [...selected];
  const noun = entity === "leads" ? "lead" : "customer";

  function apply(op: BulkOp) {
    setError(null);
    start(async () => {
      const run = entity === "leads" ? bulkUpdateLeads : bulkUpdateCustomers;
      const result = await run(ids, op);
      if (!result.ok) setError(result.message ?? "That didn't work.");
      else {
        clear();
        setTagging(false);
      }
    });
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--color-coastal-300)]",
        "bg-[var(--surface)] px-3 py-2 shadow-[var(--shadow-md)]",
        pending && "opacity-70",
      )}
    >
      <span className="text-[13px] font-medium text-[var(--text)] tabular">
        {selected.size} {selected.size === 1 ? noun : `${noun}s`} selected
      </span>

      <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden />

      <label className="flex items-center gap-1.5">
        <span className="text-[12px] text-[var(--text-muted)]">Owner</span>
        <Select
          defaultValue=""
          disabled={pending}
          onChange={(e) =>
            apply({ kind: "owner", ownerId: e.target.value === "" ? null : e.target.value })
          }
          className="h-8 w-auto min-w-32 text-[12px]"
        >
          <option value="" disabled>
            Assign to…
          </option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-[12px] text-[var(--text-muted)]">
          {entity === "leads" ? "Stage" : "Status"}
        </span>
        <Select
          defaultValue=""
          disabled={pending}
          onChange={(e) =>
            apply(
              entity === "leads"
                ? { kind: "leadStage", stage: e.target.value as "new" }
                : { kind: "customerStatus", status: e.target.value as "active" },
            )
          }
          className="h-8 w-auto min-w-32 text-[12px]"
        >
          <option value="" disabled>
            Move to…
          </option>
          {(entity === "leads" ? STAGE_OPTIONS : STATUS_OPTIONS).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </label>

      {tagging ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const tag = new FormData(e.currentTarget).get("tag");
            if (typeof tag === "string" && tag.trim()) apply({ kind: "addTag", tag: tag.trim() });
          }}
        >
          <input
            name="tag"
            autoFocus
            maxLength={30}
            placeholder="Tag name"
            aria-label="Tag to add"
            className="h-8 w-32 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[12px] text-[var(--text)] focus:border-[var(--ring)] focus:outline-2 focus:outline-[var(--ring)]"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setTagging(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setTagging(true)}>
          <Tag />
          Add a tag
        </Button>
      )}

      {pending ? (
        <Loader2 className="size-4 animate-spin text-[var(--text-faint)]" />
      ) : null}

      {error ? (
        <span role="alert" className="inline-flex items-center gap-1.5 text-[12px] text-[var(--danger)]">
          <AlertTriangle className="size-3.5" />
          {error}
        </span>
      ) : null}

      <Button size="sm" variant="ghost" className="ml-auto" onClick={clear}>
        <X />
        Clear
      </Button>
    </div>
  );
}
