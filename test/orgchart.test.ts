import { test } from "node:test";
import assert from "node:assert/strict";
import { fromMarkdownMap, toMarkdownMap } from "../src/organiser/model/markdown.ts";
import { fromJSONCanvas, toJSONCanvas } from "../src/organiser/model/jsoncanvas.ts";
import { addChild, emptyDoc, lookFromFile, moveBy, setCollapsed, setLook, setSize, setWidth, walk } from "../src/organiser/model/doc.ts";
import { seedCanvasPositions } from "../src/organiser/model/store.ts";
import { arrangementOf, freeArrangement, nextLayout, shownLayout, tidied, withLayout } from "../src/organiser/layout/arrange.ts";
import { MAP_LAYOUTS, ORG_CHART } from "../src/organiser/model/types.ts";
import { frameFor, kindFor, treePath, ORG_ROW_GAP, ORG_STACK_MIN, type Box, type Frame } from "../src/organiser/layout/index.ts";
import { arrowMove, type ArrowDir } from "../src/organiser/layout/nav.ts";
import { columnUnder, dropTargetFor, hitTest } from "../src/organiser/layout/drop.ts";
import type { IODoc, NodeId } from "../src/organiser/model/types.ts";

// Layout measures text on a canvas; a fixed-width stand-in is enough here.
(globalThis as { document?: unknown }).document = { win: { createEl: () => ({ getContext: () => ({ font: "", measureText: (t: string) => ({ width: t.length * 7 }) }) }) } };

// Design and Build spread along a row; Ship's four leaves stack under it.
const TEAM = "---\nidea-map: r\n---\n# Team\n\n- Design ^a\n  - Ana ^a1\n  - Ben ^a2\n- Build ^b\n  - Cy ^b1\n- Ship ^c\n  - Dee ^c1\n  - Eve ^c2\n  - Fay ^c3\n  - Gus ^c4\n";
const team = () => fromMarkdownMap(TEAM, "Team");

const top = (b: Box) => b.y - b.h / 2;
const bottom = (b: Box) => b.y + b.h / 2;
const left = (b: Box) => b.x - b.w / 2;
const right = (b: Box) => b.x + b.w / 2;

/** A tree of about `size` nodes with mixed widths, heading sizes, hand-set widths, folds and runs of leaves. */
function randomTree(size: number, seed: number): IODoc {
  let s = seed;
  // mulberry32: the same tree for the same seed, every run.
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const words = ["a", "idea", "longer label", "a label that is long enough to wrap onto a second line", "中文的想法", "x"];
  let d = emptyDoc("Random");
  const ids: NodeId[] = [d.rootId];
  while (ids.length < size) {
    const parent = ids[Math.floor(rand() * rand() * ids.length)]!;
    const runs = rand() < 0.15 ? 4 + Math.floor(rand() * 3) : 1;
    for (let i = 0; i < runs && ids.length < size; i++) {
      let id: NodeId;
      [d, id] = addChild(d, parent, words[Math.floor(rand() * words.length)]!);
      if (rand() < 0.1) d = setSize(d, id, (1 + Math.floor(rand() * 3)) as 1 | 2 | 3);
      if (rand() < 0.08) d = setWidth(d, id, 120 + Math.floor(rand() * 300));
      ids.push(id);
    }
  }
  // Folds deep in the tree, so most of it stays on show.
  for (const { id, depth } of walk(d, d.rootId)) if (depth > 2 && rand() < 0.05) d = setCollapsed(d, id, true);
  // A few runs of leaves under leaves on show, so there are always stacks to check.
  const shown = walk(d, d.rootId, true).map((w) => w.id);
  for (const parent of shown.filter((id) => !d.nodes[id]!.children.length).slice(0, 4)) {
    for (let i = 0; i < 4 + Math.floor(rand() * 3); i++) [d] = addChild(d, parent, words[Math.floor(rand() * words.length)]!);
  }
  return d;
}

