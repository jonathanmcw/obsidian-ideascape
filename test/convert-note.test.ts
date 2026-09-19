import { test } from "node:test";
import assert from "node:assert/strict";
import { fromMarkdownMap, toMarkdownMap } from "../src/organiser/model/markdown.ts";
import { conversionChange } from "../src/host-logic.ts";

// Layout measures text on a canvas; a fixed-width stand-in is enough here.
(globalThis as { document?: unknown }).document = { win: { createEl: () => ({ getContext: () => ({ font: "", measureText: (t: string) => ({ width: t.length * 7 }) }) }) } };

/**
 * "Open as a map" on a note somebody already wrote. The promise is narrow and worth stating:
 * the note keeps every line it had, a line outside the list is never changed without the person
 * being asked first, and once converted the file is a fixed point — the second save changes nothing.
 * These tests hold the converter to that over a corpus of deliberately awkward notes.
 */

/** What the view does on every open and save. */
const cycle = (src: string, name = "Note") => toMarkdownMap(fromMarkdownMap(src, name));
const saves = (src: string, name = "Note") => {
  const one = cycle(src, name);
  return { one, two: cycle(one, name), three: cycle(cycle(one, name), name) };
};

const FM_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)??---(?:\r?\n|$)/;
/** A note without its frontmatter and without the map's own trailing layout block. */
const noteBody = (src: string) => {
  const t = src.replace(/\r\n/g, "\n").replace(FM_RE, "");
  return t.replace(/\n%%(?:ideamap|ideascape)\n\{"v":1[\s\S]*?\n%%\n?$/, "\n");
};
/** A line reduced to the content it carries: indentation, list marker, block id and escapes set aside.
 *  A block id is a `^word` of its own at the end of the line, as the reader takes one — never the tail of `b^2`. */
const content = (l: string) =>
  l.replace(/\\\^/g, "^").trim().replace(/(^|\s)\^[A-Za-z0-9-]+$/, "$1").replace(/^([-*+]|\d+[.)])\s+/, "").replace(/^\\/, "").trim();
const bag = (src: string) => {
  const m = new Map<string, number>();
  for (const l of noteBody(src).split("\n")) { const c = content(l); if (c) m.set(c, (m.get(c) ?? 0) + 1); }
  return m;
};
/** Content the first has that the second has less of. */
const dropped = (from: string, to: string) => {
  const b = bag(to);
  return [...bag(from)].filter(([k, n]) => (b.get(k) ?? 0) < n).map(([k]) => k);
};
/** The note's own lines — everything that is not a list item — with the ids the map added taken off. */
const noteLines = (src: string) =>
  noteBody(src).split("\n").filter((l) => l.trim() && !/^\s*([-*+]|\d+[.)])\s/.test(l)).map((l) => l.replace(/ \^[a-z0-9]{6}$/, ""));

/** The three things a conversion must never do, checked on one note. */
function holds(src: string, name = "Note"): void {
  const { one, two } = saves(src, name);
  assert.equal(two, one, `the second save changed the file:\n--- first ---\n${one}\n--- second ---\n${two}`);
  assert.deepEqual(dropped(src, one), [], `content went missing from:\n${src}`);
  // A line outside the list that is not what it was is a change the person must have been asked about.
  if (JSON.stringify(noteLines(src)) !== JSON.stringify(noteLines(one)))
    assert.ok(conversionChange(src, one), `the note's own lines changed with nothing to warn about:\n${src}\n--- became ---\n${one}`);
}

/* ------------------------------------------------------------ the awkward notes, one by one */

