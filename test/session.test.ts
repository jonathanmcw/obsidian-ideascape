import { test } from "node:test";
import assert from "node:assert/strict";
import { addChild, addSibling, emptyDoc, graft, indent, subtreeIds, toggleCollapse } from "../src/organiser/model/doc.ts";
import type { IODoc } from "../src/organiser/model/types.ts";
import { embedsOf, stripEmbeds, withEmbeds } from "../src/organiser/model/inline.ts";
import { fromMarkdownMap } from "../src/organiser/model/markdown.ts";
import {
  addToNode, beginDraft, commitStep, createNode, flushDraft, leave, newSession, openTo, pruneView, redo, reload, restructure, typed, undo, unfold, withDraft, type Session,
} from "../src/organiser/session.ts";
import { asBranch, withLinks } from "../src/organiser/model/ingest.ts";

const text = (s: Session, id: string) => s.doc.nodes[id]?.text;
const child = (parent: (d: IODoc) => string) => (d: IODoc) => addChild(d, parent(d));
const sibling = (id: string) => (d: IODoc) => addSibling(d, id);
const underRoot = child((d) => d.rootId);

test("session: a map undo while typing takes the typing back as a step of its own, and redo returns it", () => {
  const s = newSession(emptyDoc("m"));
  const lisbon = createNode(s, underRoot)!;
  s.draft = "Lisbon";
  leave(s);
  beginDraft(s, lisbon, null);
  s.draft = "Lisbon — book the train";
  assert.equal(undo(s), true);
  assert.equal(text(s, lisbon), "Lisbon");
  assert.equal(s.edit, null);
  assert.equal(redo(s), true);
  assert.equal(text(s, lisbon), "Lisbon — book the train");
});

test("session: Tab → Paris → Enter → Rome → map undo takes Rome back whole and leaves Paris as typed; redo returns Rome", () => {
  const s = newSession(emptyDoc("m"));
  const paris = createNode(s, underRoot)!;
  s.draft = "Paris";
  const rome = createNode(s, sibling(paris))!;
  s.draft = "Rome";
  undo(s);
  assert.equal(text(s, paris), "Paris");
  assert.equal(text(s, rome), undefined);
  assert.equal(s.draft, null);
  redo(s);
  assert.equal(text(s, paris), "Paris");
  assert.equal(text(s, rome), "Rome");
});

test("session: flushing on close commits the text being typed as its own step and leaves the edit open", () => {
  let d = emptyDoc("m");
  let lisbon: string;
  [d, lisbon] = addChild(d, d.rootId, "Lisbon");
  const s = newSession(d);
  beginDraft(s, lisbon, null);
  s.draft = "Lisbon by train";
  flushDraft(s);
  assert.equal(text(s, lisbon), "Lisbon by train");
  assert.equal(s.history.past.length, 1);
  assert.equal(s.edit?.id, lisbon);
  // Nothing new typed: a second flush (quit after close) records nothing.
  flushDraft(s);
  assert.equal(s.history.past.length, 1);
});

test("session: opening a node and leaving it, closing the view or quitting writes nothing, whatever its text holds", () => {
  const notes = [
    "- Idea\n  ![[Other note]]\n",
    "- ![[pic.png]]\n  caption\n",
    "- a ![[pic.png]] b\n",
    "- a  \n",
    "- a\n  ![[pic.png]]\n  ![[Other note]]\n",
    "- see ![[Other note]] here\n",
    "- A\n\n  ![[x.png]]\n",
    "- ![[a.png]] first\n",
  ];
  for (const note of notes) {
    const d = fromMarkdownMap(note, "N");
    const id = d.nodes[d.rootId].children[0];
    // Click away (or Esc), and the view closing or the app quitting with the node still open.
    for (const end of [(s: Session) => leave(s), (s: Session) => leave(s, true), (s: Session) => flushDraft(s)]) {
      const s = newSession(d);
      beginDraft(s, id, null);
      end(s);
      assert.equal(s.doc, d, JSON.stringify(note));
      assert.equal(s.history.past.length, 0, JSON.stringify(note));
    }
  }
});

