"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { GripVertical, Plus, TriangleAlert } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { LEAD_STAGES } from "@/components/ui/status";
import { moveLeadOnBoard } from "@/lib/actions/leads";
import { heatOf, heatSummary, type StaleThresholds } from "@/lib/staleness";
import { cn, formatDate, money } from "@/lib/utils";

export type BoardLead = {
  id: string;
  companyName: string;
  contactName: string | null;
  stage: string;
  valueAud: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  interest: string | null;
  ownerName: string | null;
  ownerPhoto: string | null;
  lastActivityAt: Date | string | null;
  createdAt: Date | string;
  boardPosition: number;
};

const COLUMNS = ["new", "contacted", "qualified", "proposal", "negotiation", "won"] as const;

/**
 * The pipeline as a board. Dragging a card is the fastest way to say "this
 * moved on", and the column totals make the shape of the pipeline obvious
 * without opening a report.
 */
export function PipelineBoard({
  leads,
  thresholds,
}: {
  leads: BoardLead[];
  thresholds: StaleThresholds;
}) {
  const [, startMove] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const dropBefore = useRef<string | null>(null);

  // The card jumps to its new column immediately; the server catches up.
  const [board, applyMove] = useOptimistic(
    leads,
    (current, move: { id: string; stage: string; beforeId: string | null }) => {
      const moved = current.find((l) => l.id === move.id);
      if (!moved) return current;
      const rest = current.filter((l) => l.id !== move.id);
      const target = { ...moved, stage: move.stage };
      const at = move.beforeId ? rest.findIndex((l) => l.id === move.beforeId) : -1;
      if (at === -1) rest.push(target);
      else rest.splice(at, 0, target);
      return rest;
    },
  );

  function drop(stage: string) {
    const id = dragging;
    const beforeId = dropBefore.current;
    setDragging(null);
    setOverColumn(null);
    dropBefore.current = null;
    if (!id) return;

    const current = board.find((l) => l.id === id);
    if (current && current.stage === stage && !beforeId) return;

    startMove(async () => {
      applyMove({ id, stage, beforeId });
      await moveLeadOnBoard(id, stage, beforeId);
    });
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-slim">
      {COLUMNS.map((stage) => {
        const cards = board.filter((l) => l.stage === stage);
        const total = cards.reduce((sum, c) => sum + Number(c.valueAud ?? 0), 0);

        return (
          <section
            key={stage}
            onDragOver={(e) => {
              e.preventDefault();
              setOverColumn(stage);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverColumn(null);
            }}
            onDrop={() => drop(stage)}
            className={cn(
              "flex w-72 shrink-0 flex-col rounded-[10px] border transition-colors duration-150",
              overColumn === stage && dragging
                ? "border-[var(--accent)] bg-[var(--color-sunrise-50)] dark:bg-[var(--color-sunrise-900)]/20"
                : "border-[var(--border)] bg-[var(--surface-2)]",
            )}
          >
            <header className="flex items-baseline justify-between gap-2 border-b border-[var(--border-soft)] px-3 py-2.5">
              <h2 className="text-[12px] font-semibold tracking-[0.02em] text-[var(--text)]">
                {LEAD_STAGES[stage].label}
              </h2>
              <span className="text-[11px] text-[var(--text-muted)] tabular">
                {cards.length}
                {total > 0 ? ` · ${money(total)}` : ""}
              </span>
            </header>

            <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
              {cards.map((lead) => (
                <Card
                  key={lead.id}
                  lead={lead}
                  thresholds={thresholds}
                  dragging={dragging === lead.id}
                  onDragStart={() => setDragging(lead.id)}
                  onDragEnd={() => {
                    setDragging(null);
                    setOverColumn(null);
                    dropBefore.current = null;
                  }}
                  onDragOverCard={() => {
                    dropBefore.current = lead.id;
                  }}
                />
              ))}

              {cards.length === 0 ? (
                <p className="px-1 py-6 text-center text-[12px] text-[var(--text-faint)]">
                  {overColumn === stage && dragging ? "Drop here" : "Nothing here"}
                </p>
              ) : null}
            </div>

            {stage === "new" ? (
              <ButtonLink
                href="/leads/new"
                variant="ghost"
                size="sm"
                className="m-2 mt-0 justify-start text-[var(--text-muted)]"
              >
                <Plus />
                Add a lead
              </ButtonLink>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function Card({
  lead,
  thresholds,
  dragging,
  onDragStart,
  onDragEnd,
  onDragOverCard,
}: {
  lead: BoardLead;
  thresholds: StaleThresholds;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverCard: () => void;
}) {
  const { heat, days } = heatOf(lead.lastActivityAt, lead.createdAt, thresholds.lead);
  const overdue = lead.nextActionAt ? new Date(lead.nextActionAt) < new Date() : false;

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        // Firefox needs something on the transfer for the drag to begin.
        e.dataTransfer.setData("text/plain", lead.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOverCard}
      className={cn(
        "group cursor-grab rounded-lg border bg-[var(--surface)] p-2.5 shadow-[var(--shadow-sm)]",
        "transition-[opacity,border-color,box-shadow] duration-150 active:cursor-grabbing",
        "hover:border-[var(--color-coastal-300)]",
        dragging && "opacity-40",
        heat === "cold" ? "border-[var(--danger)]/40" : "border-[var(--border)]",
      )}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical
          aria-hidden
          className="mt-0.5 size-3.5 shrink-0 text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100"
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/leads/${lead.id}`}
            draggable={false}
            className="block truncate text-[13px] font-medium text-[var(--text)] hover:text-[var(--accent)] hover:underline underline-offset-2"
          >
            {lead.companyName}
          </Link>
          {lead.contactName || lead.interest ? (
            <p className="truncate text-[11px] text-[var(--text-muted)]">
              {lead.contactName ?? lead.interest}
            </p>
          ) : null}
        </div>
        {lead.ownerName ? (
          <Avatar name={lead.ownerName} src={lead.ownerPhoto} size="xs" />
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {lead.valueAud ? (
          <span className="text-[12px] font-semibold text-[var(--text)] tabular">
            {money(lead.valueAud)}
          </span>
        ) : null}
        {heat !== "fresh" ? (
          <Badge tone={heat === "cold" ? "danger" : "warn"} dot>
            {heatSummary(heat, days)}
          </Badge>
        ) : null}
      </div>

      {lead.nextAction ? (
        <p
          className={cn(
            "mt-1.5 flex items-start gap-1 truncate text-[11px]",
            overdue ? "text-[var(--danger)]" : "text-[var(--text-muted)]",
          )}
        >
          {overdue ? <TriangleAlert className="mt-px size-3 shrink-0" /> : null}
          <span className="truncate">
            {lead.nextAction}
            {lead.nextActionAt ? ` · ${formatDate(lead.nextActionAt, "day")}` : ""}
          </span>
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] text-[var(--text-faint)] italic">
          No next action set
        </p>
      )}
    </article>
  );
}
