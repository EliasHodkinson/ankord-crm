import {
  BRAND,
  fillMergeTags,
  type Align,
  type Block,
  type ColumnContent,
  type MergeValues,
  type Theme,
} from "./model";

/**
 * Blocks → email HTML. Pure and dependency-free, so the editor's live preview
 * and the send engine produce byte-for-byte the same message.
 *
 * Email HTML is its own dialect: tables for layout, inline styles, no CSS
 * variables, a 600px column, and conditional comments so Outlook on Windows
 * (which renders with Word) keeps the width. Everything a person types is
 * escaped; the only markup they can produce is the small set in TextBlock.
 */

export type RenderOptions = {
  subject: string;
  preheader: string;
  merge: MergeValues;
  /** Lines of the sender-identification footer (Spam Act). */
  footer: string;
  social: Record<string, string>;
  /** Where the unsubscribe link goes. A preview passes "#". */
  unsubscribeUrl: string;
  webVersionUrl?: string | null;
  /** A 1×1 image whose fetch records an open. */
  openPixelUrl?: string | null;
  /** Turns a destination into a tracked click URL. Absent: links go straight there. */
  trackLink?: (href: string) => string;
  /** Used when the theme has no logo of its own. */
  defaultLogoUrl: string;
  /** Marks each block's row with data-block, for the editor's click-to-select. Never sent. */
  annotate?: boolean;
};

const SAFE_URL = /^(https?:|mailto:|tel:)/i;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A URL fit for an href, or null. `javascript:` and friends never get through. */
export function safeUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (SAFE_URL.test(v)) return v;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v)) return `https://${v}`;
  return null;
}

const fontStack = (theme: Theme) =>
  theme.font === "serif"
    ? "Georgia, 'Times New Roman', Times, serif"
    : "Figtree, 'Helvetica Neue', Helvetica, Arial, sans-serif";

type Ctx = { theme: Theme; opts: RenderOptions; font: string };

function href(ctx: Ctx, raw: string): string | null {
  const url = safeUrl(fillMergeTags(raw, ctx.opts.merge));
  if (!url) return null;
  if (ctx.opts.trackLink && /^https?:/i.test(url)) return ctx.opts.trackLink(url);
  return url;
}

/**
 * The small markup of a text block: paragraphs, bullets, **bold**, *italic*
 * and [links](https://…). Merge tags are filled first, then everything is
 * escaped, then the markup is applied — so a value can never inject HTML.
 */
export function renderMarkup(ctx: Ctx, raw: string, style: string): string {
  const text = fillMergeTags(raw, ctx.opts.merge).replace(/\r\n/g, "\n");
  const inline = (line: string) =>
    escapeHtml(line)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, target: string) => {
        // The target was escaped along with the line; undo that for the URL check.
        const url = href(ctx, target.replace(/&amp;/g, "&"));
        return url
          ? `<a href="${escapeHtml(url)}" style="color:${ctx.theme.link};text-decoration:underline">${label}</a>`
          : label;
      })
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");

  return text
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split("\n");
      if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
        const items = lines
          .map((l) => `<li style="margin:0 0 6px">${inline(l.replace(/^\s*[-•]\s+/, ""))}</li>`)
          .join("");
        return `<ul style="margin:0 0 16px;padding-left:22px;${style}">${items}</ul>`;
      }
      return `<p style="margin:0 0 16px;${style}">${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
}

const alignAttr = (a: Align) => `align="${a}"`;

function button(ctx: Ctx, label: string, target: string, styleName: "accent" | "brand" | "outline", align: Align) {
  const url = href(ctx, target);
  if (!url || !label.trim()) return "";
  const { theme, font } = ctx;
  const bg = styleName === "accent" ? theme.accent : styleName === "brand" ? theme.brand : "transparent";
  const fg = styleName === "outline" ? theme.brand : BRAND.white;
  const border = styleName === "outline" ? `border:2px solid ${theme.brand};` : "";
  const text = escapeHtml(fillMergeTags(label, ctx.opts.merge));
  // The outer cell aligns; a table carrying align= itself would float, and
  // whatever follows would wrap beside it.
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td ${alignAttr(align)}><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : "0"}"><tr><td style="border-radius:8px;background:${bg};${border}"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 24px;font-family:${font};font-size:15px;font-weight:600;line-height:20px;color:${fg};text-decoration:none;border-radius:8px">${text}</a></td></tr></table></td></tr></table>`;
}

function image(ctx: Ctx, src: string, alt: string, link: string, widthPct: number, align: Align, maxPx: number) {
  const url = safeUrl(src);
  if (!url) return "";
  const px = Math.round((maxPx * Math.min(Math.max(widthPct, 10), 100)) / 100);
  const img = `<img src="${escapeHtml(url)}" alt="${escapeHtml(fillMergeTags(alt, ctx.opts.merge))}" width="${px}" style="display:block;width:100%;max-width:${px}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:6px${align === "center" ? ";margin:0 auto" : align === "right" ? ";margin-left:auto" : ""}">`;
  const target = link ? href(ctx, link) : null;
  return target ? `<a href="${escapeHtml(target)}" style="text-decoration:none">${img}</a>` : img;
}

