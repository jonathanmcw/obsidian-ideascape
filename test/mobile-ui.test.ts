import { test } from "node:test";
import assert from "node:assert/strict";

import { knobOnRight } from "../src/organiser/layout/index.ts";
import {
  claimMapTouch,
  isPhoneTouch,
  centreNudge,
  outlineScrollStop,
  formatsForNode,
  roomyDock,
  outlineSwipeAction,
  stageResizeOffset,
  stageViewportBand,
  visibilityNudge,
  viewportOcclusion,
} from "../src/organiser/ui/mobile.ts";
import { readFileSync } from "node:fs";
import { insertLineBreak } from "../src/organiser/ui/format.ts";

test("mobile UI: phone treatment needs both a touch device and a phone-width stage", () => {
  assert.equal(isPhoneTouch(true, 390), true);
  assert.equal(isPhoneTouch(true, 600), true);
  assert.equal(isPhoneTouch(true, 601), false);
  assert.equal(isPhoneTouch(true, 844, true), true, "an iPhone stays docked in landscape");
  assert.equal(isPhoneTouch(true, 844, false), false, "a touch tablet keeps the floating bar");
  assert.equal(isPhoneTouch(false, 390), false);
  assert.equal(isPhoneTouch(true, 0), false);
});

test("mobile UI: visual viewport occlusion is the part of the map hidden by the keyboard", () => {
  assert.equal(viewportOcclusion(800, 0, 500), 300);
  assert.equal(viewportOcclusion(800, 40, 500), 260);
  assert.equal(viewportOcclusion(600, 0, 700), 0);
});

test("mobile UI: the keyboard uses the stage/viewport intersection instead of subtracting its height twice", () => {
  assert.deepEqual(stageViewportBand(220, 800, 0, 500), { top: 0, bottom: 280 });
  assert.deepEqual(stageViewportBand(220, 500, 0, 500), { top: 0, bottom: 280 }, "an already-shrunk stage has the same visible band");
  assert.deepEqual(stageViewportBand(100, 500, 140, 300), { top: 40, bottom: 340 });
});

test("mobile UI: an outline does not recenter vertically while the keyboard resizes its stage", () => {
  assert.deepEqual(stageResizeOffset("outline", 20, -320), { x: 10, y: 0 });
  assert.deepEqual(stageResizeOffset("map", 20, -320), { x: 10, y: -160 });
});

test("mobile UI: an edited outline row moves only when the keyboard would cover it", () => {
  assert.equal(visibilityNudge(120, 170, 0, 300, 16, 72), 0);
  assert.equal(visibilityNudge(250, 290, 0, 300, 16, 72), -62);
  assert.equal(visibilityNudge(4, 44, 0, 300, 16, 72), 12);
});

test("mobile UI: a node taller than the band above the keyboard settles instead of bouncing between its edges", () => {
  // Band 16..228 (212px) and a 300px node: whichever edge wins, applying the nudge must leave nothing to nudge.
  for (const top of [-400, -50, 0, 100, 500]) {
    const dy = visibilityNudge(top, top + 300, 0, 300, 16, 72);
    assert.equal(visibilityNudge(top + dy, top + dy + 300, 0, 300, 16, 72), 0, `from ${top}`);
  }
});

test("mobile UI: horizontal outline swipes change nesting without stealing vertical reordering", () => {
  assert.equal(outlineSwipeAction(52, 8), "indent");
  assert.equal(outlineSwipeAction(-52, 8), "outdent");
  assert.equal(outlineSwipeAction(30, 2), null, "short drags do not restructure the tree");
  assert.equal(outlineSwipeAction(60, 52), null, "a diagonal or vertical drag remains a reorder gesture");
});

test("mobile UI: a touch gesture in the map is kept from Obsidian's sidebar swipe", () => {
  let stopped = 0;
  const touch = { pointerType: "touch", stopPropagation: () => stopped++ };
  const mouse = { pointerType: "mouse", stopPropagation: () => stopped++ };

  assert.equal(claimMapTouch(touch), true);
  assert.equal(stopped, 1);
  assert.equal(claimMapTouch(mouse), false);
  assert.equal(stopped, 1);
});

