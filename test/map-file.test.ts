import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAP_FORMATS, MARKER, escapeRootLine, fromMarkdownMap, hasMapKey, isMarkdownMap, toMarkdownMap } from "../src/organiser/model/markdown.ts";
import { PLUGIN_ID } from "../src/brand.ts";
import { emptyDoc, addChild } from "../src/organiser/model/doc.ts";
import { walk } from "../src/organiser/model/doc.ts";
import { seedCanvasPositions } from "../src/organiser/model/store.ts";
import type { IODoc } from "../src/organiser/model/types.ts";

// Layout measures text on a canvas; a fixed-width stand-in is enough here.
(globalThis as { document?: unknown }).document = { win: { createEl: () => ({ getContext: () => ({ font: "", measureText: (t: string) => ({ width: t.length * 7 }) }) }) } };

const tree = (d: IODoc) => walk(d, d.rootId).map(({ id, depth }) => `${depth}:${id}:${d.nodes[id]!.text}:${d.nodes[id]!.collapsed ? "c" : ""}`);
const links = (d: IODoc) => d.links.map((l) => `${l.from}>${l.to}`).sort();
/** The layout block new maps are written with. */
const BLOCK = MAP_FORMATS[0].block;

/** What the view does on every open and save: read the file, write it back. */
const cycle = (src: string, name = "Trip map") => toMarkdownMap(fromMarkdownMap(src, name));

const SAVED = "---\nidea-map: r1\n---\n# Trip\n\n- Where ^a1\n  - Lisbon ^a2\n- When ^b1\n\n%%ideamap\n" +
  JSON.stringify({ v: 1, pos: { r1: [0, 0], a1: [-500, -300], a2: [-700, -300], b1: [400, 250] }, collapsed: ["a1"], links: [["a2", "b1"]], align: {}, branch: {}, look: { layout: "free" } }) + "\n%%\n";

test("layout block: a line appended after it survives two open/save cycles, and so does the layout", () => {
  const appended = SAVED + "\nCall Ana about the flat\n";
  const c1 = cycle(appended);
  const c2 = cycle(c1);
  assert.equal(c1, appended, "the first save writes the file back as it was");
  assert.equal(c2, appended);
  const d = fromMarkdownMap(c2, "Trip map");
  assert.equal(d.needsLayout, false);
  assert.equal(d.nodes["a1"]!.x, -500);
  assert.equal(d.nodes["a1"]!.collapsed, true);
  assert.deepEqual(links(d), ["a2>b1"]);
  assert.equal(d.look?.layout, "free");
  assert.equal(c2.split("%%ideamap").length, 2, "one layout block, not two");
});

test("layout block: the last block is the one read; a stray %%ideamap line with no closing line is text", () => {
  // A file an older version left with two blocks: the later one is current.
  const old = SAVED.replace('"a1":[-500,-300]', '"a1":[1,1]');
  const two = old.replace(/\n$/, "") + "\n" + SAVED.slice(SAVED.indexOf("\n%%ideamap"));
  assert.equal(fromMarkdownMap(two, "Trip map").nodes["a1"]!.x, -500);
  assert.equal(cycle(two), two);
  const stray = SAVED + "%%ideamap\n";
  const d = fromMarkdownMap(stray, "Trip map");
  assert.equal(d.nodes["a1"]!.x, -500);
  assert.equal(d.md.trailer, "%%ideamap");
  assert.equal(cycle(stray), stray);
});

