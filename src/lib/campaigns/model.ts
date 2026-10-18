/**
 * The shape of a marketing email, shared by the editor (client), the renderer
 * and the send engine (server). Nothing here touches the database, so it is
 * safe to import from a client component — and constants live here rather
 * than in the "use server" actions file, which may only export async functions.
 *
 * An email is an ordered list of blocks plus a theme. Blocks are deliberately
 * few and email-safe: every one of them renders to tables and inline styles
 * that Outlook, Gmail and Apple Mail agree on.
 */

export type Align = "left" | "center" | "right";

export type HeadingBlock = {
  id: string;
  type: "heading";
  text: string;
  level: 1 | 2 | 3;
  align: Align;
};

/**
 * Body copy. A deliberately small markup, not HTML: blank lines are
 * paragraphs, `**bold**`, `*italic*`, `[label](https://…)` and lines starting
 * "- " are bullets. People write it like a message; the renderer makes it safe.
 */
export type TextBlock = { id: string; type: "text"; text: string; align: Align };

export type ImageBlock = {
  id: string;
  type: "image";
  src: string;
  alt: string;
  href: string;
  /** Percentage of the content width. */
  width: number;
  align: Align;
};

export type ButtonBlock = {
  id: string;
  type: "button";
  label: string;
  href: string;
  align: Align;
  /** `accent` is Sunrise, `brand` is Deep Coastal, `outline` is quiet. */
  style: "accent" | "brand" | "outline";
};

export type DividerBlock = { id: string; type: "divider" };
export type SpacerBlock = { id: string; type: "spacer"; height: number };

/** Two columns side by side on desktop, stacked on a phone. */
export type ColumnsBlock = {
  id: string;
  type: "columns";
  left: ColumnContent;
  right: ColumnContent;
};

export type ColumnContent = {
  image: string;
  imageAlt: string;
  heading: string;
  text: string;
  buttonLabel: string;
  buttonHref: string;
};

/** A pull quote or testimonial. */
export type QuoteBlock = { id: string; type: "quote"; text: string; cite: string };

/** A boxed call-out, for an offer, a date or a deadline. */
export type CalloutBlock = { id: string; type: "callout"; heading: string; text: string };

export type SocialBlock = { id: string; type: "social"; align: Align };

/** Escape hatch for someone who knows email HTML. Not sanitised beyond scripts. */
export type HtmlBlock = { id: string; type: "html"; html: string };

export type Block =
  | HeadingBlock
  | TextBlock
  | ImageBlock
  | ButtonBlock
  | DividerBlock
  | SpacerBlock
  | ColumnsBlock
  | QuoteBlock
  | CalloutBlock
  | SocialBlock
  | HtmlBlock;

export type BlockType = Block["type"];

/**
 * How the email looks around the blocks. Email clients cannot read CSS custom
 * properties, so these are literal colours — defaults come from the Ankor'd
 * palette in DESIGN.md (BRAND below), and a campaign may override them.
 */
export type Theme = {
  /** The page behind the email. */
  backdrop: string;
  /** The email body. */
  surface: string;
  text: string;
  heading: string;
  accent: string;
  brand: string;
  link: string;
  font: "sans" | "serif";
  /** Header: the logo bar at the top. */
  header: "logo" | "none";
  headerBackground: string;
  logoUrl: string;
  logoWidth: number;
  /** "letter" drops the card chrome so the email reads like a personal message. */
  layout: "card" | "letter";
};

/**
 * The Ankor'd palette, as literal values, for email only. The app itself
 * uses the tokens in globals.css; email HTML cannot.
 */
export const BRAND = {
  deepCoastal: "#08393a",
  sunrise: "#d2691e",
  sunrise600: "#b25517",
  seaMist: "#a8bdb8",
  coastalTeal: "#2e7a78",
  charcoal: "#1c2826",
  offWhite: "#f4f7f6",
  white: "#ffffff",
  /** Card edge and dividers — Sea Mist at low strength. */
  hairline: "#dfe6e4",
  /** Footer text; 5.6:1 on the off-white backdrop. */
  muted: "#5b6b69",
} as const;

export const DEFAULT_THEME: Theme = {
  backdrop: BRAND.offWhite,
  surface: BRAND.white,
  text: BRAND.charcoal,
  heading: BRAND.deepCoastal,
  accent: BRAND.sunrise600,
  brand: BRAND.deepCoastal,
  link: BRAND.coastalTeal,
  font: "sans",
  header: "logo",
  headerBackground: BRAND.white,
  logoUrl: "",
  logoWidth: 160,
  layout: "card",
};