test("mobile UI: More inserts a line break without changing Return's sibling action", () => {
  const calls: unknown[][] = [];
  const owner = { execCommand: (...args: unknown[]) => { calls.push(args); return true; } };
  const label = {
    nodeType: 1,
    classList: { contains: (name: string) => name === "node-label" },
    isContentEditable: true,
    ownerDocument: owner,
  };
  const root = { activeElement: label } as unknown as Document;
  assert.equal(insertLineBreak(root), true);
  assert.deepEqual(calls, [["insertText", false, "\n"]]);

  const toolbar = readFileSync(new URL("../src/organiser/ui/NodeBar.tsx", import.meta.url), "utf8");
  assert.match(toolbar, /<IconNewLine\s*\/>/);
  assert.match(toolbar, /<Name>New line<\/Name>/);
  assert.match(toolbar, /More editing options[\s\S]*<IconNewLine\s*\/>[\s\S]*<Name>New line<\/Name>/, "More precedes New line in the phone dock");
  assert.doesNotMatch(toolbar, /nt-arrange-drop/, "Move is no longer a second menu in the primary dock");
});

// What the components author — the order of the dock's keys, the types it offers — is read from the source here.
// How any of it ends up on screen is checked in a browser: npm run ui.
test("mobile UI: node type is one responsive chooser and checkboxes keep a square visual", () => {
  const toolbar = readFileSync(new URL("../src/organiser/ui/NodeBar.tsx", import.meta.url), "utf8");
  assert.match(toolbar, /\['text', 'Aa', 'Text'/);
  assert.match(toolbar, /\['numbered', '', 'Numbered'/);
  assert.match(toolbar, /\['checklist', '', 'Checklist'/);

  // The type menu is the one phone surface the rendered check does not open; its sizes and the checkbox's square
  // and 44px reach are measured in a browser by scripts/ui-check.mjs.
  const css = readFileSync(new URL("../src/organiser/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.is-docked > \.nt-type-menu\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
});

// The dock stands over the bottom of the outline while a row is being typed into. These are the numbers from the
// phone that reported it: a 700px visible band above the keyboard, a 64px margin, and a dock reaching 65px up.
test("outline: the last row stops above the editing dock, not behind it", () => {
  const visible = 700, margin = 64, dock = 65;
  const docEnd = 900; // taller than the view, so the outline does scroll
  const scrolledToTheEnd = outlineScrollStop(-10_000, visible, margin, dock, 0, docEnd);
  const lastRowBottom = docEnd + scrolledToTheEnd;
  assert.ok(lastRowBottom <= visible - dock, `the last row ends at ${lastRowBottom}, inside the dock at ${visible - dock}`);
  assert.equal(scrolledToTheEnd, visible - margin - dock - docEnd);
});

test("outline: with no dock the last row still stops at the bottom margin", () => {
  const stop = outlineScrollStop(-10_000, 700, 64, 0, 0, 900);
  assert.equal(stop, 700 - 64 - 900);
});

test("outline: a document shorter than the view does not scroll, dock or no dock", () => {
  assert.equal(outlineScrollStop(-500, 700, 64, 0, 0, 200), 64);
  assert.equal(outlineScrollStop(-500, 700, 64, 65, 0, 200), 64);
});

test("outline: whatever the dock's height, the end stays reachable clear of it and the top stays reachable", () => {
  // The two properties a person depends on while typing at the end of an outline: the row can be brought out from
  // behind the dock, and the outline can still be scrolled back to its first row.
  for (const dock of [0, 40, 65, 120, 260]) {
    const visible = 700, margin = 64, docEnd = 900;
    const end = outlineScrollStop(-10_000, visible, margin, dock, 0, docEnd);
    assert.ok(docEnd + end <= visible - dock, `dock ${dock}: the last row ends inside the dock`);
    assert.equal(outlineScrollStop(10_000, visible, margin, dock, 0, docEnd), margin, `dock ${dock}: the top is not reachable`);
  }
});

// The knob and the collapsed count stand on the branch's outer edge, away from the root. The map's own layouts
// record that as the box's direction; the Free layout stores positions only, so it is read from where the node sits.
test("knob: the map's layouts place it by the branch's direction", () => {
  assert.equal(knobOnRight({ x: 0, y: 0, w: 10, h: 10, depth: 1, dir: 1 }, "map"), true);
  assert.equal(knobOnRight({ x: 0, y: 0, w: 10, h: 10, depth: 1, dir: -1 }, "map"), false);
});

test("knob: the Free layout places it by which side of the root the node sits on", () => {
  const left = { x: 100, y: 0, w: 10, h: 10, depth: 1, dir: 0 } as const;
  const right = { x: 500, y: 0, w: 10, h: 10, depth: 1, dir: 0 } as const;
  assert.equal(knobOnRight(left, "canvas", 300), false, "a node left of the root points left");
  assert.equal(knobOnRight(right, "canvas", 300), true, "a node right of the root points right");
  // Without the root's position there is nothing to be relative to, and dir 0 reads as the right — as before.
  assert.equal(knobOnRight(left, "canvas"), true);
});

test("knob: rearranging a map does not move the knob across the node", () => {
  // The same node, on the left of the root, laid out both ways: the answer must not depend on which layout drew it.
  const auto = { x: 100, y: 0, w: 10, h: 10, depth: 1, dir: -1 } as const;
  const free = { x: 100, y: 0, w: 10, h: 10, depth: 1, dir: 0 } as const;
  assert.equal(knobOnRight(auto, "map"), knobOnRight(free, "canvas", 300));
});

// A phone shows a few rows at a time: the row being typed into goes to the middle of what can be seen, so the end of
// it is not left against the dock.
test("typing: a short row settles in the middle of the visible band", () => {
  // A 40px row in a 0..600 band with 130px reserved below: the usable band is 0..470, so it centres at 215.
  const dy = centreNudge(500, 540, 0, 600, 130);
  assert.equal(500 + dy, 215);
});

test("typing: asking again does not move it — the camera cannot creep on every keystroke", () => {
  const first = centreNudge(500, 540, 0, 600, 130);
  assert.equal(centreNudge(500 + first, 540 + first, 0, 600, 130), 0);
});

test("typing: a row taller than the band keeps its bottom edge, where the next line appears", () => {
  // 600px of text in a 470px band: the start scrolls away, the caret's end stays just above the dock.
  const dy = centreNudge(0, 600, 0, 600, 130);
  assert.equal(600 + dy, 470, "the row's bottom sits on the reserve, not inside it");
});

// Obsidian calls some tablets phones, so they get the phone's dock — with a tablet's width sitting empty either side.
test("dock: a phone keeps its short row, a tablet-width dock unpacks", () => {
  assert.equal(roomyDock(true, 390), false, "a phone has no room to spare");
  assert.equal(roomyDock(true, 600), false);
  assert.equal(roomyDock(true, 700), true, "a tablet does");
  assert.equal(roomyDock(true, 1024), true);
});

test("dock: a bar that is not docked is never 'roomy' — it already shows everything", () => {
  assert.equal(roomyDock(false, 1400), false);
});

// The root is the note's heading and is drawn bold whatever its text says: a Bold key there writes ** into the file
// and changes nothing on screen.
test("bar: the root is offered every format except Bold", () => {
  assert.deepEqual(formatsForNode(["bold", "italic", "underline", "link"], true), ["italic", "underline", "link"]);
  assert.deepEqual(formatsForNode(["bold", "italic"], false), ["bold", "italic"], "every other node keeps it");
});

test("bar: a phone's row, where Bold is the only key, gets Italic on the root rather than a gap", () => {
  assert.deepEqual(formatsForNode(["bold"], true), ["italic"]);
  assert.deepEqual(formatsForNode(["bold"], false), ["bold"]);
});
