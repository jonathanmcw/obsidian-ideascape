import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromMarkdownMap, toMarkdownMap, isMarkdownMap, toMarkdownList, fromClipboardText } from "../src/organiser/model/markdown.ts";
import { fromJSONCanvas } from "../src/organiser/model/jsoncanvas.ts";
import { addSibling, graft, ordinalOf, rootSides, setLook, setOrdered, setSide, setTask, toggleTaskDone, walk } from "../src/organiser/model/doc.ts";
import type { IODoc } from "../src/organiser/model/types.ts";

const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const shape = (d: IODoc) => walk(d, d.rootId).map(({ id, depth }) => `${depth}:${id}:${d.nodes[id]!.text}:${d.nodes[id]!.collapsed ? "c" : ""}:${d.nodes[id]!.align ?? ""}`);
const links = (d: IODoc) => d.links.map(l => `${l.from}>${l.to}`).sort();

test("markdown: a plain nested list opens as a map, ids are minted, positions flagged for layout", () => {
  const d = fromMarkdownMap("# Trip\n\n- Where\n  - Lisbon\n  - Porto\n- When\n", "x");
  assert.equal(d.name, "Trip");
  assert.equal(d.needsLayout, true);
  const rows = walk(d, d.rootId);
  assert.deepEqual(rows.map(r => [r.depth, d.nodes[r.id]!.text]), [[0, "Trip"], [1, "Where"], [2, "Lisbon"], [2, "Porto"], [1, "When"]]);
  assert.ok(Object.keys(d.nodes).every(id => /^[a-z0-9]{6}$/.test(id)));
  assert.equal(d.nodes[d.nodes[d.rootId]!.children[0]!]!.branch, 0);
  assert.equal(d.nodes[d.nodes[d.rootId]!.children[1]!]!.branch, 1);
});

test("markdown: round trip is exact and stable (ids, order, text, collapsed, links, align, positions, extras)", () => {
  const src = [
    "---", "idea-map: r1", "tags: [planning]", "---",
    "Some notes above the map.", "",
    "# Plan a small trip", "",
    "- Where ^a1", "  - Lisbon ^a2", "  - Porto ^a3",
    "- When ^b1", "  - October ^b2",
    "- Multi", "  line ^c1",
    "- 咖啡店：先做外賣窗口 ^d1", "  - émoji 🚀 and - dash ^d2",
    "", "Notes after the map.", "",
    "%%ideamap", JSON.stringify({ v: 1, pos: { r1: [0, 0], a1: [-190, -150], a2: [-100, -232], a3: [-300, -84], b1: [-176, 128], b2: [-320, 74], c1: [1, 2], d1: [3, 4], d2: [5, 6] }, collapsed: ["b1"], links: [["a3", "b2"]], align: { a1: "left" }, branch: { a1: 5 } }), "%%", "",
  ].join("\n");
  const d = fromMarkdownMap(src, "x");
  assert.equal(d.needsLayout, false);
  assert.equal(d.nodes["c1"]!.text, "Multi\nline");
  assert.equal(d.nodes["d2"]!.text, "émoji 🚀 and - dash");
  assert.equal(d.nodes["b1"]!.collapsed, true);
  assert.deepEqual(links(d), ["a3>b2"]);
  assert.equal(d.nodes["a1"]!.align, "left");
  assert.equal(d.nodes["a2"]!.branch, 5, "branch override inherits down");
  assert.equal(d.md.preamble, "Some notes above the map.");
  assert.equal(d.md.postscript, "Notes after the map.");
  assert.match(d.md.frontmatter!, /tags: \[planning\]/);
  const out = toMarkdownMap(d);
  assert.equal(out, src, "serialiser reproduces the source byte for byte");
  const again = fromMarkdownMap(out, "x");
  assert.deepEqual(shape(again), shape(d));
  assert.equal(toMarkdownMap(again), out);
});