/** Every node whose children are laid out, with the boxes of those children. */
function families(d: IODoc, f: Frame) {
  return f.order.flatMap((id) => {
    const n = d.nodes[id]!;
    const kids = n.collapsed ? [] : n.children.map((c) => f.boxes[c]!).filter(Boolean);
    return kids.length ? [{ id, box: f.boxes[id]!, kids }] : [];
  });
}

/* ---------------------------------------------------------------- geometry */

test("org chart: the root is centred at the top and each level is a row further down", () => {
  const d = team();
  const f = frameFor(d, "org");
  assert.equal(f.shape, "org");
  const root = f.boxes["r"]!;
  assert.deepEqual([root.x, root.y], [0, 0]);
  assert.deepEqual(["a", "b", "c"].map((id) => top(f.boxes[id]!)), Array(3).fill(bottom(root) + ORG_ROW_GAP), "one row, top-aligned, a row gap below the root");
  assert.ok(left(f.boxes["a"]!) < left(f.boxes["b"]!) && left(f.boxes["b"]!) < left(f.boxes["c"]!), "in child order, left to right");
  assert.equal(top(f.boxes["a1"]!), top(f.boxes["b1"]!));
  assert.equal(top(f.boxes["a1"]!), top(f.boxes["c1"]!), "a stack starts on the row its leaves belong to");
  assert.equal(kindFor("map", "org"), "org");
  assert.equal(kindFor("outline", "org"), "outline");
});

test("org chart: on a random tree of 200 nodes rows go down by depth, nothing overlaps, and parents sit centred over their children", () => {
  for (const seed of [1, 7, 42]) {
    const d = randomTree(200, seed);
    const f = frameFor(d, "org");
    const ids = f.order;
    assert.equal(new Set(ids).size, walk(d, d.rootId, true).length, "every visible node once");
    assert.ok(ids.length > 120, `seed ${seed}: most of the tree is on show (${ids.length})`);
    // No two boxes overlap.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = f.boxes[ids[i]!]!;
        const b = f.boxes[ids[j]!]!;
        const apart = right(a) <= left(b) || right(b) <= left(a) || bottom(a) <= top(b) || bottom(b) <= top(a);
        assert.ok(apart, `seed ${seed}: ${ids[i]} and ${ids[j]} overlap`);
      }
    }
    // Rows: every node spread along a row starts where every other node of its depth does, below the row above.
    const rowTop = new Map<number, number>();
    for (const id of ids) {
      const b = f.boxes[id]!;
      if (b.stack) continue;
      if (!rowTop.has(b.depth)) rowTop.set(b.depth, top(b));
      assert.equal(top(b), rowTop.get(b.depth), `seed ${seed}: ${id} is on its row`);
    }
    const depths = [...rowTop.keys()].sort((x, y) => x - y);
    depths.slice(1).forEach((dp, i) => assert.ok(rowTop.get(dp)! > rowTop.get(depths[i]!)!, `seed ${seed}: row ${dp} is below row ${depths[i]}`));
    let stacks = 0;
    for (const { id, box, kids } of families(d, f)) {
      for (const k of kids) assert.ok(top(k) >= bottom(box) + ORG_ROW_GAP - 0.001, `seed ${seed}: ${id}'s children hang below it`);
      if (kids.some((k) => k.stack)) {
        stacks++;
        assert.ok(kids.every((k) => k.stack), "a stack is all of a node's children");
        assert.ok(kids.every((k) => Math.abs(left(k) - left(kids[0]!)) < 0.001 && left(k) > box.x), `seed ${seed}: ${id}'s leaves share a column right of its centre`);
        kids.slice(1).forEach((k, i) => assert.ok(top(k) > bottom(kids[i]!), `seed ${seed}: ${id}'s leaves stack downwards in order`));
      } else {
        const span = (Math.min(...kids.map(left)) + Math.max(...kids.map(right))) / 2;
        assert.ok(Math.abs(box.x - span) <= 1, `seed ${seed}: ${id} is centred over its children (${box.x} vs ${span})`);
      }
    }
    assert.ok(stacks > 0, `seed ${seed}: the tree has stacks to check`);
  }
});

