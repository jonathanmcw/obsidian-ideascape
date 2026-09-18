// What an export promises, and what the file it writes actually carries.
//
// The picture is checked where a picture can only be checked — in a browser, against a real canvas
// (scripts/export-check.mjs, `npm run verify:export`). Everything here is the text: the name the file lands
// under, and the three formats that carry the map's structure rather than its look.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addChild, addLink, emptyDoc, setCollapsed, setText, walk } from "../src/organiser/model/doc.ts";
import { fromMarkdownMap } from "../src/organiser/model/markdown.ts";
import { droppedLinkCount, slug, toMarkdown, toOPML } from "../src/organiser/model/exporters.ts";
import { toJSONCanvas } from "../src/organiser/model/jsoncanvas.ts";
import { exportPath } from "../src/host-logic.ts";
import type { IODoc } from "../src/organiser/model/types.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const bytes = (s: string) => new TextEncoder().encode(s).length;
const texts = (d: IODoc) => walk(d, d.rootId).map(({ id, depth }) => `${depth}:${d.nodes[id]!.text}`);
const canvasOf = (d: IODoc) =>
  JSON.parse(toJSONCanvas(d)) as {
    nodes: { id: string; text: string }[];
    edges: { fromNode: string; toNode: string; kind?: string }[];
    ideaOrganiser: { rootId: string };
  };

