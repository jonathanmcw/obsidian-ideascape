import { test } from "node:test";
import assert from "node:assert/strict";

import {
  claimMapTouch,
  isPhoneTouch,
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
