import { test } from "node:test";
import assert from "node:assert/strict";
import { fromMarkdownMap, toMarkdownMap } from "../src/organiser/model/markdown.ts";
import { fromJSONCanvas, toJSONCanvas } from "../src/organiser/model/jsoncanvas.ts";
import { addChild, emptyDoc, setLook, setPalette, setSide, walk } from "../src/organiser/model/doc.ts";
import { toMarkdown, toOPML } from "../src/organiser/model/exporters.ts";
import type { IODoc } from "../src/organiser/model/types.ts";

const fields = (d: IODoc) =>
  walk(d, d.rootId).map(({ id, depth }) => {
    const n = d.nodes[id]!;
    return [depth, n.text, n.size, n.task, n.ordered, n.width, n.side, n.align, n.collapsed].map((v) => (v === undefined ? "" : String(v))).join("|");
  });

test("JSON Canvas: heading size, tasks, numbering, width, side and the map's look survive an export and an import", () => {
  // Everything the JSON Canvas writer once left out.
  let d: IODoc = fromMarkdownMap("# R\n\n- #urgent call the bank ^a\n- [ ] ## task ^b\n  1. one ^o1\n  2. [x] two ^o2\n- ### plain heading ^c\n", "x");
  d.nodes["a"]!.width = 320;
  d = setSide(d, "c", -1);
  d = setPalette(setLook(d, { theme: "graphite", layout: "free", dots: false }), 1, "#12ab56");
  const back = fromJSONCanvas(toJSONCanvas(d), "x");
  assert.deepEqual(fields(back), fields(d));
  assert.equal(back.nodes["a"]!.text, "#urgent call the bank", "a #tag keeps its hash");
  assert.deepEqual(back.look, d.look);
  // And on to Markdown, as an imported canvas is saved, with nothing lost on the way.
  assert.deepEqual(fields(fromMarkdownMap(toMarkdownMap(back), "x")), fields(d));
});

test("JSON Canvas: a plain map writes no extra keys; a canvas from elsewhere loses only a real heading marker", () => {
  const plain = JSON.parse(toJSONCanvas(fromMarkdownMap("# R\n\n- a ^a\n", "x"))).ideaOrganiser;
  assert.deepEqual(Object.keys(plain).sort(), ["align", "childOrder", "collapsed", "name", "rootId", "version"]);
  const foreign = JSON.stringify({
    nodes: [
      { id: "h", type: "text", text: "## Heading", x: 0, y: 0, width: 10, height: 10 },
      { id: "t", type: "text", text: "#tag first", x: 0, y: 60, width: 10, height: 10 },
      { id: "s", type: "text", text: "####### seven", x: 0, y: 120, width: 10, height: 10 },
    ],
    edges: [{ id: "e1", fromNode: "h", toNode: "t" }, { id: "e2", fromNode: "h", toNode: "s" }],
  });
  const d = fromJSONCanvas(foreign, "x");
  assert.deepEqual(walk(d, d.rootId).map(({ id }) => d.nodes[id]!.text), ["Heading", "#tag first", "####### seven"]);
  // Values that make no sense are dropped, not applied.
  const junk = JSON.parse(toJSONCanvas(fromMarkdownMap("# R\n\n- a ^a\n", "x")));
  Object.assign(junk.ideaOrganiser, { size: { a: 9 }, task: { a: "xx" }, ordered: "a", width: { a: -5 }, side: { a: 2 }, look: { nodeStyle: "neon" } });
  const j = fromJSONCanvas(JSON.stringify(junk), "x");
  assert.deepEqual([j.nodes["a"]!.size, j.nodes["a"]!.task, j.nodes["a"]!.ordered, j.nodes["a"]!.width, j.nodes["a"]!.side, j.look], [undefined, undefined, undefined, undefined, undefined, undefined]);
});

test("Markdown export: a multi-line node stays one item, and literal markers stay text", () => {
  let d = emptyDoc("Trip");
  d.nodes[d.rootId]!.text = "Trip\n- not an item under the title";
  let a: string;
  [d, a] = addChild(d, d.rootId, "Packing\n- passport\n- charger");
  [d] = addChild(d, d.rootId, "[x] not a task, a literal");
  [d] = addChild(d, a, "# not a heading\nends with ^word");
  const md = toMarkdown(d);
  const back = fromMarkdownMap(md, "Trip");
  const texts = (x: IODoc) => walk(x, x.rootId).slice(1).map(({ id, depth }) => [depth, x.nodes[id]!.text, x.nodes[id]!.task]);
  assert.deepEqual(texts(back), [[1, "Packing\n- passport\n- charger", undefined], [2, "# not a heading\nends with ^word", undefined], [1, "[x] not a task, a literal", undefined]]);
  assert.doesNotMatch(md, /\^[a-z0-9]{6,}/, "no block ids in an export");
});

test("OPML export: control characters are dropped and tabs kept, so the file always parses", () => {
  // A vertical tab and SOH pasted from a PDF.
  const ch = (n: number) => String.fromCharCode(n);
  let d = emptyDoc(`Map${ch(1)}`);
  d.nodes[d.rootId]!.text = "Root";
  [d] = addChild(d, d.rootId, `pasted ${ch(11)} vertical tab and ${ch(1)} SOH${ch(9)}then a tab${ch(13)}${ch(10)}and a lone ${ch(0xd800)} surrogate, but 🚀 stays`);
  const xml = toOPML(d);
  assert.doesNotMatch(xml, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/);
  assert.doesNotMatch(xml, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  assert.match(xml, /text="pasted  vertical tab and  SOH&#9;then a tab&#13;&#10;and a lone  surrogate, but 🚀 stays"/);
  assert.match(xml, /<title>Map<\/title>/);
});

test(".canvas: a named root that is someone's child, or edges that go round, still read as one tree", () => {
  const node = (id: string, y: number) => ({ id, type: "text", text: id, x: 0, y, width: 100, height: 40 });
  const edge = (from: string, to: string) => ({ id: `${from}-${to}`, fromNode: from, toNode: to });
  const childRoot = { nodes: [node("r", 0), node("c", 60)], edges: [edge("r", "c")], ideaOrganiser: { rootId: "c" } };
  const ring = { nodes: [node("a", 0), node("b", 60), node("d", 120)], edges: [edge("a", "b"), edge("b", "d"), edge("d", "a")] };
  for (const [name, canvas] of [["named child root", childRoot], ["ring", ring]] as const) {
    const doc = fromJSONCanvas(JSON.stringify(canvas), name);
    const seen = walk(doc, doc.rootId).map(({ id }) => id);
    assert.equal(doc.nodes[doc.rootId]!.parent, null, `${name}: the root has no parent`);
    assert.equal(new Set(seen).size, seen.length, `${name}: no node is reached twice`);
    assert.equal(seen.length, Object.keys(doc.nodes).length, `${name}: every node is in the tree`);
  }
});