export const LETTER_THEME: Theme = {
  ...DEFAULT_THEME,
  backdrop: BRAND.white,
  header: "none",
  layout: "letter",
};

export type EmailContent = { blocks: Block[]; theme: Theme };

/* ── merge tags ──────────────────────────────────────────────────── */

/**
 * What can be written as {{tag}} in a subject, preheader or block. A fallback
 * follows a bar — {{first_name|there}} — for when the value is blank.
 */
export const MERGE_TAGS = [
  { tag: "first_name", label: "First name", sample: "Wendy" },
  { tag: "last_name", label: "Last name", sample: "Alder" },
  { tag: "full_name", label: "Full name", sample: "Wendy Alder" },
  { tag: "company", label: "Business partner", sample: "Riverbend Kitchens" },
  { tag: "job_title", label: "Job title", sample: "Owner" },
  { tag: "email", label: "Email address", sample: "wendy@example.com.au" },
  { tag: "sender_name", label: "Sender's name", sample: "Kee Hodkinson" },
  { tag: "sender_title", label: "Sender's title", sample: "Director" },
] as const;

export type MergeTag = (typeof MERGE_TAGS)[number]["tag"];
export type MergeValues = Partial<Record<MergeTag, string | null>>;

export const SAMPLE_MERGE: MergeValues = Object.fromEntries(
  MERGE_TAGS.map((t) => [t.tag, t.sample]),
) as MergeValues;

const KNOWN = new Set<string>(MERGE_TAGS.map((t) => t.tag));
export const MERGE_PATTERN = /\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/g;

/** Tags written that the CRM does not know — "{{firstname}}" for "{{first_name}}". */
export function unknownMergeTags(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(MERGE_PATTERN)) if (!KNOWN.has(m[1])) found.add(m[1]);
  return [...found];
}

/** Fills merge tags in plain text. HTML escaping is the renderer's job. */
export function fillMergeTags(text: string, values: MergeValues): string {
  return text.replace(MERGE_PATTERN, (_all, tag: string, fallback?: string) => {
    if (!KNOWN.has(tag)) return _all;
    const value = values[tag as MergeTag]?.trim();
    return value || fallback?.trim() || "";
  });
}

/* ── blocks ──────────────────────────────────────────────────────── */

export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: "Heading",
  text: "Text",
  image: "Image",
  button: "Button",
  divider: "Divider",
  spacer: "Spacer",
  columns: "Two columns",
  quote: "Quote",
  callout: "Call-out",
  social: "Social links",
  html: "Custom HTML",
};

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);

const emptyColumn = (): ColumnContent => ({
  image: "",
  imageAlt: "",
  heading: "Heading",
  text: "A sentence or two about this.",
  buttonLabel: "",
  buttonHref: "",
});

export function newBlock(type: BlockType): Block {
  const id = newId();
  switch (type) {
    case "heading":
      return { id, type, text: "A clear headline", level: 1, align: "left" };
    case "text":
      return { id, type, text: "Hi {{first_name|there}},\n\nWrite your message here.", align: "left" };
    case "image":
      return { id, type, src: "", alt: "", href: "", width: 100, align: "center" };
    case "button":
      return { id, type, label: "Find out more", href: "https://ankord.com.au", align: "left", style: "accent" };
    case "divider":
      return { id, type };
    case "spacer":
      return { id, type, height: 24 };
    case "columns":
      return { id, type, left: emptyColumn(), right: emptyColumn() };
    case "quote":
      return { id, type, text: "What a client said about working with you.", cite: "Name, Business" };
    case "callout":
      return { id, type, heading: "Don't miss it", text: "The one thing you want them to remember." };
    case "social":
      return { id, type, align: "center" };
    case "html":
      return { id, type, html: "<p>Custom HTML</p>" };
  }
}

/** Every link a person could click, in reading order — for the checklist and click tracking. */
export function blockLinks(blocks: Block[]): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  const push = (href: string, label: string) => {
    if (href.trim()) out.push({ href: href.trim(), label: label.trim() || href.trim() });
  };
  for (const b of blocks) {
    switch (b.type) {
      case "text":
      case "callout":
        for (const m of b.text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) push(m[2], m[1]);
        break;
      case "image":
        push(b.href, b.alt || "Image");
        break;
      case "button":
        push(b.href, b.label);
        break;
      case "columns":
        for (const c of [b.left, b.right]) {
          for (const m of c.text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) push(m[2], m[1]);
          push(c.buttonHref, c.buttonLabel);
        }
        break;
      case "html":
        for (const m of b.html.matchAll(/href\s*=\s*"([^"]+)"/gi)) push(m[1], "Custom HTML link");
        break;
    }
  }
  return out;
}

