import { Menu, Modal, Notice, Plugin, TFile, TFolder, type App, type WorkspaceLeaf } from "obsidian";
import { MapView, MAP_VIEW_TYPE } from "./map-view.ts";
import { newDoc, seedCanvasPositions, starterDoc } from "./organiser/model/store";
import { ORG_CHART } from "./organiser/model/types";
import { fromMarkdownMap, hasMapKey, isMarkdownMap, toMarkdownMap } from "./organiser/model/markdown";
import { writeUnique } from "./vault.ts";
import { conversionChange, frontmatterHead } from "./host-logic.ts";
import { DEFAULT_SETTINGS, MapSettingTab, type MapSettings } from "./settings.ts";
import { PLUGIN_NAME } from "./brand.ts";

export default class MapPlugin extends Plugin {
  settings: MapSettings = { ...DEFAULT_SETTINGS };
  /** Map files the person asked to see as Markdown; cleared when the file is closed. */
  readonly markdownOverride = new Set<string>();
  private ribbonEl: HTMLElement | null = null;

  /** The ribbon button follows the setting, without a reload. It opens a short menu: a new map, and the
   *  note in front of you as a map. */
  applyRibbon(): void {
    if (this.settings.showRibbon && !this.ribbonEl) this.ribbonEl = this.addRibbonIcon("lightbulb", PLUGIN_NAME, evt => this.showRibbonMenu(evt));
    else if (!this.settings.showRibbon && this.ribbonEl) { this.ribbonEl.remove(); this.ribbonEl = null; }
  }

  private showRibbonMenu(evt: MouseEvent): void {
    const menu = new Menu();
    menu.addItem(i => i.setTitle("New map").setIcon("git-branch").onClick(() => void this.newMap()));
    const f = this.noteToConvert();
    if (f) menu.addItem(i => i.setTitle(`Open “${f.basename}” as a map`).setIcon("git-branch").onClick(() => void this.openMap(f)));
    menu.showAtMouseEvent(evt);
  }

  /** The Markdown note in front of the person, if it is not already showing as a map. */
  private noteToConvert(): TFile | null {
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (!leaf || leaf.getViewState().type !== "markdown") return null;
    const p = leafFilePath(leaf);
    const f = p ? this.app.vault.getAbstractFileByPath(p) : null;
    return f instanceof TFile && f.extension === "md" ? f : null;
  }

  /* ---------- file explorer badges: a marked note wears a MAP tag, the way other file types wear theirs ---------- */

  private badgeTimer: number | null = null;
  private explorerObserver: MutationObserver | null = null;
  private observedExplorer: HTMLElement | null = null;
  /** Set as the plugin unloads, so a badge pass already scheduled puts nothing back. */
  private unloaded = false;

  scheduleBadges(): void {
    if (this.unloaded) return;
    if (this.badgeTimer) window.clearTimeout(this.badgeTimer);
    this.badgeTimer = window.setTimeout(() => { this.badgeTimer = null; this.decorateExplorer(); }, 120);
  }

  /** Only the rows the explorer has rendered are looked up, one metadata-cache read each, not the whole vault. */
  decorateExplorer(): void {
    if (this.unloaded) return;
    for (const el of Array.from(activeDocument.querySelectorAll<HTMLElement>(".nav-file-title[data-path]"))) {
      const path = el.dataset.path ?? "";
      const f = this.settings.explorerBadges && path.endsWith(".md") ? this.app.vault.getAbstractFileByPath(path) : null;
      const fm = f instanceof TFile ? this.app.metadataCache.getFileCache(f)?.frontmatter : undefined;
      const tag = el.querySelector<HTMLElement>(".nav-file-tag.io-map-tag");
      if (hasMapKey(fm)) { if (!tag) el.createDiv({ cls: "nav-file-tag io-map-tag", text: "map" }); }
      else tag?.remove();
    }
  }

