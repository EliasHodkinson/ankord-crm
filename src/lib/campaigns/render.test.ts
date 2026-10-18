import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockLinks,
  cleanBlocks,
  cleanTheme,
  DEFAULT_THEME,
  fillMergeTags,
  newBlock,
  percent,
  unknownMergeTags,
  type Block,
} from "./model";
import { renderEmail, renderMarkup, safeUrl, scrubHtml, type RenderOptions } from "./render";
import { checkContent } from "./checks";
import { STARTERS } from "./starters";

const opts = (over: Partial<RenderOptions> = {}): RenderOptions => ({
  subject: "Hello {{first_name}}",
  preheader: "Preview",
  merge: { first_name: "Wendy", company: "Riverbend <Kitchens>" },
  footer: "Ankor'd Pty Ltd\nRegional NSW",
  social: {},
  unsubscribeUrl: "https://crm.example/m/u/tok",
  defaultLogoUrl: "https://crm.example/logo.png",
  ...over,
});

test("merge tags fill, fall back, and leave unknown tags alone", () => {
  assert.equal(fillMergeTags("Hi {{first_name}}", { first_name: "Wendy" }), "Hi Wendy");
  assert.equal(fillMergeTags("Hi {{ first_name | there }}", { first_name: "" }), "Hi there");
  assert.equal(fillMergeTags("Hi {{first_name}}", {}), "Hi ");
  assert.equal(fillMergeTags("{{firstname}}", { first_name: "W" }), "{{firstname}}");
  assert.deepEqual(unknownMergeTags("{{first_name}} {{firstname}} {{nope|x}}"), ["firstname", "nope"]);
});

test("a merge value can never inject HTML", () => {
  const ctx = { theme: DEFAULT_THEME, opts: opts(), font: "Arial" };
  const html = renderMarkup(ctx, "From {{company}}", "");
  assert.match(html, /Riverbend &lt;Kitchens&gt;/);
  assert.doesNotMatch(html, /<Kitchens>/);
});

test("text markup: paragraphs, bullets, bold, italic and safe links only", () => {
  const ctx = { theme: DEFAULT_THEME, opts: opts(), font: "Arial" };
  const html = renderMarkup(ctx, "**Bold** and *it*\n\n- one\n- two\n\n[ok](https://a.example) [bad](javascript:alert(1))", "");
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<em>it<\/em>/);
  assert.match(html, /<ul[^>]*><li[^>]*>one<\/li><li[^>]*>two<\/li><\/ul>/);
  assert.match(html, /href="https:\/\/a\.example"/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /bad/, "an unsafe link keeps its words, loses the link");
});

test("safeUrl accepts web, mail and phone links and refuses the rest", () => {
  assert.equal(safeUrl("https://ankord.com.au"), "https://ankord.com.au");
  assert.equal(safeUrl("ankord.com.au/work"), "https://ankord.com.au/work");
  assert.equal(safeUrl("mailto:hi@ankord.com.au"), "mailto:hi@ankord.com.au");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,x"), null);
  assert.equal(safeUrl(""), null);
});

test("custom HTML loses scripts, handlers and javascript: links", () => {
  const out = scrubHtml(`<p onclick="x()">Hi</p><script>bad()</script><a href="javascript:evil()">x</a><iframe src="y"></iframe>`);
  assert.doesNotMatch(out, /script|onclick|javascript:|iframe/i);
  assert.match(out, /<p>Hi<\/p>/);
  const sneaky = scrubHtml(`<a href=javascript:alert(1)>x</a><svg><a xlink:href="javascript:x()">y</a></svg><base href="https://evil"><img src=x onerror=alert(1)><script src="//evil"></script>`);
  assert.doesNotMatch(sneaky, /javascript:|onerror|<base|<script/i);
});