test("markdown: hostile text survives — leading dashes, hashes, numbers, trailing ^word, %% and blank inner lines", () => {
  const d = fromMarkdownMap("# Root\n\n- a\n", "x");
  const a = d.nodes[d.nodes[d.rootId]!.children[0]!]!;
  a.text = "- looks like an item\n# looks like a heading\n1. numbered\n\nblank above\nends with ^caret\n%%ideamap";
  const b = d.nodes[d.rootId]!; void b;
  const [d2] = [d];
  const e = { ...a }; void e;
  d.nodes[a.id]!.text = a.text;
  d.nodes[d.rootId]!.text = "Root\nsecond root line";
  const out = toMarkdownMap(d);
  const back = fromMarkdownMap(out, "x");
  assert.equal(back.nodes[a.id]!.text, a.text);
  assert.equal(back.nodes[back.rootId]!.text, "Root\nsecond root line");
  assert.equal(toMarkdownMap(back), out);
});

test("markdown: tabs, Windows newlines, missing H1, duplicate ids", () => {
  const d = fromMarkdownMap("---\r\nidea-map: 1\r\n---\r\n- a ^dup\r\n\t- b ^dup\r\n\t\t- c\r\n- d\r\n", "Fallback");
  assert.equal(d.name, "Fallback");
  assert.deepEqual(walk(d, d.rootId).map(r => [r.depth, d.nodes[r.id]!.text]), [[0, "Fallback"], [1, "a"], [2, "b"], [3, "c"], [1, "d"]]);
  const ids = Object.keys(d.nodes);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(isMarkdownMap("---\nidea-map: 1\n---\n# x"));
  assert.ok(!isMarkdownMap("---\ntitle: x\n---\n# x"));
});

for (const name of ["fileA.canvas", "deep12.canvas", "stress_300.canvas", "stress_1000.canvas"]) {
  test(`markdown: ${name} → markdown → doc keeps the tree, links and collapsed state; fast`, () => {
    const canvas = fromJSONCanvas(fixture(name), name);
    const t0 = performance.now();
    const md = toMarkdownMap(canvas);
    const t1 = performance.now();
    const back = fromMarkdownMap(md, name);
    const t2 = performance.now();
    assert.deepEqual(shape(back), shape(canvas));
    assert.deepEqual(links(back), links(canvas));
    for (const n of Object.values(canvas.nodes)) { assert.equal(back.nodes[n.id]!.x, Math.round(n.x)); assert.equal(back.nodes[n.id]!.y, Math.round(n.y)); }
    assert.equal(toMarkdownMap(back), md, "stable on the second pass");
    assert.ok(t1 - t0 < 200 && t2 - t1 < 200, `write ${(t1 - t0).toFixed(1)}ms read ${(t2 - t1).toFixed(1)}ms`);
    console.log(`  ${name}: ${Object.keys(canvas.nodes).length} nodes, write ${(t1 - t0).toFixed(1)} ms, read ${(t2 - t1).toFixed(1)} ms, ${md.length} bytes`);
  });
}

test("markdown: empty nodes, single-line text ending in ^word, and an id-only line all round-trip", () => {
  const d = fromMarkdownMap("# R\n\n- ^k1\n- ends with ^word ^k2\n-  ^k3\n", "x");
  const kids = d.nodes[d.rootId]!.children.map(id => d.nodes[id]!);
  assert.deepEqual(kids.map(k => [k.id, k.text]), [["k1", ""], ["k2", "ends with ^word"], ["k3", ""]]);
  const out = toMarkdownMap(d);
  assert.deepEqual(fromMarkdownMap(out, "x").nodes[d.rootId]!.children.map(id => fromMarkdownMap(out, "x").nodes[id]!.text), ["", "ends with ^word", ""]);
});


