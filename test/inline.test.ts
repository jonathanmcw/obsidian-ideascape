import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, plainText, safeHref } from "../src/organiser/model/inline.ts";
import { fromMarkdownMap, toMarkdownMap } from "../src/organiser/model/markdown.ts";

test("inline: plain text passes through untouched", () => {
  const r = parseInline("Plan a small trip");
  assert.equal(r.plain, "Plan a small trip");
  assert.deepEqual(r.runs, [{ start: 0, end: 17 }]);
});

test("inline: bold, italic, underline, strike, highlight, code and links become runs over plain text", () => {
  const r = parseInline("**Bold** and *it* _al_ <u>u</u> ~~no~~ ==hi== `x` [[Note|alias]] [web](https://a.b)");
  assert.equal(r.plain, "Bold and it al u no hi x alias web");
  const at = (i: number) => r.runs.find(x => x.start <= i && i < x.end)!;
  assert.ok(at(0).b && !at(0).i);
  assert.ok(at(9).i);
  assert.ok(at(12).i);
  assert.ok(at(15).u);
  assert.ok(at(17).s);
  assert.ok(at(20).mark);
  assert.ok(at(23).code);
  assert.equal(at(25).href, "Note"); assert.ok(at(25).wiki);
  assert.equal(at(31).href, "https://a.b"); assert.ok(!at(31).wiki);
});

test("inline: unmatched markers, snake_case and escapes stay literal", () => {
  assert.equal(plainText("2 * 3 = 6"), "2 * 3 = 6");
  assert.equal(plainText("snake_case_name"), "snake_case_name");
  assert.equal(plainText("**unclosed"), "**unclosed");
  assert.equal(plainText("a \\*literal\\* star"), "a *literal* star");
  assert.equal(plainText("咖啡店：**先做外賣**"), "咖啡店：先做外賣");
});

test("inline: formatted text survives the Markdown map file unchanged", () => {
  const d = fromMarkdownMap("# R\n\n- **Bold** idea with [[Link]]\n", "x");
  const id = d.nodes[d.rootId]!.children[0]!;
  assert.equal(d.nodes[id]!.text, "**Bold** idea with [[Link]]");
  const back = fromMarkdownMap(toMarkdownMap(d), "x");
  assert.equal(back.nodes[id]!.text, "**Bold** idea with [[Link]]");
});

test("inline: ![[embeds]] become media blocks, not text; strip/with round trip", () => {
  const src = "Coffee idea\n![[shop.png]]\n![[note.m4a|voice]]";
  const r = parseInline(src);
  assert.equal(r.plain, "Coffee idea");
  assert.deepEqual(r.embeds, [{ file: "shop.png", alias: undefined, kind: "image" }, { file: "note.m4a", alias: "voice", kind: "audio" }]);
  const { stripEmbeds, withEmbeds, embedsOf } = await_import();
  assert.equal(stripEmbeds(src), "Coffee idea");
  assert.equal(withEmbeds(stripEmbeds(src), embedsOf(src)), src);
  assert.equal(parseInline("![[doc.pdf]] read this").plain, "doc.pdf read this", "non-media embeds read as links");
});
function await_import() { return { stripEmbeds: (s: string) => stripEmbedsFn(s), withEmbeds: withEmbedsFn, embedsOf: embedsOfFn }; }
import { stripEmbeds as stripEmbedsFn, withEmbeds as withEmbedsFn, embedsOf as embedsOfFn } from "../src/organiser/model/inline.ts";

test("inline: blank lines and a trailing newline (mid-edit) survive the embed helpers", () => {
  assert.equal(stripEmbedsFn("a\n\nb\n"), "a\n\nb\n");
  assert.equal(stripEmbedsFn("a\n![[x.png]]\nb"), "a\nb");
  assert.equal(withEmbedsFn("abc\n", []), "abc\n");
  assert.equal(withEmbedsFn("abc\n", [{ file: "x.png", kind: "image" }]), "abc\n![[x.png]]");
  assert.equal(withEmbedsFn("abc", [{ file: "x.png", kind: "image" }]), "abc\n![[x.png]]");
  const r = parseInline("line one\n\nline three\n![[x.png]]");
  assert.equal(r.plain, "line one\n\nline three");
  assert.equal(parseInline("typing\n").plain, "typing\n", "a trailing newline is a real (empty) line while editing");
  assert.equal(parseInline("![[x.png]]\nafter").plain, "after");
});

test("inline: #tags are runs of their own — after whitespace, not all digits, not inside a word", () => {
  const r = parseInline("plan #trip/2026 and #2026 or C# and #x_y-z. #end");
  assert.equal(r.plain, "plan #trip/2026 and #2026 or C# and #x_y-z. #end");
  const tags = r.runs.filter((x) => x.tag).map((x) => r.plain.slice(x.start, x.end));
  assert.deepEqual(tags, ["#trip/2026", "#x_y-z", "#end"]);
  assert.ok(!r.runs.some((x) => x.tag && r.plain.slice(x.start, x.end) === "#2026"), "digits alone are not a tag");
  const t = parseInline("#one two");
  assert.deepEqual(t.runs.map((x) => [x.start, x.end, !!x.tag]), [[0, 4, true], [4, 8, false]]);
});

test("links: only web, mail and Obsidian addresses are openable", () => {
  for (const ok of ["https://obsidian.md", "HTTP://a.b/c", "mailto:me@example.com", "obsidian://open?vault=v&file=f"]) assert.equal(safeHref(ok), ok);
  for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "vbscript:x", "Note.md", "#heading", "\u0001javascript:alert(1)", " https://a.b", ""]) assert.equal(safeHref(bad), null, bad);
});

