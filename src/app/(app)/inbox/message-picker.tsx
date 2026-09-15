"use client";

import { useState } from "react";
import { ExternalLink, Lock, Mail, Paperclip } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { linkEmails } from "@/lib/actions/email-link";
import { cn, formatDateTime, relativeTime, truncate } from "@/lib/utils";

export type PickableMessage = {
  id: string;
  subject: string;
  preview: string;
  from: string;
  to: string;
  receivedAt: string;
  hasAttachments: boolean;
  webLink: string | null;
  alreadyLinked: boolean;
};

export type LinkTarget = {
  customers: { id: string; name: string }[];
  projects: { id: string; name: string; customerId: string }[];
  leads: { id: string; name: string }[];
};

/**
 * Pick messages, pick where they belong, link them. Anything already in the
 * CRM is shown but not selectable, so nothing gets attached twice.
 */
export function MessagePicker({
  messages,
  targets,
  defaultCustomerId,
  defaultProjectId,
  defaultLeadId,
}: {
  messages: PickableMessage[];
  targets: LinkTarget;
  defaultCustomerId?: string;
  defaultProjectId?: string;
  defaultLeadId?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");

  const selectable = messages.filter((m) => !m.alreadyLinked);
  const projectsForCustomer = customerId
    ? targets.projects.filter((p) => p.customerId === customerId)
    : targets.projects;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (messages.length === 0) {
    return (
      <EmptyState
        title="No messages found"
        description="Search by a person's name, an email address, or a subject line. The search runs against your own Outlook mailbox — you will only ever see what you can already see there."
      />
    );
  }

  return (
    <ActionForm action={linkEmails} className="flex flex-col gap-4">
      <input type="hidden" name="leadId" value={defaultLeadId ?? ""} />

      {/* The link bar sticks so the choice stays reachable down a long list */}
      <div className="sticky top-14 z-30 flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)]/95 p-2.5 shadow-[var(--shadow-sm)] backdrop-blur-md">
        <label className="flex items-center gap-1.5">
          <span className="text-[12px] text-[var(--text-muted)]">Link to</span>
          <Select
            name="customerId"
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setProjectId("");
            }}
            className="h-8 w-auto min-w-44 text-[13px]"
          >
            <option value="">Choose a customer…</option>
            {targets.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-[12px] text-[var(--text-muted)]">Project</span>
          <Select
            name="projectId"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-8 w-auto min-w-40 text-[13px]"
            disabled={projectsForCustomer.length === 0}
          >
            <option value="">
              {projectsForCustomer.length === 0 ? "None available" : "Customer only"}
            </option>
            {projectsForCustomer.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
          <input
            type="checkbox"
            name="visibility"
            value="private"
            className="size-3.5 accent-[var(--accent)]"
          />
          <Lock className="size-3" />
          Only visible to me
        </label>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-[var(--text-muted)] tabular">
            {selected.size} selected
          </span>
          {selectable.length > 0 ? (
            <button
              type="button"
              onClick={() =>
                setSelected((prev) =>
                  prev.size === selectable.length
                    ? new Set()
                    : new Set(selectable.map((m) => m.id)),
                )
              }
              className="text-[12px] font-medium text-[var(--color-coastal-600)] hover:underline underline-offset-2"
            >
              {selected.size === selectable.length ? "Clear" : "Select all"}
            </button>
          ) : null}
          <SubmitButton
            size="sm"
            disabled={selected.size === 0 || (!customerId && !defaultLeadId)}
            pendingLabel="Linking…"
          >
            <Mail />
            Link {selected.size > 0 ? selected.size : ""}
          </SubmitButton>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {messages.map((message) => {
          const checked = selected.has(message.id);
          return (
            <li key={message.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-[10px] border p-3 transition-colors duration-150",
                  message.alreadyLinked
                    ? "cursor-default border-[var(--border-soft)] bg-[var(--surface-2)] opacity-70"
                    : checked
                      ? "border-[var(--accent)] bg-[var(--color-sunrise-50)] dark:bg-[var(--color-sunrise-900)]/25"
                      : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--color-coastal-300)]",
                )}
              >
                <input
                  type="checkbox"
                  name="messageIds"
                  value={message.id}
                  checked={checked}
                  disabled={message.alreadyLinked}
                  onChange={() => toggle(message.id)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13px] font-medium text-[var(--text)]">
                      {message.subject}
                    </span>
                    {message.hasAttachments ? (
                      <Paperclip
                        className="size-3.5 text-[var(--text-faint)]"
                        aria-label="Has attachments"
                      />
                    ) : null}
                    {message.alreadyLinked ? (
                      <Badge tone="ok">Already linked</Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                    {message.from} → {message.to} ·{" "}
                    <span title={formatDateTime(message.receivedAt)}>
                      {relativeTime(message.receivedAt)}
                    </span>
                  </p>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--text-muted)]">
                    {truncate(message.preview, 260)}
                  </p>
                </div>
                {message.webLink ? (
                  <a
                    href={message.webLink}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 rounded p-1 text-[var(--text-faint)] transition-colors hover:text-[var(--color-coastal-600)]"
                    aria-label="Open in Outlook"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
    </ActionForm>
  );
}
