import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUPS, SEARCHABLE, ESSENTIALS, capLabel, filterGroups, platformCaps } from "../src/organiser/ui/keys.ts";

const labels = (groups: { rows: { label: string }[] }[]) => groups.flatMap(g => g.rows.map(r => r.label));

test("shortcuts: capLabel names ⌘ ⌥ ⇧ ⌫ off a Mac and leaves them alone on one", () => {
  assert.deepEqual(["⌘", "⌥", "⇧", "⌫"].map(c => capLabel(c, false)), ["Ctrl", "Alt", "Shift", "Backspace"]);
  assert.deepEqual(["⌘", "⌥", "⇧", "⌫"].map(c => capLabel(c, true)), ["⌘", "⌥", "⇧", "⌫"]);
  assert.equal(capLabel("↑", false), "↑");
  assert.equal(capLabel("Z", false), "Z");
});

test("shortcuts: modifiers read Ctrl Alt Shift off a Mac, in the Mac's own order on one", () => {
  assert.deepEqual(platformCaps(["⇧", "⌘", "Z"], false), ["⌘", "⇧", "Z"]);
  assert.deepEqual(platformCaps(["⇧", "⌘", "Z"], true), ["⇧", "⌘", "Z"]);
});

test("shortcuts: the filter finds rows by label, synonym and spoken key name", () => {
  assert.ok(labels(filterGroups(GROUPS, "fold")).includes("Fold or unfold"));
  assert.ok(labels(filterGroups(GROUPS, "Collapse")).includes("Fold or unfold"));
  for (const q of ["ctrl", "cmd"]) {
    const found = filterGroups(GROUPS, q).flatMap(g => g.rows);
    assert.ok(found.length > 0, q);
    assert.ok(found.every(r => r.keys.flat().includes("⌘")), q);
  }
  assert.deepEqual(labels(filterGroups(GROUPS, "shift tab")), ["Move out a level"]);
  assert.deepEqual(labels(filterGroups(GROUPS, "ctrl z")), ["Undo", "Redo"]);
  assert.ok(labels(filterGroups(SEARCHABLE, "esc")).includes("Leave node"));
  assert.deepEqual(filterGroups(GROUPS, "xylophone"), []);
  assert.equal(filterGroups(GROUPS, "  "), GROUPS);
});

test("shortcuts: every label is six words or fewer and starts with a capital", () => {
  for (const { label } of [...ESSENTIALS, ...GROUPS.flatMap(g => g.rows)]) {
    assert.ok(label.split(/\s+/).length <= 6, label);
    assert.match(label, /^[A-Z]/, label);
  }
});

test("shortcuts: no row appears twice across the groups", () => {
  const rows = SEARCHABLE.flatMap(g => g.rows);
  const keys = rows.map(r => r.keys.map(k => k.join(" ")).join(" or "));
  assert.equal(new Set(rows.map(r => r.label)).size, rows.length, "labels");
  assert.equal(new Set(keys).size, keys.length, "keys");
});

test("chord: tooltips and hints read Ctrl, Alt and Shift off a Mac, in that order", async () => {
  const { chord, macKeys } = await import("../src/organiser/ui/keys.ts");
  assert.equal(macKeys(), true, "without a page, the Mac spelling");
  assert.equal(chord("⇧⌘L", true), "⇧⌘L");
  assert.equal(chord("⇧⌘L", false), "Ctrl+Shift+L");
  assert.equal(chord("⌥⌘0–3", false), "Ctrl+Alt+0–3");
  assert.equal(chord("⌘Enter", false), "Ctrl+Enter");
  assert.equal(chord("⌥⌘=", false), "Ctrl+Alt+=");
  assert.equal(chord("⌫", false), "Backspace");
});
