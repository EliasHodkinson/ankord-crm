"use client";

import * as React from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  ImageUp,
  Italic,
  Link2,
  List,
  Loader2,
} from "lucide-react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { uploadEmailImage } from "@/lib/actions/campaigns";
import {
  MERGE_TAGS,
  type Align,
  type Block,
  type ColumnContent,
} from "@/lib/campaigns/model";
import { cn } from "@/lib/utils";

export type Asset = { id: string; url: string; name: string };

/**
 * One editor per block type. Everything is a plain controlled input; the
 * block's markup (bold, links, bullets) is written as text so it survives
 * being pasted from anywhere, and the renderer makes it safe.
 */
export function BlockFields({
  block,
  onChange,
  assets,
  onAsset,
}: {
  block: Block;
  onChange: (next: Block) => void;
  assets: Asset[];
  onAsset: (asset: Asset) => void;
}) {
  // Each case narrows `block`; `set` keeps the narrowed type.
  const set = <B extends Block>(b: B, patch: Partial<B>) => onChange({ ...b, ...patch });

  switch (block.type) {
    case "heading":
      return (
        <div className="flex flex-col gap-4">
          <Field label="Heading">
            <MergeInput value={block.text} onChange={(text) => set(block, { text })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Size">
              <Select
                value={String(block.level)}
                onChange={(e) => set(block, { level: Number(e.target.value) as 1 | 2 | 3 })}
              >
                <option value="1">Large</option>
                <option value="2">Medium</option>
                <option value="3">Small</option>
              </Select>
            </Field>
            <AlignField value={block.align} onChange={(align) => set(block, { align })} />
          </div>
        </div>
      );
    case "text":
      return (
        <div className="flex flex-col gap-4">
          <MarkupField label="Text" value={block.text} onChange={(text) => set(block, { text })} rows={12} />
          <AlignField value={block.align} onChange={(align) => set(block, { align })} />
        </div>
      );
    case "image":
      return (
        <div className="flex flex-col gap-4">
          <ImageField
            src={block.src}
            onChange={(src) => set(block, { src })}
            assets={assets}
            onAsset={onAsset}
          />
          <Field label="Alt text" hint="What the image shows, for people whose email hides images — and screen readers.">
            <Input value={block.alt} onChange={(e) => set(block, { alt: e.target.value })} />
          </Field>
          <Field label="Link (optional)">
            <Input value={block.href} placeholder="https://" onChange={(e) => set(block, { href: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Width · ${block.width}%`}>
              <input
                type="range"
                min={20}
                max={100}
                step={5}
                value={block.width}
                onChange={(e) => set(block, { width: Number(e.target.value) })}
                className="h-9.5 accent-[var(--accent)]"
              />
            </Field>
            <AlignField value={block.align} onChange={(align) => set(block, { align })} />
          </div>
        </div>
      );
    case "button":
      return (
        <div className="flex flex-col gap-4">
          <Field label="Button text">
            <MergeInput value={block.label} onChange={(label) => set(block, { label })} />
          </Field>
          <Field label="Link">
            <Input value={block.href} placeholder="https://" onChange={(e) => set(block, { href: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Style">
              <Select
                value={block.style}
                onChange={(e) => set(block, { style: e.target.value as "accent" | "brand" | "outline" })}
              >
                <option value="accent">Sunrise</option>
                <option value="brand">Deep Coastal</option>
                <option value="outline">Outline</option>
              </Select>
            </Field>
            <AlignField value={block.align} onChange={(align) => set(block, { align })} />
          </div>
        </div>
      );
    case "spacer":
      return (
        <Field label={`Height · ${block.height}px`}>
          <input
            type="range"
            min={8}
            max={96}
            step={4}
            value={block.height}
            onChange={(e) => set(block, { height: Number(e.target.value) })}
            className="h-9.5 accent-[var(--accent)]"
          />
        </Field>
      );
    case "divider":
      return <p className="text-[13px] text-[var(--text-muted)]">A hairline across the email. Nothing to set.</p>;
    case "columns":
      return (
        <div className="flex flex-col gap-5">
          {(["left", "right"] as const).map((side) => (
            <fieldset key={side} className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-3">
              <legend className="px-1 text-[12px] font-semibold text-[var(--text-muted)]">
                {side === "left" ? "Left column" : "Right column"}
              </legend>
              <ColumnFields
                value={block[side]}
                onChange={(c) => set(block, { [side]: c } as Partial<typeof block>)}
                assets={assets}
                onAsset={onAsset}
              />
            </fieldset>
          ))}
          <p className="text-[12px] text-[var(--text-faint)]">On a phone, the right column sits under the left.</p>
        </div>
      );
    case "quote":
      return (
        <div className="flex flex-col gap-4">
          <Field label="Quote">
            <Textarea value={block.text} rows={4} onChange={(e) => set(block, { text: e.target.value })} />
          </Field>
          <Field label="Who said it">
            <Input value={block.cite} onChange={(e) => set(block, { cite: e.target.value })} />
          </Field>
        </div>
      );
    case "callout":
      return (
        <div className="flex flex-col gap-4">
          <Field label="Heading">
            <MergeInput value={block.heading} onChange={(heading) => set(block, { heading })} />
          </Field>
          <MarkupField label="Text" value={block.text} onChange={(text) => set(block, { text })} rows={5} />
        </div>
      );
    case "social":
      return (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] leading-6 text-[var(--text-muted)]">
            Links to Ankor&rsquo;d&rsquo;s profiles, set once in Campaigns → Settings.
          </p>
          <AlignField value={block.align} onChange={(align) => set(block, { align })} />
        </div>
      );
    case "html":
      return (
        <Field
          label="HTML"
          hint="For a snippet you already have. Use tables and inline styles; scripts and forms are removed."
        >
          <Textarea
            value={block.html}
            rows={14}
            className="font-mono text-[12px]"
            spellCheck={false}
            onChange={(e) => set(block, { html: e.target.value })}
          />
        </Field>
      );
  }
}

function ColumnFields({
  value,
  onChange,
  assets,
  onAsset,
}: {
  value: ColumnContent;
  onChange: (next: ColumnContent) => void;
  assets: Asset[];
  onAsset: (asset: Asset) => void;
}) {
  const set = (patch: Partial<ColumnContent>) => onChange({ ...value, ...patch });
  return (
    <>
      <ImageField src={value.image} onChange={(image) => set({ image })} assets={assets} onAsset={onAsset} optional />
      {value.image ? (
        <Field label="Alt text">
          <Input value={value.imageAlt} onChange={(e) => set({ imageAlt: e.target.value })} />
        </Field>
      ) : null}
      <Field label="Heading">
        <MergeInput value={value.heading} onChange={(heading) => set({ heading })} />
      </Field>
      <MarkupField label="Text" value={value.text} onChange={(text) => set({ text })} rows={4} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Button text">
          <Input value={value.buttonLabel} placeholder="Optional" onChange={(e) => set({ buttonLabel: e.target.value })} />
        </Field>
        <Field label="Button link">
          <Input value={value.buttonHref} placeholder="https://" onChange={(e) => set({ buttonHref: e.target.value })} />
        </Field>
      </div>
    </>
  );
}

function AlignField({ value, onChange }: { value: Align; onChange: (a: Align) => void }) {
  const options: { value: Align; icon: typeof AlignLeft; label: string }[] = [
    { value: "left", icon: AlignLeft, label: "Left" },
    { value: "center", icon: AlignCenter, label: "Centre" },
    { value: "right", icon: AlignRight, label: "Right" },
  ];
  return (
    <Field label="Alignment">
      <div className="flex h-9.5 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-label={o.label}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "grid h-full flex-1 place-items-center rounded-md text-[var(--text-muted)] transition-colors",
              value === o.value
                ? "bg-[var(--surface-3)] text-[var(--text)]"
                : "hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
            )}
          >
            <o.icon className="size-4" />
          </button>
        ))}
      </div>
    </Field>
  );
}

/* ── text with markup ────────────────────────────────────────────── */

function insertAround(el: HTMLTextAreaElement | HTMLInputElement, before: string, after = "", placeholder = "") {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const selected = el.value.slice(start, end) || placeholder;
  const next = el.value.slice(0, start) + before + selected + after + el.value.slice(end);
  const caret = start + before.length + selected.length + after.length;
  return { next, select: [start + before.length, start + before.length + selected.length] as const, caret };
}

export function MarkupField({
  label,
  value,
  onChange,
  rows = 6,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const wrap = (before: string, after: string, placeholder: string) => {
    const el = ref.current;
    if (!el) return;
    const { next, select } = insertAround(el, before, after, placeholder);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(select[0], select[1]);
    });
  };

  const link = () => {
    const url = window.prompt("Link to", "https://");
    if (!url || url === "https://") return;
    wrap("[", `](${url.trim()})`, "link text");
  };

  const bullet = () => {
    const el = ref.current;
    if (!el) return;
    const start = el.value.lastIndexOf("\n", (el.selectionStart ?? 0) - 1) + 1;
    onChange(el.value.slice(0, start) + "- " + el.value.slice(start));
  };

  return (
    <Field
      label={label}
      hint="**bold**, *italic*, [text](https://link), and lines starting with “- ” for bullets. A blank line starts a new paragraph."
    >
      <div className="overflow-hidden rounded-lg border border-[var(--border)] focus-within:border-[var(--ring)] focus-within:outline-2 focus-within:outline-[var(--ring)]">
        <div className="flex items-center gap-0.5 border-b border-[var(--border-soft)] bg-[var(--surface-2)] px-1.5 py-1">
          <ToolButton label="Bold" onClick={() => wrap("**", "**", "bold text")}>
            <Bold />
          </ToolButton>
          <ToolButton label="Italic" onClick={() => wrap("*", "*", "italic text")}>
            <Italic />
          </ToolButton>
          <ToolButton label="Link" onClick={link}>
            <Link2 />
          </ToolButton>
          <ToolButton label="Bullet" onClick={bullet}>
            <List />
          </ToolButton>
          <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden />
          <MergeMenu onPick={(tag) => wrap(tag, "", "")} />
        </div>
        <textarea
          ref={ref}
          value={value}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full resize-y bg-[var(--surface)] px-3 py-2 text-sm leading-6 text-[var(--text)] outline-none"
        />
      </div>
    </Field>
  );
}

/** A single line that can take merge tags. */
export function MergeInput({
  value,
  onChange,
  placeholder,
  id,
  name,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
  name?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <Input
        ref={ref}
        id={id}
        name={name}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="pr-10"
      />
      <div className="absolute top-1/2 right-1 -translate-y-1/2">
        <MergeMenu
          onPick={(tag) => {
            const el = ref.current;
            if (!el) return onChange(value + tag);
            const { next, caret } = insertAround(el, tag);
            onChange(next);
            requestAnimationFrame(() => {
              el.focus();
              el.setSelectionRange(caret, caret);
            });
          }}
        />
      </div>
    </div>
  );
}

function MergeMenu({ onPick }: { onPick: (tag: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <ToolButton label="Insert a merge tag" onClick={() => setOpen((o) => !o)}>
        <Braces />
      </ToolButton>
      {open ? (
        <div className="absolute top-full right-0 z-30 mt-1 w-56 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-md)]">
          <p className="px-2 pt-1 pb-1.5 text-[11px] text-[var(--text-faint)]">
            Filled in for each person. Add a fallback after a bar: {"{{first_name|there}}"}
          </p>
          {MERGE_TAGS.map((t) => (
            <button
              key={t.tag}
              type="button"
              onClick={() => {
                onPick(t.tag === "first_name" ? "{{first_name|there}}" : `{{${t.tag}}}`);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-[var(--text)] hover:bg-[var(--surface-2)]"
            >
              {t.label}
              <code className="text-[11px] text-[var(--text-faint)]">{`{{${t.tag}}}`}</code>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)] [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

/* ── images ──────────────────────────────────────────────────────── */

function ImageField({
  src,
  onChange,
  assets,
  onAsset,
  optional,
}: {
  src: string;
  onChange: (src: string) => void;
  assets: Asset[];
  onAsset: (asset: Asset) => void;
  optional?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [library, setLibrary] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    // Measure it first, so the stored image knows its own size.
    const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    });
    const form = new FormData();
    form.set("file", file);
    if (dims) {
      form.set("width", String(dims.w));
      form.set("height", String(dims.h));
    }
    const result = await uploadEmailImage(form);
    setBusy(false);
    if (!result.ok || !result.data) return setError(result.message ?? "That image could not be uploaded.");
    onAsset({ id: result.data.id, url: result.data.url, name: file.name });
    onChange(result.data.url);
  };

  return (
    <Field label={optional ? "Image (optional)" : "Image"} error={error}>
      <div className="flex flex-col gap-2">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- an arbitrary external email image
          <img src={src} alt="" className="max-h-36 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] object-contain" />
        ) : null}
        <div className="flex gap-2">
          <Input value={src} placeholder="https://… or upload" onChange={(e) => onChange(e.target.value)} />
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
          <Button size="icon" variant="secondary" aria-label="Upload an image" title="Upload" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <ImageUp />}
          </Button>
        </div>
        {assets.length ? (
          <button
            type="button"
            className="self-start text-[12px] font-medium text-[var(--info)] hover:underline underline-offset-2"
            onClick={() => setLibrary((v) => !v)}
          >
            {library ? "Hide uploaded images" : `Choose from ${assets.length} uploaded`}
          </button>
        ) : null}
        {library ? (
          <div className="grid max-h-56 grid-cols-3 gap-1.5 overflow-y-auto rounded-lg border border-[var(--border)] p-1.5 scrollbar-slim">
            {assets.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.name}
                onClick={() => {
                  onChange(a.url);
                  setLibrary(false);
                }}
                className="aspect-square overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--color-coastal-300)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- uploaded email images */}
                <img src={a.url} alt={a.name} className="size-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Field>
  );
}
