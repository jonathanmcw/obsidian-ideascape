import { test } from "node:test";
import assert from "node:assert/strict";
import { fromMarkdownMap } from "../src/organiser/model/markdown.ts";
import { addChild, addLink, moveTo, ordinalOf, setCollapsed, setOrdered, setSide, setText } from "../src/organiser/model/doc.ts";
import { frameFor, keepBoxes } from "../src/organiser/layout/index.ts";
import { metricsFor, nodeMetrics } from "../src/organiser/layout/measure.ts";
import { arrowMove, type ArrowDir } from "../src/organiser/layout/nav.ts";
import { columnUnder, dropTargetFor, hitTest } from "../src/organiser/layout/drop.ts";
import type { IODoc, LayoutKind } from "../src/organiser/model/types.ts";

// Layout measures text on a canvas; a fixed-width stand-in is enough here.
(globalThis as { document?: unknown }).document = { win: { createEl: () => ({ getContext: () => ({ font: "", measureText: (t: string) => ({ width: t.length * 7 }) }) }) } };

// Tidy map: Lisbon and Porto fan left of the root, Madrid and Seville right.
const TRIP = "---\nidea-map: r\n---\n# Trip\n\n- Lisbon ^a\n  - Alfama ^a1\n  - Belem ^a2\n- Porto ^b\n  - Ribeira ^b1\n- Madrid ^c\n  - Prado ^c1\n  - Retiro ^c2\n- Seville ^d\n";
const trip = () => fromMarkdownMap(TRIP, "Trip");

/** Where each arrow lands from `from`, as the selected node's text, "fold x" or "stays". */
const arrows = (d: IODoc, kind: LayoutKind, from: string, extend = false) => {
  const frame = frameFor(d, kind);
  const out: Record<string, string> = {};
  for (const dir of ["left", "right", "up", "down"] as ArrowDir[]) {
    const m = arrowMove(d, frame, from, dir, extend);
    out[dir] = !m ? "stays" : "toggle" in m ? `fold ${d.nodes[m.toggle]!.text}` : d.nodes[m.select]!.text;
  }
  return out;
};

test("arrows, Map: ← and → follow the tree — towards the root is the parent, away from it the nearest child", () => {
  const d = trip();
  assert.deepEqual(arrows(d, "map", "r"), { left: "Lisbon", right: "Madrid", up: "stays", down: "stays" });
  // Lisbon fans left: → goes back to the root, ← into its branch.
  assert.equal(arrows(d, "map", "a").right, "Trip");
  assert.equal(arrows(d, "map", "a").left, "Alfama");
  assert.equal(arrows(d, "map", "c").left, "Trip");
  assert.equal(arrows(d, "map", "c").right, "Prado");
  // A leaf with no child that way: whatever lies inside the cone, else nothing.
  assert.equal(arrows(d, "map", "d").right, "Retiro");
  assert.equal(arrows(d, "map", "b1").left, "stays");
});

test("arrows, Map: ↑ and ↓ step through siblings, then to what is visually there", () => {
  const d = trip();
  assert.equal(arrows(d, "map", "a1").down, "Belem");
  assert.equal(arrows(d, "map", "a2").up, "Alfama");
  // Belem is the last of its siblings: below it sits Porto's child, in the same column.
  assert.equal(arrows(d, "map", "a2").down, "Ribeira");
  assert.equal(arrows(d, "map", "b1").up, "Belem");
  assert.equal(arrows(d, "map", "b").up, "Lisbon");
  assert.equal(arrows(d, "map", "c1").up, "stays", "nothing above the top of the map");
  // ⇧ answers the same node; the caller adds it to the selection.
  assert.deepEqual(arrowMove(d, frameFor(d, "map"), "a1", "down", true), { select: "a2" });
});

test("arrows, free layout: a sibling far off to the side is not the next one down; what is under the node is", () => {
  let d: IODoc = trip();
  // Alfama at the top, Belem far out to the right, Porto's Ribeira just under Alfama.
  d = moveTo(d, "a1", -600, 0);
  d = moveTo(d, "a2", 600, 60);
  d = moveTo(d, "b1", -600, 80);
  assert.equal(arrows(d, "canvas", "a1").down, "Ribeira");
});

test("arrows, Outline: ↑ and ↓ walk the visible rows; ← folds or goes to the parent; → unfolds or goes to the first child", () => {
  const d = trip();
  assert.equal(arrows(d, "outline", "a1").down, "Belem");
  assert.equal(arrows(d, "outline", "a2").down, "Porto");
  assert.equal(arrows(d, "outline", "r").up, "stays");
  assert.equal(arrows(d, "outline", "d").down, "stays");
  assert.deepEqual(arrows(d, "outline", "a"), { left: "fold Lisbon", right: "Alfama", up: "Trip", down: "Alfama" });
  assert.equal(arrows(d, "outline", "a1").left, "Lisbon");
  assert.equal(arrows(d, "outline", "a1").right, "stays");
  const folded = setCollapsed(d, "a", true);
  assert.deepEqual(arrows(folded, "outline", "a"), { left: "Trip", right: "fold Lisbon", up: "Trip", down: "Porto" });
  // ⇧↑/↓ extend a row at a time; ⇧←/→ mean nothing in a list.
  assert.deepEqual(arrows(d, "outline", "a1", true), { left: "stays", right: "stays", up: "Lisbon", down: "Belem" });
});

