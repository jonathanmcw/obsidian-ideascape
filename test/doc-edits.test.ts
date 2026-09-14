import { test } from "node:test";
import assert from "node:assert/strict";
import { fromMarkdownMap, toMarkdownMap, toMarkdownList, fromClipboardText } from "../src/organiser/model/markdown.ts";
import { addChild, emptyDoc, graft, removeNode, reparent, setBranchColor, setPalette, setSide, subtreeIds } from "../src/organiser/model/doc.ts";

test("cut and paste: a branch keeps its checkboxes and numbering, and in the same map its block ids", () => {
  // ⌘X on "Trip", ⌘V under "Later".
  const d = fromMarkdownMap("# R\n\n- Trip ^t\n  - [x] Book flights ^f\n  1. First ^o1\n  2. Second ^o2\n- Later ^l\n", "x");
  const clip = toMarkdownList(d, ["t"]);
  const cutIds = subtreeIds(d, "t");
  const cut = removeNode(d, "t");
  const [pasted, tops] = graft(cut, "l", fromClipboardText(clip)!, undefined, cutIds);
  assert.deepEqual(tops, ["t"], "the cut ids come back");
  assert.equal(pasted.nodes["f"]!.task, "x");
  assert.equal(pasted.nodes["o1"]!.ordered, true);
  assert.equal(pasted.nodes["o2"]!.ordered, true);
  assert.match(toMarkdownMap(pasted), /\n- Later \^l\n  - Trip \^t\n    - \[x\] Book flights \^f\n    1\. First \^o1\n    2\. Second \^o2\n/);
  // A plain paste (a copy, or text from elsewhere) still mints fresh ids and keeps the list kinds.
  const [copied, copyTops] = graft(d, "l", fromClipboardText(clip)!);
  assert.notEqual(copyTops[0], "t");
  const kids = copied.nodes[copyTops[0]!]!.children.map((c) => copied.nodes[c]!);
  assert.deepEqual(kids.map((k) => [k.task, k.ordered]), [["x", undefined], [undefined, true], [undefined, true]]);
});

test("cut and paste: ids the map still has, or a list that does not match the clip, are not reused", () => {
  const d = fromMarkdownMap("# R\n\n- a ^a\n  - a1 ^a1\n- b ^b\n", "x");
  const clip = fromClipboardText(toMarkdownList(d, ["a"]))!;
  const [same] = graft(d, "b", clip, undefined, ["a", "a1"]);
  assert.equal(Object.keys(same.nodes).length, Object.keys(d.nodes).length + 2, "the source is still there, so fresh ids");
  const [short, tops] = graft(removeNode(d, "a"), "b", clip, undefined, ["a"]);
  assert.notEqual(tops[0], "a");
  assert.equal(short.nodes["a"], undefined);
  const [odd, oddTops] = graft(removeNode(d, "a"), "b", clip, undefined, ["__proto__", "a1"]);
  assert.notEqual(oddTops[0], "__proto__");
  assert.equal(Object.getPrototypeOf(odd.nodes), Object.prototype);
});

test("paste under the root: a main branch keeps its side", () => {
  const src = fromMarkdownMap("# R\n\n- a ^a\n- b ^b\n", "x");
  const sided = setSide(src, "a", 1);
  const clip = { ...sided, nodes: { ...sided.nodes }, rootId: sided.rootId };
  const target = fromMarkdownMap("# T\n\n- t ^t\n", "y");
  const [d, tops] = graft(target, target.rootId, clip);
  assert.equal(d.nodes[tops[0]!]!.side, 1);
  const [under] = graft(target, "t", clip);
  assert.ok(Object.values(under.nodes).every((n) => n.side == null), "only a main branch has a side");
});

