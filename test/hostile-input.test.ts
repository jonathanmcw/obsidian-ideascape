import { test } from "node:test";
import assert from "node:assert/strict";
import { fromMarkdownMap, toMarkdownMap, fromClipboardText } from "../src/organiser/model/markdown.ts";
import { fromJSONCanvas } from "../src/organiser/model/jsoncanvas.ts";
import { makeNode, walk } from "../src/organiser/model/doc.ts";
import type { IODoc } from "../src/organiser/model/types.ts";

// A shared map, a pasted list or a dropped .canvas is untrusted: none of it may reach Object.prototype.
const KEYS = ["x", "y", "width", "size", "align", "collapsed", "branch", "side"];
const clean = () => {
  const proto = Object.prototype as Record<string, unknown>;
  const ctor = Object as unknown as Record<string, unknown>;
  for (const k of KEYS) assert.equal(proto[k], undefined, `Object.prototype.${k}`);
  for (const k of KEYS) assert.equal(ctor[k], undefined, `Object.${k}`);
};
const tree = (d: IODoc) => walk(d, d.rootId).map(({ id, depth }) => `${depth}:${id}:${d.nodes[id]!.text}`);

const LIST = "---\nidea-map: r1\n---\n# Shared map\n\n- Lisbon ^a1\n  - Alfama ^a2\n- Porto ^b1\n";
const block = (g: unknown) => `\n%%ideamap\n${JSON.stringify(g)}\n%%\n`;
const HOSTILE: unknown[] = [
  // JSON.parse makes "__proto__" an own key, so these reach the loops exactly as a crafted file would.
  JSON.parse('{"v":1,"pos":{"a1":[0,0],"__proto__":["polluted",{"any":"json"}],"constructor":[1,2]},"width":{"__proto__":900,"constructor":900},"size":{"__proto__":3,"constructor":2},"align":{"__proto__":"right","constructor":"left"},"side":{"__proto__":1},"branch":{"__proto__":4,"constructor":5}}'),
  { v: 1, collapsed: ["__proto__", "constructor", "toString"] },
  { v: 1, links: [["__proto__", "a1"], ["constructor", "toString"], 5, null, "ab"] },
  { v: 1, pos: 5, collapsed: 5, links: "ab", align: [], width: null, look: "x" },
  { v: 1, pos: { a1: "zz", a2: [1e308, 1e308], b1: [NaN, 0], r1: [null, null] }, branch: { a1: "x", b1: -1 } },
  [],
  "just a string",
];

