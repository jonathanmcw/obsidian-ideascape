import { test } from "node:test";
import assert from "node:assert/strict";
import { MAP_FORMATS, fromMarkdownMap, toMarkdownMap } from "../src/organiser/model/markdown.ts";
import { walk } from "../src/organiser/model/doc.ts";
import { TOUR_NAME, chord, tourMarkdown } from "../src/tour.ts";

const BLOCK = MAP_FORMATS[0].block;

test("tour: key chords are spelled for the keyboard in front of the person", () => {
  assert.equal(chord("⇧⌘0", true), "⇧⌘0");
  assert.equal(chord("⇧⌘0", false), "Ctrl+Shift+0");
  assert.equal(chord("⌥⌘F", false), "Ctrl+Alt+F");
  assert.equal(chord("⌘↑ ⌘↓", false), "Ctrl+↑ Ctrl+↓");
  assert.equal(chord("⌫", false), "Backspace");
  assert.equal(chord("Tab", false), "Tab");
});

test("tour: every node shows what it describes, and the file reads back as written", () => {
  const src = tourMarkdown(true);
  const d = fromMarkdownMap(src, TOUR_NAME);
  const n = (id: string) => d.nodes[id]!;
  assert.equal(d.rootId, "tour");
  assert.equal(n("tour").text, TOUR_NAME);
  const top = n("tour").children.map((c) => n(c).text);
  assert.equal(top.length, 7);
  assert.ok(walk(d, d.rootId).length >= 40 && walk(d, d.rootId).length <= 50, "about forty nodes");
  // The make-your-own branch is a checklist, one item already ticked.
  assert.equal(n("make-new").task, " ");
  assert.equal(n("make-tour").task, "x");
  assert.equal(n("done").task, " ");
  // The style branch wears its own styles.
  assert.match(n("style-inline").text, /\*\*Bold\*\*/);
  assert.equal(n("style-heading").size, 1);
  assert.equal(n("style-align").align, "left");
  assert.match(n("style-align").text, /\n/, "alignment shows on a node of more than one line");
  assert.equal(n("style-wide").width, 300);
  assert.equal(n("style-plan").ordered, true);
  assert.match(n("build-line").text, /adds\na second line/);
  assert.match(n("connect-block").text, /\[\[Ideascape tour#\^tour\|the centre\]\]/);
  // Two branches open, the rest folded, and the fold demo folded inside its folded branch.
  for (const id of ["style", "connect", "organise", "organise-fold", "see"]) assert.equal(n(id).collapsed, true, id);
  for (const id of ["make", "build"]) assert.equal(n(id).collapsed, false, id);
  assert.deepEqual([n("make").side, n("build").side], [-1, 1], "the open branches sit on either side of the centre");
  // What the map writes back is the tour's own text: the tour is already in the saved format.
  assert.equal(toMarkdownMap(d).split(`\n${BLOCK}\n`)[0], src.split(`\n${BLOCK}\n`)[0]);
});

test("tour: off a Mac no node shows a Mac key glyph", () => {
  const pc = tourMarkdown(false);
  assert.doesNotMatch(pc, /[⌘⌥⇧⌫]/);
  assert.match(pc, /Ctrl\+Shift\+0 fits the whole map/);
  assert.match(tourMarkdown(true), /⇧⌘0 fits the whole map/);
});
