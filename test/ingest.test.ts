import { test } from "node:test";
import assert from "node:assert/strict";
import { graft, subtreeIds, walk } from "../src/organiser/model/doc.ts";
import { fromClipboardText, fromMarkdownMap } from "../src/organiser/model/markdown.ts";
import { clipboardFragment, droppedLinks, isMapFile, linkName, mapFileFragment, mediaFiles, soundFragment } from "../src/organiser/model/ingest.ts";
import type { IODoc } from "../src/organiser/model/types.ts";

// Layout measures text on a canvas (a read OPML map is laid out); a fixed-width stand-in is enough here.
(globalThis as { document?: unknown }).document = { win: { createEl: () => ({ getContext: () => ({ font: "", measureText: (t: string) => ({ width: t.length * 7 }) }) }) } };
// OPML is read with the browser's DOMParser; Node has none. This one reads the plain nested outlines the tests write.
type El = { tagName: string; attrs: Record<string, string>; children: El[]; textContent: string };
(globalThis as { DOMParser?: unknown }).DOMParser = class {
  parseFromString(src: string) {
    const top: El = { tagName: "#document", attrs: {}, children: [], textContent: "" };
    const stack = [top];
    for (const m of src.matchAll(/<(\/?)([\w-]+)([^>]*?)(\/?)>|([^<]+)/g)) {
      const cur = stack[stack.length - 1]!;
      if (m[5] !== undefined) { cur.textContent += m[5]; continue; }
      if (m[1]) { stack.pop(); continue; }
      const el: El = { tagName: m[2]!, attrs: Object.fromEntries([...m[3]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!])), children: [], textContent: "" };
      cur.children.push(el);
      if (!m[4]) stack.push(el);
    }
    const find = (el: El, tag: string): El | null => el.children.find((c) => c.tagName === tag) ?? el.children.map((c) => find(c, tag)).find(Boolean) ?? null;
    const wrap = (el: El): unknown => ({ ...el, children: el.children.map(wrap), getAttribute: (k: string) => el.attrs[k] ?? null });
    return { querySelector: (q: string) => (q === "parsererror" ? null : q === "head > title" ? find(top, "title") : ((e) => e && wrap(e))(find(top, q))) };
  }
};

// Nothing that arrives from outside may reach Object.prototype.
const KEYS = ["x", "y", "text", "children", "width", "size", "align", "collapsed", "branch", "side", "task", "ordered", "evil"];
const clean = () => {
  const proto = Object.prototype as Record<string, unknown>;
  for (const k of KEYS) assert.equal(proto[k], undefined, `Object.prototype.${k}`);
  assert.equal(({} as Record<string, unknown>).x, undefined);
};
const shape = (d: IODoc, from = d.rootId) => walk(d, from).map(({ depth, id }) => `${depth}:${d.nodes[id]!.text}`);
const target = () => fromMarkdownMap("---\nidea-map: r\n---\n# Trip\n\n- Lisbon ^a\n", "Trip");

test("ingest, clipboard: a list, a heading or plain lines become the nodes they describe — the same nodes the reader made", () => {
  for (const text of ["- Packing\n  - passport\n  - [ ] charger\n- ## Tickets\n", "# Plan\n- one\n- two\n", "milk\n\n  eggs  \nbread\n"]) {
    const clip = clipboardFragment(text)!;
    const [viaIngest, ids] = graft(target(), "a", clip);
    const read = fromClipboardText(text)!;
    const [direct] = graft(target(), "a", read);
    assert.deepEqual(shape(viaIngest), shape(direct));
    assert.deepEqual(ids.map((id) => viaIngest.nodes[id]!.text), read.nodes[read.rootId]!.children.map((c) => read.nodes[c]!.text));
  }
  const [d, [tickets]] = graft(target(), "a", clipboardFragment("- ## Tickets\n- [x] Booked\n")!);
  assert.equal(d.nodes[tickets!]!.size, 2, "a heading keeps its size");
  assert.equal(clipboardFragment("   \n\n"), null);
});

test("ingest, clipboard: a pasted list with a hostile layout block pollutes nothing and keeps its items", () => {
  const text = "- Packing list\n  - passport\n\n%%ideamap\n" + '{"v":1,"size":{"__proto__":2},"collapsed":["__proto__"],"pos":{"__proto__":[1,2]},"width":{"constructor":900}}' + "\n%%\n";
  const clip = clipboardFragment(text)!;
  clean();
  const [d, ids] = graft(target(), "a", clip);
  clean();
  assert.deepEqual(ids.flatMap((id) => subtreeIds(d, id)).map((id) => d.nodes[id]!.text), ["Packing list", "passport"]);
});