test("layout block: a root line reading %%ideamap is escaped, and every child is kept", () => {
  const d = fromMarkdownMap(SAVED, "Other");
  d.nodes[d.rootId]!.text = "Trip\n%%ideamap";
  const written = toMarkdownMap(d);
  assert.match(written, /\n# Trip\n\\%%ideamap\n/);
  const back = fromMarkdownMap(written, "Other");
  assert.equal(back.nodes[back.rootId]!.text, "Trip\n%%ideamap");
  assert.deepEqual(tree(back), tree(d));
  assert.equal(toMarkdownMap(back), written);
  // A file an older version wrote with the root line unescaped still opens with its whole list.
  const unescaped = written.replace("\n\\%%ideamap\n", "\n%%ideamap\n");
  assert.deepEqual(Object.keys(fromMarkdownMap(unescaped, "Other").nodes).sort(), Object.keys(d.nodes).sort());
});

test("layout block: JSON that will not parse is written back unchanged, not replaced", () => {
  const bad = SAVED.replace('"collapsed"', ',"collapsed"');
  const d = fromMarkdownMap(bad, "Trip map");
  assert.equal(d.needsLayout, true);
  assert.ok(d.md.rawGeometry?.includes(',"collapsed"'));
  assert.equal(toMarkdownMap(d), bad, "the unreadable block, and everything else, is written back as it was");
  // A block that is valid JSON but not an object is kept the same way.
  const odd = SAVED.replace(/%%ideamap\n.*\n%%/, "%%ideamap\n[1,2]\n%%");
  assert.equal(cycle(odd), odd);
});

test("free layout: an item added outside the plugin is placed beside the others; stored positions stay", () => {
  // A free-layout map arranged by hand, then edited in the Markdown editor.
  const saved = "---\nidea-map: r\n---\n# Trip\n\n- Where ^a\n  - Lisbon ^a2\n- When ^b\n\n%%ideamap\n" +
    JSON.stringify({ v: 1, pos: { r: [0, 0], a: [-800, 400], a2: [-1200, 900], b: [650, -500] }, collapsed: [], links: [], align: {}, branch: {}, look: { layout: "free" } }) + "\n%%\n";
  const edited = saved
    .replace("- When ^b\n", "- When ^b\n  - Soon ^b1\n- Budget ^c\n")
    .replace("  - Lisbon ^a2\n", "  - Lisbon ^a2\n    - Alfama ^a3\n  - Porto ^a4\n");
  const read = fromMarkdownMap(edited, "Trip map");
  assert.equal(read.needsLayout, true);
  assert.deepEqual(read.unplaced, ["a3", "a4", "b1", "c"]);
  const d = seedCanvasPositions(read);
  const at = (id: string) => [d.nodes[id]!.x, d.nodes[id]!.y];
  assert.deepEqual(at("a"), [-800, 400]);
  assert.deepEqual(at("a2"), [-1200, 900]);
  assert.deepEqual(at("b"), [650, -500]);
  assert.deepEqual(at(d.rootId), [0, 0]);
  assert.deepEqual(at("c"), [650, -456], "after the previous sibling");
  assert.deepEqual(at("a4"), [-1200, 944]);
  assert.deepEqual(at("b1"), [830, -500], "a first child sits beside its parent, away from the root");
  assert.deepEqual(at("a3"), [-1380, 900], "on the left of the map it grows leftwards");
  assert.equal(d.unplaced, undefined, "placing is done once");
  const written = toMarkdownMap(d);
  assert.match(written, /"a":\[-800,400\],"a2":\[-1200,900\]/);
});

test("free layout: a map with no stored positions at all is laid out whole", () => {
  const d = fromMarkdownMap("# Trip\n\n- Where\n  - Lisbon\n- When\n", "Trip map");
  assert.equal(d.needsLayout, true);
  assert.equal(d.unplaced, undefined);
  const seeded = seedCanvasPositions(d);
  const xs = walk(seeded, seeded.rootId).map(({ id }) => seeded.nodes[id]!.x);
  assert.equal(new Set(xs).size, xs.length, "every node gets its own place");
});

/* ---------------------------------------------------------------- ordinary notes */

// An ordinary note opened as a map.
const PLAIN_NOTE = [
  "---", "tags: [trip]", "---",
  "# Lisbon trip", "",
  "Intro paragraph about the trip. ^intro", "",
  "Second paragraph.", "",
  "## Packing",
  "- passport", "",
  "- charger", "",
  "## Notes",
  "Remember to call Ana.",
  "- day one",
  "  ```",
  "  if (x) {",
  "      go()",
  "  }",
  "  ```",
  "- UNC path",
  "  \\\\nas\\share",
  "",
].join("\n");

/** The lines of a file that are not list items, frontmatter or the layout block, with the block ids the map added taken off. */
const noteLines = (src: string, d?: IODoc) => {
  const body = src.replace(/^---\n[\s\S]*?\n---\n/, "").split(/\n%%(?:ideamap|ideascape)\n/)[0]!;
  return body.split("\n")
    .map((l) => (d ? l.replace(/ \^([a-z0-9]{6})$/, (m, id) => (d.nodes[id] ? "" : m)) : l))
    .filter((l) => l.trim() && !/^\s*([-*+]|\d+[.)])\s/.test(l));
};

