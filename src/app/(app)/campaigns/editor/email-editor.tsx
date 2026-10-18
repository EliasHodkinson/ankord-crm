"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronLeft,
  Code2,
  Columns2,
  Copy,
  GripVertical,
  Heading,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  Minus,
  Monitor,
  MoveVertical,
  Quote,
  Redo2,
  Share2,
  Smartphone,
  SquareMousePointer,
  Trash2,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { saveCampaignContent, saveTemplateContent } from "@/lib/actions/campaigns";
import {
  BLOCK_LABELS,
  BRAND,
  DEFAULT_THEME,
  fillMergeTags,
  LETTER_THEME,
  newBlock,
  newId,
  SAMPLE_MERGE,
  type Block,
  type BlockType,
  type Theme,
} from "@/lib/campaigns/model";
import { renderEmail } from "@/lib/campaigns/render";
import { checkContent } from "@/lib/campaigns/checks";
import { cn } from "@/lib/utils";
import { BlockFields, MergeInput, type Asset } from "./block-fields";
import { PreviewFrame } from "./preview-frame";

type Content = { subject: string; preheader: string; blocks: Block[]; theme: Theme };

const BLOCK_ICONS: Record<BlockType, LucideIcon> = {
  heading: Heading,
  text: Type,
  image: ImageIcon,
  button: SquareMousePointer,
  divider: Minus,
  spacer: MoveVertical,
  columns: Columns2,
  quote: Quote,
  callout: Megaphone,
  social: Share2,
  html: Code2,
};

const PALETTE: BlockType[] = ["heading", "text", "image", "button", "columns", "callout", "quote", "divider", "spacer", "social", "html"];

/** A line that says what a block holds, for the outline. */
function summarise(b: Block): string {
  switch (b.type) {
    case "heading":
    case "text":
      return b.text.replace(/\s+/g, " ").trim() || "Empty";
    case "image":
      return b.alt || (b.src ? "Image" : "No image yet");
    case "button":
      return b.label || "No label";
    case "columns":
      return `${b.left.heading || "—"} · ${b.right.heading || "—"}`;
    case "quote":
      return b.text;
    case "callout":
      return b.heading || b.text;
    case "spacer":
      return `${b.height}px`;
    case "social":
      return "Ankor'd profiles";
    case "html":
      return "Custom HTML";
    case "divider":
      return "";
  }
}