test("the rendered email carries the footer, unsubscribe, pixel and tracked links", () => {
  const blocks: Block[] = [
    { ...newBlock("button"), label: "Go", href: "https://ankord.com.au/x" } as Block,
    { ...newBlock("text"), text: "Hi {{first_name}}" } as Block,
  ];
  const html = renderEmail(blocks, DEFAULT_THEME, opts({
    openPixelUrl: "https://crm.example/m/o/tok",
    trackLink: (href) => `https://crm.example/m/c/tok/${encodeURIComponent(href)}`,
  }));
  assert.match(html, /<title>Hello Wendy<\/title>/);
  assert.match(html, /Hi Wendy/);
  assert.match(html, /href="https:\/\/crm\.example\/m\/c\/tok\/https%3A%2F%2Fankord\.com\.au%2Fx"/);
  assert.match(html, /href="https:\/\/crm\.example\/m\/u\/tok"[^>]*>Unsubscribe/);
  assert.match(html, /src="https:\/\/crm\.example\/m\/o\/tok"/);
  assert.match(html, /Ankor&#39;d Pty Ltd<br>Regional NSW/);
});

test("annotate marks each block for the editor, and only when asked", () => {
  const blocks = [newBlock("heading"), newBlock("image")];
  const plain = renderEmail(blocks, DEFAULT_THEME, opts());
  const marked = renderEmail(blocks, DEFAULT_THEME, opts({ annotate: true }));
  assert.doesNotMatch(plain, /data-block/);
  assert.equal(marked.match(/data-block="/g)?.length, 2, "an empty image still gets a placeholder row");
});

test("cleaning keeps free text out of styles", () => {
  const theme = cleanTheme({ accent: "red;background:url(x)", text: "#123456", layout: "evil", logoWidth: 9999 });
  assert.equal(theme.accent, DEFAULT_THEME.accent);
  assert.equal(theme.text, "#123456");
  assert.equal(theme.layout, "card");
  assert.equal(theme.logoWidth, 520);

  const blocks = cleanBlocks([
    { type: "heading", text: "Hi", level: 7, align: "middle;color:red" },
    { type: "spacer", height: -40 },
    { type: "nonsense" },
    "not a block",
  ]);
  assert.equal(blocks.length, 2);
  assert.deepEqual([blocks[0].type, (blocks[0] as { level: number }).level, (blocks[0] as { align: string }).align], ["heading", 3, "left"]);
  assert.equal((blocks[1] as { height: number }).height, 4);
});

test("links are listed in reading order, for click tracking", () => {
  const blocks = cleanBlocks([
    { type: "text", text: "See [our work](https://ankord.com.au/work)" },
    { type: "button", label: "Book", href: "https://ankord.com.au/book" },
  ]);
  assert.deepEqual(blockLinks(blocks).map((l) => l.href), ["https://ankord.com.au/work", "https://ankord.com.au/book"]);
});

test("checks: errors block sending, warnings advise", () => {
  const clean = checkContent({ subject: "News", preheader: "More", blocks: [{ ...newBlock("text") }] });
  assert.equal(clean.filter((c) => c.level === "error").length, 0);

  const bad = checkContent({
    subject: "",
    preheader: "",
    blocks: [{ ...newBlock("image") }, { ...newBlock("text"), text: "{{frist_name}}" } as Block],
  });
  const messages = bad.map((c) => c.message).join(" | ");
  assert.match(messages, /subject/i);
  assert.match(messages, /no image/i);
  assert.match(messages, /frist_name/);
});

test("every starter renders and has no errors bar the images left to fill", () => {
  for (const s of STARTERS) {
    const blocks = s.blocks();
    assert.ok(renderEmail(blocks, s.theme, opts()).includes("Unsubscribe"), s.id);
    const errors = checkContent({ subject: s.subject || "x", preheader: s.preheader, blocks }).filter(
      (c) => c.level === "error" && !/image/i.test(c.message),
    );
    assert.deepEqual(errors, [], s.id);
  }
});

test("percent reads well at both ends", () => {
  assert.equal(percent(0, 0), "—");
  assert.equal(percent(1, 3), "33%");
  assert.equal(percent(1, 40), "2.5%");
});
