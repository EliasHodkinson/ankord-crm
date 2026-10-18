"use client";

import * as React from "react";
import { BRAND } from "@/lib/campaigns/model";
import { cn } from "@/lib/utils";

/**
 * The email exactly as it will be sent, in an iframe so its own styles cannot
 * leak into the app (or the app's into it). Rewritten in place on each change
 * rather than reloaded, so the scroll position holds while someone types.
 *
 * With `onSelect`, clicking a block selects it in the editor: the renderer
 * marks each block's row with data-block when asked to annotate.
 */
export function PreviewFrame({
  html,
  width,
  selectedId,
  onSelect,
  className,
  title = "Email preview",
}: {
  html: string;
  width: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  title?: string;
}) {
  const ref = React.useRef<HTMLIFrameElement>(null);
  const onSelectRef = React.useRef(onSelect);
  React.useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  React.useEffect(() => {
    const frame = ref.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return;

    const chrome = onSelectRef.current
      ? `<style>
          [data-block]{cursor:pointer}
          [data-block]:hover{outline:1px dashed ${BRAND.coastalTeal};outline-offset:-1px}
          [data-block="${CSS.escape(selectedId ?? "")}"]{outline:2px solid ${BRAND.sunrise600};outline-offset:-2px}
          a{pointer-events:none}
        </style>`
      : "";
    doc.open();
    doc.write(html.replace("</head>", `${chrome}</head>`));
    doc.close();

    const fit = () => {
      frame.style.height = `${Math.max(doc.documentElement.scrollHeight, 320)}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (doc.body) observer.observe(doc.body);
    doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", fit));

    const click = (event: MouseEvent) => {
      if (!onSelectRef.current) return;
      event.preventDefault();
      const row = (event.target as Element | null)?.closest?.("[data-block]");
      const id = row?.getAttribute("data-block");
      if (id) onSelectRef.current(id);
    };
    doc.addEventListener("click", click);
    return () => {
      observer.disconnect();
      doc.removeEventListener("click", click);
    };
  }, [html, selectedId]);

  return (
    <iframe
      ref={ref}
      title={title}
      // No script ever runs inside the email — custom HTML included. Same
      // origin so the editor can write the document and hear clicks on it.
      sandbox="allow-same-origin"
      className={cn("block border-0 bg-transparent transition-[width] duration-200 ease-out", className)}
      style={{ width, maxWidth: "100%" }}
    />
  );
}

/** A scaled-down, non-interactive render — for template cards. */
export function PreviewThumb({ html, className }: { html: string; className?: string }) {
  return (
    <div className={cn("relative h-56 overflow-hidden", className)} aria-hidden>
      <iframe
        title="Template preview"
        srcDoc={html}
        // No scripts. Same-origin only so images load: an opaque-origin frame
        // is refused images from a private address (as in development).
        sandbox="allow-same-origin"
        tabIndex={-1}
        className="pointer-events-none absolute top-0 left-1/2 h-[1100px] w-[640px] origin-top -translate-x-1/2 scale-[0.42] border-0"
      />
    </div>
  );
}