test("org chart: leaves stack at four or more, and only when none of them has children showing", () => {
  // Leaves under a branch (the root's own branches always spread along a row; see the next test).
  const withLeaves = (count: number) => {
    const start = emptyDoc("T");
    let [d, branch] = addChild(start, start.rootId, "branch");
    for (let i = 0; i < count; i++) [d] = addChild(d, branch, `leaf ${i}`);
    return d;
  };
  const branchOf = (d: IODoc) => d.nodes[d.rootId]!.children[0]!;
  const stacked = (d: IODoc) => d.nodes[branchOf(d)]!.children.map((c) => !!frameFor(d, "org").boxes[c]!.stack);
  assert.equal(ORG_STACK_MIN, 4);
  assert.deepEqual(stacked(withLeaves(3)), [false, false, false], "three leaves spread along a row");
  assert.deepEqual(stacked(withLeaves(4)), [true, true, true, true]);
  assert.deepEqual(stacked(withLeaves(6)), Array(6).fill(true));
  // One of four with a child: a row. The same child folded away: a leaf again, so a stack.
  let d = withLeaves(4);
  const second = d.nodes[branchOf(d)]!.children[1]!;
  [d] = addChild(d, second, "below");
  assert.deepEqual(stacked(d), [false, false, false, false]);
  assert.deepEqual(stacked(setCollapsed(d, second, true)), [true, true, true, true]);
});

test("org chart: connectors are elbows with small round corners; a stacked leaf is reached down the spine", () => {
  const d = team();
  const f = frameFor(d, "org");
  const [a, b, c] = ["a", "b", "c"].map((id) => f.boxes[id]!);
  const root = f.boxes["r"]!;
  const bar = top(a!) - ORG_ROW_GAP / 2;
  // Down from the root's bottom centre, a corner, across, a corner, down into Design's top centre.
  assert.equal(treePath(root, a!, "org"), `M0 ${bottom(root)} V${bar - 4} Q0 ${bar} -4 ${bar} H${a!.x + 4} Q${a!.x} ${bar} ${a!.x} ${bar + 4} V${top(a!)}`);
  assert.match(treePath(root, c!, "org"), /^M0 \S+ V\S+ Q/);
  // Cy is Build's only child, right under it: straight down.
  const cy = f.boxes["b1"]!;
  assert.equal(cy.x, b!.x);
  assert.equal(treePath(b!, cy, "org"), `M${b!.x} ${bottom(b!)} V${top(cy) - ORG_ROW_GAP / 2} H${cy.x} V${top(cy)}`);
  const dee = f.boxes["c1"]!;
  assert.equal(treePath(c!, dee, "org"), `M${c!.x} ${bottom(c!)} V${dee.y - 4} Q${c!.x} ${dee.y} ${c!.x + 4} ${dee.y} H${left(dee)}`);
  // The Mind map keeps its curves.
  assert.match(treePath(frameFor(d, "map").boxes["r"]!, frameFor(d, "map").boxes["a"]!, "map"), / C/);
});

/* ---------------------------------------------------------------- keys */

/** Where each arrow lands from `from` in the org chart, as the selected node's text or "stays". */
const arrows = (d: IODoc, from: string, extend = false) => {
  const frame = frameFor(d, "org");
  const out: Record<string, string> = {};
  for (const dir of ["up", "down", "left", "right"] as ArrowDir[]) {
    const m = arrowMove(d, frame, from, dir, extend);
    out[dir] = !m ? "stays" : "toggle" in m ? `fold ${d.nodes[m.toggle]!.text}` : d.nodes[m.select]!.text;
  }
  return out;
};