test("drop, Map: over a node the dragged branch becomes its child", () => {
  const d = trip();
  const frame = frameFor(d, "map");
  const retiro = frame.boxes["c2"]!;
  assert.equal(hitTest(frame, retiro.x, retiro.y, new Set()), "c2");
  assert.deepEqual(pick(dropTargetFor(d, frame, retiro.x, retiro.y, ["b1"])), { parent: "c2", index: 0 });
  // Onto Madrid: among its children by height — here between Prado and Retiro.
  const madrid = frame.boxes["c"]!;
  assert.deepEqual(pick(dropTargetFor(d, frame, madrid.x, madrid.y + 10, ["b1"])), { parent: "c", index: 1 });
});

test("drop, Map: in the empty space beside a column of siblings it is a reorder among them", () => {
  const d = trip();
  const frame = frameFor(d, "map");
  const alfama = frame.boxes["a1"]!;
  const belem = frame.boxes["a2"]!;
  // Belem dragged above Alfama, clear of any box: first among Lisbon's children.
  const above = alfama.y - alfama.h / 2 - 10;
  assert.equal(hitTest(frame, alfama.x, above, new Set(["a2"])), null);
  assert.deepEqual(pick(dropTargetFor(d, frame, alfama.x, above, ["a2"])), { parent: "a", index: 0 });
  // Alfama dragged below Belem, between Belem and Porto's child: still Lisbon's column, last.
  const below = belem.y + belem.h / 2 + 7;
  assert.equal(columnUnder(d, frame, belem.x, below, new Set(["a1"]), "a"), "a");
  assert.deepEqual(pick(dropTargetFor(d, frame, belem.x, below, ["a1"])), { parent: "a", index: 1 });
});

test("drop, Map: the root takes a branch on the side the pointer is on, an empty side included", () => {
  const d = trip();
  const frame = frameFor(d, "map");
  const root = frame.boxes["r"]!;
  // Seville (right) dropped on the root's left half, level with the gap before Porto.
  const t = dropTargetFor(d, frame, root.x - 10, root.y, ["d"]);
  assert.deepEqual(pick(t), { parent: "r", index: 1, side: -1 });
  // Every branch on the right: the empty left side is a column of its own.
  let right: IODoc = fromMarkdownMap("---\nidea-map: r\n---\n# Trip\n\n- Lisbon ^a\n- Porto ^b\n", "Trip");
  right = setSide(setSide(right, "a", 1), "b", 1);
  const rf = frameFor(right, "map");
  const rb = rf.boxes["r"]!;
  const x = rb.x - rb.w / 2 - 100;
  assert.equal(hitTest(rf, x, rb.y, new Set()), null);
  assert.deepEqual(pick(dropTargetFor(right, rf, x, rb.y, ["b"])), { parent: "r", index: 1, side: -1 });
});

test("drop: never into the dragged branch itself; the Outline and free layout have no columns", () => {
  const d = trip();
  const frame = frameFor(d, "map");
  const alfama = frame.boxes["a1"]!;
  assert.equal(dropTargetFor(d, frame, alfama.x, alfama.y, ["a"]), null, "Lisbon onto its own child");
  const outline = frameFor(d, "outline");
  const lisbon = outline.boxes["a"]!;
  assert.deepEqual(pick(dropTargetFor(d, outline, lisbon.x + 5, lisbon.y, ["d"])), { parent: "a", index: 0 });
  assert.equal(columnUnder(d, outline, lisbon.x + 5, lisbon.y + 200, new Set(["d"]), "r"), null);
  assert.equal(columnUnder(d, frameFor(d, "canvas"), 0, 0, new Set(), null), null);
});

/** The parts of a drop target that say where the node goes (the slot line's coordinates are drawing). */
function pick(t: ReturnType<typeof dropTargetFor>) {
  if (!t) return null;
  return { parent: t.parent, index: t.index, ...(t.side ? { side: t.side } : {}) };
}

test("layout: typing into a node keeps every box that did not move as the same object, and the frame is what a fresh layout gives", () => {
  const d = trip();
  const before = frameFor(d, "map");
  // A leaf grows: only its own box changes.
  const typed = setText(d, "a2", "Belem and the tower");
  const kept = keepBoxes(before, frameFor(typed, "map"));
  assert.deepEqual(kept, frameFor(typed, "map"), "the same geometry as laying it out afresh");
  assert.equal(kept.order, before.order, "an unchanged order is the same array");
  assert.deepEqual(Object.keys(kept.boxes).filter((id) => kept.boxes[id] !== before.boxes[id]), ["a2"]);
  // A parent grows: its children move out with its edge; its siblings stay.
  const parent = setText(d, "c", "Madrid in the spring");
  const keptParent = keepBoxes(before, frameFor(parent, "map"));
  assert.deepEqual(Object.keys(keptParent.boxes).filter((id) => keptParent.boxes[id] !== before.boxes[id]).sort(), ["c", "c1", "c2"]);
  // A node added: a new order. Another shape: nothing to keep.
  const [added] = addChild(d, "d", "Triana");
  assert.notEqual(keepBoxes(before, frameFor(added, "map")).order, before.order);
  const outline = frameFor(d, "outline");
  assert.equal(keepBoxes(before, outline), outline);
});

test("layout: a node measured from its own data and its place is measured as the document measures it", () => {
  let d: IODoc = trip();
  d = setOrdered(setOrdered(d, "a1", true), "a2", true);
  d = addLink(d, "a1", "d");
  for (const kind of ["map", "outline", "canvas"] as LayoutKind[]) {
    for (const id of Object.keys(d.nodes)) {
      const links = d.links.filter((l) => l.from === id || l.to === id).length;
      assert.deepEqual(nodeMetrics(d.nodes[id]!, { isRoot: id === d.rootId, ordinal: ordinalOf(d, id), linked: links > 0 }, kind), metricsFor(d, id, kind), `${kind} ${id}`);
    }
  }
});