test("session: a ![[note]] line stays in the label as a link — typing keeps it, and Esc on a node holding only that keeps the node", () => {
  let d = emptyDoc("m");
  let idea: string, only: string;
  [d, idea] = addChild(d, d.rootId, "Idea\n![[Other note]]\n![[pic.png]]");
  [d, only] = addChild(d, d.rootId, "![[Other note]]");
  assert.equal(stripEmbeds(text(newSession(d), idea)!), "Idea\n![[Other note]]");
  const s = newSession(d);
  beginDraft(s, idea, null);
  // The label reports its text; the media under the node is added back.
  s.draft = withEmbeds("Big idea\n![[Other note]]", embedsOf(text(s, idea)!));
  leave(s);
  assert.equal(text(s, idea), "Big idea\n![[Other note]]\n![[pic.png]]");
  beginDraft(s, only, null);
  leave(s, true);
  assert.equal(text(s, only), "![[Other note]]");
});

test("session: typing, a change that takes the typing along, then typing back to the opening text still writes that text", () => {
  let d = emptyDoc("m");
  let a: string, b: string;
  [d, a] = addChild(d, d.rootId, "abc");
  [d, b] = addChild(d, d.rootId, "other");
  const s = newSession(d);
  beginDraft(s, a, null);
  s.draft = "abcd";
  // A colour, a task tick, an attachment for another node: the command builds on the map with the typing in it.
  assert.equal(addToNode(s, b, (t) => t + "!"), "doc");
  assert.equal(text(s, a), "abcd");
  s.draft = "abc";
  leave(s);
  assert.equal(text(s, a), "abc");
});

test("session: the same map read again from its file keeps the node being typed into and what was cut, though its id is new; another file starts over", () => {
  // A map whose file doesn't carry `idea-map: <id>` yet: every read mints the document a new id.
  const note = "---\nidea-map: 1\n---\n- Lisbon ^lisbon\n- Porto ^porto\n";
  const d = fromMarkdownMap(note, "Trip");
  const s = newSession(d);
  assert.equal(reload(s, d, "Trips/Trip.md"), "other");
  beginDraft(s, "lisbon", null);
  s.draft = "Lisbon by train";
  s.opened = new Set(["porto"]);
  // Sync changes another node.
  const synced = fromMarkdownMap(note.replace("Porto ^porto", "Porto and Braga ^porto"), "Trip");
  assert.notEqual(synced.id, d.id);
  assert.equal(reload(s, synced, "Trips/Trip.md"), null);
  assert.equal(s.doc, synced);
  assert.deepEqual([s.edit?.id, s.draft, s.opened.size], ["lisbon", "Lisbon by train", 1]);
  leave(s);
  assert.equal(text(s, "lisbon"), "Lisbon by train");
  assert.equal(text(s, "porto"), "Porto and Braga");
  // A history from before a reload never brings back the map as it was.
  assert.equal(reload(s, fromMarkdownMap(note, "Trip"), "Trips/Trip.md"), null);
  assert.equal(s.history.past.length, 0);
  // Cut in this map; a Sync pull keeps the cut a move.
  s.lastCut = { text: "- Porto and Braga\n", ids: ["porto"] };
  assert.equal(reload(s, fromMarkdownMap(note, "Trip"), "Trips/Trip.md"), null);
  assert.equal(s.lastCut?.ids[0], "porto");
  // Another file in the same view: pasting that text there makes new nodes, with no ids from this one.
  beginDraft(s, "porto", null);
  assert.equal(reload(s, fromMarkdownMap(note, "Plan"), "Plan.md"), "other");
  assert.deepEqual([s.edit, s.draft, s.initial, s.opened.size, s.lastCut], [null, null, null, 0, null]);
});

test("session: the file changes the node being typed into — the typing goes on top as an undo step, so ⌘Z brings the file's version back", () => {
  const note = "- Lisbon ^lisbon\n- Porto ^porto\n";
  const key = "Trip.md";
  const s = newSession(fromMarkdownMap(note, "Trip"));
  reload(s, s.doc, key);
  beginDraft(s, "lisbon", null);
  s.draft = "Lisbon by train";
  const synced = fromMarkdownMap(note.replace("Lisbon ^", "Lisbon, Sintra ^"), "Trip");
  assert.equal(reload(s, synced, key), "changed");
  assert.equal(text(s, "lisbon"), "Lisbon by train");
  assert.equal(s.history.past.length, 1);
  assert.equal(s.edit?.id, "lisbon");
  // Nothing typed since: ⌘Z is the map's, and takes the file's version back.
  assert.equal(typed(s), false);
  leave(s);
  assert.equal(s.history.past.length, 1);
  undo(s);
  assert.equal(text(s, "lisbon"), "Lisbon, Sintra");
  assert.equal(s.doc, synced);
});