test("arrows, Org chart: ↑ is the parent, ↓ the child nearest the centre, ←/→ the siblings, then the same row", () => {
  const d = team();
  // The root: the child under its centre; nothing beside it on the top row.
  assert.deepEqual(arrows(d, "r"), { up: "stays", down: "Build", left: "stays", right: "stays" });
  assert.deepEqual(arrows(d, "a"), { up: "Team", down: "Ana", left: "stays", right: "Build" });
  assert.deepEqual(arrows(d, "b"), { up: "Team", down: "Cy", left: "Design", right: "Ship" });
  // Two children as near the centre as each other: the first.
  const f = frameFor(d, "org");
  assert.equal(Math.abs(f.boxes["a1"]!.x - f.boxes["a"]!.x), Math.abs(f.boxes["a2"]!.x - f.boxes["a"]!.x));
  // At the end of its siblings, → carries on along the row: Ben to Cy, Cy to the top of Ship's stack.
  assert.deepEqual(arrows(d, "a2"), { up: "Design", down: "stays", left: "Ana", right: "Cy" });
  assert.deepEqual(arrows(d, "b1"), { up: "Build", down: "stays", left: "Ben", right: "Dee" });
  assert.equal(arrows(d, "a1").left, "stays", "nothing further left on the row");
  // ⇧ answers the same node; the caller adds it to the selection.
  assert.deepEqual(arrowMove(d, f, "a", "right", true), { select: "b" });
});

test("arrows, Org chart: in a stack of leaves ↑/↓ step through it, and ←/→ leave it for the nearest node that way", () => {
  const d = team();
  assert.equal(arrows(d, "c").down, "Dee", "↓ from the parent is the top of the stack");
  assert.deepEqual(arrows(d, "c1"), { up: "Ship", down: "Eve", left: "Cy", right: "stays" });
  assert.deepEqual(arrows(d, "c2"), { up: "Dee", down: "Fay", left: "Cy", right: "stays" });
  assert.deepEqual(arrows(d, "c4"), { up: "Fay", down: "stays", left: "Cy", right: "stays" });
  // A folded stack is not stepped into.
  assert.equal(arrows(setCollapsed(d, "c", true), "c").down, "stays");
});

/* ---------------------------------------------------------------- drop */

/** The parts of a drop target that say where the node goes (the slot line's coordinates are drawing). */
function pick(t: ReturnType<typeof dropTargetFor>) {
  if (!t) return null;
  return { parent: t.parent, index: t.index, ...(t.side ? { side: t.side } : {}) };
}

test("drop, Org chart: over a node the dragged branch becomes its child, placed across its row by the pointer", () => {
  const d = team();
  const f = frameFor(d, "org");
  const cy = f.boxes["b1"]!;
  assert.equal(hitTest(f, cy.x, cy.y, new Set()), "b1");
  assert.deepEqual(pick(dropTargetFor(d, f, cy.x, cy.y, ["a2"])), { parent: "b1", index: 0 });
  // Onto Design, which sits centred over Ana and Ben: between them.
  const design = f.boxes["a"]!;
  assert.deepEqual(pick(dropTargetFor(d, f, design.x, design.y, ["b1"])), { parent: "a", index: 1 });
  // Onto the root, right of Build's centre: before Ship. A main branch has no side in the Org chart.
  const root = f.boxes["r"]!;
  assert.ok(root.x + root.w / 2 - 2 > f.boxes["b"]!.x);
  const t = dropTargetFor(d, f, root.x + root.w / 2 - 2, root.y, ["a"]);
  assert.deepEqual(pick(t), { parent: "r", index: 1 }, "index among the siblings left once Design is out");
  assert.equal(t!.side, undefined);
});

test("drop, Org chart: in the gap between siblings in a row it is a reorder, and the slot runs down between them", () => {
  const d = team();
  const f = frameFor(d, "org");
  const [a, b, c] = ["a", "b", "c"].map((id) => f.boxes[id]!);
  // Ship dragged into the gap between Design and Build.
  const gap = (a!.x + a!.w / 2 + b!.x - b!.w / 2) / 2;
  assert.equal(hitTest(f, gap, a!.y, new Set(["c"])), null);
  assert.equal(columnUnder(d, f, gap, a!.y, new Set(["c"]), "r"), "r");
  const t = dropTargetFor(d, f, gap, a!.y, ["c"]);
  assert.deepEqual(pick(t), { parent: "r", index: 1 });
  assert.equal(t!.down, true);
  assert.equal(t!.x, gap);
  // Design dragged past the end of the row, beyond Ship: last.
  assert.deepEqual(pick(dropTargetFor(d, f, c!.x + c!.w / 2 + 12, c!.y, ["a"])), { parent: "r", index: 2 });
  // Ben dragged left of Ana, clear of any box: first under Design.
  const ana = f.boxes["a1"]!;
  assert.deepEqual(pick(dropTargetFor(d, f, ana.x - ana.w / 2 - 10, ana.y, ["a2"])), { parent: "a", index: 0 });
});

