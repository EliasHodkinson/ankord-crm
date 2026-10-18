import {
  DEFAULT_THEME,
  LETTER_THEME,
  newBlock,
  type Block,
  type BlockType,
  type Theme,
} from "./model";

/**
 * The built-in starting points, written in Ankor'd's voice. They live in code
 * rather than the database so every deployment has them and they improve with
 * the app; a team's own templates are rows in email_templates.
 */

export type Starter = {
  id: string;
  name: string;
  description: string;
  subject: string;
  preheader: string;
  theme: Theme;
  blocks: () => Block[];
};

/** A block of a type with some fields set, with a fresh id each time. */
function b<T extends BlockType>(type: T, fields: Partial<Extract<Block, { type: T }>> = {}): Block {
  return { ...newBlock(type), ...fields } as Block;
}

export const STARTERS: Starter[] = [
  {
    id: "blank",
    name: "Blank",
    description: "The Ankor'd header and footer, nothing in between.",
    subject: "",
    preheader: "",
    theme: DEFAULT_THEME,
    blocks: () => [b("text", { text: "Hi {{first_name|there}},\n\n" })],
  },
  {
    id: "personal-note",
    name: "Personal note",
    description:
      "Looks like an email you wrote yourself — no banner, no buttons. Best for a short message from your own mailbox, and the kindest to inbox filters.",
    subject: "A quick one, {{first_name|there}}",
    preheader: "",
    theme: LETTER_THEME,
    blocks: () => [
      b("text", {
        text:
          "Hi {{first_name|there}},\n\n" +
          "I wanted to let you know about something we've been working on at Ankor'd that I think could be useful for {{company|your team}}.\n\n" +
          "Two or three sentences on what it is and why it matters to them.\n\n" +
          "If it's worth a chat, just reply to this email — it comes straight to me.\n\n" +
          "Cheers,\n{{sender_name}}\n{{sender_title}}, Ankor'd",
      }),
    ],
  },
  {
    id: "newsletter",
    name: "Newsletter",
    description: "A lead story, two shorter pieces side by side, and a way to get in touch.",
    subject: "What's new at Ankor'd",
    preheader: "The latest from the team, in two minutes.",
    theme: DEFAULT_THEME,
    blocks: () => [
      b("heading", { text: "The latest from Ankor'd", level: 1 }),
      b("text", {
        text:
          "Hi {{first_name|there}},\n\n" +
          "A short welcome — what this issue covers and why it's worth their two minutes.",
      }),
      b("image", { src: "", alt: "Lead story image", width: 100 }),
      b("heading", { text: "The lead story", level: 2 }),
      b("text", {
        text: "Tell the story in a paragraph or two. Keep it about them: what changed, what it means, what to do next.",
      }),
      b("button", { label: "Read the full story", href: "https://ankord.com.au" }),
      b("divider"),
      b("columns", {
        left: {
          image: "",
          imageAlt: "",
          heading: "Second story",
          text: "A sentence or two that earns the click.",
          buttonLabel: "Read more",
          buttonHref: "https://ankord.com.au",
        },
        right: {
          image: "",
          imageAlt: "",
          heading: "Third story",
          text: "A sentence or two that earns the click.",
          buttonLabel: "Read more",
          buttonHref: "https://ankord.com.au",
        },
      }),
      b("divider"),
      b("text", {
        text: "Questions, ideas, a project brewing? Reply to this email and it'll reach a real person.",
        align: "center",
      }),
      b("social", { align: "center" }),
    ],
  },
  {
    id: "announcement",
    name: "Announcement",
    description: "One piece of news, told well, with one thing to do about it.",
    subject: "Something new from Ankor'd",
    preheader: "",
    theme: DEFAULT_THEME,
    blocks: () => [
      b("heading", { text: "Introducing something new", level: 1 }),
      b("text", {
        text:
          "Hi {{first_name|there}},\n\n" +
          "What's new, in one sentence. Then why it matters to {{company|you}}:\n\n" +
          "- The first benefit, in their words\n- The second benefit\n- The third benefit",
      }),
      b("button", { label: "See how it works", href: "https://ankord.com.au", style: "accent" }),
      b("callout", {
        heading: "Already working with us?",
        text: "Your account manager will be in touch — or reply to this email and we'll set a time.",
      }),
    ],
  },
  {
    id: "event",
    name: "Event invitation",
    description: "When, where and how to say yes — the details up front, the reasons below.",
    subject: "You're invited, {{first_name|there}}",
    preheader: "Save the date — details inside.",
    theme: DEFAULT_THEME,
    blocks: () => [
      b("heading", { text: "You're invited", level: 1 }),
      b("callout", {
        heading: "Thursday 20 November · 5:30pm",
        text: "Venue name, street, town\nDrinks and nibbles provided",
      }),
      b("text", {
        text:
          "Hi {{first_name|there}},\n\n" +
          "A paragraph on what the evening is, who'll be there and what they'll get out of it.",
      }),
      b("button", { label: "Save my spot", href: "https://ankord.com.au", style: "accent", align: "center" }),
      b("text", { text: "Can't make it? Reply and let us know — we'll send the highlights.", align: "center" }),
    ],
  },
  {
    id: "case-study",
    name: "Case study",
    description: "A client's result, in their words, with the numbers to back it.",
    subject: "How a regional business did it",
    preheader: "",
    theme: DEFAULT_THEME,
    blocks: () => [
      b("heading", { text: "How a local business turned it around", level: 1 }),
      b("image", { src: "", alt: "The client", width: 100 }),
      b("text", {
        text: "Where they started, what got in the way, and what we did together. Two short paragraphs.",
      }),
      b("quote", { text: "One line from the client that says it better than we could.", cite: "Name, Business" }),
      b("columns", {
        left: {
          image: "",
          imageAlt: "",
          heading: "3× more enquiries",
          text: "What changed, measured.",
          buttonLabel: "",
          buttonHref: "",
        },
        right: {
          image: "",
          imageAlt: "",
          heading: "10 hours a week back",
          text: "What changed, measured.",
          buttonLabel: "",
          buttonHref: "",
        },
      }),
      b("button", { label: "Talk to us about yours", href: "https://ankord.com.au", style: "brand" }),
    ],
  },
];

export const starterById = (id: string) => STARTERS.find((s) => s.id === id) ?? null;