test("inline: $math$, HTML tags and code spans are read whole, as Obsidian reads them", () => {
  const r = parseInline("$a*b$ and $c*d$, <span class=\"x\">*y*</span>, ``a`b``, $5 and $6");
  assert.equal(r.plain, "$a*b$ and $c*d$, <span class=\"x\">y</span>, a`b, $5 and $6");
  assert.ok(!r.runs.some((x) => x.i && r.plain.slice(x.start, x.end).includes("and")), "no italic across the two formulas");
  assert.ok(r.runs.some((x) => x.i && r.plain.slice(x.start, x.end) === "y"));
  assert.ok(r.runs.some((x) => x.code && r.plain.slice(x.start, x.end) === "a`b"));
  assert.equal(plainText("costs \\$5 or \\!"), "costs $5 or !");
});

test("colour: hex ↔ hsl round-trips, hue order and tone are what a palette needs", async () => {
  const { hexToHsl, hslToHex, sortByHue, toneOf, withHue, isHex } = await import("../src/organiser/colour.ts");
  assert.deepEqual(hexToHsl("#ff0000"), { h: 0, s: 100, l: 50 });
  assert.equal(hslToHex({ h: 120, s: 100, l: 50 }), "#00ff00");
  // integer HSL cannot hit every hex exactly: within two steps per channel is one shade
  const chan = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (const hex of ["#c2683c", "#4a6fa5", "#75823c", "#e0808f"]) {
    const back = chan(hslToHex(hexToHsl(hex)));
    chan(hex).forEach((v, i) => assert.ok(Math.abs(v - back[i]) <= 2, `${hex} → ${hslToHex(hexToHsl(hex))}`));
  }
  // the light theme's eight around the wheel from red: terracotta, ochre, olive, green, teal, blue, plum, rose
  const light = ["#c2683c", "#4a6fa5", "#4f8a6b", "#a3773a", "#8a5a94", "#3f8a86", "#b0566a", "#75823c"];
  assert.deepEqual(sortByHue(light), [0, 3, 7, 2, 5, 1, 4, 6]);
  const tone = toneOf(light);
  assert.ok(tone.s > 25 && tone.s < 60 && tone.l > 35 && tone.l < 55, JSON.stringify(tone));
  assert.ok(isHex(withHue(300, tone)));
  assert.equal(hexToHsl(withHue(300, tone)).h, 300);
  assert.ok(!isHex("#abc") && !isHex("red"));
});

test("inline: an escaped marker never closes, so the span stays as written", () => {
  const star = parseInline("*a\\*");
  assert.equal(star.plain, "*a*");
  assert.ok(!star.runs.some((x) => x.i), "the escaped star does not close the italic");
  const under = parseInline("_a\\_");
  assert.equal(under.plain, "_a_");
  assert.ok(!under.runs.some((x) => x.i), "the escaped underscore does not close the italic");
  // As CommonMark and Obsidian read it: the escaped star is text, the last star closes one of the two opening ones.
  const bold = parseInline("**b\\**");
  assert.equal(bold.plain, "*b*");
  assert.ok(!bold.runs.some((x) => x.b), "the escaped star does not close the bold");
  const it = parseInline("*a*");
  assert.equal(it.plain, "a");
  assert.ok(it.runs.some((x) => x.i && it.plain.slice(x.start, x.end) === "a"), "*a* is still italic");
});

test("inline: __ and _ do not open or close inside a word", () => {
  const bold = parseInline("snake__case__name");
  assert.equal(bold.plain, "snake__case__name");
  assert.deepEqual(bold.runs, [{ start: 0, end: 17 }]);
  assert.equal(plainText("snake_case_name"), "snake_case_name");
  const strong = parseInline("__bold__");
  assert.equal(strong.plain, "bold");
  assert.ok(strong.runs.some((x) => x.b && strong.plain.slice(x.start, x.end) === "bold"));
  const it = parseInline("_it_");
  assert.equal(it.plain, "it");
  assert.ok(it.runs.some((x) => x.i && it.plain.slice(x.start, x.end) === "it"));
  const star = parseInline("a**b**c");
  assert.equal(star.plain, "abc");
  assert.ok(star.runs.some((x) => x.b && star.plain.slice(x.start, x.end) === "b"), "* still works inside a word");
});

test("inline: a wikilink with an empty target stays text, alias and all", () => {
  const empty = parseInline("[[|alias]]");
  assert.equal(empty.plain, "[[|alias]]");
  assert.deepEqual(empty.runs, [{ start: 0, end: 10 }]);
  assert.ok(!empty.runs.some((x) => x.href != null), "no link run without a target");
  const note = parseInline("[[Note|alias]]");
  assert.equal(note.plain, "alias");
  const link = note.runs.find((x) => x.href != null)!;
  assert.equal(link.href, "Note");
  assert.ok(link.wiki);
  assert.equal(note.plain.slice(link.start, link.end), "alias");
});

test("inline: a ** with no closer gives up one star, so **Note* reads as a star and an italic, as Obsidian shows it", () => {
  const r = parseInline("**Note*");
  assert.equal(r.plain, "*Note");
  assert.ok(r.runs.some((x) => x.i && r.plain.slice(x.start, x.end) === "Note"));
  assert.ok(!r.runs.some((x) => x.b));
  const mid = parseInline("snake__case__name");
  assert.equal(mid.plain, "snake__case__name", "an intraword __ still stays a literal pair");
});
