import { test } from "node:test";
import assert from "node:assert/strict";
import { PLUGIN_NAME } from "../src/brand.ts";
import { conversionChange, exportPath, frontmatterHead, linkAction, obsidianOpenFiles } from "../src/host-logic.ts";
import { isMarkdownMap } from "../src/organiser/model/markdown.ts";
import { loadHost } from "./host-bundle.ts";

// The host files import `obsidian`, which does not load under node --test. The decisions they delegate are tested
// directly; the load and save paths run on the real view code, bundled against a stand-in (see host-bundle.ts).

type Stub = { notices: string[]; TFile: new (p: string) => object; TFolder: new (p: string, c: object[]) => object };
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 0;

const lines = (...l: string[]) => l.join("\n");

test("open as map: an ordinary note the map would restructure is reported, not silently rewritten", () => {
  const note = lines(
    "---", "tags: [trip]", "---",
    "# Lisbon trip", "",
    "Intro paragraph about the trip. ^intro", "",
    "Second paragraph.", "",
    "## Packing", "- passport", "", "- charger", "",
    "## Notes", "Remember to call Ana.",
    "- day one", "  ```", "  if (x) {", "      go()", "  }", "  ```",
    "- UNC path", "  \\\\nas\\share", "",
  );
  // What such a note became two seconds after it was opened as a map, before the plugin asked first.
  const after = lines(
    "---", "idea-map: 34q9os", "tags: [trip]", "---",
    "# Lisbon trip", "Intro paragraph about the trip.", "Second paragraph.", "## Packing", "",
    "- passport ^cs3why", "- charger ^8afu15",
    "- day one", "  ```", "  if (x) {", "  go()", "  }", "  ``` ^dwbwng",
    "- UNC path", "  \\nas\\share ^l51jju", "",
    "## Notes", "Remember to call Ana.", "",
    "%%ideamap", "{\"v\":1,\"pos\":{}}", "%%", "",
  );
  const c = conversionChange(note, after);
  assert.ok(c, "the rewrite is noticed");
  assert.ok(c.lines >= 5, `several lines change (${c.lines})`);
  assert.equal(c.first, "Intro paragraph about the trip. ^intro");
});

type MapModule = Stub & { MapView: new (leaf: object, plugin: object) => Record<string, any> };
const mapView = async (file: string, app: object = { vault: {}, workspace: { on: () => ({}) } }) => {
  const m = await loadHost<MapModule>("../src/map-view.ts");
  (globalThis as { activeDocument?: unknown }).activeDocument = { body: { classList: { contains: () => false } } };
  const v = new m.MapView({ app }, { settings: {} });
  const name = file.slice(file.lastIndexOf("/") + 1);
  v.file = { path: file, name, basename: name.replace(/\.[^.]+$/, ""), extension: name.split(".").pop() };
  return { m, v };
};

/** A map with its layout block, so opening it needs no text measuring (there is no canvas under node). */
const tripMap = lines("---", "idea-map: r1", "---", "# Trip", "", "- Where ^a1", "", "%%ideamap", "{\"v\":1,\"pos\":{\"r1\":[0,0],\"a1\":[200,0]},\"collapsed\":[],\"links\":[],\"align\":{},\"branch\":{}}", "%%", "");
/** The same map with a node added somewhere else (Sync, another pane). */
const tripPulled = lines("---", "idea-map: r1", "---", "# Trip", "", "- Where ^a1", "- from my phone ^b1", "", "%%ideamap", "{\"v\":1,\"pos\":{\"r1\":[0,0],\"a1\":[200,0],\"b1\":[200,80]},\"collapsed\":[],\"links\":[],\"align\":{},\"branch\":{}}", "%%", "");

test("map view: opening a note asks for no save, and closing an unedited map writes nothing", async (t) => {
  // The note has no layout yet, so opening it measures text: a stand-in canvas, for this test only.
  const g = globalThis as { document?: unknown; activeDocument?: object };
  const measuring = { createElement: () => ({ getContext: () => ({ font: "", measureText: (s: string) => ({ width: s.length * 7 }) }) }) };
  g.document = measuring;
  t.after(() => { delete g.document; });
  const { v } = await mapView("Lisbon trip.md");
  g.activeDocument = { ...g.activeDocument, ...measuring };
  const note = lines("---", "tags: [trip]", "---", "# Lisbon trip", "", "Intro paragraph. ^intro", "", "## Packing", "- passport", "");
  v.load(note);
  assert.equal(v.loadError, null);
  assert.equal(v.saves, 0);
  assert.equal(v.getViewData(), note);
  await v.save();
  assert.equal(v.written, undefined);
  // An empty note gets no first content until something is added.
  const { v: empty } = await mapView("Untitled.md");
  empty.load("");
  assert.equal(empty.saves, 0);
  await empty.save();
  assert.equal(empty.written, undefined);
});