/** All the words in an email, for the merge-tag check and the plain-text part. */
export function blockText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "heading":
        case "text":
          return b.text;
        case "button":
          return b.label;
        case "quote":
          return `${b.text} ${b.cite}`;
        case "callout":
          return `${b.heading} ${b.text}`;
        case "columns":
          return [b.left, b.right].map((c) => `${c.heading} ${c.text} ${c.buttonLabel}`).join(" ");
        case "image":
          return b.alt;
        case "html":
          return b.html;
        default:
          return "";
      }
    })
    .join("\n");
}

/* ── audiences ───────────────────────────────────────────────────── */

/**
 * Who a campaign goes to, as a rule rather than a list, so a scheduled
 * campaign picks up the people added since it was written. The rule is
 * resolved into recipients the moment sending starts.
 *
 * Within a list, any value matches (OR); between filters, all must (AND).
 * An empty list is "no filter".
 */
export type AudienceRule = {
  /** People at business partners. */
  contacts: boolean;
  partnerKinds: ("customer" | "supplier" | "media")[];
  partnerStatuses: string[];
  partnerTags: string[];
  partnerSegments: string[];
  partnerIndustries: string[];
  partnerStates: string[];
  ownerIds: string[];
  /** Only these business partners, when any are named. */
  customerIds: string[];
  primaryOnly: boolean;
  decisionMakersOnly: boolean;
  /** `recorded` = express or inferred consent noted against the person. */
  consent: "any" | "recorded" | "express";

  /** Leads — prospects — by stage. Leads have one email each. */
  leads: boolean;
  leadStages: string[];
  leadTags: string[];

  /** Hand-picked people added on top, and people taken out. */
  includeContactIds: string[];
  excludeContactIds: string[];

  /** Leave out anyone a campaign reached in the last N days. */
  notEmailedWithinDays: number | null;

  /** Narrow to how people responded to an earlier campaign — "resend to non-openers". */
  engagement: { campaignId: string; campaignName: string; kind: EngagementFilter } | null;
};

export type EngagementFilter = "not_opened" | "opened" | "clicked" | "not_clicked";

export const ENGAGEMENT_LABELS: Record<EngagementFilter, string> = {
  not_opened: "Didn't open",
  opened: "Opened",
  clicked: "Clicked a link",
  not_clicked: "Didn't click",
};

export const EMPTY_AUDIENCE: AudienceRule = {
  contacts: true,
  partnerKinds: ["customer"],
  partnerStatuses: ["active"],
  partnerTags: [],
  partnerSegments: [],
  partnerIndustries: [],
  partnerStates: [],
  ownerIds: [],
  customerIds: [],
  primaryOnly: false,
  decisionMakersOnly: false,
  consent: "any",
  leads: false,
  leadStages: [],
  leadTags: [],
  includeContactIds: [],
  excludeContactIds: [],
  notEmailedWithinDays: null,
  engagement: null,
};

/** Reads a stored rule, filling anything added to the shape since it was saved. */
export function normaliseAudience(value: unknown): AudienceRule {
  const v = (value && typeof value === "object" ? value : {}) as Partial<AudienceRule>;
  return { ...EMPTY_AUDIENCE, ...v };
}

export function normaliseTheme(value: unknown): Theme {
  const v = (value && typeof value === "object" ? value : {}) as Partial<Theme>;
  return { ...DEFAULT_THEME, ...v };
}

export function normaliseBlocks(value: unknown): Block[] {
  return Array.isArray(value) ? (value as Block[]).filter((b) => b && typeof b === "object" && "type" in b) : [];
}

/* ── A/B tests ───────────────────────────────────────────────────── */

/**
 * A subject-line test. `testPercent` of the audience is split evenly between
 * A and B; after `waitHours` the better one by `metric` goes to everyone else.
 * At 100% there is no remainder — the whole audience is split and the report
 * just compares.
 */
export type AbTest = {
  subjectB: string;
  preheaderB: string;
  testPercent: number;
  waitHours: number;
  metric: "opens" | "clicks";
};

export const DEFAULT_AB: AbTest = {
  subjectB: "",
  preheaderB: "",
  testPercent: 30,
  waitHours: 4,
  metric: "clicks",
};