const AWKWARD: [string, string][] = [
  ["deeply nested list", "# Deep\n\n" + Array.from({ length: 8 }, (_, i) => "  ".repeat(i) + `- level ${i + 1}`).join("\n") + "\n"],
  ["mixed ordered and unordered", "# Mix\n\n- one\n1. two\n2. three\n- four\n  1) a\n  2) b\n"],
  ["a list inside a callout", "# Callout\n\n> [!note] Heads up\n> - a point\n> - another\n\n- real item\n"],
  ["a list inside a blockquote", "# Quote\n\n> - quoted a\n> - quoted b\n\n- real item\n"],
  ["a list inside fenced code", "# Fenced\n\n```md\n- not an item\n- also not\n```\n\n- real item\n"],
  ["a list inside an indented code block", "# Indented\n\n    - not an item\n    code\n\n- real item\n"],
  ["block ids that collide", "# Collide\n\n- first ^dup\n- second ^dup\n- third ^dup\n"],
  ["frontmatter that is not the map's", "---\ntitle: My note\ntags: [a, b]\n---\n\n# Front\n\n- a\n- b\n"],
  ["frontmatter that is empty", "---\n---\n\n# Empty\n\n- a\n"],
  ["an ideascape key already there", "---\nideascape: 1\nauthor: jw\n---\n# Already\n\n- a ^aaa111\n"],
  ["tasks in every form Obsidian takes", "# Tasks\n\n- [ ] todo\n- [x] done\n- [/] partial\n- [-] cancelled\n- [>] forwarded\n- [?] question\n"],
  ["footnotes", "# Footnotes\n\nSome prose with a note[^1].\n\n- an item[^2]\n\n[^1]: The first footnote.\n[^2]: The second.\n"],
  ["Dataview inline fields", "# Dataview\n\nstatus:: active\n\n- task:: write it [due:: 2026-01-01]\n- plain\n"],
  ["a table between two items", "# Table\n\n- before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- after\n"],
  ["a table glued to the items", "# Table\n\n- a\n| x | y |\n|---|---|\n- b\n"],
  ["a very long line", "# Long\n\n- " + "x".repeat(5000) + "\n"],
  ["Windows line endings", "# CRLF\r\n\r\n- a\r\n  - b\r\n\r\nParagraph.\r\n"],
  ["Windows line endings under an indented list", "# CRLF\r\n\r\n  - a\r\n  - b\r\n\r\n  note\r\n"],
  ["non-breaking spaces", "# NBSP\n\n-\u00a0after the marker\n- and\u00a0inside the text\n"],
  ["emoji and CJK", "# Wide\n\n- party \u{1f389}\n- \u65e5\u672c\u8a9e\u306e\u30c6\u30ad\u30b9\u30c8\n- \ud55c\uad6d\uc5b4 \ud14c\uc2a4\ud2b8\n- family \u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}\n"],
  ["a note that is only a heading", "# Just a heading\n"],
  ["a note with no list at all", "# Prose\n\nA paragraph.\n\nAnother paragraph.\n"],
  ["a note with neither heading nor list", "Just some text.\n\nMore text.\n"],
  ["an empty note", ""],
  ["a note that is only frontmatter", "---\ntitle: x\n---\n"],
  ["tabs for indentation", "# Tabs\n\n- a\n\t- b\n\t\t- c\n"],
  ["a setext heading", "My title\n========\n\n- a\n- b\n"],
  ["an HTML block", "# HTML\n\n<div class=\"x\">\n  <p>hi</p>\n</div>\n\n- a\n"],
  ["a callout inside a callout", "# C\n\n> [!info]\n> > [!warning]\n> > - deep\n> - shallow\n\n- real\n"],
  ["code fenced inside an item", "# F\n\n- item\n  ```js\n  const a = 1\n  ```\n- next\n"],
  ["a four-backtick fence holding three", "# F4\n\n````\n```\n- inner\n```\n````\n\n- real\n"],
  ["an Obsidian comment between items", "# C\n\n- a\n\n%%\na hidden note\n%%\n\n- b\n"],
  ["a maths block between items", "# M\n\n- a\n\n$$\nx = \\frac{1}{2}\n$$\n\n- b\n"],
  ["horizontal rules", "# H\n\n- a\n\n---\n\n- b\n\n***\n\n- c\n"],
  ["a horizontal rule right under the frontmatter", "---\ntitle: x\n---\n---\n# T\n\n- a\n"],
  ["lazy continuation", "# Lazy\n\n- first line\ncontinued lazily\n- second\n"],
  ["wikilinks and embeds", "# W\n\n- see [[Other note]]\n- ![[image.png]]\n- [[Note#^blockid]]\n"],
  ["carets that are not block ids", "# Caret\n\n- a^2 + b^2\n- exponent ^2\n- trailing ^word\n"],
  ["escapes the note already carries", "# E\n\n- \\- literal dash\n- \\# literal hash\n"],
  ["Windows paths", "# P\n\n- C:\\Users\\jw\\file.txt\n"],
  ["a jump in indentation", "# J\n\n- a\n        - suddenly deep\n- b\n"],
  ["a whole list that is indented", "# T\n\n  - a\n  - b\n\n  trailing note\n"],
  ["a numbered list that does not start at one", "# N\n\n7. seven\n8. eight\n9. nine\n"],
  ["every bullet marker", "# A\n\n* star\n+ plus\n- dash\n"],
  ["a byte-order mark", "\ufeff# B\n\n- a\n"],
  ["no trailing newline", "# N\n\n- a"],
  ["frontmatter with no closing fence", "---\ntitle: x\n\n# H\n\n- a\n"],
  // What the map used to rewrite in a note it had only been asked to open.
  ["a block id and a list inside an item's code", "---\nideascape: root\n---\n# R\n\n- snippet ^s\n  ~~~md\n  value ^literal\n  - code-list\n  ~~~\n"],
  ["the same in backticks, in a note that is not yet a map", "# R\n\n- snippet\n  ````md\n  value ^literal\n  - [ ] task\n  ```\n  ````\n- next\n"],
  ["a block id under a fence nothing closes", "# R\n\n- snippet ^s\n  ~~~md\n  value ^literal\n  more\n- next\n"],
  ["a block id and a list inside the note's own code", "# R\n\n- a\n\n~~~\nvalue ^literal\n- not an item\n~~~\n\n- b\n"],
  ["a tab inside an item's code", "---\nideascape: root\n---\n# R\n\n- build ^a\n  ~~~make\n  all:\n  \techo hi\n  ~~~\n"],
  ["blank lines that end a block of text in the frontmatter", "---\nideascape: r\npoem: |+\n  line\n\n\n---\n# R\n\n- a ^a\n"],
  ["a marker that is a mapping", "---\nideascape:\n  custom: value\ntags: [keep]\n---\n# R\n\n- a ^a\n"],
];