/** The map view with a layout step that always fails, so a note that needs laying out can't be read. */
const unreadableMapView = async (file: string) => {
  const m = await loadHost<MapModule>("../src/map-view.ts", { "./organiser/model/store": "export const DEFAULT_PREFS = {}; export const newDoc = () => ({}); export const seedCanvasPositions = () => { throw new Error('no room'); };" });
  const v = new m.MapView({ app: { vault: {}, workspace: { on: () => ({}) } } }, { settings: {} });
  const name = file.slice(file.lastIndexOf("/") + 1);
  v.file = { path: file, name, basename: name.replace(/\.[^.]+$/, ""), extension: name.split(".").pop() };
  return { m, v };
};

test("map view: a note that can't be read as a map stays as it is, with a notice", async () => {
  const { m, v } = await unreadableMapView("Trip.md");
  m.notices.length = 0;
  const text = lines("# Trip", "- a", "");
  v.load(text);
  assert.equal(v.saves, 0);
  assert.equal(v.getViewData(), text);
  assert.equal(m.notices.length, 1);
  assert.equal(v.commands(), null, "no editable map behind it");
  // A file that is not a Markdown note is never read as a map, and never written.
  const { m: other, v: canvas } = await mapView("Sketch.canvas");
  other.notices.length = 0;
  canvas.load("{\"nodes\":[]}");
  assert.notEqual(canvas.loadError, null);
  assert.equal(canvas.saves, 0);
  assert.equal(canvas.getViewData(), "{\"nodes\":[]}");
  assert.equal(other.notices.length, 1);
});

type Render = { props: { doc: any; onDoc(d: object): void; fileKey?: string } } | null;
/** A map view opened on a stand-in host, with React replaced by roots that record each render and pass it to `onRender`. */
const mountMap = async () => {
  const m = await loadHost<MapModule>("../src/map-view.ts", {
    "react-dom/client": "export const createRoot = () => { const r = { renders: [], render(el) { r.renders.push(el); globalThis.__onRender?.(el); }, unmount() {} }; globalThis.__roots.push(r); return r; };",
  });
  const g = globalThis as { __roots?: { renders: Render[]; unmount(): void }[]; __onRender?: (el: Render) => void; activeDocument?: unknown };
  g.__roots = [];
  g.__onRender = undefined;
  g.activeDocument = { body: { classList: { contains: () => false } } };
  let migrated = () => {};
  const host = { tabIndex: -1, addEventListener() {}, toggle() {}, onWindowMigrated: (fn: () => void) => { migrated = fn; return () => {}; } };
  const contentEl = { empty() {}, addClass() {}, createDiv: () => host };
  const v = new m.MapView({ app: { vault: {}, workspace: { on: () => ({}) } }, contentEl }, { settings: {} });
  v.file = { path: "Trip.md", name: "Trip.md", basename: "Trip", extension: "md" };
  await v.onOpen();
  v.load(tripMap);
  assert.equal(v.loadError, null);
  return { v, roots: g.__roots, onRender: (fn: (el: Render) => void) => { g.__onRender = fn; }, migrate: () => migrated() };
};

test("map view: once a reload can't be read or the view is cleared, a change still pending from the old map writes nothing", async () => {
  // The map has its layout block, so it reads without the layout step; the reload has none, and can't be read.
  const { v } = await unreadableMapView("Trip.md");
  v.load(tripMap);
  assert.equal(v.loadError, null);
  v.setApi({ reveal() {} });
  const pending = structuredClone(v.doc);
  pending.nodes.a1.text = "a pasted image landing late";
  // A Sync conflict leaves the file unreadable; then the old map's pending attachment arrives.
  const conflicted = lines("# Trip", "- a", "");
  v.setViewData(conflicted, false);
  assert.notEqual(v.loadError, null);
  assert.equal(v.doc, null, "no half-read map behind it");
  assert.equal(v.commands(), null, "no commands left for the old map");
  v.onDoc(pending);
  assert.equal(v.saves, 0);
  assert.equal(v.getViewData(), conflicted);

  const { v: w } = await mapView("Trip.md");
  w.load(tripMap);
  assert.equal(w.loadError, null);
  w.setApi({ reveal() {} });
  const late = structuredClone(w.doc);
  late.nodes.a1.text = "late";
  w.clear();
  assert.equal(w.commands(), null);
  w.onDoc(late);
  assert.equal(w.saves, 0);
  assert.equal(w.getViewData(), tripMap);

  // A reload that reads: the map may commit the node being typed on top of it from inside the render the reload
  // starts. That change goes through like any other.
  const { v: u, onRender } = await mountMap();
  const reloaded = tripPulled;
  let committed = false;
  onRender(el => { if (!el || committed) return; committed = true; const d = structuredClone(el.props.doc); d.nodes.a1.text = "Lisbon"; el.props.onDoc(d); });
  u.setViewData(reloaded, false);
  assert.equal(u.loadError, null);
  assert.ok(committed);
  assert.equal(u.saves, 1);
  assert.match(u.getViewData(), /^- Lisbon \^a1\n- from my phone \^b1$/m);
  assert.equal(u.data, u.getViewData());
});

