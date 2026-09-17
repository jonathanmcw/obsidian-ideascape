// The welcome slides: their words, their keys on each platform, and the screenshots the build inlines.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadHost } from "./host-bundle.ts";
import type { Slide } from "../src/welcome.ts";

type Welcome = { slides: (mac?: boolean, touch?: boolean) => Slide[] };

test("welcome: three slides, each with words, an alt text and both theme screenshots inlined", async () => {
  const { slides } = await loadHost<Welcome>("../src/welcome.ts");
  const all = slides(true);
  assert.equal(all.length, 3);
  for (const s of all) {
    assert.ok(s.title.length > 0 && s.body.length > 0 && s.alt.length > 0, s.title);
    assert.match(s.image.dark, /^data:image\/webp;base64,/, `${s.title} dark`);
    assert.match(s.image.light, /^data:image\/webp;base64,/, `${s.title} light`);
    assert.notEqual(s.image.dark, s.image.light, `${s.title} has two themes`);
  }
  assert.equal(all.at(-1)!.title, "Turn a note into a map", "the last slide is the one whose button is Start");
  assert.match(all[0]!.body, /ribbon button/, "the ribbon button is taught on the first slide");
});

test("welcome: the view keys read ⌘ on a Mac and Ctrl elsewhere", async () => {
  const { slides } = await loadHost<Welcome>("../src/welcome.ts");
  assert.match(slides(true)[1]!.body, /⌘1 shows the map and ⌘2 the outline/);
  assert.match(slides(false)[1]!.body, /Ctrl\+1 shows the map and Ctrl\+2 the outline/);
  assert.match(slides(true)[2]!.body, /Notes with the ideascape property/);
  assert.match(slides(true)[2]!.body, /^Right-click any note/);
  assert.match(slides(true, true)[1]!.body, /^Map and Outline, at the top of the view/, "a touch screen names the switch, not keys");
  assert.match(slides(true, true)[2]!.body, /^Open any note's menu and choose Open as a map/, "a touch screen has no right-click");
});