test("hostile geometry: __proto__ and constructor keys pollute nothing, never throw, and leave the tree as it is", () => {
  const plain = tree(fromMarkdownMap(LIST, "Shared map"));
  for (const g of HOSTILE) {
    const d = fromMarkdownMap(LIST + block(g), "Shared map");
    clean();
    assert.deepEqual(tree(d), plain);
    // A clean map read afterwards picks nothing up either.
    const other = fromMarkdownMap("# Groceries\n\n- Milk ^m1\n", "x");
    const m1 = other.nodes["m1"]!;
    assert.equal(m1.size, undefined);
    assert.equal(m1.width, undefined);
    assert.equal(m1.align, undefined);
    assert.doesNotMatch(toMarkdownMap(other), /###|"width"|"align":\{"/);
  }
});

test("hostile geometry: positions must be two finite numbers and branch colours small whole numbers", () => {
  const d = fromMarkdownMap(LIST + block({ v: 1, pos: { r1: [0, 0], a1: "zz", a2: [1e308, 1], b1: [10, 20] }, branch: { a1: "red", b1: 2.5 } }), "Shared map");
  assert.equal(d.nodes["b1"]!.x, 10);
  assert.equal(d.nodes["a1"]!.x, 0, "a string is not a position");
  assert.equal(d.nodes["a2"]!.x, 0, "a coordinate out past any real map is not a position");
  assert.equal(d.needsLayout, true);
  assert.equal(d.nodes["a1"]!.branch, 0, "the default colour stays");
  assert.equal(d.nodes["b1"]!.branch, 1);
  assert.ok(toMarkdownMap(d).includes('"a1":[0,0]'), "nothing unusable is written back");
});

test("hostile geometry: an item whose id is a prototype name is still an ordinary node", () => {
  const d = fromMarkdownMap("# R\n\n- one ^constructor\n- two ^toString\n" + block({ v: 1, pos: { constructor: [5, 6] }, collapsed: ["toString"] }), "x");
  clean();
  assert.equal(d.nodes["constructor"]!.x, 5);
  assert.equal(d.nodes["toString"]!.collapsed, false, "a node without children does not fold");
  assert.equal(d.needsLayout, true, "toString has no position, whatever Object.prototype has");
});

test("hostile clipboard: a pasted list with a layout block pollutes nothing", () => {
  const clip = fromClipboardText("- Packing list\n  - passport\n" + block(JSON.parse('{"v":1,"size":{"__proto__":2},"collapsed":["__proto__"],"pos":{"__proto__":[1,2]}}')))!;
  clean();
  const top = clip.nodes[clip.rootId]!.children.map((c) => clip.nodes[c]!.text);
  assert.deepEqual(top, ["Packing list"]);
});

test("hostile JSON Canvas: prototype-named ids and extension keys pollute nothing and keep every node", () => {
  const canvas = (ext: unknown, ids = ["a", "b"]) =>
    JSON.stringify({
      nodes: ids.map((id, i) => ({ id, type: "text", text: `N${i}`, x: 0, y: i * 60, width: 10, height: 10 })),
      edges: [{ id: "e", fromNode: ids[0], toNode: ids[1], kind: "child" }],
      ideaOrganiser: ext,
    });
  const shapeOf = (d: IODoc) => walk(d, d.rootId).map(({ depth, id }) => `${depth}:${d.nodes[id]!.text}`);
  const plain = shapeOf(fromJSONCanvas(canvas({ version: 1, rootId: "a", childOrder: {}, collapsed: [] })));
  const evil = [
    JSON.parse('{"version":1,"rootId":"__proto__","childOrder":{"__proto__":["b"],"constructor":["a"]},"collapsed":["__proto__","constructor"],"align":{"__proto__":"center","constructor":"left"},"name":5}'),
    { version: 1, childOrder: 5, collapsed: "ab", align: [] },
    "nope",
  ];
  for (const ext of evil) {
    const d = fromJSONCanvas(canvas(ext));
    clean();
    assert.deepEqual(shapeOf(d), plain);
    assert.equal(typeof d.name, "string");
  }
  // Node ids that are prototype names, or not block ids at all, get fresh ids; edges still find them.
  const d = fromJSONCanvas(canvas({ version: 1, rootId: "__proto__", childOrder: {}, collapsed: ["constructor"] }, ["__proto__", "constructor"]));
  clean();
  assert.deepEqual(shapeOf(d), ["0:N0", "1:N1"]);
  assert.ok(Object.keys(d.nodes).every((id) => /^[a-z0-9]+$/.test(id) && id !== "__proto__"));
  assert.equal(Object.getPrototypeOf(d.nodes), Object.prototype);
  const odd = fromJSONCanvas(canvas({ version: 1, rootId: "node_1", childOrder: { node_1: ["node 2"] }, collapsed: [] }, ["node_1", "node 2"]));
  assert.deepEqual(shapeOf(odd), ["0:N0", "1:N1"]);
  assert.ok(Object.keys(odd.nodes).every((id) => /^[A-Za-z0-9-]+$/.test(id)), "every id can be written as a block id");
});

test("makeNode takes only the fields it is given, never inherited ones", () => {
  const proto = Object.prototype as Record<string, unknown>;
  try {
    proto.x = "polluted"; proto.width = 900; proto.size = 3; proto.align = "right"; proto.task = "x";
    const n = makeNode({ text: "a" });
    assert.equal(Object.hasOwn(n, "width"), false);
    assert.equal(Object.hasOwn(n, "size"), false);
    assert.equal(Object.hasOwn(n, "align"), false);
    assert.equal(Object.hasOwn(n, "task"), false);
    assert.equal(n.x, 0);
  } finally {
    for (const k of ["x", "width", "size", "align", "task"]) delete proto[k];
  }
});