test("open as map: ids, the map key (either format), the layout block and blank lines around lists are not changes", () => {
  const note = lines("# Trip", "- Where", "  - Lisbon", "- When", "");
  const out = lines("---", "idea-map: r1", "---", "# Trip", "", "- Where ^a1", "  - Lisbon ^a2", "- When ^b1", "", "%%ideamap", "{\"v\":1}", "%%", "");
  assert.equal(conversionChange(note, out), null);
  // Windows line endings and an idea-map value the map replaces with the root id.
  assert.equal(conversionChange(note.replace(/\n/g, "\r\n"), out), null);
  assert.equal(conversionChange(lines("---", "idea-map: 1", "---", "# Trip", "- Where ^a1", "  - Lisbon", "- When"), out), null);
  // A map the plugin wrote comes back as it went in.
  assert.equal(conversionChange(out, out), null);
  // The same holds for the key and layout block new maps are written with, and a user's own %% comment is still text.
  const current = out.replace("idea-map: r1", "ideascape: r1").replace("%%ideamap", "%%ideascape");
  assert.equal(conversionChange(note, current), null);
  assert.equal(conversionChange(lines("---", "ideascape: 1", "---", "# Trip", "- Where ^a1", "  - Lisbon", "- When"), current), null);
  assert.notEqual(conversionChange(note, current.replace("%%ideascape", "%%ideascape-notes")), null);
  // Blank lines beside a heading, or above a list that follows prose, change nothing either.
  assert.equal(conversionChange(lines("Para", "# Title", "- a"), lines("Para", "", "# Title", "", "- a ^x1")), null);
  assert.equal(conversionChange(lines("Para", "- a"), lines("Para", "", "- a ^x1")), null);
});

/** A note as the map would write it: the marker, the given lines, the layout block. */
const written = (...l: string[]) => lines("---", "idea-map: r1", "---", ...l, "", "%%ideamap", "{}", "%%", "");

test("open as map: a blank line the map would drop between items, or inside an item, counts (loose lists)", () => {
  // A loose list comes back tight.
  assert.deepEqual(conversionChange(lines("# T", "", "- passport", "", "- charger"), written("# T", "", "- passport ^x1", "- charger ^x2")), { lines: 1, first: "- charger" });
  assert.equal(conversionChange(lines("- a", "  more", "", "- b"), written("- a", "  more ^x1", "- b ^x2"))?.first, "- b");
  // An item's second paragraph joins its first; an indented code block under an item becomes text.
  assert.deepEqual(conversionChange(lines("- a", "", "  second para", "- b"), written("- a", "  second para ^x1", "- b ^x2")), { lines: 1, first: "second para" });
  assert.equal(conversionChange(lines("- a", "", "      code"), written("- a", "      code ^x1"))?.first, "code");
});

