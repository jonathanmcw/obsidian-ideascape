import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCustomTheme } from "../src/organiser/theme.ts";

const lum = (hex: string) => {
  const m = /^#(..)(..)(..)$/.exec(hex)!;
  const f = (v: string) => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(m[1]) + 0.7152 * f(m[2]) + 0.0722 * f(m[3]);
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test("theme: a custom accent is left alone when it already stands out on the stage", () => {
  const t = buildCustomTheme({ name: "C", base: "paper", branches: [], stage: "#ffffff", accent: "#3b2ae0" });
  assert.equal(t.vars["--accent"], "#3b2ae0");
});

test("theme: an accent chosen near the stage colour is moved until the selection ring can be seen", () => {
  // Selection, focus and the caret are all drawn in the accent, so this one would vanish as picked.
  const t = buildCustomTheme({ name: "C", base: "paper", branches: [], stage: "#fafafa", accent: "#f7f7f7" });
  const shown = t.vars["--accent"]!;
  assert.notEqual(shown, "#f7f7f7", "the drawn accent moved");
  assert.ok(contrast(shown, "#fafafa") >= 2.4, `ring contrast ${contrast(shown, "#fafafa").toFixed(2)} is enough to see`);
});

test("theme: the same guard works on a dark stage, moving the accent the other way", () => {
  const t = buildCustomTheme({ name: "C", base: "slate", branches: [], stage: "#101014", accent: "#131318" });
  const shown = t.vars["--accent"]!;
  assert.ok(contrast(shown, "#101014") >= 2.4, "the accent is lifted off a dark stage");
});

test("theme: where both ways out of the stage would do, the accent takes the shorter one", () => {
  // Slightly lighter than its stage: going lighter clears the floor sooner than going dark would, and the
  // accent should not be dragged all the way to near-black to get there.
  const t = buildCustomTheme({ name: "C", base: "slate", branches: [], stage: "#6a6a6a", accent: "#6e6e6e" });
  const shown = t.vars["--accent"]!;
  assert.ok(lum(shown) > lum("#6e6e6e"), `the accent went lighter, not darker (got ${shown})`);
  assert.ok(contrast(shown, "#6a6a6a") >= 2.4, "and it clears the floor");
});