for (const [name, src] of AWKWARD) test(`open as a map: ${name} keeps the note, and the second save changes nothing`, () => holds(src));

test("open as a map: a 5,000-line outline converts, stays put on the second save, and is quick", () => {
  const lines: string[] = ["# Big note", ""];
  for (let i = 0; i < 1000; i++) {
    lines.push(`- item ${i}`, `  - child ${i}a`, `    - grandchild ${i}b`);
    if (i % 10 === 0) lines.push("", `A paragraph after item ${i}.`, "");
    else lines.push(`  more text for ${i}`);
  }
  const src = lines.join("\n") + "\n";
  assert.ok(src.split("\n").length > 4000);
  const started = performance.now();
  holds(src);
  assert.ok(performance.now() - started < 4000, "a long note converts without a stall");
});

/* ------------------------------------------------------- the same three rules, over a corpus */

const LEAD = ["", " ", "  ", "   ", "    ", "     ", "\t", "\t\t", "  \t"];
const MARK = ["-", "*", "+", "1.", "2)", "7.", "- [ ]", "- [x]", "- [/]"];
const WORD = ["alpha", "beta ^abc123", "gamma \\", "delta #tag", "a  b", "x ^word", "[[link]]", "![[img.png]]", "key:: v", "$x$", "`code`", "**bold**", "a|b", "-", "#", ">", ""];
const BLOCKS: string[][] = [
  ["```", "- fenced", "```"], ["```js", "code()", "```"], ["~~~", "t", "~~~"],
  ["````", "```", "in", "```", "````"], ["```", "never closed"],
  ["%%", "hidden", "%%"], ["%% inline %%"], ["<!--", "html", "-->"], ["<!-- inline -->"],
  ["$$", "x^2", "$$"], ["| a | b |", "|---|---|", "| 1 | 2 |"],
  ["---"], ["***"], ["___"], ["> quoted"], ["> - quoted item"],
  ["> [!note] Call", "> - in", "> more"], [">> nested quote"], ["<div>", "<p>x</p>", "</div>"],
  ["Setext", "======"], ["Setext2", "------"], ["[^1]: fn"], ["# H1"], ["## H2"], ["###### H6"],
  ["    indented code", "    more code"], ["\ttab code"], ["Plain prose line."], [""], ["   "], ["Prose ^para"],
  // Code under an item and code of the note's own, each holding what would read as an id, an item or a tab's worth of spaces.
  ["  ~~~md", "  value ^literal", "  - code-list", "  ~~~"], ["  ```make", "  all:", "  \techo hi", "  ```"], ["~~~", "value ^literal", "- code-list", "~~~"],
];
const FRONT = ["", "---\ntitle: t\n---\n", "---\ntags:\n  - a\n  - b\n---\n", "---\nideascape: 1\n---\n", "---\nideascape: r00t01\n---\n", "---\nidea-map: 1\n---\n", "---\n---\n",
  "---\nideascape: r\npoem: |+\n  line\n\n\n---\n", "---\nideascape:\n  custom: value\ntags: [keep]\n---\n"];