test("session: the file changes a node that is only open — the edit takes the file's text, and leaving writes nothing", () => {
  const note = "- Lisbon ^lisbon\n";
  const s = newSession(fromMarkdownMap(note, "Trip"));
  reload(s, s.doc, "Trip.md");
  beginDraft(s, "lisbon", null);
  const synced = fromMarkdownMap("- Lisbon, Sintra ^lisbon\n  ![[tram.png]]\n", "Trip");
  assert.equal(reload(s, synced, "Trip.md"), "reopened");
  assert.deepEqual([s.draft, s.initial], ["Lisbon, Sintra\n![[tram.png]]", "Lisbon, Sintra\n![[tram.png]]"]);
  leave(s);
  assert.equal(s.doc, synced);
  assert.equal(s.history.past.length, 0);
});

test("session: the file deletes the node being typed into — the edit ends and nothing is put back", () => {
  const note = "- Lisbon ^lisbon\n- Porto ^porto\n";
  const s = newSession(fromMarkdownMap(note, "Trip"));
  reload(s, s.doc, "Trip.md");
  beginDraft(s, "lisbon", null);
  s.draft = "Lisbon by train";
  const synced = fromMarkdownMap("- Porto ^porto\n", "Trip");
  assert.equal(reload(s, synced, "Trip.md"), "removed");
  assert.deepEqual([s.edit, s.draft, s.initial], [null, null, null]);
  assert.equal(s.doc, synced);
  assert.equal(leave(s), null);
  assert.equal(s.doc, synced);
});

test("session: a reload that leaves the node being typed into as it was keeps the typing for when the node is left", () => {
  const note = "- Lisbon ^lisbon\n- Porto ^porto\n";
  const s = newSession(fromMarkdownMap(note, "Trip"));
  reload(s, s.doc, "Trip.md");
  // Enter makes a node, typing names it, and a colour change takes the typing into the map, which is saved.
  const faro = createNode(s, sibling("porto"))!;
  s.draft = "Faro";
  assert.equal(addToNode(s, "porto", (t) => t + "!"), "doc");
  s.draft = "Faro beach";
  // The save comes back with someone else's change to another node: nothing to tell.
  const saved = fromMarkdownMap(`- Lisbon, Sintra ^lisbon\n- Porto! ^porto\n- Faro ^${faro}\n`, "Trip");
  assert.equal(reload(s, saved, "Trip.md"), null);
  assert.equal(s.doc, saved);
  // Its making is no longer in the history: emptied and left with Esc, it goes as a step of its own.
  assert.equal(s.edit?.created, undefined);
  s.draft = "";
  leave(s, true);
  assert.equal(text(s, faro), undefined);
  undo(s);
  assert.equal(text(s, faro), "Faro");
  assert.equal(s.doc, saved);
});

test("session: after undo removes what was selected, the selection moves to the nearest surviving ancestor", () => {
  let d = emptyDoc("m");
  let trip: string;
  [d, trip] = addChild(d, d.rootId, "Trip");
  const s = newSession(d);
  // Enter by mistake: a new node, selected and open; then ⌘Z.
  const oops = createNode(s, child(() => trip))!;
  const after = s.doc;
  assert.equal(typed(s), false);
  undo(s);
  assert.equal(s.doc, d);
  const v = pruneView(after, s.doc, { selection: oops, multi: new Set(), focusId: oops, editId: oops });
  assert.ok(v);
  assert.equal(v.selection, trip);
  assert.equal(v.focusId, null);
  assert.equal(v.editId, null);
});