test("markdown: a root that equals the file name is not written as an H1; the marker carries its id", () => {
  const d = fromMarkdownMap("---\nidea-map: abc123\n---\n- a\n", "My map");
  assert.equal(d.rootId, "abc123");
  assert.equal(d.nodes[d.rootId]!.text, "My map");
  const out = toMarkdownMap(d);
  assert.ok(!out.includes("# My map"), out);
  assert.match(out, /^---\nidea-map: abc123\n---\n- a \^/);
  const back = fromMarkdownMap(out, "My map");
  assert.equal(back.rootId, "abc123");
  assert.equal(toMarkdownMap(back), out);
  back.nodes[back.rootId]!.text = "Renamed root";
  assert.match(toMarkdownMap(back), /\n# Renamed root\n/);
});

test("markdown: a hand-set node width travels in the geometry block", () => {
  const d = fromMarkdownMap("# R\n\n- wide ^w1\n- normal ^w2\n", "x");
  d.nodes["w1"]!.width = 320;
  const out = toMarkdownMap(d);
  assert.match(out, /"width":\{"w1":320\}/);
  const back = fromMarkdownMap(out, "x");
  assert.equal(back.nodes["w1"]!.width, 320);
  assert.equal(back.nodes["w2"]!.width, undefined);
  assert.equal(toMarkdownMap(back), out);
});

test("markdown: heading sizes are `- ## text` in the file; a literal leading # is escaped", () => {
  const d = fromMarkdownMap("# R\n\n- ## Section ^s1\n  - ### Sub ^s2\n- \\# not a heading ^s3\n- body ^s4\n", "x");
  assert.equal(d.nodes["s1"]!.size, 2); assert.equal(d.nodes["s1"]!.text, "Section");
  assert.equal(d.nodes["s2"]!.size, 3);
  assert.equal(d.nodes["s3"]!.size, undefined); assert.equal(d.nodes["s3"]!.text, "# not a heading");
  const out = toMarkdownMap(d);
  assert.match(out, /- ## Section \^s1\n  - ### Sub \^s2\n- \\# not a heading \^s3\n- body \^s4/);
  d.nodes[d.rootId]!.size = 1;
  const out2 = toMarkdownMap(d);
  assert.match(out2, /"size":\{"[a-z0-9]+":1\}/);
  assert.equal(fromMarkdownMap(out2, "x").nodes[d.rootId]!.size, 1);
});

test("markdown: a branch dragged across the root keeps its side; untouched maps still split in halves", () => {
  const d = fromMarkdownMap("# R\n\n- a ^a\n- b ^b\n- c ^c\n- d ^d\n- e ^e\n", "x");
  assert.deepEqual(rootSides(d), { a: -1, b: -1, c: 1, d: 1, e: 1 });
  const moved = setSide(d, "a", 1);
  // Everyone else is frozen where they were, so only `a` crosses over.
  assert.deepEqual(rootSides(moved), { a: 1, b: -1, c: 1, d: 1, e: 1 });
  const out = toMarkdownMap(moved);
  assert.match(out, /"side":\{"a":1,"b":-1,"c":1,"d":1,"e":1\}/);
  const back = fromMarkdownMap(out, "x");
  assert.equal(back.nodes["a"]!.side, 1);
  assert.equal(toMarkdownMap(back), out);
  // A new main branch with no side fills the shorter side.
  const f = fromMarkdownMap(out.replace("- e ^e\n", "- e ^e\n- f ^f\n"), "x");
  assert.equal(rootSides(f)["f"], -1);
  assert.equal(toMarkdownMap(d), toMarkdownMap(fromMarkdownMap(toMarkdownMap(d), "x")));
});

test("clipboard: branches copy as a nested list without ids and paste back with fresh ids", () => {
  const d = fromMarkdownMap("# R\n\n- ## a ^a\n  - a1 ^a1\n    line two ^a1x\n  - a2 ^a2\n- b ^b\n", "x");
  const md = toMarkdownList(d, ["a"]);
  assert.equal(md, "- ## a\n  - a1\n    line two\n  - a2\n");
  const clip = fromClipboardText(md)!;
  const [next, ids] = graft(d, "b", clip);
  assert.equal(ids.length, 1);
  const pasted = next.nodes[ids[0]!]!;
  assert.notEqual(pasted.id, "a");
  assert.equal(pasted.text, "a"); assert.equal(pasted.size, 2); assert.equal(pasted.parent, "b");
  assert.equal(pasted.children.length, 2);
  assert.equal(next.nodes[pasted.children[0]!]!.text, "a1\nline two");
  assert.equal(next.nodes["a"]!.children.length, 2, "the source is untouched");
  assert.equal(walk(next, next.rootId).length, walk(d, d.rootId).length + 3);
});

test("clipboard: plain lines become one node each; a heading above a list is a node too; empty text is nothing", () => {
  const lines = fromClipboardText("first\n\n- second\nthird\n")!;
  // has a list marker → parsed as a list: "first" is preamble, "third" continues the item? no — it is a new line at indent 0, so it closes the list
  assert.deepEqual(lines.nodes[lines.rootId]!.children.map((c) => lines.nodes[c]!.text), ["second"]);
  const plain = fromClipboardText("alpha\nbeta\n\ngamma")!;
  assert.deepEqual(plain.nodes[plain.rootId]!.children.map((c) => plain.nodes[c]!.text), ["alpha", "beta", "gamma"]);
  const headed = fromClipboardText("# Title\n\n- kid\n")!;
  const tops = headed.nodes[headed.rootId]!.children;
  assert.equal(tops.length, 1);
  assert.equal(headed.nodes[tops[0]!]!.text, "Title");
  assert.equal(headed.nodes[headed.nodes[tops[0]!]!.children[0]!]!.text, "kid");
  assert.equal(fromClipboardText("   \n"), null);
});

test("markdown: the map's own look round-trips, and an unpinned map writes none", () => {
  const d = fromMarkdownMap("# T\n\n- A ^a1\n", "x");
  assert.equal(toMarkdownMap(d).includes('"look"'), false);
  const pinned = setLook(d, { theme: "graphite", nodeStyle: "filled", layout: "free" });
  const back = fromMarkdownMap(toMarkdownMap(pinned), "x");
  assert.deepEqual(back.look, { theme: "graphite", nodeStyle: "filled", layout: "free" });
  const unpinned = setLook(setLook(setLook(pinned, { theme: undefined }), { nodeStyle: undefined }), { layout: undefined });
  assert.equal(unpinned.look, undefined);
  assert.equal(toMarkdownMap(unpinned), toMarkdownMap(d));
});

test("markdown: numbered items and tasks read as they are, number themselves, and write back as 1. 2. / - [ ] - [x]", () => {
  const src = "# R\n\n- a ^a\n1. one ^o1\n2. two ^o2\n   - [ ] open ^t1\n   - [x] done ^t2\n- [/] custom ^t3\n7) seven ^o3\n- \\[ ] not a task ^p1\n- [ ] ## Sized task ^t4\n- ## [x] Sized first ^t5\n";
  const d = fromMarkdownMap(src, "x");
  assert.equal(d.nodes["o1"]!.ordered, true);
  assert.equal(ordinalOf(d, "o1"), 1);
  assert.equal(ordinalOf(d, "o2"), 2);
  assert.equal(ordinalOf(d, "o3"), 1, "a bullet between two runs restarts the count");
  assert.equal(d.nodes["a"]!.ordered, undefined);
  assert.equal(ordinalOf(d, "a"), null);
  assert.equal(d.nodes["t1"]!.task, " "); assert.equal(d.nodes["t1"]!.text, "open");
  assert.equal(d.nodes["t2"]!.task, "x");
  assert.equal(d.nodes["t3"]!.task, "/", "custom states are kept");
  assert.equal(d.nodes["p1"]!.task, undefined); assert.equal(d.nodes["p1"]!.text, "[ ] not a task");
  assert.equal(d.nodes["t4"]!.task, " "); assert.equal(d.nodes["t4"]!.size, 2); assert.equal(d.nodes["t4"]!.text, "Sized task");
  assert.equal(d.nodes["t5"]!.task, "x"); assert.equal(d.nodes["t5"]!.size, 2); assert.equal(d.nodes["t5"]!.text, "Sized first");
  const out = toMarkdownMap(d);
  assert.match(out, /\n- a \^a\n1\. one \^o1\n2\. two \^o2\n  - \[ \] open \^t1\n  - \[x\] done \^t2\n- \[\/\] custom \^t3\n1\. seven \^o3\n- \\\[ \] not a task \^p1\n- \[ \] ## Sized task \^t4\n- \[x\] ## Sized first \^t5\n/);
  const back = fromMarkdownMap(out, "x");
  assert.equal(toMarkdownMap(back), out, "stable on the second pass");
  assert.deepEqual(shape(back), shape(d));
  assert.equal(toMarkdownList(d, ["o2"]), "2. two\n  - [ ] open\n  - [x] done\n");
  // Enter continues the list the way the editor does; toggles are plain.
  const [s1, sib] = addSibling(d, "t2");
  assert.equal(s1.nodes[sib]!.task, " ", "a sibling of a done task is an open task");
  const [s2, num] = addSibling(d, "o2");
  assert.equal(ordinalOf(s2, num), 3);
  assert.equal(toggleTaskDone(d, "t2").nodes["t2"]!.task, " ");
  assert.equal(toggleTaskDone(d, "t3").nodes["t3"]!.task, "x");
  assert.equal(setTask(d, "t2", undefined).nodes["t2"]!.task, undefined);
  assert.equal(setOrdered(d, "a", true).nodes["a"]!.ordered, true);
  assert.equal(setOrdered(d, d.rootId, true), d, "the root is never an item");
  assert.equal(setTask(d, d.rootId, " "), d);
});

test("markdown: the map's own colours travel in the geometry block; bad values are dropped", async () => {
  const { setPalette } = await import("../src/organiser/model/doc.ts");
  const d = fromMarkdownMap("# T\n\n- A ^a1\n- B ^b1\n", "x");
  assert.equal(toMarkdownMap(d).includes('"palette"'), false);
  const one = setPalette(setPalette(d, 2, "#12ab56"), 0, "#ff8800");
  assert.deepEqual(one.look?.palette, ["#ff8800", "", "#12ab56"]);
  const out = toMarkdownMap(one);
  assert.match(out, /"palette":\["#ff8800","","#12ab56"\]/);
  const back = fromMarkdownMap(out, "x");
  assert.deepEqual(back.look?.palette, ["#ff8800", "", "#12ab56"]);
  assert.equal(toMarkdownMap(back), out);
  // emptying the last slot trims; emptying every slot drops the key
  assert.deepEqual(setPalette(one, 2, undefined).look?.palette, ["#ff8800"]);
  assert.equal(setPalette(setPalette(one, 2, undefined), 0, undefined).look, undefined);
  const junk = out.replace('["#ff8800","","#12ab56"]', '["#ff8800","nope",12,"#ABCDEF","#000000"]');
  assert.deepEqual(fromMarkdownMap(junk, "x").look?.palette, ["#ff8800", "", "", "#abcdef"]);
});

test("markdown: the dot grid and snap settings travel in the geometry block only when set", () => {
  const d = fromMarkdownMap("# T\n\n- A ^a1\n", "x");
  assert.equal(toMarkdownMap(d).includes('"dots"'), false);
  const off = setLook(d, { dots: false, snap: true });
  const out = toMarkdownMap(off);
  assert.match(out, /"look":\{"dots":false,"snap":true\}/);
  const back = fromMarkdownMap(out, "x");
  assert.equal(back.look?.dots, false);
  assert.equal(back.look?.snap, true);
  assert.equal(toMarkdownMap(setLook(back, { dots: undefined, snap: undefined })), toMarkdownMap(d));
});

test("snap: the edge a node's alignment names lands on the grid; unset alignment follows the parent's side", async () => {
  const { snapX } = await import("../src/organiser/layout/index.ts");
  const d = fromMarkdownMap("# R\n\n- right ^r\n- left ^l\n", "x");
  d.nodes[d.rootId]!.x = 0; d.nodes["r"]!.x = 200; d.nodes["l"]!.x = -200;
  // a child to the right lines up by its left edge: centre 130, width 100 → left edge 80 → 72
  assert.equal(snapX(d, "r", 100, 130, 24), 72 + 50);
  // a child to the left lines up by its right edge: centre -130 → right edge -80 → -72
  assert.equal(snapX(d, "l", 100, -130, 24), -72 - 50);
  // the root, and centred text, snap by the centre
  assert.equal(snapX(d, d.rootId, 100, 130, 24), 120);
  d.nodes["r"]!.align = "center";
  assert.equal(snapX(d, "r", 100, 130, 24), 120);
  d.nodes["r"]!.align = "right";
  // right edge 180 → 7.5 cells rounds up → 192
  assert.equal(snapX(d, "r", 100, 130, 24), 192 - 50);
});

test("markdown: a layout block quoted inside fenced code is not read as the map's own", () => {
  // A note that documents the format: the real block comes first, the example after it, inside a fence.
  const note = [
    "# R",
    "",
    "- one ^n1",
    "- two ^n2",
    "",
    "%%ideascape",
    '{"v":1,"pos":{"n1":[10,20]}}',
    "%%",
    "",
    "Written out, a map ends like this:",
    "",
    "```markdown",
    "%%ideascape",
    '{"v":1,"pos":{"n1":[999,999]}}',
    "%%",
    "```",
    "",
  ].join("\n");
  const d = fromMarkdownMap(note, "x");
  assert.equal(d.nodes["n1"]!.x, 10, "the map's own positions win over the quoted example");
  assert.equal(d.nodes["n1"]!.y, 20);
  // Writing it back leaves the fenced example exactly where it was.
  const out = toMarkdownMap(d);
  assert.match(out, /```markdown\n%%ideascape\n\{"v":1,"pos":\{"n1":\[999,999\]\}\}\n%%\n```/);
  assert.equal((out.match(/%%ideascape/g) ?? []).length, 2, "one real block, one still quoted");
});

test("markdown: a stray code fence inside a comment does not hide the map's layout block", () => {
  // The fence never closes. Read as code it would swallow the note's end, layout block and all.
  const note = [
    "# R",
    "",
    "- one ^n1",
    "",
    "%%",
    "a note to self with a stray ``` in it",
    "%%",
    "",
    "%%ideascape",
    '{"v":1,"pos":{"n1":[7,8]}}',
    "%%",
    "",
  ].join("\n");
  const d = fromMarkdownMap(note, "x");
  assert.equal(d.nodes["n1"]!.x, 7, "the layout block is still found after the comment");
  assert.equal(d.nodes["n1"]!.y, 8);
});

test("markdown: an example inside a code fence that is never closed stays an example", () => {
  const note = [
    "# R",
    "",
    "- one ^n1",
    "",
    "%%ideascape",
    '{"v":1,"pos":{"n1":[3,4]}}',
    "%%",
    "",
    "How a map ends, for reference:",
    "",
    "```markdown",
    "%%ideascape",
    '{"v":1,"pos":{"n1":[999,999]}}',
    "%%",
    "",
  ].join("\n");
  const d = fromMarkdownMap(note, "x");
  assert.equal(d.nodes["n1"]!.x, 3, "the real block wins over the one in the unclosed fence");
  assert.equal(d.nodes["n1"]!.y, 4);
});

test("markdown: an inline comment before the layout block does not shift what counts as code", () => {
  const note = [
    "# R",
    "",
    "- one ^n1",
    "",
    "%% a note to self, opened and closed on one line %%",
    "",
    "```markdown",
    "%%ideascape",
    '{"v":1,"pos":{"n1":[999,999]}}',
    "%%",
    "```",
    "",
    "%%ideascape",
    '{"v":1,"pos":{"n1":[5,6]}}',
    "%%",
    "",
  ].join("\n");
  const d = fromMarkdownMap(note, "x");
  assert.equal(d.nodes["n1"]!.x, 5, "the real block after the fenced example still wins");
  assert.equal(d.nodes["n1"]!.y, 6);
});

test("markdown: a note whose only layout block sits after an unclosed fence keeps its positions", () => {
  // Read strictly, the unclosed fence swallows the rest of the note. Dropping the block would lose every
  // position and write a second one on the next save, so the map's own block still counts.
  const note = ["# R", "", "- one ^n1", "", "```", "an example that forgot its closing fence", "", "%%ideascape", '{"v":1,"pos":{"n1":[11,12]}}', "%%", ""].join("\n");
  const d = fromMarkdownMap(note, "x");
  assert.equal(d.nodes["n1"]!.x, 11);
  assert.equal(d.nodes["n1"]!.y, 12);
});

test("markdown: an odd %% marker does not cost the map its layout block", () => {
  const note = ["# R", "", "- one ^n1", "", "%%", "a comment nobody closed", "", "%%ideascape", '{"v":1,"pos":{"n1":[13,14]}}', "%%", ""].join("\n");
  const d = fromMarkdownMap(note, "x");
  assert.equal(d.nodes["n1"]!.x, 13);
  assert.equal(d.nodes["n1"]!.y, 14);
});

test("markdown: a note whose only layout block is a fenced example keeps its own hands off it", () => {
  // Someone's note about the format, opened as a map. The example is theirs: it is not read as this map's
  // geometry, and writing the map back leaves the fence exactly as it was.
  const note = ["# R", "", "- one ^n1", "", "A map ends like this:", "", "```markdown", "%%ideascape", '{"v":1,"pos":{"n1":[999,999]}}', "%%", "```", ""].join("\n");
  const d = fromMarkdownMap(note, "x");
  assert.notEqual(d.nodes["n1"]!.x, 999, "the example's coordinates are not adopted");
  const out = toMarkdownMap(d);
  assert.match(out, /```markdown\n%%ideascape\n\{"v":1,"pos":\{"n1":\[999,999\]\}\}\n%%\n```/, "the example survives the round trip untouched");
});