/** A small deterministic generator, so a failure here is a failure anyone can reproduce. */
function noteFor(seed: number): string {
  let s = (seed * 7919 + 13) >>> 0;
  const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const lines: string[] = [];
  const count = 2 + Math.floor(r() * 14);
  for (let i = 0; i < count; i++) {
    if (r() < 0.55) lines.push(`${pick(LEAD)}${pick(MARK)} ${pick(WORD)}`.replace(/\s+$/, ""));
    else lines.push(...pick(BLOCKS));
  }
  const src = pick(FRONT) + lines.join("\n") + "\n";
  return r() < 0.06 ? src.replace(/\n/g, "\r\n") : src;
}

test("open as a map: over a corpus of awkward notes, nothing is lost and the second save changes nothing", () => {
  for (let seed = 1; seed <= 4000; seed++) {
    const src = noteFor(seed);
    try { holds(src); }
    catch (e) { assert.fail(`seed ${seed}: ${e instanceof Error ? e.message : String(e)}\n--- the note ---\n${JSON.stringify(src)}`); }
  }
});

test("open as a map: a converted note is a fixed point — a third save changes nothing either", () => {
  for (let seed = 1; seed <= 1500; seed++) {
    const { two, three } = saves(noteFor(seed));
    assert.equal(three, two, `seed ${seed} still moved on the third save`);
  }
});

/* ---------------------------------------------------------------- what used to go wrong */

/** A note as it stands once it is a map: the file the view wrote, which the next save must leave alone. */
const BYTE_FOR_BYTE: [string, string][] = [
  ["a block id and a list inside an item's code", "- snippet ^s\n  ~~~md\n  value ^literal\n  - code-list\n  ~~~\n"],
  ["a tab inside an item's code", "- build ^a\n  ~~~make\n  all:\n  \techo hi\n  ~~~\n"],
  ["a block id and a list inside the note's own code", "- a ^a\n\n~~~\nvalue ^literal\n- not an item\n~~~\n"],
];
for (const [name, body] of BYTE_FOR_BYTE) test(`a saved map: ${name} comes back byte for byte`, () => {
  const src = `---\nideascape: root\npoem: |+\n  line\n\n\n---\n# R\n\n${body}`;
  const out = cycle(src, "R");
  assert.equal(out.slice(0, out.lastIndexOf("\n%%ideascape\n")), src);
  assert.equal(conversionChange(src, out), null);
});