test("session: undoing a paste clears the multi-selection of pasted nodes; a gone branch hands the selection up past every gone level", () => {
  let d = emptyDoc("m");
  let a: string, b: string, c: string;
  [d, a] = addChild(d, d.rootId, "A");
  const base = d;
  [d, b] = addChild(d, a, "B");
  [d, c] = addChild(d, b, "C");
  const v = pruneView(d, base, { selection: c, multi: new Set([b, c]), focusId: null, editId: null });
  assert.ok(v);
  assert.equal(v.selection, a);
  assert.equal(v.multi.size, 0);
  // A reload with nothing gone changes nothing.
  assert.equal(pruneView(d, d, { selection: c, multi: new Set([b, c]), focusId: a, editId: c }), null);
  // Selection survives, one of three selected nodes is gone: the other two stay selected.
  const [d2, e] = addChild(d, a, "E");
  const v2 = pruneView(d2, d, { selection: b, multi: new Set([b, c, e]), focusId: null, editId: null });
  assert.deepEqual([...v2!.multi], [b, c]);
});

test("session: ⇧Enter on a node with an image, then leaving it, keeps one image", () => {
  let d = emptyDoc("m");
  let coffee: string;
  [d, coffee] = addChild(d, d.rootId, "Coffee\n![[shop.png]]");
  const s = newSession(d);
  // The edit opens on the text without its media; the break is typed into the label, which reports text only.
  beginDraft(s, coffee, null);
  assert.equal(s.draft, "Coffee\n![[shop.png]]");
  s.draft = withEmbeds("Coffee\n", embedsOf(text(s, coffee)!));
  leave(s);
  assert.equal(text(s, coffee), "Coffee\n![[shop.png]]");
});

test("session: starting an edit on the node already being typed into keeps what was typed", () => {
  let d = emptyDoc("m");
  let lisbon: string;
  [d, lisbon] = addChild(d, d.rootId, "Lisbon");
  const s = newSession(d);
  assert.equal(beginDraft(s, lisbon, null), true);
  s.draft = "Lisbon by train";
  assert.equal(typed(s), true);
  // A double-click on "train" inside the label.
  assert.equal(beginDraft(s, lisbon, null), false);
  assert.equal(s.draft, "Lisbon by train");
  assert.equal(beginDraft(s, "gone", null), false);
});

test("session: Tab → Alpha → Enter → Beta → Esc, then undo twice: Beta goes whole, then Alpha goes whole", () => {
  const s = newSession(emptyDoc("m"));
  const alpha = createNode(s, underRoot)!;
  s.draft = "Alpha";
  const beta = createNode(s, sibling(alpha))!;
  s.draft = "Beta";
  leave(s, true);
  assert.deepEqual([text(s, alpha), text(s, beta)], ["Alpha", "Beta"]);
  undo(s);
  assert.deepEqual([text(s, alpha), text(s, beta)], ["Alpha", undefined]);
  undo(s);
  assert.deepEqual([text(s, alpha), text(s, beta)], [undefined, undefined]);
  assert.equal(s.history.past.length, 0);
});

test("session: Esc on a node Tab just made takes it back without an undo step; Esc on an emptied old node removes it as one", () => {
  const s = newSession(emptyDoc("m"));
  const start = s.doc;
  const kept = createNode(s, underRoot)!;
  s.draft = "Kept";
  leave(s);
  const withKept = s.doc;
  const steps = s.history.past.length;
  const oops = createNode(s, sibling(kept))!;
  assert.equal(leave(s, true), kept);
  assert.equal(s.doc, withKept);
  assert.equal(s.history.past.length, steps);
  assert.equal(text(s, oops), undefined);
  // An existing node emptied and left with Esc still goes, as a step of its own.
  beginDraft(s, kept, null);
  s.draft = "";
  assert.equal(leave(s, true), s.doc.rootId);
  assert.equal(text(s, kept), undefined);
  undo(s);
  assert.equal(text(s, kept), "Kept");
  assert.notEqual(s.doc, start);
});

test("session: in the Outline, Enter → Tab → typing → Esc makes the indented child in one undo step", () => {
  let d = emptyDoc("m");
  let a: string;
  [d, a] = addChild(d, d.rootId, "A");
  const s = newSession(d);
  const b = createNode(s, sibling(a))!;
  restructure(s, b, (doc) => indent(doc, b));
  s.draft = "B";
  leave(s, true);
  assert.equal(s.doc.nodes[b]?.parent, a);
  assert.equal(text(s, b), "B");
  undo(s);
  assert.equal(s.doc, d);
});

