"use client";

import { useId, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookmarkPlus, Users, X } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { CheckboxField } from "@/components/app/form-kit";
import { deleteView, saveView } from "@/lib/actions/saved-views";
import type { SavedView } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

/**
 * Saved views are the filters you keep coming back to — "Mine, going cold",
 * "Everything in proposal". Saving one just remembers the query string the
 * list page is already using, so anything you can filter you can save.
 */
export function SavedViews({
  entity,
  views,
  currentUserId,
}: {
  entity: string;
  views: SavedView[];
  currentUserId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [saving, setSaving] = useState(false);
  const uid = useId();

  const currentQuery = params.toString();
  const activeId = views.find((v) => v.query === currentQuery)?.id;
  const canSave = currentQuery.length > 0 && !activeId;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => router.replace(pathname, { scroll: false })}
        aria-pressed={!activeId && currentQuery.length === 0}
        className={cn(
          "inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium transition-colors",
          !activeId && currentQuery.length === 0
            ? "bg-[var(--surface-3)] text-[var(--text)]"
            : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
        )}
      >
        All
      </button>

      {views.map((view) => (
        <ViewChip
          key={view.id}
          view={view}
          active={view.id === activeId}
          canRemove={view.ownerId === currentUserId || view.createdById === currentUserId}
          onOpen={() =>
            router.replace(view.query ? `${pathname}?${view.query}` : pathname, {
              scroll: false,
            })
          }
        />
      ))}

      {canSave && !saving ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[12px] text-[var(--text-faint)]"
          onClick={() => setSaving(true)}
        >
          <BookmarkPlus />
          Save this view
        </Button>
      ) : null}

      {saving ? (
        <ActionForm
          action={saveView}
          onSuccess={() => setSaving(false)}
          className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5"
        >
          <input type="hidden" name="entity" value={entity} />
          <input type="hidden" name="query" value={currentQuery} />
          <Field label="Name this view" htmlFor={`${uid}-name`} className="min-w-48 flex-1">
            <Input
              id={`${uid}-name`}
              name="name"
              required
              autoFocus
              maxLength={40}
              placeholder="Mine, going cold"
            />
          </Field>
          <CheckboxField
            id={`${uid}-shared`}
            name="isShared"
            label="Share with the team"
            hint="Everyone sees it, not just you."
          />
          <div className="flex items-center gap-2">
            <SubmitButton size="sm">Save view</SubmitButton>
            <Button variant="ghost" size="sm" onClick={() => setSaving(false)}>
              Cancel
            </Button>
          </div>
        </ActionForm>
      ) : null}
    </div>
  );
}

function ViewChip({
  view,
  active,
  canRemove,
  onOpen,
}: {
  view: SavedView;
  active: boolean;
  canRemove: boolean;
  onOpen: () => void;
}) {
  const [pending, start] = useTransition();

  return (
    <span
      className={cn(
        "group/chip inline-flex h-7 items-center rounded-md transition-colors",
        active
          ? "bg-[var(--color-sunrise-50)] text-[var(--accent)] dark:bg-[var(--color-sunrise-900)]/30"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
        pending && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-pressed={active}
        className="inline-flex h-full items-center gap-1.5 rounded-md pr-1.5 pl-2.5 text-[12px] font-medium"
      >
        {view.isShared ? <Users className="size-3" aria-label="Shared" /> : null}
        {view.name}
      </button>
      {canRemove ? (
        <button
          type="button"
          aria-label={`Remove the "${view.name}" view`}
          disabled={pending}
          onClick={() => start(() => void deleteView(view.id))}
          className="mr-1 rounded p-0.5 opacity-0 transition-opacity group-hover/chip:opacity-100 focus-visible:opacity-100 hover:text-[var(--danger)]"
        >
          <X className="size-3" />
        </button>
      ) : (
        <span className="w-1.5" />
      )}
    </span>
  );
}