test("drop, Org chart: in a stack the slots run top to bottom; never into the dragged branch", () => {
  const d = team();
  const f = frameFor(d, "org");
  const [eve, fay] = ["c2", "c3"].map((id) => f.boxes[id]!);
  // Dee dragged into the gap between Eve and Fay, clear of both.
  const between = (eve!.y + eve!.h / 2 + fay!.y - fay!.h / 2) / 2;
  assert.equal(hitTest(f, eve!.x, between, new Set(["c1"])), null);
  const t = dropTargetFor(d, f, eve!.x, between, ["c1"]);
  assert.deepEqual(pick(t), { parent: "c", index: 1 });
  assert.equal(t!.down, undefined, "across, as the Mind map shows it");
  // Cy dragged under Gus, at the foot of the stack: last of Ship's.
  const gus = f.boxes["c4"]!;
  assert.deepEqual(pick(dropTargetFor(d, f, gus.x, gus.y + gus.h / 2 + 10, ["b1"])), { parent: "c", index: 4 });
  // Ship onto its own leaf, or into its own stack: nowhere.
  assert.equal(dropTargetFor(d, f, eve!.x, eve!.y, ["c"]), null);
  assert.equal(dropTargetFor(d, f, eve!.x, between, ["c"]), null);
});

/* ---------------------------------------------------------------- layouts */

/** Stored positions, rounded as the file writes them. */
const stored = (d: IODoc) => Object.fromEntries(Object.values(d.nodes).map((n) => [n.id, [Math.round(n.x), Math.round(n.y)]]));
const shown = (d: IODoc, kind: "map" | "org" | "canvas") => Object.fromEntries(Object.entries(frameFor(d, kind).boxes).map(([id, b]) => [id, [Math.round(b.x), Math.round(b.y)]]));

test("⌘3 cycles Mind map → Org chart → Free → Mind map", { skip: !ORG_CHART && "the Org chart is hidden" }, () => {
  assert.deepEqual([nextLayout("auto"), nextLayout("org"), nextLayout("free")], ["org", "free", "auto"]);
});

test("Org chart hidden: ⌘3, the toolbar and Settings offer Mind map and Free; a map that pins it shows the Mind map and keeps it", { skip: ORG_CHART && "the Org chart is on" }, () => {
  assert.deepEqual(MAP_LAYOUTS, ["auto", "free"]);
  assert.deepEqual([nextLayout("auto"), nextLayout("free")], ["free", "auto"]);
  assert.equal(shownLayout("org"), "auto");
  const pinned = setLook(team(), { layout: "org" });
  assert.equal(toMarkdownMap(pinned).includes('"layout":"org"'), true, "the file keeps saying org");
  // Free that follows the Org chart: Tidy lays it out as the Mind map, and ⌘3 back to the Mind map changes nothing stored.
  const free = setLook(team(), { layout: "free", arrange: "org" });
  assert.equal(arrangementOf("free", free.look), "auto");
  assert.equal(freeArrangement(free.look), "org", "what the positions follow is still read truthfully");
  assert.deepEqual(tidied(free, arrangementOf("free", free.look)).look, { layout: "free" });
  // Entering Free from the shown Mind map when the positions were laid out as the Org chart lays them out as the Mind map first.
  const entered = withLayout(setLook(team(), { layout: "org", arrange: "org" }), shownLayout("org"), "free");
  assert.deepEqual(entered.look, { layout: "free" });
  assert.deepEqual(shown(entered, "canvas"), shown(team(), "map"));
});