test("a marker rewritten along with the lines under it is a change the person is asked about", () => {
  const src = "---\nideascape:\n  custom: value\n  other: 2\ntags: [keep]\n---\n# R\n\n- a ^a\n";
  const out = cycle(src, "R");
  assert.match(out, /^---\nideascape: \w+\ntags: \[keep\]\n---\n/);
  assert.deepEqual(conversionChange(src, out), { lines: 2, first: "custom: value" });
  // Blank lines kept at the end of the frontmatter are no change at all.
  const poem = "---\npoem: |+\n  line\n\n\n---\n# R\n\n- a ^a\n";
  assert.equal(conversionChange(poem, cycle(poem, "R")), null);
});

test("a list the note indents more widely than the map does still reads back as it was written", () => {
  // The note's own text sat between the list's indentation and the map's, so the first save left it
  // outside the list and the second swallowed it into the last node.
  const src = "# T\n\n  - a\n  - b\n\n  trailing note\n";
  const { one, two } = saves(src);
  assert.match(one, /\n- a \^\w+\n- b \^\w+\n\n  trailing note\n/);
  assert.equal(two, one);
  // Glued to the item, with no blank line, the same text is the node's own — and stays the node's.
  const glued = "    - grandchild\n  continuation\n";
  const g = saves(glued);
  assert.equal(fromMarkdownMap(g.one, "Note").nodes[fromMarkdownMap(g.one, "Note").rootId]!.children.length, 1);
  assert.equal(g.two, g.one);
});

test("a blank line ends a node's text: an indented paragraph after one is the note's, not the node's", () => {
  const src = "# T\n\n- item\n\n  A paragraph the note indented under the item.\n\n- next\n";
  const d = fromMarkdownMap(src, "Note");
  assert.deepEqual(d.nodes[d.rootId]!.children.map((c) => d.nodes[c]!.text), ["item", "next"]);
  const out = toMarkdownMap(d);
  assert.match(out, /\n- item \^\w+\n\n  A paragraph the note indented under the item\.\n\n- next \^\w+\n/);
  assert.equal(cycle(out), out);
});

test("a block id on the line under the heading stays a block id, so [[note#^id]] still lands", () => {
  // The root wears its own id in the frontmatter, so a line it swallowed used to lose its caret to an escape.
  const src = "# Heading\nParagraph ^para\n\n- a\n";
  const out = cycle(src);
  assert.match(out, /\n# Heading\nParagraph \^para\n/);
  assert.doesNotMatch(out, /\\\^para/);
  assert.equal(cycle(out), out);
  assert.equal(conversionChange(src, out), null, "nothing outside the list changed, so nothing to ask about");
  // The root's own second line still keeps a caret it never had as an id.
  const d = fromMarkdownMap("# Heading\nsubtitle\n\n- a\n", "Note");
  d.nodes[d.rootId]!.text = "Heading\ntyped ^word";
  assert.match(toMarkdownMap(d), /\n# Heading\ntyped \\\^word\n/);
});

test("frontmatter that is empty is frontmatter, so the note is never given a second block", () => {
  const out = cycle("---\n---\n\n# T\n\n- a\n");
  assert.match(out, /^---\nideascape: \w+\n---\n# T\n/);
  assert.equal((out.match(/^---$/gm) ?? []).length, 2, "one pair of fences, not two");
  assert.equal(cycle(out), out);
  // The line after an empty block is the note's own text, as Obsidian reads it — a rule, not frontmatter.
  const ruled = cycle("---\n---\n---\n\n- a\n");
  assert.match(ruled, /^---\nideascape: \w+\n---\n---\n/);
  assert.equal(cycle(ruled), ruled);
});
