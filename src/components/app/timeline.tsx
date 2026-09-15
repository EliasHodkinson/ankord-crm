import Link from "next/link";
import {
  ExternalLink,
  Lock,
  Mail,
  MessageSquare,
  Phone,
  StickyNote,
  Users,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TimelineRemove } from "./timeline-remove";
import type { TimelineEntry } from "@/lib/data/communications";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";

const ICONS = {
  email: Mail,
  call: Phone,
  meeting: Users,
  note: StickyNote,
  teams: MessageSquare,
} as const;

const DIRECTION_LABEL = {
  inbound: "Received",
  outbound: "Sent",
  internal: "Internal",
} as const;

export function Timeline({
  entries,
  emptyTitle = "Nothing logged yet",
  emptyDescription = "Log a call, a meeting or a note — or link an email straight from Outlook — and the history builds itself.",
  showProject = false,
  currentUserId,
  canModerate = false,
  revalidate,
}: {
  entries: TimelineEntry[];
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
  showProject?: boolean;
  /** Who is looking, so only their own entries offer a remove control. */
  currentUserId?: string;
  canModerate?: boolean;
  revalidate?: string;
}) {
  if (entries.length === 0) {
    return <EmptyState compact title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <ol className="relative flex flex-col">
      {entries.map((entry, i) => {
        const Icon = ICONS[entry.type] ?? StickyNote;
        const last = i === entries.length - 1;
        return (
          <li key={entry.id} className="group/entry relative flex gap-3 pb-5 last:pb-0">
            {/* The rail that turns separate entries into one thread */}
            {!last ? (
              <span
                aria-hidden
                className="absolute top-8 bottom-0 left-[13px] w-px bg-[var(--border)]"
              />
            ) : null}

            <span
              className={cn(
                "relative z-10 mt-0.5 grid size-7 shrink-0 place-items-center rounded-full",
                "border border-[var(--border)] bg-[var(--surface)]",
                entry.type === "email" && "text-[var(--color-coastal-600)]",
                entry.type === "call" && "text-[var(--color-sunrise-600)]",
                entry.type === "meeting" && "text-[var(--color-coastal-500)]",
                entry.type === "note" && "text-[var(--text-faint)]",
              )}
            >
              <Icon className="size-3.5" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[13px] font-medium text-[var(--text)]">
                  {entry.subject ?? DIRECTION_LABEL[entry.direction]}
                </span>
                {entry.visibility === "private" ? (
                  <Badge tone="muted">
                    <Lock className="size-3" />
                    Private
                  </Badge>
                ) : null}
                {showProject && entry.project ? (
                  <Link
                    href={`/projects/${entry.project.id}`}
                    className="text-[12px] text-[var(--color-coastal-600)] hover:underline underline-offset-2"
                  >
                    {entry.project.name}
                  </Link>
                ) : null}
              </div>

              <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                <span title={formatDateTime(entry.occurredAt)}>
                  {relativeTime(entry.occurredAt)}
                </span>
                {entry.fromEmail ? ` · ${entry.fromName ?? entry.fromEmail}` : ""}
                {entry.contact
                  ? ` · ${[entry.contact.firstName, entry.contact.lastName].filter(Boolean).join(" ")}`
                  : ""}
              </p>

              {entry.preview || entry.body ? (
                <p className="mt-1.5 line-clamp-4 text-[13px] leading-6 whitespace-pre-line text-[var(--text)]">
                  {entry.preview ?? entry.body}
                </p>
              ) : null}

              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                {entry.graphWebLink ? (
                  <a
                    href={entry.graphWebLink}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-coastal-600)] hover:underline underline-offset-2"
                  >
                    Open in Outlook
                    <ExternalLink className="size-3" />
                  </a>
                ) : null}
                {entry.loggedBy ? (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-faint)]">
                    <Avatar
                      name={entry.loggedBy.name}
                      src={entry.loggedBy.photo}
                      size="xs"
                    />
                    {entry.loggedBy.name}
                  </span>
                ) : null}
                {revalidate && (canModerate || entry.loggedById === currentUserId) ? (
                  <TimelineRemove
                    id={entry.id}
                    label={entry.subject ?? "this entry"}
                    revalidate={revalidate}
                  />
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