test("session: Find opens folded branches on screen only; the next change carries them into the file", () => {
  let d = emptyDoc("m");
  let a: string, hit: string;
  [d, a] = addChild(d, d.rootId, "A");
  [d, hit] = addChild(d, a, "needle");
  d = toggleCollapse(d, a);
  const s = newSession(d);
  assert.equal(openTo(s, hit), true);
  assert.equal(s.doc, d);
  assert.equal(s.history.past.length, 0);
  assert.equal(unfold(s.doc, s.opened).nodes[a].collapsed, false);
  // Typing into the match and leaving it commits the text — and the unfold with it.
  beginDraft(s, hit, null);
  s.draft = "needle found";
  leave(s);
  assert.equal(s.doc.nodes[a].collapsed, false);
  assert.equal(s.opened.size, 0);
  assert.equal(s.history.past.length, 1);
});

test("session: history steps — commits sharing a key fold; Esc's take-back only works while that run is the latest", () => {
  const s = newSession(emptyDoc("m"));
  const [d1] = addChild(s.doc, s.doc.rootId, "x");
  commitStep(s, d1, "palette-0");
  const [d2] = addChild(s.doc, s.doc.rootId, "y");
  commitStep(s, d2, "palette-0");
  assert.equal(s.history.past.length, 1);
  assert.equal(s.history.drop("other"), null);
  assert.ok(s.history.drop("palette-0"));
  assert.equal(s.history.past.length, 0);
  assert.equal(withDraft(s.doc, null, "ignored"), s.doc);
});

test("session: a note dropped onto the node being typed into joins the draft, and leaving the node keeps it", () => {
  let d = emptyDoc("m");
  let lisbon: string;
  [d, lisbon] = addChild(d, d.rootId, "Lisbon");
  const s = newSession(d);
  beginDraft(s, lisbon, null);
  s.draft = "Lisbon trip";
  assert.equal(addToNode(s, lisbon, (t) => withLinks(t, ["[[Trains]]", "![[map.png]]"])), "draft");
  assert.equal(s.doc, d);
  leave(s);
  assert.equal(text(s, lisbon), "Lisbon trip [[Trains]]\n![[map.png]]");
});

test("session: an attachment that finishes saving lands on the map as it is now, not as it was when the save began", () => {
  let d = emptyDoc("m");
  let coffee: string;
  [d, coffee] = addChild(d, d.rootId, "Coffee");
  const s = newSession(d);
  // While the vault write is under way, Enter adds a sibling and it is named.
  const tea = createNode(s, sibling(coffee))!;
  s.draft = "Tea";
  leave(s);
  assert.equal(addToNode(s, coffee, (t) => withLinks(t, ["![[cup.png]]"])), "doc");
  assert.equal(text(s, tea), "Tea");
  assert.equal(text(s, coffee), "Coffee\n![[cup.png]]");
  // The node went during the save: nothing is committed.
  const steps = s.history.past.length;
  assert.equal(addToNode(s, "gone", (t) => t + "!"), null);
  assert.equal(s.history.past.length, steps);
});

test("session: a dropped map joins as one branch under the selection; the map it lands in keeps its root, notes and extras", () => {
  let trip = emptyDoc("Trip");
  let lisbon: string;
  [trip, lisbon] = addChild(trip, trip.rootId, "Lisbon");
  (trip as IODoc & { md?: unknown }).md = { frontmatter: "tags: [travel]" };
  let other = emptyDoc("Packing");
  other = { ...other, nodes: { ...other.nodes, [other.rootId]: { ...other.nodes[other.rootId], text: "Packing" } } };
  [other] = addChild(other, other.rootId, "Passport");
  [other] = addChild(other, other.rootId, "Charger");
  const [next, ids] = graft(trip, lisbon, asBranch(other));
  assert.equal(ids.length, 1);
  assert.equal(next.rootId, trip.rootId);
  assert.equal((next as IODoc & { md?: unknown }).md, (trip as IODoc & { md?: unknown }).md);
  assert.equal(next.nodes[ids[0]].parent, lisbon);
  assert.deepEqual(subtreeIds(next, ids[0]).map((id) => next.nodes[id].text), ["Packing", "Passport", "Charger"]);
});
