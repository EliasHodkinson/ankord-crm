"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { DriveItem } from "@/lib/graph/sharepoint";
import { bytes, cn, relativeTime } from "@/lib/utils";

type Crumb = { id: string; name: string };

/**
 * A live view of the SharePoint folder behind this record. Nothing is copied
 * into the CRM — the list, the uploads and the links all point at SharePoint.
 *
 * The first page of the folder is rendered on the server, so opening a record
 * never shows an empty box that fills in a moment later. Everything after that
 * is driven by what the person clicks.
 */
export function FilesPanel({
  driveId,
  rootItemId,
  rootName,
  webUrl,
  initialItems,
  initialError,
}: {
  driveId: string;
  rootItemId: string;
  rootName: string;
  webUrl: string | null;
  initialItems: DriveItem[];
  initialError?: string | null;
}) {
  const [trail, setTrail] = useState<Crumb[]>([{ id: rootItemId, name: rootName }]);
  const [items, setItems] = useState<DriveItem[]>(initialItems);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, startBusy] = useTransition();
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const current = trail[trail.length - 1];

  const load = useCallback(
    async (itemId: string) => {
      try {
        const res = await fetch(
          `/api/files?driveId=${encodeURIComponent(driveId)}&itemId=${encodeURIComponent(itemId)}`,
        );
        const data = (await res.json()) as { items?: DriveItem[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Could not read that folder.");
        setError(null);
        setItems(data.items ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read that folder.");
        setItems([]);
      }
    },
    [driveId],
  );

  function open(folder: DriveItem) {
    setTrail((t) => [...t, { id: folder.id, name: folder.name }]);
    setItems([]);
    startBusy(() => load(folder.id));
  }

  function goTo(index: number) {
    const crumb = trail[index];
    setTrail((t) => t.slice(0, index + 1));
    setItems([]);
    startBusy(() => load(crumb.id));
  }

  function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;

    const body = new FormData();
    body.set("driveId", driveId);
    body.set("itemId", current.id);
    for (const file of list) body.append("files", file);

    startBusy(async () => {
      try {
        const res = await fetch("/api/files/upload", { method: "POST", body });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Upload failed.");
        await load(current.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      }
    });
  }

  function newFolder() {
    const name = window.prompt("Name the new folder");
    if (!name?.trim()) return;
    startBusy(async () => {
      try {
        const res = await fetch("/api/files/folder", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ driveId, itemId: current.id, name }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Could not create the folder.");
        await load(current.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create the folder.");
      }
    });
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col gap-3 rounded-lg transition-colors duration-150",
        dragging &&
          "bg-[var(--color-sunrise-50)] outline-2 outline-dashed outline-[var(--color-sunrise-400)] dark:bg-[var(--color-sunrise-900)]/20",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <nav
          aria-label="Folder path"
          className="flex min-w-0 flex-1 items-center gap-0.5 text-[12px]"
        >
          {trail.map((crumb, i) => (
            <span key={crumb.id} className="flex min-w-0 items-center gap-0.5">
              {i > 0 ? (
                <ChevronRight
                  className="size-3 shrink-0 text-[var(--text-faint)]"
                  aria-hidden
                />
              ) : null}
              {i === trail.length - 1 ? (
                <span className="truncate font-medium text-[var(--text)]">
                  {crumb.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  className="truncate text-[var(--text-muted)] transition-colors hover:text-[var(--text)] hover:underline underline-offset-2"
                >
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh"
            disabled={busy}
            onClick={() => startBusy(() => load(current.id))}
          >
            <RefreshCw className={cn(busy && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={newFolder}>
            <FolderPlus />
            Folder
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}
            {busy ? "Working…" : "Upload"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) upload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--danger)]"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {busy && items.length === 0 ? (
        <ul className="flex flex-col gap-1" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="h-9 animate-pulse rounded-lg bg-[var(--surface-3)]" />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <EmptyState
          compact
          title="This folder is empty"
          description="Drag files in, or use Upload. They go straight into SharePoint — the CRM only ever links to them."
        />
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li key={item.id}>
              {item.folder ? (
                <button
                  type="button"
                  onClick={() => open(item)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
                >
                  <Folder className="size-4 shrink-0 text-[var(--color-coastal-500)]" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text)]">
                    {item.name}
                  </span>
                  <span className="shrink-0 text-[12px] text-[var(--text-faint)]">
                    {item.folder.childCount}{" "}
                    {item.folder.childCount === 1 ? "item" : "items"}
                  </span>
                </button>
              ) : (
                <a
                  href={item.webUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--surface-2)]"
                >
                  <FileGlyph name={item.name} mime={item.file?.mimeType} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-[var(--text)]">
                      {item.name}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--text-faint)]">
                      {bytes(item.size)} · {relativeTime(item.lastModifiedDateTime)}
                      {item.lastModifiedBy?.user?.displayName
                        ? ` · ${item.lastModifiedBy.user.displayName}`
                        : ""}
                    </span>
                  </span>
                  <ExternalLink className="size-3.5 shrink-0 text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {webUrl ? (
        <a
          href={webUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 self-start text-[12px] font-medium text-[var(--color-coastal-600)] hover:underline underline-offset-2"
        >
          Open in SharePoint
          <ExternalLink className="size-3" />
        </a>
      ) : null}
    </div>
  );
}

function FileGlyph({ name, mime }: { name: string; mime?: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const Icon =
    mime?.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(ext)
      ? ImageIcon
      : ["xlsx", "xls", "csv"].includes(ext)
        ? FileSpreadsheet
        : ["docx", "doc", "pdf", "txt", "md", "rtf"].includes(ext)
          ? FileText
          : FileIcon;
  return <Icon className="size-4 shrink-0 text-[var(--text-faint)]" />;
}
