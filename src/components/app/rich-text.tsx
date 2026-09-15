import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Runbook copy arrives as plain text with blank-line paragraphs and numbered
 * or bulleted runs. This renders that faithfully without pulling in Markdown.
 */
export function RichText({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
}) {
  if (!text?.trim()) return null;

  const blocks: React.ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p${blocks.length}`} className="text-[13px] leading-6 text-pretty">
        {paragraph.join(" ")}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const { ordered, items } = list;
    blocks.push(
      ordered ? (
        <ol
          key={`l${blocks.length}`}
          className="flex list-decimal flex-col gap-1 pl-5 text-[13px] leading-6 marker:text-[var(--text-faint)]"
        >
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul
          key={`l${blocks.length}`}
          className="flex list-disc flex-col gap-1 pl-5 text-[13px] leading-6 marker:text-[var(--color-coastal-300)]"
        >
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ),
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const ordered = /^\d+[.)]\s+/.exec(line);
    const bulleted = /^[•\-*]\s+/.exec(line);

    if (ordered || bulleted) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) flushList();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push(line.replace(/^(\d+[.)]|[•\-*])\s+/, ""));
      continue;
    }

    // A short line ending in a colon reads as a sub-heading in these runbooks.
    if (line.endsWith(":") && line.length < 60 && paragraph.length === 0 && !list) {
      flushList();
      blocks.push(
        <p
          key={`h${blocks.length}`}
          className="text-[12px] font-semibold tracking-[0.02em] text-[var(--text)]"
        >
          {line.replace(/:$/, "")}
        </p>,
      );
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return (
    <div className={cn("flex flex-col gap-3 text-[var(--text-muted)]", className)}>
      {blocks}
    </div>
  );
}