test("switching to Free from the Org chart starts from the org chart's positions, and remembers it", () => {
  const d = team();
  const org = withLayout(d, "auto", "org");
  assert.deepEqual(org.look, { layout: "org" });
  assert.deepEqual(stored(org), stored(d), "the Mind map and the Org chart leave stored positions alone");
  const free = withLayout(org, "org", "free");
  assert.deepEqual(free.look, { layout: "free", arrange: "org" });
  assert.deepEqual(shown(free, "canvas"), shown(d, "org"), "nothing moves on the switch");
  assert.equal(freeArrangement(free.look), "org");
  // Positions placed by hand in Free survive a trip round the cycle back to the same arrangement.
  const placed = moveBy(free, "c", 300, 40);
  const round = withLayout(withLayout(withLayout(placed, "free", "auto"), "auto", "org"), "org", "free");
  assert.deepEqual(stored(round), stored(placed));
  assert.deepEqual(round.look, { layout: "free", arrange: "org" });
  // Entered from the Mind map instead, Free is laid out as the Mind map, and follows it from then on.
  const fromMind = withLayout(withLayout(placed, "free", "auto"), "auto", "free");
  assert.deepEqual(fromMind.look, { layout: "free" });
  assert.deepEqual(shown(fromMind, "canvas"), shown(d, "map"));
});

test("switching to Free from the Mind map keeps the positions it has, as it always did", () => {
  const d = moveBy(team(), "a", -120, 30);
  const free = withLayout(d, "auto", "free");
  assert.deepEqual(free.look, { layout: "free" });
  assert.deepEqual(stored(free), stored(d));
  // The plugin's default layout is where the switch starts when the map has not chosen one.
  assert.deepEqual(withLayout(d, "org", "free").look, { layout: "free", arrange: "org" });
});

test("a folded branch laid out for Free opens as the org chart would show it", () => {
  const d = setCollapsed(team(), "c", true);
  const free = withLayout(d, "org", "free");
  const opened = shown(team(), "org");
  const at = stored(free);
  for (const id of ["c1", "c2", "c3", "c4"]) {
    assert.deepEqual([at[id]![0]! - at["c"]![0]!, at[id]![1]! - at["c"]![1]!], [opened[id]![0]! - opened["c"]![0]!, opened[id]![1]! - opened["c"]![1]!], id);
  }
});

test("Free: a stack the org chart left keeps its lines beside the column until a leaf leaves it", () => {
  const free = withLayout(team(), "org", "free");
  const f = frameFor(free, "canvas");
  const [ship, dee] = [f.boxes["c"]!, f.boxes["c1"]!];
  assert.deepEqual(["c1", "c2", "c3", "c4"].map((id) => !!f.boxes[id]!.stack), [true, true, true, true]);
  assert.equal(treePath(ship, dee, "canvas"), `M${ship.x} ${bottom(ship)} C${ship.x} ${dee.y} ${ship.x} ${dee.y} ${left(dee)} ${dee.y}`);
  assert.equal(f.boxes["a1"]!.stack, undefined, "a row is not a stack");
  const moved = frameFor(moveBy(free, "c3", 80, 0), "canvas");
  assert.deepEqual(["c1", "c2", "c3", "c4"].map((id) => !!moved.boxes[id]!.stack), [false, false, false, false]);
});