test("ingest: a hand-made __proto__ fragment is copied without polluting anything, looping, or keeping a bad value", () => {
  // JSON.parse makes "__proto__" an own key, as a crafted fragment from any reader would have it.
  const nodes = JSON.parse(`{
    "r": { "text": "", "children": ["__proto__", "a", "a", "constructor", "toString"] },
    "__proto__": { "text": "evil", "children": ["r"], "size": 3, "width": 900, "x": "polluted", "task": "x" },
    "a": { "text": "A", "children": ["r", "a", "b"], "task": "xx", "size": 9, "align": "up", "width": -5, "side": 2, "collapsed": "yes", "y": 1e400 },
    "b": { "text": 7, "children": "nope", "ordered": "yes", "align": "right", "side": -1 }
  }`);
  const links = [{ id: "1", from: "a", to: "__proto__" }, { id: "2", from: "a", to: "a" }, { id: "3", from: "b", to: "constructor" }, "junk", null];
  const hostile = { id: "h", name: "h", rootId: "r", nodes, links, createdAt: 0, updatedAt: 0 } as unknown as IODoc;
  const frag = soundFragment(hostile)!;
  clean();
  assert.equal(Object.getPrototypeOf(frag.nodes), Object.prototype);
  assert.ok(Object.keys(frag.nodes).every((id) => /^[A-Za-z0-9-]+$/.test(id)), "a prototype-named id is given a fresh one");
  assert.deepEqual(shape(frag), ["0:", "1:evil", "1:A", "2:"], "each node once; a loop back up and a missing child are left out");
  const evil = frag.nodes[frag.nodes[frag.rootId]!.children[0]!]!;
  assert.deepEqual([evil.size, evil.width, evil.x, evil.task], [3, 900, 0, "x"]);
  const a = frag.nodes[frag.nodes[frag.rootId]!.children[1]!]!;
  assert.deepEqual([a.task, a.size, a.align, a.width, a.side, a.collapsed, a.y], [undefined, undefined, undefined, undefined, undefined, false, 0]);
  const b = frag.nodes[a.children[0]!]!;
  assert.deepEqual([b.text, b.children, b.ordered, b.align, b.side], ["", [], undefined, "right", -1]);
  assert.deepEqual(frag.links.map((l) => `${frag.nodes[l.from]!.text}>${frag.nodes[l.to]!.text}`), ["A>evil"]);
  // And grafted, it lands as an ordinary branch.
  const [d, ids] = graft(target(), "a", frag);
  clean();
  assert.deepEqual(ids.flatMap((id) => subtreeIds(d, id)).map((id) => d.nodes[id]!.text), ["evil", "A", ""]);
  assert.equal(soundFragment({ ...hostile, rootId: "constructor" }), null, "a root the table does not own is no fragment");
  assert.equal(soundFragment({ ...hostile, nodes: "nope" } as unknown as IODoc), null);
});

test("ingest, map file: a dropped .canvas is one branch, named by the file when it has no name of its own", () => {
  const canvas = JSON.stringify({
    nodes: [
      { id: "a", type: "text", text: "Root", x: 0, y: 0, width: 100, height: 40 },
      { id: "b", type: "text", text: "One", x: 200, y: 0, width: 100, height: 40 },
      { id: "c", type: "text", text: "Two", x: 200, y: 80, width: 100, height: 40 },
    ],
    edges: [{ id: "e1", fromNode: "a", toNode: "b" }, { id: "e2", fromNode: "a", toNode: "c" }],
  });
  const { fragment, count } = mapFileFragment("Ideas.canvas", canvas);
  assert.equal(count, 3);
  assert.equal(fragment.name, "Ideas");
  const [d, ids] = graft(target(), "a", fragment);
  assert.deepEqual(shape(d, ids[0]), ["0:Root", "1:One", "1:Two"]);
  assert.throws(() => mapFileFragment("Empty.canvas", '{"nodes":[]}'), /no nodes/);
  assert.throws(() => mapFileFragment("notes.xml", "<not-opml/>"), SyntaxError, "an .xml that is not OPML is read as JSON Canvas, and fails as one");
});

test("ingest, map file: a hostile .canvas pollutes nothing and keeps every node", () => {
  const evil = JSON.stringify({
    nodes: [
      { id: "__proto__", type: "text", text: "N0", x: 0, y: 0 },
      { id: "constructor", type: "text", text: "N1", x: 0, y: 60 },
    ],
    edges: [{ id: "e", fromNode: "__proto__", toNode: "constructor", kind: "child" }],
  }).replace('"nodes"', `"ideaOrganiser":${'{"version":1,"rootId":"__proto__","childOrder":{"__proto__":["constructor"]},"collapsed":["__proto__"],"align":{"__proto__":"right"},"size":{"constructor":3}}'},"nodes"`);
  const { fragment, count } = mapFileFragment("Shared.canvas", evil);
  clean();
  assert.equal(count, 2);
  const [d, ids] = graft(target(), "a", fragment);
  clean();
  assert.deepEqual(shape(d, ids[0]), ["0:N0", "1:N1"]);
});

test("ingest, map file: .opml, and OPML under any name, go to the OPML reader", () => {
  const opml = '<?xml version="1.0"?><opml version="2.0"><head><title>Garden</title></head><body><outline text="Garden"><outline text="Beans"/><outline title="Kale"/></outline></body></opml>';
  for (const name of ["Garden.opml", "Garden.xml", "Garden.canvas"]) {
    const { fragment, count } = mapFileFragment(name, opml);
    assert.equal(count, 3, name);
    const [d, ids] = graft(target(), "a", fragment);
    assert.deepEqual(shape(d, ids[0]), ["0:Garden", "1:Beans", "1:Kale"], name);
  }
});

test("ingest: which dropped files are maps, which are media, and which dropped links count", () => {
  assert.deepEqual(["a.canvas", "b.OPML", "c.xml", "d.md", "e.png", "canvas"].map(isMapFile), [true, true, true, false, false, false]);
  const files = [new File(["x"], "a.png", { type: "image/png" }), new File(["x"], "b.m4a", { type: "audio/mp4" }), new File(["x"], "c.canvas", { type: "" }), new File(["x"], "d.pdf", { type: "application/pdf" })];
  assert.deepEqual(mediaFiles(files).map((f) => f.name), ["a.png", "b.m4a"]);
  assert.deepEqual(droppedLinks(["[[Lisbon]]", "![[map.png]]", "[[Notes/Trip plan|Trip]]", "https://example.com", "[[a\nb]]", "[[]]", "", 5, null]), ["[[Lisbon]]", "![[map.png]]", "[[Notes/Trip plan|Trip]]"]);
  assert.deepEqual(["[[Lisbon]]", "![[map.png]]"].map(linkName), ["Lisbon", "map.png"]);
});