function column(ctx: Ctx, c: ColumnContent) {
  const { theme, font } = ctx;
  return [
    c.image ? `<div style="margin:0 0 12px">${image(ctx, c.image, c.imageAlt, c.buttonHref, 100, "left", 260)}</div>` : "",
    c.heading
      ? `<h3 style="margin:0 0 8px;font-family:${font};font-size:17px;line-height:24px;font-weight:600;color:${theme.heading}">${escapeHtml(fillMergeTags(c.heading, ctx.opts.merge))}</h3>`
      : "",
    c.text ? renderMarkup(ctx, c.text, `font-family:${font};font-size:15px;line-height:23px;color:${theme.text}`) : "",
    c.buttonLabel ? button(ctx, c.buttonLabel, c.buttonHref, "outline", "left") : "",
  ].join("");
}

const SOCIAL_LABELS: Record<string, string> = {
  website: "Website",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
};

function socialLinks(ctx: Ctx, align: Align, size = 14) {
  const links = Object.entries(ctx.opts.social)
    .map(([network, url]) => {
      const target = href(ctx, url);
      return target
        ? `<a href="${escapeHtml(target)}" style="color:${ctx.theme.link};text-decoration:none;font-weight:600">${SOCIAL_LABELS[network] ?? escapeHtml(network)}</a>`
        : null;
    })
    .filter(Boolean);
  if (!links.length) return "";
  return `<p style="margin:0;font-family:${ctx.font};font-size:${size}px;line-height:22px;text-align:${align}">${links.join(" &nbsp;·&nbsp; ")}</p>`;
}

