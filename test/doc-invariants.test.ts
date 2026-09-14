import { test } from "node:test";
import assert from "node:assert/strict";
import { addChild, addSibling, graft, indent, outdent, removeNode, reparent, reorder, setText } from "../src/organiser/model/doc.ts";
import { fromMarkdownMap, toMarkdownMap } from "../src/organiser/model/markdown.ts";
import { newDoc } from "../src/organiser/model/store.ts";
import type { IODoc, NodeId } from "../src/organiser/model/types.ts";

/* A seeded property test of the map tree: 100 sequences of 25 random operations.
   After every operation the doc must still be one tree; after every sequence the
   Markdown writer and reader must give that tree back. */

// newDoc seeds node positions through the layout, which measures text with a canvas.
// Node has no DOM, so give it the one method the measurer uses.
const globals = globalThis as unknown as { document?: unknown };
if (!globals.document) {
  globals.document = {
    createElement: () => ({ getContext: () => ({ font: "", measureText: (t: string) => ({ width: (t || " ").length * 7 }) }) }),
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const allIds = (doc: IODoc): NodeId[] => Object.keys(doc.nodes);

/** Every id the root reaches, and any id reached twice (two parents, or a cycle). */
function reach(doc: IODoc): { order: NodeId[]; twice: NodeId[] } {
  const seen = new Set<NodeId>();
  const twice: NodeId[] = [];
  const order: NodeId[] = [];
  const queue: NodeId[] = [doc.rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) { twice.push(id); continue; }
    seen.add(id);
    order.push(id);
    for (const c of doc.nodes[id]?.children ?? []) queue.push(c);
  }
  return { order, twice };
}

/** The tree invariants as a list of problems; empty means the doc is one sound tree. */
function treeProblems(doc: IODoc): string[] {
  const out: string[] = [];
  const root = doc.nodes[doc.rootId];
  if (!root) return [`the root ${doc.rootId} is not in doc.nodes`];
  if (root.parent !== null) out.push(`the root has parent ${root.parent}`);
  const ids = allIds(doc);
  const { order, twice } = reach(doc);
  for (const id of twice) out.push(`${id} is reachable more than once`);
  const reached = new Set(order);
  for (const id of ids) if (!reached.has(id)) out.push(`${id} is not reachable from the root`);
  if (order.length !== ids.length) out.push(`the root reaches ${order.length} nodes but doc.nodes holds ${ids.length}`);
  for (const id of ids) {
    const n = doc.nodes[id];
    for (const c of n.children) {
      const child = doc.nodes[c];
      if (!child) { out.push(`${id} lists a missing child ${c}`); continue; }
      if (child.parent !== id) out.push(`${c}.parent is ${child.parent}, expected ${id}`);
    }
    if (n.parent !== null) {
      const p = doc.nodes[n.parent];
      if (!p) out.push(`${id}.parent ${n.parent} is missing`);
      else if (!p.children.includes(id)) out.push(`${n.parent}.children is missing ${id}`);
    }
    const seen = new Set<NodeId>([id]);
    let cur: NodeId | null = id;
    while (cur !== null && cur !== doc.rootId) {
      cur = doc.nodes[cur]?.parent ?? null;
      if (cur === null) { out.push(`${id} has no root above it`); break; }
      if (seen.has(cur)) { out.push(`the parent chain of ${id} cycles at ${cur}`); break; }
      seen.add(cur);
    }
  }
  return out;
}

/** The subtree under `id`, used to keep re-parenting off its own descendants. */
function subtree(doc: IODoc, id: NodeId): Set<NodeId> {
  const seen = new Set<NodeId>();
  const queue: NodeId[] = [id];
  while (queue.length) {
    const x = queue.shift()!;
    if (seen.has(x)) continue;
    seen.add(x);
    for (const c of doc.nodes[x]?.children ?? []) queue.push(c);
  }
  return seen;
}

let textNo = 0;
const nextText = (): string => `t${++textNo}`;

type Op = { name: string; run(doc: IODoc, rand: () => number): IODoc | null };

const OPS: Op[] = [
  {
    name: "addChild",
    run: (doc, rand) => addChild(doc, pick(rand, allIds(doc)), nextText())[0],
  },
  {
    name: "addSibling",
    run: (doc, rand) => addSibling(doc, pick(rand, allIds(doc)), nextText())[0],
  },
  {
    name: "setText",
    run: (doc, rand) => setText(doc, pick(rand, allIds(doc)), nextText()),
  },
  {
    name: "removeNode",
    run: (doc, rand) => {
      const id = pick(rand, allIds(doc));
      return id === doc.rootId ? null : removeNode(doc, id);
    },
  },
  {
    name: "reparent",
    run: (doc, rand) => {
      const id = pick(rand, allIds(doc));
      if (id === doc.rootId) return null;
      const under = subtree(doc, id);
      const parents = allIds(doc).filter((p) => !under.has(p));
      if (!parents.length) return null;
      return reparent(doc, id, pick(rand, parents));
    },
  },
  {
    name: "indent",
    run: (doc, rand) => {
      const id = pick(rand, allIds(doc));
      const parent = doc.nodes[id].parent;
      if (!parent) return null;
      return doc.nodes[parent].children.indexOf(id) > 0 ? indent(doc, id) : null;
    },
  },
  {
    name: "outdent",
    run: (doc, rand) => {
      const id = pick(rand, allIds(doc));
      const parent = doc.nodes[id].parent;
      return !parent || !doc.nodes[parent].parent ? null : outdent(doc, id);
    },
  },
  {
    name: "reorder",
    run: (doc, rand) => {
      const id = pick(rand, allIds(doc));
      const parent = doc.nodes[id].parent;
      if (!parent) return null;
      const siblings = doc.nodes[parent].children;
      const i = siblings.indexOf(id);
      const delta = rand() < 0.5 ? -1 : 1;
      return i + delta < 0 || i + delta >= siblings.length ? null : reorder(doc, id, delta);
    },
  },
  {
    name: "graft",
    run: (doc, rand) => {
      let clip = newDoc("clip");
      const tops = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < tops; k++) clip = addChild(clip, clip.rootId, nextText())[0];
      return graft(doc, pick(rand, allIds(doc)), clip)[0];
    },
  },
];