test("ordinary note: every line that is not a list item survives, in order, and the second save changes nothing", () => {
  const d = fromMarkdownMap(PLAIN_NOTE, "Lisbon trip");
  const out = toMarkdownMap(d);
  assert.deepEqual(noteLines(out, d), noteLines(PLAIN_NOTE));
  assert.match(out, /\n---\n# Lisbon trip\n\nIntro paragraph about the trip\. \^intro\n\nSecond paragraph\.\n\n## Packing\n- passport \^\w+\n- charger \^\w+\n\n## Notes\nRemember to call Ana\.\n- day one \^\w+\n/);
  assert.equal(toMarkdownMap(fromMarkdownMap(out, "Lisbon trip")), out);
  const root = d.nodes[d.rootId]!;
  assert.equal(root.text, "Lisbon trip", "paragraphs under the heading are the note's, not the root's");
  assert.deepEqual(root.children.map((c) => d.nodes[c]!.text), ["passport", "charger", "day one\n```\nif (x) {\n    go()\n}\n```", "UNC path\n\\nas\\share"]);
  assert.doesNotMatch(out, /```.*\^/, "no fence line carries a block id");
});

test("ordinary note: text between items stays between them; if its node is deleted it moves to the end of the list", async () => {
  const { removeNode } = await import("../src/organiser/model/doc.ts");
  const src = "# R\n\n- a ^a\n\nA paragraph between two lists.\n\n- b ^b\n- c ^c\n";
  const d = fromMarkdownMap(src, "x");
  const out = toMarkdownMap(d);
  assert.equal(out.split(`\n${BLOCK}`)[0], `---\n${MARKER}: ${d.rootId}\n---\n${src}`);
  assert.equal(toMarkdownMap(fromMarkdownMap(out, "x")), out);
  const gone = toMarkdownMap(removeNode(d, "a"));
  assert.ok(gone.includes(`\n- b ^b\n- c ^c\n\nA paragraph between two lists.\n\n${BLOCK}\n`));
  // Text between an item and its first child stays ahead of the children.
  const under = "# R\n\n- a ^a\n\n## Details\n\n  - a1 ^a1\n- b ^b\n";
  assert.equal(toMarkdownMap(fromMarkdownMap(under, "x")).split(`\n\n${BLOCK}`)[0].replace(/^---\n.*\n---\n/, ""), under.replace(/\n$/, ""));
});

test("ordinary note: only the lines right under the heading are the root's; ids on other lines are left alone", () => {
  const d = fromMarkdownMap("# Title\nsubtitle\n## Section\nParagraph ^para\n\n- a ^a\n", "x");
  assert.equal(d.nodes[d.rootId]!.text, "Title\nsubtitle");
  assert.equal(d.md.intro, "## Section\nParagraph ^para\n");
  const out = toMarkdownMap(d);
  assert.match(out, /\n# Title\nsubtitle\n## Section\nParagraph \^para\n\n- a \^a\n/);
  assert.equal(toMarkdownMap(fromMarkdownMap(out, "x")), out);
  // A heading typed as a root line in the map is escaped, so it stays the root's.
  d.nodes[d.rootId]!.text = "Title\n## still the root";
  const typed = toMarkdownMap(d);
  assert.match(typed, /\n# Title\n\\## still the root\n/);
  assert.equal(fromMarkdownMap(typed, "x").nodes[d.rootId]!.text, "Title\n## still the root");
});

test("ordinary note: an H1 that equals the file name is written back, with its block id", () => {
  const out = toMarkdownMap(fromMarkdownMap("---\nidea-map: 1\n---\n# Trip ^root\n\n- a ^a\n", "Trip"));
  assert.match(out, /^---\nidea-map: root\n---\n# Trip \^root\n\n- a \^a\n/);
  // A map the plugin made with its name as the H1 keeps it too.
  const made = "---\nidea-map: r1\n---\n# Trip\n\n- a ^a\n\n%%ideamap\n" + JSON.stringify({ v: 1, pos: { r1: [0, 0], a: [1, 2] }, collapsed: [], links: [], align: {}, branch: {} }) + "\n%%\n";
  assert.equal(cycle(made, "Trip"), made);
});

test("ordinary note: a `# line` inside fenced code above the list is code, not the title", () => {
  const src = "```bash\n# install\nnpm i\n```\n\n- a ^a\n";
  const d = fromMarkdownMap(src, "Setup");
  assert.equal(d.nodes[d.rootId]!.text, "Setup");
  assert.equal(d.md.preamble, "```bash\n# install\nnpm i\n```");
  assert.equal(toMarkdownMap(d).split(`\n${BLOCK}`)[0], `---\n${MARKER}: ${d.rootId}\n---\n${src}`);
});

test("text: a line starting with a backslash keeps it, on items and on the root", () => {
  let d = fromMarkdownMap("# R\n\n- a ^a\n", "x");
  d.nodes["a"]!.text = "Share:\n\\\\nas\\photos";
  d.nodes[d.rootId]!.text = "R\n\\alpha is a LaTeX command";
  for (let i = 0; i < 3; i++) d = fromMarkdownMap(toMarkdownMap(d), "x");
  assert.equal(d.nodes["a"]!.text, "Share:\n\\\\nas\\photos");
  assert.equal(d.nodes[d.rootId]!.text, "R\n\\alpha is a LaTeX command");
});

test("text: fenced code in a node is written as it is and reads back the same; an unclosed fence is escaped", () => {
  const d = fromMarkdownMap("# R\n\n- snippet ^s\n- lone ^l\n- after ^p\n", "x");
  d.nodes["s"]!.text = "snippet\n```md\n# title\n\n- item\n1. one\n    indented \\ and %%\n```";
  d.nodes["l"]!.text = "lone\n```\nnot closed";
  d.nodes["p"]!.text = "after\n~~~\ncode\n~~~\nand prose after it";
  const out = toMarkdownMap(d);
  assert.match(out, /\n- snippet \^s\n  ```md\n  # title\n\n  - item\n  1\. one\n      indented \\ and %%\n  ```\n/);
  assert.match(out, /\n- lone\n  \\```\n  not closed \^l\n/);
  assert.match(out, /\n  and prose after it \^p\n/);
  const back = fromMarkdownMap(out, "x");
  for (const id of ["s", "l", "p"]) assert.equal(back.nodes[id]!.text, d.nodes[id]!.text);
  assert.equal(back.nodes["s"]!.children.length, 0, "list lines inside code are not items");
  assert.equal(toMarkdownMap(back), out);
  // A file an older version wrote, with the block id on the closing fence, is repaired on the next save.
  const old = fromMarkdownMap("# R\n\n- day one\n  ```\n  if (x) {\n  go()\n  }\n  ``` ^d1\n", "x");
  assert.equal(old.nodes["d1"]!.text, "day one\n```\nif (x) {\ngo()\n}\n```");
  assert.match(toMarkdownMap(old), /\n- day one \^d1\n  ```\n  if \(x\) \{\n  go\(\)\n  \}\n  ```\n/);
});

test("block ids: a continuation line with a different id does not replace the item's own", () => {
  const d = fromMarkdownMap("# R\n\n- text ^a1\n  more ^b1\n- multi\n  line ^c1\n", "x");
  assert.ok(d.nodes["a1"], "the first id is kept, so [[R#^a1]] still resolves");
  assert.equal(d.nodes["b1"], undefined);
  assert.equal(d.nodes["a1"]!.text, "text\nmore");
  assert.equal(d.nodes["c1"]!.text, "multi\nline", "an item's only id may sit on its last line");
  const out = toMarkdownMap(d);
  assert.match(out, /\n- text\n  more \^a1\n- multi\n  line \^c1\n/);
  assert.equal(toMarkdownMap(fromMarkdownMap(out, "x")), out);
});

test("line endings: a file with Windows line endings is written back with them", () => {
  const lf = SAVED + "\nCall Ana\n";
  const crlf = lf.replace(/\n/g, "\r\n");
  const d = fromMarkdownMap(crlf, "Trip map");
  assert.equal(d.nodes["a1"]!.x, -500);
  assert.equal(d.nodes["a1"]!.text, "Where", "no stray carriage return in the text");
  assert.equal(toMarkdownMap(d), crlf);
  assert.equal(cycle(lf), lf, "a file with Unix line endings keeps them");
  d.nodes["a1"]!.text = "Where\nand when";
  assert.doesNotMatch(toMarkdownMap(d), /[^\r]\n/, "new lines use the file's endings too");
});

test("ordinary note: list lines inside the note's own code, comments and math are not items, and get no ids or blank lines", async () => {
  const { conversionChange } = await import("../src/host-logic.ts");
  // List lines inside a code block, a %% comment, an HTML comment and a math block. [note, its block, the items]
  const notes: [string, string, string[]][] = [
    ["Intro\n\n```md\n- one\n- two\n```\n\n- real\n", "\n```md\n- one\n- two\n```\n", ["real"]],
    ["~~~~ js\n- one\n~~~\n- two\n~~~~~\n- real\n", "~~~~ js\n- one\n~~~\n- two\n~~~~~\n", ["real"]],
    ["%%\n- hidden\n%%\n- real\n", "%%\n- hidden\n%%\n", ["real"]],
    ["<!--\n- hidden\n-->\n- real\n", "<!--\n- hidden\n-->\n", ["real"]],
    ["$$\n- x\n$$\n- real\n", "$$\n- x\n$$\n", ["real"]],
    ["- real\n\n```\n- not an item\n```\n\n- also real\n", "\n```\n- not an item\n```\n", ["real", "also real"]],
  ];
  for (const [note, block, items] of notes) {
    const d = fromMarkdownMap(note, "Note");
    assert.deepEqual(Object.values(d.nodes).filter((n) => n.id !== d.rootId).map((n) => n.text), items, note);
    const out = toMarkdownMap(d);
    assert.ok(out.includes(block), `the block is written back line for line: ${JSON.stringify(out)}`);
    assert.equal(conversionChange(note, out), null, note);
    assert.equal(toMarkdownMap(fromMarkdownMap(out, "Note")), out, note);
  }
  // A comment or math that opens and closes on one line is a line of text; the list after it is the list.
  for (const inline of ["%% todo %%\n- a\n", "$$x$$\n- a\n", "<!-- x -->\n- a\n"]) {
    const d = fromMarkdownMap(inline, "N");
    assert.deepEqual(d.nodes[d.rootId]!.children.map((c) => d.nodes[c]!.text), ["a"], inline);
  }
  // A heading inside a comment above the list is not the title.
  assert.equal(fromMarkdownMap("%%\n# Not the title\n%%\n# Title\n\n- a\n", "N").name, "Title");
});

test("a map's own items are never swallowed by an opener nothing closes, in the root or in the note's text", () => {
  // The root ends in an unclosed fence or comment; later a node's code, or the note's own comment, has the closing line.
  const maps = [
    "---\nidea-map: r\n---\n# T\n```\n\n- a\n  ```\n  code\n  ```\n  after ^a\n- b ^b\n\nnotes\n```\n",
    "---\nidea-map: r\n---\n# T\n%%\n\n- a\n  x %% y\n  last ^a\n- b ^b\n\n%%\ncomment\n%%\n",
  ];
  for (const src of maps) {
    const d = fromMarkdownMap(src, "N");
    assert.deepEqual(d.nodes[d.rootId]!.children, ["a", "b"]);
    assert.equal(toMarkdownMap(d).split("\n\n%%ideamap")[0] + "\n", src);
  }
  // The root's own code is still the root's.
  const code = fromMarkdownMap("# T\n```\ncode\n```\n\n- a ^a\n", "N");
  assert.equal(code.nodes[code.rootId]!.text, "T\n```\ncode\n```");
});

test("ordinary note: an item with trailing spaces converts once and opens quietly afterwards", async () => {
  const { conversionChange } = await import("../src/host-logic.ts");
  // Trailing spaces on an item: Convert wrote `- a   ^id`, and the next open asked again.
  for (const note of ["- a  \n- b\n", "- a\n  b  \n- c\n", "- [ ] task \t\n", "- a  \n  ```\n  code\n  ```\n"]) {
    const d = fromMarkdownMap(note, "Note");
    const converted = toMarkdownMap(seedCanvasPositions(d));
    assert.doesNotMatch(converted, /[ \t]{2,}\^\w+$/m, "one space before each block id");
    const reopened = toMarkdownMap(fromMarkdownMap(converted, "Note"));
    assert.equal(reopened, converted, "the converted file reads back as it was written");
    assert.equal(conversionChange(converted, reopened), null);
    assert.equal(conversionChange(note, toMarkdownMap(d)), null, "trailing spaces alone are not a change worth asking about");
  }
  // Text typed with trailing spaces is written the same way.
  const d = fromMarkdownMap("# R\n\n- a ^a\n- b ^b\n", "x");
  d.nodes["a"]!.text = "one  ";
  d.nodes["b"]!.text = "two  \nthree  ";
  const out = toMarkdownMap(d);
  assert.match(out, /\n- one \^a\n- two  \n  three \^b\n/);
  assert.equal(toMarkdownMap(fromMarkdownMap(out, "x")), out);
});

test("old maps: a blank line an older version wrote as `\\` inside a node's fenced code reads as a blank line", () => {
  // Older maps wrote a blank line in a node as `\`, also inside code; the map showed a literal backslash.
  const old = "---\nidea-map: r\n---\n# R\n\n- a\n  ```\n  code\n  \\\n  more\n  ```\n  after ^a\n  - child ^c\n    ```\n    x\n    \\\n    ```\n    y ^c2\n";
  const d = fromMarkdownMap(old, "x");
  assert.equal(d.nodes["a"]!.text, "a\n```\ncode\n\nmore\n```\nafter");
  assert.equal(d.nodes["c"]!.text, "child\n```\nx\n\n```\ny");
  const out = toMarkdownMap(d);
  assert.match(out, /\n  code\n\n  more\n/, "written back as a real blank line");
  assert.equal(toMarkdownMap(fromMarkdownMap(out, "x")), out);
  // More indented, it is code: kept as it is.
  assert.equal(fromMarkdownMap("- a ^a\n  ```\n    \\\n  ```\n", "x").nodes["a"]!.text, "a\n```\n  \\\n```");
});

test("an empty node with a heading size reads back as an empty heading, and text that is only hashes stays text", () => {
  const d = fromMarkdownMap(SAVED, "Trip map");
  d.nodes["a2"] = { ...d.nodes["a2"]!, text: "", size: 3 };
  d.nodes["b1"] = { ...d.nodes["b1"]!, text: "###" };
  const once = toMarkdownMap(d);
  assert.match(once, /^  - ### \^a2$/m);
  assert.match(once, /^- \\### \^b1$/m);
  const back = fromMarkdownMap(once, "Trip map");
  assert.equal(back.nodes["a2"]!.text, "");
  assert.equal(back.nodes["a2"]!.size, 3);
  assert.equal(back.nodes["b1"]!.text, "###");
  assert.equal(back.nodes["b1"]!.size, undefined);
  assert.equal(cycle(once), once, "the second save writes the same bytes");
});

test("an unclosed, indented opener above the list can't be closed by a node's own code, so the heading and the node stay", () => {
  const src = "---\nidea-map: r1\n---\n  ```\n\n# Trip\n\n- Setup\n  ```sh\n  npm test\n  ```\n  then deploy ^s1\n- Lisbon ^a1\n\n%%ideamap\n" +
    JSON.stringify({ v: 1, pos: { r1: [0, 0], s1: [200, 0], a1: [200, 80] }, collapsed: [], links: [], align: {}, branch: {} }) + "\n%%\n";
  const d = fromMarkdownMap(src, "Untitled idea");
  assert.equal(d.nodes[d.rootId]!.text, "Trip");
  assert.ok(d.nodes["s1"], "the node with code is still a node");
  assert.equal(cycle(src, "Untitled idea"), src);
});

test("file format: a new map is marked with the plugin's id, and its layout block opens with it", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as { id: string };
  assert.equal(MARKER, manifest.id, "the frontmatter key is the manifest id");
  assert.equal(PLUGIN_ID, manifest.id, "so is the view type");
  assert.equal(BLOCK, `%%${manifest.id}`);
  const e = emptyDoc("Plan");
  const [d] = addChild(e, e.rootId, "Step");
  const out = toMarkdownMap(d);
  assert.match(out, new RegExp(`^---\\n${MARKER}: ${d.rootId}\\n---\\n`));
  assert.ok(out.includes(`\n${BLOCK}\n{`), "the layout block opens with the new marker");
  assert.ok(!out.includes("idea-map") && !out.includes("%%ideamap"));
  assert.equal(cycle(out, "Plan"), out);
  assert.ok(isMarkdownMap(out) && hasMapKey({ [MARKER]: "r" }));
});

test("file format: a map written as idea-map opens the same and keeps its key and block, byte for byte and after an edit", () => {
  assert.ok(isMarkdownMap(SAVED) && hasMapKey({ "idea-map": "r1" }) && !hasMapKey({ tags: [] }) && !hasMapKey(undefined));
  assert.equal(cycle(SAVED), SAVED);
  const d = fromMarkdownMap(SAVED, "Trip");
  d.nodes["a2"]!.text = "Lisbon and Sintra";
  const edited = toMarkdownMap(d);
  assert.match(edited, /^---\nidea-map: r1\n---\n/);
  assert.ok(edited.includes("\n%%ideamap\n{") && !edited.includes(MARKER), "no new marker is written into an older map");
  // The two formats read into the same tree and layout.
  const renamed = SAVED.replace("idea-map: r1", `${MARKER}: r1`).replace("%%ideamap", BLOCK);
  const [a, b] = [fromMarkdownMap(SAVED, "Trip"), fromMarkdownMap(renamed, "Trip")];
  assert.deepEqual(tree(b), tree(a));
  assert.deepEqual(Object.values(b.nodes).map((n) => [n.id, n.x, n.y]), Object.values(a.nodes).map((n) => [n.id, n.x, n.y]));
  assert.equal(cycle(renamed), renamed);
});

test("file format: a key and a block from different formats are each kept; the last block of either kind is the one read", () => {
  const mixed = SAVED.replace("%%ideamap", BLOCK);
  assert.equal(cycle(mixed), mixed);
  const later = SAVED.replace(/\n$/, "") + "\n" + BLOCK + "\n" + JSON.stringify({ v: 1, pos: { r1: [0, 0], a1: [5, 5], a2: [6, 6], b1: [7, 7] }, collapsed: [], links: [], align: {}, branch: {} }) + "\n%%\n";
  const d = fromMarkdownMap(later, "Trip");
  assert.equal(d.nodes["a1"]!.x, 5, "the later block wins");
  assert.equal(d.md.block, BLOCK);
  // A root line reading as either opening line is escaped, so it can't open a block.
  for (const f of MAP_FORMATS) assert.equal(escapeRootLine(f.block), `\\${f.block}`);
});