test("open as map: a block id or blank line added inside a top-level code block, comment or math block counts", () => {
  // What the map made of list lines inside these blocks: nodes, with ids and blank lines written inside.
  assert.deepEqual(conversionChange(lines("Intro", "", "```md", "- one", "- two", "```"), written("Intro", "", "```md", "", "- one ^x1", "- two ^x2", "", "```")), { lines: 3, first: "- one" });
  assert.equal(conversionChange(lines("%%", "- hidden", "%%", "- real"), written("%%", "", "- hidden ^x1", "%%", "- real ^x2"))?.first, "- hidden");
  assert.equal(conversionChange(lines("<!--", "- hidden", "-->", "- real"), written("<!--", "", "- hidden ^x1", "-->", "- real ^x2"))?.first, "- hidden");
  assert.equal(conversionChange(lines("$$", "- x", "$$", "- a"), written("$$", "", "- x ^x1", "$$", "- a ^x2"))?.first, "- x");
  // An id alone is enough, and so is a blank line alone.
  assert.equal(conversionChange(lines("~~~", "- one", "~~~"), written("~~~", "- one ^x1", "~~~"))?.first, "- one");
  assert.equal(conversionChange(lines("````js", "a();", "b();", "````"), written("````js", "a();", "", "b();", "````"))?.first, "b();");
  // Blank lines added around a block are not changes, and list-like lines inside one make no list: a longer fence
  // closes only on a fence as long (a ~~~~ fence around a ~~~ one).
  assert.equal(conversionChange(lines("~~~~ js", "- one", "~~~", "- two", "~~~~~", "- real"), written("~~~~ js", "- one", "~~~", "- two", "~~~~~", "", "- real ^x1")), null);
  assert.equal(conversionChange(lines("Intro", "```", "code", "```", "After", "", "- a"), written("Intro", "", "```", "code", "```", "", "After", "", "- a ^x1")), null);
  // Blocks the map leaves as they are, a fence inside an item, and a one-line comment are not changes.
  assert.equal(conversionChange(lines("```md", "- one", "```", "", "- real"), written("```md", "- one", "```", "", "- real ^x1")), null);
  assert.equal(conversionChange(lines("- a", "  ```", "  - not an item", "  ```"), written("- a ^x1", "  ```", "  - not an item", "  ```")), null);
  assert.equal(conversionChange(lines("%%note%%", "- a"), written("%%note%%", "", "- a ^x1")), null);
});

test("open as map: an older map whose node ends in code is not asked about for its id moving to the node's first line", () => {
  const before = written("# Trip", "", "- a", "  ```js", "  - x", "  ```  ^a1", "- [ ] b", "  ~~~", "  y", "  ~~~ ^b1", "- c ^c1");
  const after = written("# Trip", "", "- a ^a1", "  ```js", "  - x", "  ```", "- [ ] b ^b1", "  ~~~", "  y", "  ~~~", "- c ^c1");
  assert.equal(conversionChange(before, after), null);
  // Older maps also wrote a blank line inside a node's code as `\`, which the map now writes as a blank line.
  assert.equal(conversionChange(written("# Trip", "", "- a", "  ```", "  one", "  \\", "  two", "  ``` ^a1"), written("# Trip", "", "- a ^a1", "  ```", "  one", "", "  two", "  ```")), null);
  // An id that lands on another node, or on no node, is still a change.
  assert.equal(conversionChange(before, written("# Trip", "", "- a", "  ```js", "  - x", "  ```", "- [ ] b ^b1", "  ~~~", "  y", "  ~~~", "- c ^a1"))?.first, "```  ^a1");
  assert.equal(conversionChange(lines("Para", "``` ^p1"), lines("Para ^p1", "```"))?.first, "``` ^p1");
  // A `^word` at the end of a code line is code, not an old id: moving it to the head still asks.
  const code = written("# Trip", "", "- Compare with main", "  ```sh", "  git log --oneline HEAD ^main", "  ```");
  const moved = written("# Trip", "", "- Compare with main ^main", "  ```sh", "  git log --oneline HEAD", "  ```");
  assert.equal(conversionChange(code, moved)?.first, "git log --oneline HEAD ^main");
});

test("open as map: merged paragraphs, dropped block ids, lost frontmatter and added text all count", () => {
  const merged = conversionChange(lines("# T", "", "One.", "", "Two.", "", "- a"), lines("# T", "One.", "Two.", "", "- a ^x"));
  assert.deepEqual(merged, { lines: 1, first: "Two." });
  const droppedId = conversionChange(lines("# T", "", "Para ^intro", "", "- a"), lines("# T", "Para", "", "- a ^x"));
  assert.equal(droppedId?.first, "Para ^intro");
  const frontmatter = conversionChange(lines("---", "tags: [a]", "aliases: [b]", "---", "- a"), lines("---", "idea-map: x", "tags: [a]", "---", "- a ^x"));
  assert.equal(frontmatter?.first, "aliases: [b]");
  const added = conversionChange(lines("- a"), lines("# Title", "", "- a ^x"));
  assert.deepEqual(added, { lines: 1, first: "# Title" });
  // A changed id breaks links into the note, so it is a change too.
  assert.equal(conversionChange(lines("- a ^a1"), lines("- a ^zz9"))?.first, "- a ^a1");
});

