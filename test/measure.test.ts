import { test } from "node:test";
import assert from "node:assert/strict";

// A fake canvas that counts what it is asked to measure.
let calls = 0;
(globalThis as { document?: unknown }).document = {
  win: { createEl: () => ({ getContext: () => ({ font: "", measureText: (t: string) => { calls++; return { width: t.length * 7 }; } }) }) },
};
const { wrapLines, textWidth, CACHE_GENERATION } = await import("../src/organiser/layout/measure.ts");

const token = (n: number) => "https://example.com/" + Array.from({ length: n - 20 }, (_, i) => "abcdefghijklmnopqrstuvwxyz0123456789"[(i * 7919) % 36]).join("");

test("wrapping: a 4,000-character token wraps with a bounded number of measurements, into the same lines", () => {
  const tok = token(4000);
  calls = 0;
  const lines = wrapLines(tok, 500, 14, 260);
  assert.ok(calls < 3000, `${calls} measurements (it was about 214,000)`);
  assert.equal(lines.join(""), tok, "nothing lost or repeated");
  assert.ok(lines.every((l) => l.length * 7 <= 260), "every line fits");
  assert.ok(lines.slice(0, -1).every((l) => l.length === Math.floor(260 / 7)), "every full line is as full as it can be");
});

test("wrapping: ordinary text wraps as before — at spaces, and a word too long for the line is cut", () => {
  assert.deepEqual(wrapLines("a quick brown fox jumps over the lazy dog", 500, 14, 80), ["a quick", "brown fox", "jumps over", "the lazy", "dog"]);
  assert.deepEqual(wrapLines("tiny supercalifragilistic end", 500, 14, 80), ["tiny", "supercalifr", "agilistic", "end"]);
  assert.deepEqual(wrapLines("ab", 500, 14, 3), ["a", "b"], "one character per line when even one does not fit");
});

test("wrapping: a wrapped line never starts with the space it broke at", () => {
  // 10 px a character: "aaaa" fits in 45, "aaaa " does not.
  const tenPx = (a: number, b: number) => (b - a) * 10;
  assert.deepEqual(wrapLines("aaaa b", 400, 14, 45, tenPx), ["aaaa", "b"]);
  assert.deepEqual(wrapLines("aaaa 字字字", 400, 14, 45, tenPx), ["aaaa", "字字字"]);
  assert.deepEqual(wrapLines("aaaa  bb", 400, 14, 45, tenPx), ["aaaa", "bb"]);
  assert.deepEqual(wrapLines("aaaa bbbb cccc", 400, 14, 45, tenPx), ["aaaa", "bbbb", "cccc"]);
});

test("measuring: the width cache is bounded — widths nothing asks for again are measured again", () => {
  textWidth("first", 400, 14);
  // Two generations' worth of other widths, in long keys so it takes few calls.
  const filler = "w".repeat(10_000);
  for (let i = 0; i * 10_000 < 2.2 * CACHE_GENERATION; i++) textWidth(`${filler}${i}`, 400, 14);
  calls = 0;
  textWidth("first", 400, 14);
  assert.equal(calls, 1, "dropped, so measured again");
});

test("measuring: a width still in use is never measured again, however much else comes and goes", () => {
  textWidth("in use", 400, 14);
  const filler = "v".repeat(10_000);
  calls = 0;
  for (let round = 0; round < 5; round++) {
    textWidth("in use", 400, 14);
    for (let i = 0; i * 10_000 < 1.2 * CACHE_GENERATION; i++) textWidth(`${filler}${round}|${i}`, 400, 14);
  }
  const fillers = calls;
  textWidth("in use", 400, 14);
  assert.equal(calls, fillers, "only the fillers were measured");
});

test("measuring: a 5,000-node map lays out again without measuring anything it measured before", async () => {
  // At 5,000 nodes an entry-capped cache measured 6,981 strings on every keystroke.
  const { layoutFor } = await import("../src/organiser/layout/index.ts");
  const { makeNode, setText } = await import("../src/organiser/model/doc.ts");
  const words = ["Lisbon", "coffee shop", "咖啡店外賣窗口", "a longer idea that wraps across more than one line of the pill for sure", "**bold** and [[Note]]"];
  for (const count of [1000, 5000]) {
    const root = makeNode({ text: "Root" });
    const nodes: Record<string, ReturnType<typeof makeNode>> = { [root.id]: root };
    const ids = [root.id];
    for (let i = 0; i < count; i++) {
      const parent = nodes[ids[Math.floor(i / 6)]!]!;
      const n = makeNode({ id: `n${i}`, text: `${words[i % words.length]} ${i}`, parent: parent.id, branch: 0 });
      nodes[n.id] = n;
      parent.children.push(n.id);
      ids.push(n.id);
    }
    const doc = { id: "m", name: "m", rootId: root.id, nodes, links: [], createdAt: 0, updatedAt: 0 };
    layoutFor(doc, "map");
    calls = 0;
    layoutFor(doc, "map");
    assert.equal(calls, 0, `${count} nodes: an unchanged map measures nothing`);
    const typed = setText(doc, `n${Math.floor(count / 2)}`, "Lisbon and Porto");
    calls = 0;
    layoutFor(typed, "map");
    assert.ok(calls <= 3, `${count} nodes: a keystroke measures only the text that changed (${calls})`);
  }
});
