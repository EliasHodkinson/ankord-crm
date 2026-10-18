import { blockLinks, blockText, unknownMergeTags, type Block } from "./model";
import { safeUrl } from "./render";

/**
 * What to fix before an email goes out. Pure, so the editor shows the same
 * list as the send page. `error` blocks sending; `warning` is advice.
 */

export type ContentCheck = { level: "error" | "warning"; message: string; blockId?: string };

const SPAMMY = /\b(free|guarantee[d]?|act now|urgent|winner|risk[- ]free|100% |cash|\$\$\$)\b|!!+/i;

export function checkContent(input: { subject: string; preheader: string; blocks: Block[] }): ContentCheck[] {
  const out: ContentCheck[] = [];
  const { subject, preheader, blocks } = input;

  if (!subject.trim()) out.push({ level: "error", message: "Write a subject line." });
  else {
    if (subject.length > 70) out.push({ level: "warning", message: "The subject is long; phones show about 40 characters." });
    if (SPAMMY.test(subject) || /[A-Z]{6,}/.test(subject)) {
      out.push({ level: "warning", message: "Words like “free” or ALL CAPS in a subject make spam filters suspicious." });
    }
  }
  if (!preheader.trim()) {
    out.push({ level: "warning", message: "Add preview text — otherwise inboxes show the first words of the email." });
  }

  const unknown = [
    ...unknownMergeTags(subject),
    ...unknownMergeTags(preheader),
    ...unknownMergeTags(blockText(blocks)),
  ];
  if (unknown.length) {
    out.push({
      level: "error",
      message: `Unknown merge tag${unknown.length > 1 ? "s" : ""}: ${[...new Set(unknown)].map((t) => `{{${t}}}`).join(", ")}.`,
    });
  }

  if (!blocks.length) out.push({ level: "error", message: "The email is empty." });

  let images = 0;
  let words = 0;
  for (const b of blocks) {
    if (b.type === "image") {
      images++;
      if (!b.src.trim()) out.push({ level: "error", message: "An image block has no image.", blockId: b.id });
      else if (!safeUrl(b.src)) out.push({ level: "error", message: "An image address isn't a web address.", blockId: b.id });
      if (!b.alt.trim()) out.push({ level: "warning", message: "An image has no alt text.", blockId: b.id });
    }
    if (b.type === "button") {
      if (!b.label.trim() || !b.href.trim()) out.push({ level: "error", message: "A button needs both text and a link.", blockId: b.id });
    }
    if (b.type === "columns") {
      for (const c of [b.left, b.right]) {
        if (c.image) images++;
        if (c.image && !c.imageAlt.trim()) out.push({ level: "warning", message: "A column image has no alt text.", blockId: b.id });
      }
    }
    if (b.type === "text" || b.type === "callout") words += b.text.split(/\s+/).filter(Boolean).length;
    if (b.type === "heading") words += b.text.split(/\s+/).length;
  }
  for (const link of blockLinks(blocks)) {
    if (/\{\{/.test(link.href)) continue;
    if (!safeUrl(link.href)) out.push({ level: "error", message: `“${link.label}” links to something that isn't a web address.` });
  }
  if (images >= 3 && words < images * 25) {
    out.push({ level: "warning", message: "Mostly pictures and few words — spam filters prefer more text." });
  }
  return out;
}
