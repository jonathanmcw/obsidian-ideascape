import { test } from "node:test";
import assert from "node:assert/strict";
import { fromMarkdownMap } from "../src/organiser/model/markdown.ts";
import { addChild, addLink, emptyDoc, moveTo, ordinalOf, rootSides, setCollapsed, setOrdered, setSide, setText } from "../src/organiser/model/doc.ts";
import { frameFor, keepBoxes, mapLayout } from "../src/organiser/layout/index.ts";
import { MAX_ROW_TEXT_W, ROW_LEAD, metricsFor, nodeMetrics, setOutlineWidths } from "../src/organiser/layout/measure.ts";
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

test("layout, Outline: indentation never pushes a phone-width row past the right margin", () => {
  const width = 360;
  setOutlineWidths(width - ROW_LEAD - 40, width);
  try {
    let doc: IODoc = trip();
    let parent = "a1";
    for (let depth = 0; depth < 20; depth++) {
      const [next, child] = addChild(doc, parent, `Deep ${depth}: a row long enough to wrap onto a second line on a phone`);
      doc = next;
      parent = child;
    }
    const frame = frameFor(doc, "outline");
    for (const box of Object.values(frame.boxes)) {
      assert.ok(box.x + box.w <= width, `depth ${box.depth} ends at ${box.x + box.w}px`);
    }
  } finally {
    setOutlineWidths(MAX_ROW_TEXT_W, 0);
  }
});

test("drop, Outline: a row's edges place a branch between rows, its middle makes it a child", () => {
  const d = trip();
  const f = frameFor(d, "outline");
  const pick = (t: ReturnType<typeof dropTargetFor>) => (t ? { parent: t.parent, index: t.index } : null);
  const row = (id: string) => {
    const b = f.boxes[id]!;
    return { x: b.x + 20, top: b.y - b.h / 2, bottom: b.y + b.h / 2, mid: b.y };
  };

  // Porto sits under Lisbon's branch. Dragging Seville over Porto's top edge puts it above Porto, among the root's
  // children — not inside Porto, which is what every drop used to mean.
  const porto = row("b");
  // Indices count the children with the dragged branch taken out, as every slot in this file does.
  assert.deepEqual(pick(dropTargetFor(d, f, porto.x, porto.top + 1, ["d"])), { parent: "r", index: 1 }, "the top edge goes above the row");
  assert.deepEqual(pick(dropTargetFor(d, f, porto.x, porto.mid, ["d"])), { parent: "b", index: 0 }, "the middle still makes a child");

  // A leaf's bottom edge is the place after it among its siblings.
  const belem = row("a2");
  assert.deepEqual(pick(dropTargetFor(d, f, belem.x, belem.bottom - 1, ["d"])), { parent: "a", index: 2 }, "the bottom edge goes below the row");

  // Under an open row, the place below it is its first child's place: the line a person sees is that same line.
  const lisbon = row("a");
  assert.deepEqual(pick(dropTargetFor(d, f, lisbon.x, lisbon.bottom - 1, ["d"])), { parent: "a", index: 0 }, "below an open row is inside it, above its first child");

  // Folded, it has no children on screen, so below it means below it.
  const folded = setCollapsed(d, "a", true);
  const ff = frameFor(folded, "outline");
  const fb = ff.boxes["a"]!;
  assert.deepEqual(pick(dropTargetFor(folded, ff, fb.x + 20, fb.y + fb.h / 2 - 1, ["d"])), { parent: "r", index: 1 }, "below a folded row is after it");
});

test("drop, Outline: the bands are big enough for a finger, and never eat a short row whole", () => {
  const d = trip();
  const f = frameFor(d, "outline");
  const b = f.boxes["b"]!;
  const at = (y: number) => dropTargetFor(d, f, b.x + 20, y, ["d"]);
  // A middle band survives on the shortest row the outline draws, so "make a child" is always reachable.
  assert.equal(at(b.y)!.parent, "b");
  // And each edge band is at least 7px, which is what a finger can hit between rows 4px apart.
  const top = b.y - b.h / 2;
  assert.equal(at(top + 6)!.parent, "r", "6px into the row is still between the rows");
  assert.equal(at(top + 1)!.parent, "r");
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

// A person who drags branches to one side of the root means it: the tidy map must not even the sides up again, and
// a branch added later must not push an existing one across to balance the count.
test("map: sides a person chose are kept, however lopsided, and later branches fill the shorter side", () => {
  let d = emptyDoc("Root");
  for (const t of ["a", "b", "c", "d"]) [d] = addChild(d, d.rootId, t);
  const kids = d.nodes[d.rootId].children;
  // Untouched, the map splits them evenly.
  const even = rootSides(d);
  assert.deepEqual(kids.map((k) => even[k]), [-1, -1, 1, 1]);

  // Drag the third to the left: that one is chosen, and the others are frozen where they already were.
  d = setSide(d, kids[2], -1);
  const after = rootSides(d);
  assert.deepEqual(kids.map((k) => after[k]), [-1, -1, -1, 1], "three left, one right — and it stays that way");

  // A fourth dragged left leaves the right side empty, which is allowed.
  d = setSide(d, kids[3], -1);
  assert.deepEqual(d.nodes[d.rootId].children.map((k) => rootSides(d)[k]), [-1, -1, -1, -1]);

  // A branch added now fills the shorter side rather than moving any of the chosen ones.
  const [d2, added] = addChild(d, d.rootId, "e");
  const sides = rootSides(d2);
  assert.equal(sides[added], 1, "the new branch goes to the empty side");
  assert.deepEqual(kids.map((k) => sides[k]), [-1, -1, -1, -1], "nothing a person chose moved");
});

test("map: a chosen side survives the layout — the boxes really are on that side of the root", () => {
  let d = emptyDoc("Root");
  for (const t of ["a", "b", "c", "d"]) [d] = addChild(d, d.rootId, t);
  const kids = d.nodes[d.rootId].children;
  d = setSide(d, kids[2], -1);
  d = setSide(d, kids[3], -1);
  const frame = mapLayout(d);
  const rootX = frame.boxes[d.rootId].x;
  for (const k of kids) assert.ok(frame.boxes[k].x < rootX, `${d.nodes[k].text} should be drawn left of the root`);
  assert.deepEqual(kids.map((k) => frame.boxes[k].dir), [-1, -1, -1, -1]);
});