test("Tidy in Free lays out as the remembered arrangement, and so does placing what the file has no position for", () => {
  const d = setLook(team(), { layout: "free", arrange: "org" });
  // Tidy (MapApp) bakes the positions of the arrangement Free follows: the org chart's.
  assert.equal(freeArrangement(d.look), "org");
  assert.equal(arrangementOf("free", d.look), ORG_CHART ? "org" : "auto");
  assert.deepEqual(shown(tidied(d, "org"), "canvas"), shown(d, "org"));
  assert.notDeepEqual(shown(d, "org"), shown(d, "map"));
  // Tidied as a mind map (the menu and the palette offer Tidy in any layout), the positions follow the mind map from then on.
  assert.deepEqual(tidied(setLook(d, { layout: "auto" }), "auto").look, { layout: "auto" });
  // A map with no positions at all is seeded as its arrangement.
  const seeded = seedCanvasPositions({ ...fromMarkdownMap(toMarkdownMap(d).replace(/\n%%ideamap[\s\S]*$/, "\n"), "Team"), look: d.look });
  assert.deepEqual(shown(seeded, "canvas"), shown(d, "org"));
  // A node added outside the plugin: as far from the one before it as the org chart puts it; the rest stay.
  const moved = moveBy(withLayout(team(), "org", "free"), "b", 0, 200);
  const edited = toMarkdownMap(moved).replace("  - Cy ^b1\n", "  - Cy ^b1\n  - Dot ^b2\n");
  const read = fromMarkdownMap(edited, "Team");
  assert.deepEqual(read.unplaced, ["b2"]);
  const placed = seedCanvasPositions(read);
  const org = frameFor(fromMarkdownMap(edited, "Team"), "org").boxes;
  assert.equal(Math.round(placed.nodes["b2"]!.x - placed.nodes["b1"]!.x), Math.round(org["b2"]!.x - org["b1"]!.x));
  assert.equal(placed.nodes["b2"]!.y, placed.nodes["b1"]!.y, "on its sibling's row");
  assert.deepEqual(stored({ ...placed, nodes: Object.fromEntries(Object.entries(placed.nodes).filter(([id]) => id !== "b2")) }), stored(moved));
});

/* ---------------------------------------------------------------- file */

test("file: the Org chart layout and Free's remembered arrangement survive Markdown and JSON Canvas round trips", () => {
  const d = team();
  for (const look of [{ layout: "org" as const }, { layout: "free" as const, arrange: "org" as const }, { layout: "auto" as const, arrange: "org" as const }]) {
    const pinned = setLook(d, look);
    const md = toMarkdownMap(pinned);
    assert.deepEqual(fromMarkdownMap(md, "Team").look, look, `Markdown: ${JSON.stringify(look)}`);
    assert.equal(toMarkdownMap(fromMarkdownMap(md, "Team")), md, "and writes back byte for byte");
    assert.deepEqual(fromJSONCanvas(toJSONCanvas(pinned), "Team").look, look, `JSON Canvas: ${JSON.stringify(look)}`);
  }
  // The Mind map is the default: Free following it writes no `arrange` at all.
  assert.doesNotMatch(toMarkdownMap(setLook(d, { layout: "free", arrange: "auto" })), /arrange/);
  assert.doesNotMatch(toMarkdownMap(setLook(d, { layout: "auto" })), /arrange/);
});

test("file: an unknown layout or arrangement reads as the default", () => {
  assert.deepEqual(lookFromFile({ layout: "radial", arrange: "org" }), { arrange: "org" });
  assert.deepEqual(lookFromFile({ layout: "org", arrange: "fishbone" }), { layout: "org" });
  assert.deepEqual(lookFromFile({ layout: "free", arrange: "auto" }), { layout: "free" });
  assert.deepEqual(lookFromFile({ layout: 3, arrange: null }), {});
  const md = TEAM + "\n%%ideamap\n" + JSON.stringify({ v: 1, pos: {}, collapsed: [], links: [], align: {}, branch: {}, look: { layout: "tree", arrange: "tree" } }) + "\n%%\n";
  assert.equal(fromMarkdownMap(md, "Team").look, undefined);
});

test("org chart: the root's own branches spread along a row even when there are four or more with nothing under them", () => {
  let d = emptyDoc("Plan");
  for (let i = 0; i < 5; i++) d = addChild(d, d.rootId)[0];
  const f = frameFor(d, "org");
  const kids = d.nodes[d.rootId]!.children.map((id) => f.boxes[id]!);
  assert.ok(kids.every((b) => !b.stack), "no stack under the root");
  assert.equal(new Set(kids.map((b) => Math.round(b.y))).size, 1, "all five on one row");
});