test("open as map: the summary line stays short", () => {
  const long = "A very long paragraph that keeps going well past the width a dialog line should carry.";
  const c = conversionChange(lines("# T", "", `${long} ^intro`, "", "- a"), lines("# T", long, "", "- a ^x"));
  assert.ok(c && c.first.length <= 60 && c.first.endsWith("…"));
});

test("export: never the map itself, never an existing note — the next free name instead", () => {
  const map = (path: string) => ({ path, basename: path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, ""), dir: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/" });
  const vault = (...paths: string[]) => (p: string) => paths.includes(p);
  // ExportSheet names the file slug(root text); these are names that collide.
  assert.equal(exportPath("untitled.md", map("Untitled.md"), vault("Untitled.md")), "Untitled-2.md");
  assert.equal(exportPath("untitled.canvas", map("Untitled.md"), vault("Untitled.md", "Untitled.canvas")), "Untitled-2.canvas");
  assert.equal(exportPath("trip.md", map("maps/trip.md"), vault("maps/trip.md")), "maps/trip-2.md");
  assert.equal(exportPath("202609131200.md", map("202609131200.md"), vault("202609131200.md")), "202609131200-2.md");
  assert.equal(exportPath("reading-list.md", map("maps/Planning.md"), vault("maps/Planning.md", "maps/reading-list.md", "maps/reading-list-2.md")), "maps/reading-list-3.md");
  // The map's own path is refused even when the vault lookup misses it, and whatever its case.
  assert.equal(exportPath("trip.md", map("maps/Trip.md"), () => false), "maps/trip-2.md");
  // A free name is used as is.
  assert.equal(exportPath("reading-list.opml", map("maps/Planning.md"), vault("maps/Planning.md")), "maps/reading-list.opml");
  assert.equal(exportPath("untitled.png", null, () => false), `${PLUGIN_NAME}.png`);
});

test("new files: a name that differs only in case, or is taken between the look and the write, gets the next free name; other failures are the caller's to report", async () => {
  const m = await loadHost<Stub & { writeUnique: (app: object, folder: string, name: string, content: string) => Promise<{ path: string }> }>("../src/vault.ts");
  const made: string[] = [];
  let race = new Set<string>();
  const trip = new m.TFile("maps/trip.md");
  const maps = new m.TFolder("maps", [trip]);
  const app = { vault: {
    getAbstractFileByPath: (p: string) => (p === "maps" ? maps : p === "maps/trip.md" ? trip : null),
    getRoot: () => new m.TFolder("/", [maps]),
    createFolder: async () => {},
    // obsidian: create refuses a path the disk already has, and macOS and Windows disks ignore case.
    create: async (p: string) => { if (race.has(p)) { race.delete(p); throw new Error("File already exists."); } made.push(p); return new m.TFile(p); },
  } };
  assert.equal((await m.writeUnique(app, "maps", "Trip.md", "x")).path, "maps/Trip-2.md");
  race = new Set(["maps/Idea.md"]);
  assert.equal((await m.writeUnique(app, "maps", "Idea.md", "x")).path, "maps/Idea-2.md", "a second click took the name first");
  // A refusal worded some other way still moves on to the next name when the vault now has the file.
  const lookup = app.vault.getAbstractFileByPath;
  const appeared = new Set<string>();
  app.vault.getAbstractFileByPath = (p: string) => (appeared.has(p) ? new m.TFile(p) : lookup(p));
  app.vault.create = async (p: string) => { if (p === "maps/Plan.md") { appeared.add(p); throw new Error("EEXIST"); } made.push(p); return new m.TFile(p); };
  assert.equal((await m.writeUnique(app, "maps", "Plan.md", "x")).path, "maps/Plan-2.md");
  app.vault.create = async () => { throw new Error("EACCES: permission denied"); };
  await assert.rejects(m.writeUnique(app, "maps", "Idea.md", "x"), /EACCES/);
});

/* ---------- quit and background saves ---------- */

test("map view: an edit leaves `data` different from what was saved, which is what Obsidian's quit save checks", async () => {
  const { v } = await mapView("Trip.md");
  const note = lines("---", "idea-map: r1", "---", "# Lisbon trip", "", "- Where ^a1", "", "%%ideamap", "{\"v\":1,\"pos\":{\"r1\":[0,0],\"a1\":[200,0]},\"collapsed\":[],\"links\":[],\"align\":{},\"branch\":{}}", "%%", "");
  v.load(note);
  const next = structuredClone(v.doc);
  next.nodes[next.rootId].text = "Porto trip";
  v.onDoc(next);
  assert.equal(v.saves, 1);
  assert.notEqual(v.data, v.lastSavedData);
  assert.equal(v.data, v.getViewData());
  assert.match(v.data, /^# Porto trip$/m);
});

test("map view: a save waits for the one being written, so ⌘Q soon after an edit and closing mid-save keep the node being typed", async () => {
  const note = tripMap;
  type Tasks = { addPromise(p: Promise<unknown>): void };
  const open = async () => {
    const disk = { text: note };
    // obsidian: the workspace's own quit handler is registered first; it saves every text view whose data changed.
    const quit: ((t: Tasks) => void)[] = [(t) => { if (v.saving) t.addPromise(Promise.resolve()); if (v.data !== v.lastSavedData) t.addPromise(v.save()); }];
    const vault = { modify: async (_f: unknown, text: string) => { await new Promise(r => setTimeout(r, 15)); disk.text = text; } };
    const { v } = await mapView("Trip.md", { vault, workspace: { on: (name: string, fn: (t: Tasks) => void) => { if (name === "quit") quit.push(fn); return {}; } } });
    v.load(note);
    // The map's session, as far as the host sees it: a draft that flushEdit commits through onDoc.
    let draft: string | null = null;
    v.setApi({ flushEdit: () => { if (draft === null) return; const d = structuredClone(v.doc); d.nodes.a1.text = draft; draft = null; v.onDoc(d); }, typed: () => false });
    const type = (text: string) => { draft = text; };
    const edit = (text: string) => { const d = structuredClone(v.doc); d.nodes.a1.text = text; v.onDoc(d); };
    // ⌘Q: Obsidian triggers "quit", waits for the promises handed to it, then closes the window.
    const pressQuit = async () => { const ps: Promise<unknown>[] = []; for (const h of quit) h({ addPromise: p => ps.push(p) }); await Promise.all(ps); return disk.text; };
    return { v, disk, type, edit, pressQuit };
  };

  const a = await open();
  a.type("Lisbon");
  assert.match(await a.pressQuit(), /- Lisbon \^a1/, "typing only, then ⌘Q");

  const b = await open();
  b.edit("Where to");
  b.type("Lisbon");
  assert.match(await b.pressQuit(), /- Lisbon \^a1/, "an edit under 2 s ago, typing, then ⌘Q");

  const c = await open();
  c.type("Lisbon");
  c.edit("Where to");
  const inflight = c.v.save(); // the 2-second debounce firing
  await c.v.onClose();         // the tab closed while that write is under way
  assert.match(c.disk.text, /- Lisbon \^a1/, "closing the tab during a save");
  await inflight;
});

test("map view: a change still on its way from the map a tab showed before is not written into the file it switched to", async () => {
  const { v, roots } = await mountMap();
  const lastProps = () => roots.at(-1)!.renders.filter(Boolean).at(-1)!.props;
  const fromA = lastProps().onDoc;
  const a = structuredClone(lastProps().doc);
  // obsidian: the same tab opens map B — FileView.loadFile clears the view and reads B.
  v.clear();
  v.file = { path: "Other.md", name: "Other.md", basename: "Other", extension: "md" };
  v.load(tripPulled);
  const b = v.data;
  a.nodes.a1.text = "late import";
  fromA(a);
  assert.equal(v.data, b, "B's text is untouched");
  assert.ok(v.doc.nodes.b1, "the view still holds B");
  assert.notEqual(lastProps().onDoc, fromA, "B's map got its own onDoc");
});

test("map view: a change made against the map before a reload from disk is not written over what arrived", async () => {
  const { v, roots } = await mountMap();
  const lastProps = () => roots.at(-1)!.renders.filter(Boolean).at(-1)!.props;
  const before = lastProps().onDoc;
  const stale = structuredClone(lastProps().doc);
  v.setViewData(tripPulled, false); // Sync brings a node from the phone
  stale.nodes.a1.text = "late attachment";
  before(stale);
  assert.ok(v.doc.nodes.b1, "the node from the phone is still there");
  const after = structuredClone(lastProps().doc);
  after.nodes.a1.text = "typed on top";
  lastProps().onDoc(after);
  assert.equal(v.doc.nodes.a1.text, "typed on top", "a change from the render that shows the reload is taken");
  assert.ok(v.doc.nodes.b1);
});

test("map view: renaming the map, then a change from disk, is still the same map to MapApp", async () => {
  const { v, roots } = await mountMap();
  const key = () => roots.at(-1)!.renders.filter(Boolean).at(-1)!.props.fileKey;
  const before = key();
  v.file = { path: "Trips/Lisbon.md", name: "Lisbon.md", basename: "Lisbon", extension: "md" };
  v.setViewData(tripPulled, false);
  assert.equal(key(), before);
});

test("map view: opening another file in the same tab writes the node being typed into the file it came from", async () => {
  const disk = { text: tripMap };
  const vault = { modify: async (_f: unknown, text: string) => { disk.text = text; } };
  const { v } = await mapView("Trip.md", { vault, workspace: { on: () => ({}) } });
  v.load(tripMap);
  let draft: string | null = "Lisbon";
  v.setApi({ flushEdit: () => { if (draft === null) return; const d = structuredClone(v.doc); d.nodes.a1.text = draft; draft = null; v.onDoc(d); }, typed: () => true });
  // obsidian: a link or the file explorer opens another note here — FileView.loadFile unloads this one, which saves it.
  await v.onUnloadFile(v.file);
  assert.match(disk.text, /- Lisbon \^a1/);
});

test("map view: a tab moved to another window commits the node being typed before the map mounts again there", async () => {
  const { v, roots, migrate } = await mountMap();
  const order: string[] = [];
  v.setApi({ flushEdit: () => { order.push("flush"); const d = structuredClone(v.doc); d.nodes.a1.text = "Lisbon"; v.onDoc(d); } });
  roots[0]!.unmount = () => { order.push("unmount"); };
  migrate();
  assert.deepEqual(order, ["flush", "unmount"]);
  assert.equal(roots.length, 2);
  assert.equal(roots[1]!.renders.at(-1)!.props.doc.nodes.a1.text, "Lisbon", "the new mount starts from the committed text");
  assert.equal(v.saves, 1);
});

test("map view: while the Export or Shortcuts sheet is open, the map's shortcuts don't act on the map behind it", async () => {
  const { v } = await mapView("Trip.md");
  v.load(tripMap);
  const did: string[] = [];
  v.setApi({ shift: (shape: string) => did.push(shape), undo: () => did.push("undo"), format: (f: string) => did.push(f), typed: () => false });
  const chord = (modifiers: string[], key: string) => v.scope.keys.find((k: { modifiers: string[]; key: string }) => k.key === key && k.modifiers.join() === modifiers.join()).func as (e: object) => boolean;
  let sheet = true;
  v.hostEl = { contains: () => true, querySelector: (sel: string) => (sheet && sel.includes("dialog") ? {} : null) };
  // Focus is on the sheet, inside the map's host.
  (globalThis as { activeDocument?: unknown }).activeDocument = { activeElement: { nodeType: 1, tagName: "DIV", classList: { contains: () => false } } };
  for (const [mods, key] of [[["Mod"], "1"], [["Mod"], "Z"], [["Mod"], "B"]] as const) assert.equal(chord([...mods], key)({ key: key.toLowerCase() }), true, key);
  assert.deepEqual(did, []);
  sheet = false;
  assert.equal(chord(["Mod"], "1")({ key: "1" }), false);
  assert.deepEqual(did, ["map"]);
});

test("map view: zoom is ⌥⌘= ⌥⌘- and ⇧⌘0, never ⌘= ⌘- ⌘0, which Obsidian's View menu takes before the page sees them", async () => {
  const { v } = await mapView("Trip.md");
  v.load(tripMap);
  const did: string[] = [];
  v.setApi({ zoomBy: (f: number) => did.push(f > 1 ? "in" : "out"), fit: () => did.push("fit"), typed: () => false });
  const keys = v.scope.keys as { modifiers: string[]; key: string; func: (e: object) => boolean }[];
  const find = (modifiers: string[], key: string) => keys.find((k) => k.key === key && k.modifiers.join() === modifiers.join());
  for (const key of ["=", "-", "0"]) assert.equal(find(["Mod"], key), undefined, `⌘${key} is left to Obsidian`);
  v.hostEl = { contains: () => true, querySelector: () => null };
  (globalThis as { activeDocument?: unknown }).activeDocument = { activeElement: { nodeType: 1, tagName: "DIV", classList: { contains: () => false } } };
  find(["Mod", "Alt"], "=")!.func({ key: "≠" });
  find(["Mod", "Alt"], "-")!.func({ key: "–" });
  find(["Mod", "Shift"], "0")!.func({ key: ")" });
  assert.deepEqual(did, ["in", "out", "fit"]);
});

/* ---------- reload from disk ---------- */

test("map view: text arriving from disk that this view didn't write clears undo", async () => {
  const { v } = await mapView("Trip.md");
  v.load(tripMap);
  const e0 = v.epoch;
  v.setViewData(tripPulled, false);
  assert.equal(v.loadError, null);
  assert.equal(v.epoch, e0 + 1, "a Sync pull starts a fresh history");
  const next = structuredClone(v.doc);
  next.nodes.a1.text = "alpha";
  v.onDoc(next);
  assert.equal(v.saves, 1);
  v.setViewData(v.getViewData(), false);
  assert.equal(v.epoch, e0 + 1, "the view's own write coming back is not a reload");
});

/* ---------- links ---------- */

test("links: web and email open, Obsidian links ask, everything else is refused with a reason", () => {
  for (const href of ["https://example.com", "HTTP://example.com/a?b", "mailto:ana@example.com", " https://x.y "]) assert.equal(linkAction(href).action, "open", href);
  assert.equal(linkAction("obsidian://new?content=hi").action, "confirm");
  for (const href of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "vbscript:x", "notes/a.md", "C:\\temp"]) {
    const how = linkAction(href);
    assert.equal(how.action, "refuse", href);
    assert.ok("reason" in how && how.reason.length > 0);
  }
});

test("drag: a malformed obsidian:// link is skipped instead of throwing on every dragover", () => {
  const text = "obsidian://open?vault=V&file=Trips%2FLisbon\nobsidian://open?vault=V&file=bad%\nobsidian://open?file=Caf%C3%A9";
  assert.deepEqual(obsidianOpenFiles(text), ["Trips/Lisbon", "Café"]);
});

test("map detection: a marker after 2,000 characters of frontmatter is still found", () => {
  const tags = Array.from({ length: 300 }, (_, i) => `  - topic-${i}`).join("\n");
  const note = `---\ntags:\n${tags}\nidea-map: r1\n---\n# Trip\n- a ^a1\n`;
  assert.equal(isMarkdownMap(note.slice(0, 2000)), false, "the old fixed read missed it");
  assert.equal(isMarkdownMap(frontmatterHead(note)), true);
  assert.equal(frontmatterHead(note).endsWith("idea-map: r1\n---\n"), true);
  assert.equal(frontmatterHead("# No frontmatter\n---\n"), "");
  assert.equal(frontmatterHead("---\r\nidea-map: x\r\n---\r\nbody"), "---\r\nidea-map: x\r\n---\r\n");
  assert.equal(frontmatterHead("---\nnever closed\n"), "");
});

/* ---------- explorer badges ---------- */

test("explorer badges: only rendered rows are looked up, and a pass still pending at unload puts nothing back", async () => {
  const m = await loadHost<Stub & { module: { default: new (app: object, manifest: object) => Record<string, any> } }>("../src/main.ts");
  type Row = { dataset: { path: string }; tag: object | null; querySelector(): object | null; createDiv(): void };
  const row = (path: string): Row => {
    const r: Row = { dataset: { path }, tag: null, querySelector: () => r.tag, createDiv: () => { r.tag = { remove: () => { r.tag = null; } }; } };
    return r;
  };
  const rows = [row("maps/Trip.md"), row("notes/a.md"), row("img.png")];
  let passes = 0;
  (globalThis as { activeDocument?: unknown }).activeDocument = {
    querySelectorAll: (sel: string) => { if (sel.includes("io-map-tag")) return rows.flatMap(r => (r.tag ? [r.tag] : [])); passes++; return rows; },
  };
  const trip = new m.TFile("maps/Trip.md"), note = new m.TFile("notes/a.md");
  const on = () => ({});
  (globalThis as { window?: unknown }).window ??= globalThis;
  const app = {
    vault: { on, getMarkdownFiles: () => { throw new Error("the whole vault was scanned"); }, getAbstractFileByPath: (p: string) => (p === "maps/Trip.md" ? trip : p === "notes/a.md" ? note : null) },
    metadataCache: { on, getFileCache: (f: object) => ({ frontmatter: f === trip ? { "idea-map": "r1" } : { tags: [] } }) },
    workspace: { on, onLayoutReady: () => {}, getLeavesOfType: () => [] },
  };
  const plugin = new m.module.default(app, {});
  await plugin.onload();
  plugin.decorateExplorer();
  assert.deepEqual(rows.map(r => !!r.tag), [true, false, false]);
  plugin.scheduleBadges();
  const before = passes;
  plugin.unload();
  assert.deepEqual(rows.map(r => !!r.tag), [false, false, false], "unload takes the badges off");
  await new Promise(r => setTimeout(r, 160));
  assert.equal(passes, before, "the pending pass never ran");
  assert.deepEqual(rows.map(r => !!r.tag), [false, false, false]);
});