  private observeExplorer(): void {
    const view = this.app.workspace.getLeavesOfType("file-explorer")[0]?.view as { containerEl?: HTMLElement } | undefined;
    const el = view?.containerEl;
    if (!el || el === this.observedExplorer) return;
    this.explorerObserver?.disconnect();
    // The explorer re-renders its rows as folders open and the list scrolls; our own badge
    // insertions trigger this too, but decorating is idempotent, so it settles at once.
    this.explorerObserver = new MutationObserver(() => this.scheduleBadges());
    this.explorerObserver.observe(el, { childList: true, subtree: true });
    this.observedExplorer = el;
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(MAP_VIEW_TYPE, leaf => new MapView(leaf, this));
    this.registerHoverLinkSource(MAP_VIEW_TYPE, { display: PLUGIN_NAME, defaultMod: true });
    this.applyRibbon();

    this.addCommand({ id: "new-map", name: "Create a new map", callback: () => void this.newMap() });
    this.addCommand({ id: "starter-map", name: "Open the starter map", callback: () => void this.newMap("Start here", undefined, starterDoc()) });
    this.addCommand({ id: "map-export", name: "Export map…", checkCallback: c => this.withMap(c, a => a.export()) });
    this.addCommand({ id: "map-focus", name: "Focus on the selected branch", checkCallback: c => this.withMap(c, a => a.toggleFocus()) });
    this.addCommand({ id: "map-fit", name: "Fit map to window", checkCallback: c => this.withMap(c, a => a.fit()) });
    this.addCommand({ id: "map-layout", name: ORG_CHART ? "Next map layout: mind map, org chart or free" : "Next map layout: mind map or free", checkCallback: c => this.withMap(c, a => a.toggleLayout()) });
    this.addCommand({ id: "map-tidy", name: "Tidy the map layout", checkCallback: c => this.withMap(c, a => a.tidy()) });
    // Every keyboard action has a palette twin, so it is discoverable and rebindable.
    this.addCommand({ id: "map-edit", name: "Edit the selected node", checkCallback: c => this.withMap(c, a => a.toggleEdit()) });
    this.addCommand({ id: "map-add-child", name: "Add child node", checkCallback: c => this.withMap(c, a => a.addChild()) });
    this.addCommand({ id: "map-add-sibling", name: "Add sibling node", checkCallback: c => this.withMap(c, a => a.addSibling()) });
    this.addCommand({ id: "map-delete", name: "Delete selected nodes", checkCallback: c => this.withMap(c, a => a.deleteSelection()) });
    this.addCommand({ id: "map-collapse", name: "Collapse or expand the selected node", checkCallback: c => this.withMap(c, a => a.toggleCollapse()) });
    this.addCommand({ id: "map-find", name: "Find in map", checkCallback: c => this.withMap(c, a => a.search()) });
    this.addCommand({ id: "map-select-all", name: "Select all nodes", checkCallback: c => this.withMap(c, a => a.selectAll()) });
    this.addCommand({ id: "map-copy", name: "Copy selected branches", checkCallback: c => this.withMap(c, a => void a.copy(false)) });
    this.addCommand({ id: "map-cut", name: "Cut selected branches", checkCallback: c => this.withMap(c, a => void a.copy(true)) });
    this.addCommand({ id: "map-paste", name: "Paste as child nodes", checkCallback: c => this.withMap(c, a => void a.paste()) });
    this.addCommand({ id: "map-undo", name: "Undo in map", checkCallback: c => this.withMap(c, a => a.undo()) });
    this.addCommand({ id: "map-redo", name: "Redo in map", checkCallback: c => this.withMap(c, a => a.redo()) });
    this.addCommand({ id: "map-shape-map", name: "Show as map", checkCallback: c => this.withMap(c, a => a.shift("map")) });
    this.addCommand({ id: "map-shape-outline", name: "Show as outline", checkCallback: c => this.withMap(c, a => a.shift("outline")) });
    this.addCommand({ id: "map-properties", name: "Toggle the document panel", checkCallback: c => this.withMap(c, a => a.toggleInspector()) });
    this.addCommand({ id: "map-toggle-task", name: "Toggle checkbox on the selected nodes", checkCallback: c => this.withMap(c, a => a.toggleTask()) });
    this.addCommand({ id: "map-toggle-ordered", name: "Toggle numbered list on the selected nodes", checkCallback: c => this.withMap(c, a => a.toggleOrdered()) });
    for (const [al, label] of [["left", "left"], ["center", "centre"], ["right", "right"]] as const)
      this.addCommand({ id: `map-align-${al}`, name: `Align node text ${label}`, checkCallback: c => this.withMap(c, a => a.align(al)) });
    for (const [z, label] of [[undefined, "body"], [1, "heading 1"], [2, "heading 2"], [3, "heading 3"]] as const)
      this.addCommand({ id: `map-size-${z ?? 0}`, name: `Set node text size: ${label}`, checkCallback: c => this.withMap(c, a => a.size(z)) });
    for (const [dir, dx, dy] of [["left", -8, 0], ["right", 8, 0], ["up", 0, -8], ["down", 0, 8]] as const)
      this.addCommand({ id: `map-nudge-${dir}`, name: `Nudge selected branch ${dir} (free layout)`, checkCallback: c => this.withMap(c, a => a.nudge(dx, dy)) });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFolder) {
        menu.addItem(item => item.setTitle("New map here").setIcon("git-branch").onClick(() => void this.newMap("Untitled map", file.path)));
        return;
      }
      if (!(file instanceof TFile)) return;
      if (file.extension === "md") menu.addItem(item => item.setTitle("Open as a map").setIcon("git-branch").onClick(() => void this.openMap(file)));
    }));
    // The note in front of you, as a map: a command, and the editor's right-click menu.
    this.addCommand({ id: "open-note-as-map", name: "Open this note as a map", checkCallback: c => { const f = this.noteToConvert(); if (!f) return false; if (!c) void this.openMap(f); return true; } });
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, _editor, info) => {
      const f = (info as { file?: TFile | null }).file;
      if (f instanceof TFile && f.extension === "md") menu.addItem(item => item.setTitle("Open as a map").setIcon("git-branch").onClick(() => void this.openMap(f)));
    }));
    // Explorer badges follow the metadata, renames, and the explorer's own re-renders.
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleBadges()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleBadges()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleBadges()));
    this.registerEvent(this.app.workspace.on("layout-change", () => { this.observeExplorer(); this.scheduleBadges(); }));
    this.app.workspace.onLayoutReady(() => { this.observeExplorer(); this.scheduleBadges(); });
    this.register(() => {
      this.unloaded = true;
      if (this.badgeTimer) { window.clearTimeout(this.badgeTimer); this.badgeTimer = null; }
      this.explorerObserver?.disconnect();
      for (const el of Array.from(activeDocument.querySelectorAll(".io-map-tag"))) el.remove();
    });
    // A Markdown file carrying the marker opens as a map (the Kanban plugin's pattern), unless
    // the person asked for the editor on it. No patching: the markdown view is swapped after it opens.
    this.registerEvent(this.app.workspace.on("file-open", file => { if (file) void this.swapMarkedFiles(file); }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => {
      // obsidian: a leaf's view may still be a DeferredView; the view state says which file it holds without touching it.
      const p = leaf ? leafFilePath(leaf) : undefined;
      const f = p ? this.app.vault.getAbstractFileByPath(p) : null;
      if (leaf?.getViewState().type === "markdown" && f instanceof TFile) void this.swapMarkedFiles(f);
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      const open = new Set(this.app.workspace.getLeavesOfType("markdown").map(leafFilePath));
      for (const p of this.markdownOverride) if (!open.has(p)) this.markdownOverride.delete(p);
      // A search hit or a link that lands the map's own file back in the leaf it is already in changes
      // no active file, so file-open stays quiet; the layout change is the one signal left.
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        const p = leafFilePath(leaf);
        const f = p ? this.app.vault.getAbstractFileByPath(p) : null;
        if (f instanceof TFile) void this.swapMarkedFiles(f);
      }
    }));
    this.app.workspace.onLayoutReady(() => {
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        const p = leafFilePath(leaf);
        const f = p ? this.app.vault.getAbstractFileByPath(p) : null;
        if (f instanceof TFile) void this.swapMarkedFiles(f);
      }
    });
    this.addCommand({ id: "open-as-markdown", name: "Open map as Markdown", checkCallback: c => { const v = this.activeMap(); if (!v) return false; if (!c) void v.openAsMarkdown(); return true; } });
    this.addSettingTab(new MapSettingTab(this.app, this));
  }

  activeMap(): MapView | null { return this.app.workspace.getActiveViewOfType(MapView); }

  private withMap(checking: boolean, fn: (a: import("./organiser/MapApp").MapCommands) => void): boolean {
    const a = this.activeMap()?.commands();
    if (!a) return false;
    if (!checking) fn(a);
    return true;
  }

  async newMap(name = "Untitled map", folder = this.settings.mapsFolder, doc = seedCanvasPositions(newDoc(name))): Promise<void> {
    let file: TFile;
    try { file = await writeUnique(this.app, folder, `${name}.md`, toMarkdownMap(doc)); }
    catch (e) { new Notice(`Could not create the map: ${e instanceof Error ? e.message : String(e)}`); return; }
    await this.showMap(file);
  }

  /** Open a note in the map view. A note the map would rewrite asks first. */
  async openMap(file: TFile, leaf?: WorkspaceLeaf): Promise<void> {
    if ((await this.confirmMap(file)) !== "open") return;
    await this.showMap(file, leaf);
  }

  /** Straight into the map view: for files the plugin has just written in its own format. */
  async showMap(file: TFile, leaf: WorkspaceLeaf = this.app.workspace.getLeaf("tab")): Promise<void> {
    this.markdownOverride.delete(file.path);
    await leaf.setViewState({ type: MAP_VIEW_TYPE, state: { file: file.path }, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** A short question with a row of answers. Resolves to the chosen key, or null when dismissed. */
  ask(title: string, body: string, answers: { key: string; label: string; cls?: string }[]): Promise<string | null> {
    return new Promise(resolve => new AskModal(this.app, title, body, answers, resolve).open());
  }

  /** A note that would not come back out of the map as it went in is not rewritten without asking.
   *  "open": show it as a map. "copy": a converted copy was written and opened instead. "cancel": leave it. */
  private async confirmMap(file: TFile): Promise<"open" | "copy" | "cancel"> {
    if (file.extension !== "md") return "open";
    const src = await this.app.vault.read(file);
    let doc: ReturnType<typeof fromMarkdownMap>;
    try { doc = fromMarkdownMap(src, file.basename); }
    catch (e) { new Notice(`Could not read “${file.basename}” as a map: ${e instanceof Error ? e.message : String(e)}`); return "cancel"; }
    const change = conversionChange(src, toMarkdownMap(doc));
    if (!change) return "open";
    const answer = await this.ask(
      "Convert this note to a map?",
      `The map would rewrite ${change.lines === 1 ? "1 line" : `${change.lines} lines`} of “${file.basename}”, starting with “${change.first}”.`,
      [{ key: "convert", label: "Convert", cls: "mod-warning" }, { key: "copy", label: "Convert a copy", cls: "mod-cta" }, { key: "cancel", label: "Cancel" }],
    );
    if (answer !== "convert" && answer !== "copy") return "cancel";
    const seeded = seedCanvasPositions(doc) as typeof doc;
    if (answer === "convert") {
      const out = toMarkdownMap(seeded);
      let moved = false;
      await this.app.vault.process(file, now => { if (now !== src) { moved = true; return now; } return out; });
      if (moved) { new Notice(`“${file.basename}” changed while you were deciding, so it was not converted.`); return "cancel"; }
      return "open";
    }
    // The copy has its own name, so its root is written as a heading rather than taken from the file name.
    const folder = file.parent?.path && file.parent.path !== "/" ? file.parent.path : "";
    let copy: TFile;
    try { copy = await writeUnique(this.app, folder, `${file.basename} map.md`, toMarkdownMap(seeded, { ...seeded.md, basename: undefined })); }
    catch (e) { new Notice(`Could not write a converted copy of “${file.basename}”: ${e instanceof Error ? e.message : String(e)}`); return "cancel"; }
    await this.showMap(copy);
    return "copy";
  }

  private async hasMarker(file: TFile): Promise<boolean> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (hasMapKey(fm)) return true;
    if (fm) return false;
    // The metadata cache is cold (startup, a fresh index): read the frontmatter to its closing fence, however long.
    return isMarkdownMap(frontmatterHead(await this.app.vault.cachedRead(file)));
  }

  private readonly swapping = new Set<string>();

  /** file-open and active-leaf-change both fire for one open; the set keeps the swap to one. */
  private async swapMarkedFiles(file: TFile): Promise<void> {
    if (!this.settings.autoOpenMaps) return;
    if (file.extension !== "md" || this.markdownOverride.has(file.path) || this.swapping.has(file.path)) return;
    this.swapping.add(file.path);
    try {
      // The view state can lag behind a same-tab open (file-open fires first), so the live
      // view's file is checked as well.
      const leaves = this.app.workspace.getLeavesOfType("markdown").filter(l => leafFilePath(l) === file.path || (l.view as { file?: TFile | null }).file?.path === file.path);
      if (!leaves.length || !(await this.hasMarker(file))) return;
      // A note that just gained the key may still be prose: asked once, and a "no" keeps it in the editor.
      if ((await this.confirmMap(file)) !== "open") { this.markdownOverride.add(file.path); return; }
      for (const leaf of leaves) await leaf.setViewState({ type: MAP_VIEW_TYPE, state: { file: file.path } }, this.arrivalState(leaf));
    } finally {
      window.setTimeout(() => this.swapping.delete(file.path), 300);
    }
  }

  /** A [[Note#^id]] link or a search hit flashes the block it landed on in the editor. Read that block
   *  before the editor is swapped out, so the map opens on the same node: its id when the flashed line
   *  shows one, else its line (the map view resolves either); nothing when nothing flashed. */
  private arrivalState(leaf: WorkspaceLeaf): { subpath?: string; line?: number } | undefined {
    const v = leaf.view as { containerEl?: HTMLElement; editor?: { offsetToPos(offset: number): { line: number } }; editMode?: { cm?: { posAtDOM(node: Node): number } }; getEphemeralState?(): { cursor?: { from?: { line?: number } } } };
    const flash = v.containerEl?.querySelector(".is-flashing");
    if (!flash) return undefined;
    const id = /\^([A-Za-z0-9-]+)\s*$/.exec((flash.textContent ?? "").trim())?.[1];
    if (id) return { subpath: `#^${id}` };
    let line: number | undefined;
    try { const cm = v.editMode?.cm; if (cm && v.editor) line = v.editor.offsetToPos(cm.posAtDOM(flash)).line; } catch { /* reading view: no editor positions */ }
    if (line == null) line = v.getEphemeralState?.()?.cursor?.from?.line;
    return typeof line === "number" ? { line } : undefined;
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<MapSettings> | null) };
  }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}


class AskModal extends Modal {
  private answer: string | null = null;
  constructor(app: App, private readonly title: string, private readonly body: string,
    private readonly answers: { key: string; label: string; cls?: string }[], private readonly done: (answer: string | null) => void) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.body });
    const row = this.contentEl.createDiv("modal-button-container");
    for (const a of this.answers) {
      const b = row.createEl("button", { text: a.label, cls: a.cls });
      b.addEventListener("click", () => { this.answer = a.key; this.close(); });
    }
  }
  onClose(): void { this.contentEl.empty(); this.done(this.answer); }
}

/** The file a leaf shows, read from its view state — safe on a DeferredView, where `leaf.view` is a placeholder. */
function leafFilePath(leaf: WorkspaceLeaf): string | undefined {
  const st = leaf.getViewState().state as { file?: unknown } | undefined;
  return typeof st?.file === "string" ? st.file : undefined;
}
