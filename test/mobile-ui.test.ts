import { test } from "node:test";
import assert from "node:assert/strict";

import { claimMapTouch, isPhoneTouch, viewportOcclusion } from "../src/organiser/ui/mobile.ts";
import { readFileSync } from "node:fs";

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

test("mobile UI: a touch gesture in the map is kept from Obsidian's sidebar swipe", () => {
  let stopped = 0;
  const touch = { pointerType: "touch", stopPropagation: () => stopped++ };
  const mouse = { pointerType: "mouse", stopPropagation: () => stopped++ };

  assert.equal(claimMapTouch(touch), true);
  assert.equal(stopped, 1);
  assert.equal(claimMapTouch(mouse), false);
  assert.equal(stopped, 1);
});

test("mobile UI: corner controls match Obsidian Canvas's 40px controls and 24px icons", () => {
  const css = readFileSync(new URL("../src/organiser/styles.css", import.meta.url), "utf8");
  assert.match(css, /--mobile-control-size:\s*40px/);
  assert.match(css, /--mobile-control-icon:\s*24px/);
});