export function EmailEditor({
  kind,
  id,
  name: initialName,
  initial,
  footer,
  social,
  defaultLogoUrl,
  fromLabel,
  assets: initialAssets,
  backHref,
}: {
  kind: "campaign" | "template";
  id: string;
  name: string;
  initial: Content;
  footer: string;
  social: Record<string, string>;
  defaultLogoUrl: string;
  /** How the sender shows in an inbox, for the inbox preview. */
  fromLabel: string;
  assets: Asset[];
  backHref: string;
}) {
  const [content, setContent] = React.useState<Content>(initial);
  const [name, setName] = React.useState(initialName);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<"content" | "design">("content");
  const [device, setDevice] = React.useState<"desktop" | "mobile">("desktop");
  const [assets, setAssets] = React.useState(initialAssets);
  const [save, setSave] = React.useState<{ state: "saved" | "dirty" | "saving" | "error"; message?: string }>({ state: "saved" });

  /* ── undo ──────────────────────────────────────────────────────── */
  const past = React.useRef<Content[]>([]);
  const future = React.useRef<Content[]>([]);
  const lastPush = React.useRef(0);
  const [depth, setDepth] = React.useState({ undo: 0, redo: 0 });
  const syncDepth = () => setDepth({ undo: past.current.length, redo: future.current.length });

  const update = React.useCallback((next: Content | ((c: Content) => Content)) => {
    setContent((current) => {
      const value = typeof next === "function" ? next(current) : next;
      // Typing coalesces: one undo step per pause, not per keystroke.
      if (Date.now() - lastPush.current > 800) {
        past.current = [...past.current.slice(-49), current];
        future.current = [];
        lastPush.current = Date.now();
        syncDepth();
      }
      return value;
    });
    setSave({ state: "dirty" });
  }, []);

  const undo = React.useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    setContent((current) => {
      future.current.push(current);
      return prev;
    });
    lastPush.current = 0;
    setSave({ state: "dirty" });
    syncDepth();
  }, []);

  const redo = React.useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    setContent((current) => {
      past.current.push(current);
      return next;
    });
    lastPush.current = 0;
    setSave({ state: "dirty" });
    syncDepth();
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]");
      if (typing || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /* ── autosave ──────────────────────────────────────────────────── */
  const latest = React.useRef({ content, name });
  React.useEffect(() => {
    latest.current = { content, name };
  }, [content, name]);

  const flush = React.useCallback(async () => {
    setSave({ state: "saving" });
    const { content: c, name: n } = latest.current;
    const result =
      kind === "campaign"
        ? await saveCampaignContent(id, c)
        : await saveTemplateContent(id, { ...c, name: n });
    setSave(result.ok ? { state: "saved" } : { state: "error", message: result.message });
  }, [id, kind]);

  React.useEffect(() => {
    if (save.state !== "dirty") return;
    const timer = setTimeout(() => void flush(), 1200);
    return () => clearTimeout(timer);
  }, [save.state, content, name, flush]);

  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save.state === "dirty" || save.state === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.state]);

  /* ── blocks ────────────────────────────────────────────────────── */
  const setBlocks = (fn: (blocks: Block[]) => Block[]) => update((c) => ({ ...c, blocks: fn(c.blocks) }));
  const selectedIndex = content.blocks.findIndex((b) => b.id === selected);
  const selectedBlock = selectedIndex >= 0 ? content.blocks[selectedIndex] : null;

  const addBlock = (type: BlockType) => {
    const block = newBlock(type);
    setBlocks((blocks) => {
      const at = selectedIndex >= 0 ? selectedIndex + 1 : blocks.length;
      return [...blocks.slice(0, at), block, ...blocks.slice(at)];
    });
    setSelected(block.id);
  };
  const move = (index: number, to: number) =>
    setBlocks((blocks) => {
      if (to < 0 || to >= blocks.length) return blocks;
      const next = [...blocks];
      const [b] = next.splice(index, 1);
      next.splice(to, 0, b);
      return next;
    });
  const duplicate = (index: number) => {
    const copy = { ...structuredClone(content.blocks[index]), id: newId() };
    setBlocks((blocks) => [...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)]);
    setSelected(copy.id);
  };
  const remove = (index: number) => {
    setBlocks((blocks) => blocks.filter((_, i) => i !== index));
    setSelected(null);
  };

  const [dragging, setDragging] = React.useState<number | null>(null);

  /* ── preview ───────────────────────────────────────────────────── */
  const html = React.useMemo(
    () =>
      renderEmail(content.blocks, content.theme, {
        subject: content.subject,
        preheader: content.preheader,
        merge: SAMPLE_MERGE,
        footer,
        social,
        unsubscribeUrl: "#",
        webVersionUrl: kind === "campaign" ? "#" : null,
        defaultLogoUrl,
        annotate: true,
      }),
    [content, footer, social, defaultLogoUrl, kind],
  );

  const checks = React.useMemo(() => checkContent(content), [content]);
  const errors = checks.filter((c) => c.level === "error").length;

  const setTheme = (patch: Partial<Theme>) => update((c) => ({ ...c, theme: { ...c.theme, ...patch } }));

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-[36rem] flex-col">
      {/* ── top bar ── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <ArrowLeft className="size-4" />
          Back
        </Link>
        <span className="h-5 w-px bg-[var(--border)]" aria-hidden />
        {kind === "template" ? (
          <Input
            aria-label="Template name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSave({ state: "dirty" });
            }}
            className="h-8 w-56 text-[14px] font-semibold"
          />
        ) : (
          <h1 className="truncate text-[14px] font-semibold text-[var(--text)]">{name}</h1>
        )}

        <div className="ml-auto flex items-center gap-2">
          <SaveState save={save} onRetry={() => void flush()} />
          <Button size="icon" variant="ghost" aria-label="Undo" title="Undo (⌘Z)" onClick={undo} disabled={!depth.undo}>
            <Undo2 />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Redo" title="Redo (⇧⌘Z)" onClick={redo} disabled={!depth.redo}>
            <Redo2 />
          </Button>
          <div className="flex items-center rounded-lg border border-[var(--border)] p-0.5" role="group" aria-label="Preview size">
            {(
              [
                ["desktop", Monitor, "Desktop"],
                ["mobile", Smartphone, "Phone"],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={device === value}
                title={label}
                onClick={() => setDevice(value)}
                className={cn(
                  "grid size-7 place-items-center rounded-md text-[var(--text-muted)] transition-colors",
                  device === value ? "bg-[var(--surface-3)] text-[var(--text)]" : "hover:text-[var(--text)]",
                )}
              >
                <Icon className="size-4" />
                <span className="sr-only">{label}</span>
              </button>
            ))}
          </div>
          <ButtonLink
            href={backHref}
            variant="primary"
            size="sm"
            onClick={() => {
              if (save.state === "dirty") void flush();
            }}
          >
            Done
          </ButtonLink>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ── left panel ── */}
        <aside className="flex w-[22rem] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
          <div className="flex gap-1 border-b border-[var(--border-soft)] px-3 pt-2">
            {(["content", "design"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={cn(
                  "-mb-px border-b-2 px-2.5 py-2 text-[13px] font-medium capitalize transition-colors",
                  tab === t
                    ? "border-[var(--accent-mark)] text-[var(--text)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-slim">
            {tab === "design" ? (
              <DesignPanel theme={content.theme} onChange={setTheme} onPreset={(t) => update((c) => ({ ...c, theme: t }))} />
            ) : selectedBlock ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="inline-flex items-center gap-1 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
                  >
                    <ChevronLeft className="size-4" />
                    All blocks
                  </button>
                  <div className="flex items-center gap-0.5">
                    <IconAction label="Move up" onClick={() => move(selectedIndex, selectedIndex - 1)} disabled={selectedIndex === 0}>
                      <ArrowUp />
                    </IconAction>
                    <IconAction
                      label="Move down"
                      onClick={() => move(selectedIndex, selectedIndex + 1)}
                      disabled={selectedIndex === content.blocks.length - 1}
                    >
                      <ArrowDown />
                    </IconAction>
                    <IconAction label="Duplicate" onClick={() => duplicate(selectedIndex)}>
                      <Copy />
                    </IconAction>
                    <IconAction label="Delete" onClick={() => remove(selectedIndex)} danger>
                      <Trash2 />
                    </IconAction>
                  </div>
                </div>
                <h2 className="text-[15px] font-semibold text-[var(--text)]">{BLOCK_LABELS[selectedBlock.type]}</h2>
                <BlockFields
                  block={selectedBlock}
                  onChange={(next) => setBlocks((blocks) => blocks.map((b) => (b.id === next.id ? next : b)))}
                  assets={assets}
                  onAsset={(a) => setAssets((list) => [a, ...list])}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <section className="flex flex-col gap-3">
                  <Field label="Subject line">
                    <MergeInput value={content.subject} onChange={(subject) => update((c) => ({ ...c, subject }))} />
                  </Field>
                  <Field label="Preview text" hint="Shown after the subject in most inboxes.">
                    <MergeInput value={content.preheader} onChange={(preheader) => update((c) => ({ ...c, preheader }))} />
                  </Field>
                </section>

                <section>
                  <h2 className="mb-2 text-[12px] font-semibold tracking-[0.02em] text-[var(--text-muted)]">Blocks</h2>
                  {content.blocks.length ? (
                    <ol className="flex flex-col gap-1">
                      {content.blocks.map((b, i) => {
                        const Icon = BLOCK_ICONS[b.type];
                        return (
                          <li
                            key={b.id}
                            draggable
                            onDragStart={() => setDragging(i)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                              if (dragging !== null && dragging !== i) move(dragging, i);
                              setDragging(null);
                            }}
                            onDragEnd={() => setDragging(null)}
                            className={cn(
                              "group flex items-center gap-2 rounded-lg border border-transparent px-1.5 py-1.5 transition-colors",
                              dragging === i ? "opacity-40" : "hover:border-[var(--border)] hover:bg-[var(--surface-2)]",
                            )}
                          >
                            <GripVertical className="size-3.5 shrink-0 cursor-grab text-[var(--text-faint)]" aria-hidden />
                            <button
                              type="button"
                              onClick={() => setSelected(b.id)}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <Icon className="size-4 shrink-0 text-[var(--color-coastal-500)]" />
                              <span className="min-w-0">
                                <span className="block text-[13px] font-medium text-[var(--text)]">{BLOCK_LABELS[b.type]}</span>
                                <span className="block truncate text-[12px] text-[var(--text-faint)]">{summarise(b)}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-[13px] text-[var(--text-muted)]">
                      Add a block below to start.
                    </p>
                  )}
                </section>

                <section>
                  <h2 className="mb-2 text-[12px] font-semibold tracking-[0.02em] text-[var(--text-muted)]">Add a block</h2>
                  <div className="grid grid-cols-3 gap-1.5">
                    {PALETTE.map((type) => {
                      const Icon = BLOCK_ICONS[type];
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => addBlock(type)}
                          className="flex flex-col items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-1 py-2.5 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--color-coastal-300)] hover:text-[var(--text)]"
                        >
                          <Icon className="size-4" />
                          {BLOCK_LABELS[type]}
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}
          </div>

          {/* ── checks ── */}
          <div className="max-h-48 shrink-0 overflow-y-auto border-t border-[var(--border-soft)] px-4 py-3 scrollbar-slim">
            {checks.length ? (
              <ul className="flex flex-col gap-1.5">
                {checks.map((c, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => c.blockId && setSelected(c.blockId)}
                      className={cn(
                        "flex items-start gap-2 text-left text-[12px] leading-5",
                        c.level === "error" ? "text-[var(--danger)]" : "text-[var(--warn)]",
                        c.blockId ? "hover:underline" : "cursor-default",
                      )}
                    >
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {c.message}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-[12px] text-[var(--ok)]">
                <Check className="size-3.5" />
                Ready to send — nothing to fix.
              </p>
            )}
            {errors ? <span className="sr-only">{errors} problems to fix</span> : null}
          </div>
        </aside>

        {/* ── preview ── */}
        <div className="min-w-0 flex-1 overflow-y-auto bg-[var(--surface-3)] scrollbar-slim">
          <div className="mx-auto flex flex-col items-center gap-4 px-4 py-6">
            <InboxRow
              from={fromLabel}
              subject={fillMergeTags(content.subject, SAMPLE_MERGE) || "(no subject)"}
              preheader={fillMergeTags(content.preheader, SAMPLE_MERGE)}
              width={device === "mobile" ? 375 : 640}
            />
            <div
              className={cn(
                "overflow-hidden rounded-[10px] shadow-[var(--shadow-md)]",
                device === "mobile" && "rounded-[28px] border-[6px] border-[var(--color-coastal-900)]",
              )}
            >
              <PreviewFrame html={html} width={device === "mobile" ? 375 : 680} selectedId={selected} onSelect={setSelected} />
            </div>
            <p className="text-[12px] text-[var(--text-faint)]">
              Merge tags show sample values here. Click any block to edit it.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SaveState({
  save,
  onRetry,
}: {
  save: { state: "saved" | "dirty" | "saving" | "error"; message?: string };
  onRetry: () => void;
}) {
  if (save.state === "error") {
    return (
      <button type="button" onClick={onRetry} className="text-[12px] font-medium text-[var(--danger)] hover:underline" title={save.message}>
        Not saved — retry
      </button>
    );
  }
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-faint)]">
      {save.state === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : save.state === "saved" ? <Check className="size-3.5 text-[var(--ok)]" /> : null}
      {save.state === "saving" ? "Saving…" : save.state === "saved" ? "Saved" : "Unsaved changes"}
    </span>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid size-7 place-items-center rounded-md text-[var(--text-muted)] transition-colors disabled:opacity-35 [&_svg]:size-3.5",
        danger ? "hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]" : "hover:bg-[var(--surface-3)] hover:text-[var(--text)]",
      )}
    >
      {children}
    </button>
  );
}

/** How the message will sit in an inbox list: sender, subject, preview text. */
function InboxRow({ from, subject, preheader, width }: { from: string; subject: string; preheader: string; width: number }) {
  return (
    <div
      className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-sm)]"
      style={{ maxWidth: width }}
    >
      <p className="text-[11px] font-semibold tracking-[0.06em] text-[var(--text-faint)] uppercase">Inbox preview</p>
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <p className="truncate text-[13px] font-semibold text-[var(--text)]">{from}</p>
        <p className="shrink-0 text-[11px] text-[var(--text-faint)]">9:41 am</p>
      </div>
      <p className="truncate text-[13px] text-[var(--text)]">{subject}</p>
      <p className="truncate text-[13px] text-[var(--text-muted)]">{preheader || "The first words of the email show here when there's no preview text."}</p>
    </div>
  );
}

/* ── design ──────────────────────────────────────────────────────── */

const COLOURS: { key: keyof Theme; label: string }[] = [
  { key: "accent", label: "Buttons" },
  { key: "heading", label: "Headings" },
  { key: "text", label: "Body text" },
  { key: "link", label: "Links" },
  { key: "surface", label: "Email" },
  { key: "backdrop", label: "Background" },
  { key: "headerBackground", label: "Header" },
];

function DesignPanel({
  theme,
  onChange,
  onPreset,
}: {
  theme: Theme;
  onChange: (patch: Partial<Theme>) => void;
  onPreset: (theme: Theme) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-[12px] font-semibold tracking-[0.02em] text-[var(--text-muted)]">Look</h2>
        <div className="grid grid-cols-2 gap-2">
          <PresetCard
            active={theme.layout === "card"}
            title="Ankor'd"
            hint="Logo, card, brand colours"
            onClick={() => onPreset({ ...DEFAULT_THEME, logoUrl: theme.logoUrl })}
          />
          <PresetCard
            active={theme.layout === "letter"}
            title="Letter"
            hint="Reads like a personal email"
            onClick={() => onPreset({ ...LETTER_THEME, logoUrl: theme.logoUrl })}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-semibold tracking-[0.02em] text-[var(--text-muted)]">Header</h2>
        <Field label="Logo">
          <Select value={theme.header} onChange={(e) => onChange({ header: e.target.value as Theme["header"] })}>
            <option value="logo">Show the logo</option>
            <option value="none">No header</option>
          </Select>
        </Field>
        {theme.header === "logo" ? (
          <>
            <Field label="Logo image" hint="Blank uses the Ankor'd logo set in Campaigns → Settings.">
              <Input value={theme.logoUrl} placeholder="https://" onChange={(e) => onChange({ logoUrl: e.target.value })} />
            </Field>
            <Field label={`Logo width · ${theme.logoWidth}px`}>
              <input
                type="range"
                min={80}
                max={320}
                step={10}
                value={theme.logoWidth}
                onChange={(e) => onChange({ logoWidth: Number(e.target.value) })}
                className="h-9.5 accent-[var(--accent)]"
              />
            </Field>
          </>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-semibold tracking-[0.02em] text-[var(--text-muted)]">Type</h2>
        <Field label="Typeface" hint="Figtree where the reader has it; Helvetica or Arial otherwise.">
          <Select value={theme.font} onChange={(e) => onChange({ font: e.target.value as Theme["font"] })}>
            <option value="sans">Sans (Figtree)</option>
            <option value="serif">Serif (Georgia)</option>
          </Select>
        </Field>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[12px] font-semibold tracking-[0.02em] text-[var(--text-muted)]">Colours</h2>
          <button
            type="button"
            className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] hover:underline"
            onClick={() =>
              onChange(
                Object.fromEntries(COLOURS.map(({ key }) => [key, (theme.layout === "letter" ? LETTER_THEME : DEFAULT_THEME)[key]])),
              )
            }
          >
            Reset to brand
          </button>
        </div>
        <ul className="flex flex-col gap-1.5">
          {COLOURS.map(({ key, label }) => (
            <li key={key} className="flex items-center justify-between gap-3">
              <label htmlFor={`colour-${key}`} className="text-[13px] text-[var(--text)]">
                {label}
              </label>
              <span className="flex items-center gap-2">
                <code className="text-[11px] text-[var(--text-faint)] uppercase">{String(theme[key])}</code>
                <input
                  id={`colour-${key}`}
                  type="color"
                  value={String(theme[key])}
                  onChange={(e) => onChange({ [key]: e.target.value } as Partial<Theme>)}
                  className="h-7 w-9 cursor-pointer rounded-md border border-[var(--border)] bg-transparent p-0.5"
                />
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Brand swatches">
          {Object.entries({ "Deep Coastal": BRAND.deepCoastal, Sunrise: BRAND.sunrise600, "Coastal Teal": BRAND.coastalTeal, Charcoal: BRAND.charcoal }).map(
            ([label, hex]) => (
              <span key={label} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--text-muted)]">
                <span className="size-3 rounded-full border border-[var(--border)]" style={{ background: hex }} />
                {label}
              </span>
            ),
          )}
        </div>
      </section>
    </div>
  );
}

function PresetCard({ active, title, hint, onClick }: { active: boolean; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-lg border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-[var(--color-sunrise-300)] bg-[var(--color-sunrise-50)] dark:bg-[var(--color-sunrise-900)]/30"
          : "border-[var(--border)] hover:border-[var(--color-coastal-300)]",
      )}
    >
      <span className="block text-[13px] font-semibold text-[var(--text)]">{title}</span>
      <span className="block text-[11px] leading-4 text-[var(--text-muted)]">{hint}</span>
    </button>
  );
}