const SEQUENCES = 100;
const OPS_PER_SEQUENCE = 25;
const BASE_SEED = 20260913;

test("doc: 100 seeded sequences of 25 operations keep one tree and round-trip through Markdown", () => {
  for (let s = 0; s < SEQUENCES; s++) {
    const seed = BASE_SEED + s;
    const rand = mulberry32(seed);
    let doc = newDoc(`seq ${seed}`);
    const done: string[] = [];
    for (let i = 0; i < OPS_PER_SEQUENCE; i++) {
      const op = pick(rand, OPS);
      const next = op.run(doc, rand);
      if (!next) { done.push(`${op.name}(skipped)`); continue; }
      doc = next;
      done.push(op.name);
      const problems = treeProblems(doc);
      assert.deepEqual(problems, [], `seed ${seed}, op ${i + 1} ${op.name} (${done.join(" → ")}): ${problems.join("; ")}`);
    }
    const where = `seed ${seed} (${done.join(" → ")})`;
    const md = toMarkdownMap(doc);
    const back = fromMarkdownMap(md, doc.name);
    assert.deepEqual(allIds(back).sort(), allIds(doc).sort(), `node set changed after the Markdown round trip — ${where}`);
    assert.equal(back.nodes[back.rootId]?.text, doc.nodes[doc.rootId].text, `root text changed after the Markdown round trip — ${where}`);
    for (const id of allIds(doc)) {
      const node = doc.nodes[id];
      const want = node.children.map((c) => doc.nodes[c].text);
      const got = back.nodes[id];
      assert.ok(got, `node ${id} is missing after the Markdown round trip — ${where}`);
      assert.deepEqual(got.children.map((c) => back.nodes[c]?.text), want, `child texts of ${id} changed after the Markdown round trip — ${where}`);
    }
  }
});