/* ── sending ─────────────────────────────────────────────────────── */

/**
 * Exchange Online allows a mailbox 30 messages a minute and 10,000 recipients
 * a day. The engine keeps under both, with headroom for the person's own mail
 * from the same mailbox.
 */
export const SEND_LIMITS = { perMinute: 25, perDay: 9000 } as const;

export type FromMode = "me" | "marketing";

/* ── cleaning what the editor sends ──────────────────────────────── */

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const ALIGNS: Align[] = ["left", "center", "right"];
const str = (v: unknown, max = 20_000) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : fallback;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

/**
 * Coerces whatever arrived into well-formed blocks. Theme colours and
 * alignments end up inside inline styles, so nothing free-form reaches them:
 * colours must be hex, enums must be one of theirs, numbers are clamped.
 */
export function cleanBlocks(value: unknown): Block[] {
  if (!Array.isArray(value)) return [];
  const types = Object.keys(BLOCK_LABELS) as BlockType[];
  return value.slice(0, 200).flatMap((raw): Block[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    if (!types.includes(r.type as BlockType)) return [];
    const id = str(r.id, 40) || newId();
    const align = oneOf(r.align, ALIGNS, "left");
    switch (r.type as BlockType) {
      case "heading":
        return [{ id, type: "heading", text: str(r.text, 500), level: num(r.level, 1, 3, 1) as 1 | 2 | 3, align }];
      case "text":
        return [{ id, type: "text", text: str(r.text), align }];
      case "image":
        return [{ id, type: "image", src: str(r.src, 2000), alt: str(r.alt, 300), href: str(r.href, 2000), width: num(r.width, 10, 100, 100), align: oneOf(r.align, ALIGNS, "center") }];
      case "button":
        return [{ id, type: "button", label: str(r.label, 120), href: str(r.href, 2000), align, style: oneOf(r.style, ["accent", "brand", "outline"] as const, "accent") }];
      case "divider":
        return [{ id, type: "divider" }];
      case "spacer":
        return [{ id, type: "spacer", height: num(r.height, 4, 120, 24) }];
      case "columns": {
        const col = (c: unknown): ColumnContent => {
          const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
          return {
            image: str(o.image, 2000),
            imageAlt: str(o.imageAlt, 300),
            heading: str(o.heading, 300),
            text: str(o.text, 5000),
            buttonLabel: str(o.buttonLabel, 120),
            buttonHref: str(o.buttonHref, 2000),
          };
        };
        return [{ id, type: "columns", left: col(r.left), right: col(r.right) }];
      }
      case "quote":
        return [{ id, type: "quote", text: str(r.text, 2000), cite: str(r.cite, 300) }];
      case "callout":
        return [{ id, type: "callout", heading: str(r.heading, 300), text: str(r.text, 5000) }];
      case "social":
        return [{ id, type: "social", align: oneOf(r.align, ALIGNS, "center") }];
      case "html":
        return [{ id, type: "html", html: str(r.html, 50_000) }];
    }
  });
}

export function cleanTheme(value: unknown): Theme {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const colour = (key: keyof Theme) => (typeof v[key] === "string" && HEX.test(v[key] as string) ? (v[key] as string) : (DEFAULT_THEME[key] as string));
  return {
    backdrop: colour("backdrop"),
    surface: colour("surface"),
    text: colour("text"),
    heading: colour("heading"),
    accent: colour("accent"),
    brand: colour("brand"),
    link: colour("link"),
    headerBackground: colour("headerBackground"),
    font: oneOf(v.font, ["sans", "serif"] as const, "sans"),
    header: oneOf(v.header, ["logo", "none"] as const, "logo"),
    logoUrl: str(v.logoUrl, 2000),
    logoWidth: num(v.logoWidth, 60, 520, DEFAULT_THEME.logoWidth),
    layout: oneOf(v.layout, ["card", "letter"] as const, "card"),
  };
}

/** What the audience builder shows while a rule is being edited. */
export type AudiencePreview = {
  count: number;
  sample: {
    email: string;
    name: string;
    company: string | null;
    source: "contact" | "lead";
    contactId: string | null;
  }[];
  excluded: { suppressed: number; consent: number; recent: number; engagement: number };
  unrecordedConsent: number;
};

/** "42%" — or "—" when there is nothing to divide by. */
export function percent(part: number, whole: number): string {
  if (!whole) return "—";
  const p = (part / whole) * 100;
  return `${p < 10 && p > 0 ? p.toFixed(1) : Math.round(p)}%`;
}