test("drag: a main branch moved among its siblings keeps its colour, and dropping it back changes nothing", () => {
  let d = emptyDoc("m");
  const ids: string[] = [];
  for (const t of ["Lisbon", "Porto", "Faro"]) { const [n, id] = addChild(d, d.rootId, t); d = n; ids.push(id); }
  d = setBranchColor(setPalette(d, 0, "#aa3366"), ids[1]!, 8);
  const [d2, kid] = addChild(d, ids[1]!, "Ribeira"); d = d2;
  const moved = reparent(d, ids[1]!, d.rootId, 0);
  assert.deepEqual(moved.nodes[d.rootId]!.children, [ids[1], ids[0], ids[2]]);
  assert.equal(moved.nodes[ids[1]!]!.branch, 8, "its own colour stays");
  assert.equal(moved.nodes[kid]!.branch, 8);
  assert.equal(moved.nodes[ids[2]!]!.branch, 2);
  assert.equal(reparent(d, ids[2]!, d.rootId, 2), d, "dropped back in its own place: the same doc, so no undo step");
  // Joining the root from deeper down picks a free colour, not counting its own.
  const [d3, deep] = addChild(d, ids[0]!, "Alfama");
  const promoted = reparent(d3, deep, d3.rootId);
  assert.equal(promoted.nodes[deep]!.branch, 1, "a branch joining the root takes a colour no other main branch wears");
  // Moving under another parent takes that branch's colour.
  assert.equal(reparent(d, kid, ids[2]!).nodes[kid]!.branch, 2);
});

test("paste under the root: each pasted main branch takes its own colour; under a branch they wear that branch's", () => {
  // branchFor once ran once per graft, so every pasted main branch shared one colour.
  const d = fromMarkdownMap("# R\n\n- a ^a\n- b ^b\n", "x");
  const clip = fromClipboardText("- one\n  - one.1\n- two\n- three\n")!;
  const [under, tops] = graft(d, d.rootId, clip);
  assert.deepEqual(tops.map((t) => under.nodes[t]!.branch), [2, 3, 4]);
  assert.equal(under.nodes[under.nodes[tops[0]!]!.children[0]!]!.branch, 2, "a child wears its branch's colour");
  const [deeper, kids] = graft(d, "b", clip);
  assert.deepEqual(kids.map((t) => deeper.nodes[t]!.branch), [1, 1, 1]);
});

test("import as a branch: the imported map's free links come along between the copies", async () => {
  const { asBranch } = await import("../src/organiser/model/ingest.ts");
  // Importing a .canvas as a branch once dropped its links.
  const imported = fromMarkdownMap("# Imported\n\n- a ^a\n  - a1 ^a1\n- b ^b\n", "Imported");
  imported.links = [
    { id: "l1", from: "a1", to: "b" },
    { id: "l2", from: "a", to: imported.rootId },
    { id: "l3", from: "b", to: "gone" },
  ];
  const target = fromMarkdownMap("# T\n\n- t ^t\n  - t1 ^t1\n", "T");
  target.links = [{ id: "own", from: "t", to: "t1" }];
  const [d, tops] = graft(target, "t", asBranch(imported));
  const copy = d.nodes[tops[0]!]!; // the imported root, now a branch
  const [a, b] = copy.children.map((c) => d.nodes[c]!);
  const a1 = d.nodes[a!.children[0]!]!;
  assert.deepEqual(
    d.links.map((l) => [l.from, l.to]),
    [["t", "t1"], [a1.id, b!.id], [a!.id, copy.id]],
    "the map's own link stays; the imported ones join the copies; one to a node that isn't there is dropped",
  );
  assert.equal(new Set(d.links.map((l) => l.id)).size, d.links.length, "link ids are unique");
  // A clip whose root is not copied (a paste) drops a link to it.
  const [p] = graft(target, "t", { ...imported, links: [{ id: "x", from: "a", to: imported.rootId }, { id: "y", from: "a1", to: "b" }] });
  assert.deepEqual(p.links.map((l) => `${p.nodes[l.from]!.text}>${p.nodes[l.to]!.text}`).sort(), ["a1>b", "t>t1"]);
});