test("export names: a title in any script becomes a file name, and one too long for a file system is cut", () => {
  assert.equal(slug("Trip to Lisbon"), "trip-to-lisbon");
  // A letter is a letter in every script. A map named in Japanese, French or Korean must not export as `untitled`.
  assert.equal(slug("旅行計画"), "旅行計画");
  assert.equal(slug("Café déjà vu"), "café-déjà-vu");
  assert.equal(slug("한국어 지도"), "한국어-지도");
  // What a path or a file system reserves never reaches the name, and neither does a leading dot, which on
  // macOS and Linux would hide the file the export just wrote.
  for (const name of ["a/b", "a:b", "a\\b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b", ".hidden", "..", "a\u0000b", "a\u0009b"]) {
    const s = slug(name);
    // eslint-disable-next-line no-control-regex -- the control characters a file name must not carry
    assert.doesNotMatch(s, /[/\\:*?"<>|\u0000-\u001f]/, `${JSON.stringify(name)} -> ${JSON.stringify(s)}`);
    assert.doesNotMatch(s, /^[.-]|[.-]$/, `${JSON.stringify(name)} -> ${JSON.stringify(s)}`);
  }
  // A run of anything that is not a letter or a digit is one dash, and a title made only of those has no name in it.
  assert.equal(slug("Trip 🚀"), "trip");
  assert.equal(slug("🚀".repeat(100) + "day"), "day");
  for (const empty of ["", "   ", "...", "--", "🚀🚀"]) assert.equal(slug(empty), "untitled", JSON.stringify(empty));

  // A 300-character title is not a file name: every file system in use stops a name at 255 bytes, and
  // `exportPath` still has to fit `-2` and an extension inside that. The cut counts bytes, as a file system does.
  const long = slug("a very long title that keeps going ".repeat(20));
  assert.ok(bytes(long) <= 120, `${bytes(long)} bytes`);
  assert.doesNotMatch(long, /-$/, "and never trails the dash it was cut at");
  const japanese = slug("旅".repeat(300));
  assert.equal(bytes(japanese), 120, "120 bytes is 40 Japanese characters, not 120");
  assert.equal(japanese.length, 40);
  // Cut between characters, never through one: 𝔄 is a letter that takes two UTF-16 units and four bytes.
  const astral = slug("𝔄".repeat(100));
  assert.equal([...astral].length, 30, "a surrogate pair is never split");
  assert.equal(astral.length, 60);

  // And where such a file lands: beside the map, under a name nothing has yet.
  assert.equal(exportPath(`${slug("旅行計画")}.opml`, null, () => false), "旅行計画.opml");
  assert.equal(exportPath(`${slug("Café")}.md`, { path: "maps/Café.md", basename: "Café", dir: "maps" }, () => false), "maps/café-2.md");
});

test("export: the file carries the whole map — a folded branch is in it, where the picture leaves it out", () => {
  // Folding is how a map is read, not what it holds. The three text formats write every node; only the picture,
  // drawn from the same layout the screen uses, leaves a folded branch out (see scripts/export-check.mjs).
  let d: IODoc = fromMarkdownMap("# Trip\n\n- Packing ^p\n  - passport ^a\n  - charger ^b\n- Tickets ^t\n", "Trip");
  d = setCollapsed(d, "p", true);
  const md = toMarkdown(d);
  const opml = toOPML(d);
  for (const hidden of ["passport", "charger"]) {
    assert.match(md, new RegExp(`- ${hidden}$`, "m"), `Markdown keeps ${hidden}`);
    assert.match(opml, new RegExp(`text="${hidden}"`), `OPML keeps ${hidden}`);
    assert.ok(canvasOf(d).nodes.some(n => n.text === hidden), `.canvas keeps ${hidden}`);
  }
  // Read back, the Markdown is the same map — the fold itself is a thing only the map's own file keeps.
  assert.deepEqual(texts(fromMarkdownMap(md, "Trip")), texts(d));
  assert.doesNotMatch(md, /\^[a-z0-9]{6,}/, "and no block ids go with it");
});

test("export: a root with no text is the map's name, not “Untitled”", () => {
  // The sheet is headed Export “{name}” and the file is named after it; the outline inside must agree.
  let d: IODoc = emptyDoc("Weekend in Porto");
  d = setText(d, d.rootId, "");
  [d] = addChild(d, d.rootId, "Sé Cathedral");
  assert.match(toMarkdown(d), /^# Weekend in Porto$/m);
  assert.match(toOPML(d), /<outline text="Weekend in Porto">/);
  assert.equal(slug(d.name), "weekend-in-porto");
  // .canvas is the format that keeps the map exactly as it stands, so there an empty root stays empty.
  const canvas = canvasOf(d);
  assert.equal(canvas.nodes.find(n => n.id === canvas.ideaOrganiser.rootId)!.text, "");
  // A child with no text is "Untitled" everywhere: it has no name of its own to fall back on.
  let e: IODoc = emptyDoc("Map");
  [e] = addChild(e, e.rootId, "");
  assert.match(toMarkdown(e), /^- Untitled$/m);
  assert.match(toOPML(e), /text="Untitled"/);
});

test("export: every level is kept, and a map of a thousand nodes is written whole", () => {
  // Twelve deep, which is past what headings could carry, and why the export is a nested list.
  let deep = "# R\n";
  for (let i = 1; i <= 12; i++) deep += `\n${"  ".repeat(i - 1)}- level ${i} ^n${i}`;
  const d = fromMarkdownMap(`${deep}\n`, "R");
  const md = toMarkdown(d);
  assert.match(md, /^ {22}- level 12$/m, "two spaces a level, all the way down");
  assert.deepEqual(texts(fromMarkdownMap(md, "R")), texts(d), "and it reads back as the same map");

  // A map far larger than anyone builds by hand: eight branches of 125 nodes, some of them nested.
  let big: IODoc = emptyDoc("Big");
  for (let b = 0; b < 8; b++) {
    let branch: string;
    [big, branch] = addChild(big, big.rootId, `branch ${b}`);
    let parent = branch;
    for (let i = 0; i < 124; i++) [big, parent] = addChild(big, i % 4 === 3 ? parent : branch, `node ${b}-${i}`);
  }
  assert.equal(Object.keys(big.nodes).length, 1001);
  assert.equal(toMarkdown(big).split("\n").filter(l => /^\s*- /.test(l)).length, 1000, "every node but the root is an item");
  assert.equal((toOPML(big).match(/<outline /g) ?? []).length, 1001);
  assert.equal(canvasOf(big).nodes.length, 1001);
});

test("export: free links survive .canvas, and the formats that cannot hold them say how many they drop", () => {
  let d: IODoc = fromMarkdownMap("# R\n\n- a ^a\n- b ^b\n", "R");
  d = addLink(d, "a", "b");
  assert.equal(droppedLinkCount(d), 1, "what the sheet tells the reader before they choose a format");
  // .canvas keeps the link as an edge of its own, beside the edges that make the tree.
  const canvas = canvasOf(d);
  assert.ok(canvas.edges.some(e => e.fromNode === "a" && e.toNode === "b" && e.kind !== "child"), "the link is an edge");
  // Neither Markdown nor OPML gains a phantom item where a link was: two nodes in, two nodes out.
  assert.equal(toMarkdown(d).split("\n").filter(l => l.startsWith("- ")).length, 2);
  assert.equal((toOPML(d).match(/<outline /g) ?? []).length, 3);
});

test("export: the picture draws in the very font the layout measured", () => {
  // The measurer decides how wide a pill is; the exporter decides how wide the text drawn in it is. They keep
  // separate copies of the stack, and text drawn in a font that was not the one measured runs past its pill.
  const stack = (path: string) => /const FONT_STACK = `([^`]+)`/.exec(read(path))?.[1];
  const measured = stack("src/organiser/layout/measure.ts");
  assert.ok(measured, "measure.ts still names a font stack");
  assert.equal(stack("src/organiser/model/exporters.ts"), measured, "the exporter draws in a different font from the one the layout measured");
  // And the screen is set in it too, so all three agree on how wide a line is.
  assert.ok(read("src/organiser/styles.css").replace(/'/g, '"').includes(measured!), "styles.css sets node text in some other stack");
});