/** Strips the obviously dangerous from custom HTML. It is a staff-only escape hatch, not a sanitiser. */
export function scrubHtml(html: string): string {
  return html
    .replace(/<(script|iframe|object|embed|form|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|iframe|object|embed|form|base|meta|link|frame|frameset|applet)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action|formaction|xlink:href|background)\s*=\s*(["']?)\s*(javascript|vbscript|data):[^"'\s>]*\2/gi, '$1="#"');
}

function renderBlock(ctx: Ctx, block: Block): string {
  const { theme, font } = ctx;
  const pad = (inner: string, bottom = 8) =>
    `<tr><td class="px" style="padding:0 40px ${bottom}px">${inner}</td></tr>`;
  const merge = (v: string) => escapeHtml(fillMergeTags(v, ctx.opts.merge));

  switch (block.type) {
    case "heading": {
      const size = block.level === 1 ? 28 : block.level === 2 ? 22 : 18;
      const line = block.level === 1 ? 34 : block.level === 2 ? 28 : 24;
      return pad(
        `<h${block.level} style="margin:0 0 12px;font-family:${font};font-size:${size}px;line-height:${line}px;font-weight:700;letter-spacing:-0.02em;color:${theme.heading};text-align:${block.align}">${merge(block.text)}</h${block.level}>`,
      );
    }
    case "text":
      return pad(
        renderMarkup(ctx, block.text, `font-family:${font};font-size:16px;line-height:26px;color:${theme.text};text-align:${block.align}`),
      );
    case "image": {
      const img = image(ctx, block.src, block.alt, block.href, block.width, block.align, 520);
      return img ? pad(`<div style="text-align:${block.align}">${img}</div>`, 20) : "";
    }
    case "button": {
      const b = button(ctx, block.label, block.href, block.style, block.align);
      return b ? pad(b, 24) : "";
    }
    case "divider":
      return pad(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${theme.layout === "letter" ? BRAND.hairline : BRAND.hairline};font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table>`,
        20,
      ).replace("padding:0 40px 20px", "padding:12px 40px 20px");
    case "spacer":
      return `<tr><td style="font-size:0;line-height:0;height:${Math.min(Math.max(block.height, 4), 120)}px">&nbsp;</td></tr>`;
    case "columns":
      return pad(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="col" width="50%" valign="top" style="padding-right:12px">${column(ctx, block.left)}</td><td class="col" width="50%" valign="top" style="padding-left:12px">${column(ctx, block.right)}</td></tr></table>`,
        16,
      );
    case "quote":
      return pad(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:3px solid ${theme.accent};padding:4px 0 4px 18px"><p style="margin:0 0 8px;font-family:Georgia, 'Times New Roman', serif;font-size:19px;line-height:28px;font-style:italic;color:${theme.heading}">“${merge(block.text)}”</p>${block.cite ? `<p style="margin:0;font-family:${font};font-size:13px;line-height:20px;color:${theme.text};opacity:0.75">— ${merge(block.cite)}</p>` : ""}</td></tr></table>`,
        20,
      );
    case "callout":
      return pad(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${theme.backdrop};border:1px solid ${BRAND.hairline};border-radius:10px;padding:20px 22px 4px">${block.heading ? `<p style="margin:0 0 6px;font-family:${font};font-size:17px;line-height:24px;font-weight:700;color:${theme.heading}">${merge(block.heading)}</p>` : ""}${renderMarkup(ctx, block.text, `font-family:${font};font-size:15px;line-height:23px;color:${theme.text}`)}</td></tr></table>`,
        20,
      );
    case "social": {
      const s = socialLinks(ctx, block.align, 14);
      return s ? pad(s, 16) : "";
    }
    case "html":
      return pad(scrubHtml(block.html));
  }
}

export function renderEmail(blocks: Block[], theme: Theme, opts: RenderOptions): string {
  const font = fontStack(theme);
  const ctx: Ctx = { theme, opts, font };
  const letter = theme.layout === "letter";
  const subject = escapeHtml(fillMergeTags(opts.subject, opts.merge));
  const preheader = escapeHtml(fillMergeTags(opts.preheader, opts.merge));

  const logo = safeUrl(theme.logoUrl) ?? opts.defaultLogoUrl;
  const header =
    theme.header === "logo" && logo
      ? `<tr><td class="px" style="padding:28px 40px 20px;background:${theme.headerBackground}${letter ? "" : ";border-radius:12px 12px 0 0"}"><img src="${escapeHtml(logo)}" alt="Ankor'd" width="${theme.logoWidth}" style="display:block;width:${theme.logoWidth}px;max-width:100%;height:auto;border:0"></td></tr>`
      : `<tr><td style="font-size:0;line-height:0;height:${letter ? 8 : 32}px">&nbsp;</td></tr>`;

  const body = blocks
    .map((b) => {
      const html = renderBlock(ctx, b);
      if (!opts.annotate) return html;
      // An empty block (an image with no source yet) still needs somewhere to click.
      const row = html || `<tr><td class="px" style="padding:0 40px 8px"><div style="padding:18px;border:1px dashed ${BRAND.seaMist};border-radius:8px;font-family:${font};font-size:13px;color:${BRAND.muted};text-align:center">Empty ${b.type} — choose it to fill it in</div></td></tr>`;
      return row.replace(/^<tr/, `<tr data-block="${escapeHtml(b.id)}"`);
    })
    .join("");

  const footerLines = opts.footer
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => escapeHtml(l))
    .join("<br>");
  const muted = BRAND.muted;
  const footerLinks = [
    opts.webVersionUrl
      ? `<a href="${escapeHtml(opts.webVersionUrl)}" style="color:${muted};text-decoration:underline">View in your browser</a>`
      : null,
    `<a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:${muted};text-decoration:underline">Unsubscribe</a>`,
  ]
    .filter(Boolean)
    .join(" &nbsp;·&nbsp; ");
  const footer = `<tr><td class="px" style="padding:${letter ? "24px 40px 8px" : "28px 40px 32px"};${letter ? `border-top:1px solid ${BRAND.hairline};` : ""}font-family:${font};font-size:12px;line-height:19px;color:${muted};text-align:${letter ? "left" : "center"}">${footerLines ? `<p style="margin:0 0 10px">${footerLines}</p>` : ""}<p style="margin:0">${footerLinks}</p></td></tr>`;

  const pixel = opts.openPixelUrl
    ? `<img src="${escapeHtml(opts.openPixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0">`
    : "";

  // Padding after the preheader stops clients pulling body text into the preview.
  const preheaderPad = "&#847;&zwnj;&nbsp;".repeat(60);

  const card = letter ? "" : `background:${theme.surface};border-radius:12px;border:1px solid ${BRAND.hairline};`;

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${subject}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>table,td,p,h1,h2,h3,a{font-family:Arial,sans-serif!important}</style><![endif]-->
<style>
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}
img{-ms-interpolation-mode:bicubic}
a{color:${theme.link}}
@media (max-width:620px){
.px{padding-left:22px!important;padding-right:22px!important}
.col{display:block!important;width:100%!important;padding:0 0 16px!important}
h1{font-size:24px!important;line-height:30px!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${theme.backdrop}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${theme.backdrop};opacity:0">${preheader}${preheaderPad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${theme.backdrop}">
<tr><td align="center" style="padding:${letter ? "12px 8px" : "28px 12px"}">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;${card}">
${header}
${body}
<tr><td style="font-size:0;line-height:0;height:12px">&nbsp;</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
${footer}
</table>
<!--[if mso]></td></tr></table><![endif]-->
${pixel}
</td></tr>
</table>
</body>
</html>`;
}
