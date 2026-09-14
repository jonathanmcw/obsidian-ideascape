import { Menu, Notice, Platform, Scope, TFile, TextFileView, normalizePath, type WorkspaceLeaf } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import MapApp, { type MapCommands } from "./organiser/MapApp";
import type { IODoc } from "./organiser/model/types";
import { DEFAULT_PREFS, newDoc, seedCanvasPositions, type Prefs } from "./organiser/model/store";
import { HOST_THEME_ID, applyTheme, registerHostTheme } from "./organiser/theme";
import { readObsidianColours } from "./obsidian-theme.ts";
import { fromMarkdownMap, toMarkdownMap } from "./organiser/model/markdown";
import { embedKind } from "./organiser/model/inline";
import { setSaveHandler } from "./organiser/model/exporters";
import { exportPath, linkAction, obsidianOpenFiles } from "./host-logic.ts";
import type MapPlugin from "./main.ts";
import { PLUGIN_ID, PLUGIN_NAME } from "./brand.ts";

export const MAP_VIEW_TYPE = PLUGIN_ID;

/** The exporters keep one save handler for the whole app; this is the map it currently writes beside. */
let exportOwner: MapView | null = null;

/** The organiser, hosted in an Obsidian file view. A map is a Markdown note: a nested list with block ids and a
 *  layout block in an Obsidian comment (see organiser/model/markdown.ts). */
export class MapView extends TextFileView {
  private doc: IODoc | null = null;
  private root: Root | null = null;
  private hostEl: HTMLDivElement | null = null;
  private rootRef: { current: HTMLDivElement | null } = { current: null };
  private epoch = 0;
  /** Bumped when the view reads a file (and when it lets one go), never on a reload from disk or a rename:
   *  what MapApp is told is "this map", and what a change must still belong to before it is taken. */
  private loadGen = 0;
  /** Bumped when text this view didn't write arrives from disk: a change still made against the map before it is dropped. */
  private diskRev = 0;
  private sink: { gen: string; fn: (next: IODoc) => void } | null = null;
  private api: MapCommands | null = null;
  /** For Obsidian's Page preview: it parks the hover card here. */
  hoverPopover: import("obsidian").HoverPopover | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: MapPlugin) {
    super(leaf);
    // Modifier shortcuts live here, active only while this view is focused, so they go through
    // Obsidian's keymap instead of shadowing it. No ⌘N, ⌘⇧F: those are Obsidian's. ⌘E is
    // taken here on purpose: Obsidian's toggle-view has no meaning in a map, editing a node does.
    // So are ⌘1–⌘3 (Obsidian's go-to-tab): switching shapes is what a person reaches for all day in here.
    // Zoom is not ⌘0 ⌘= ⌘-: Obsidian's View menu owns those, and a menu's key equivalent never reaches the page.
    this.scope = new Scope(this.app.scope);
    // `label`: a node label being typed into keeps the key — always, or once something has been typed there.
    // `inFind`: the key still works from the map's own Find field.
    const bind = (mods: ("Mod" | "Shift" | "Alt")[], key: string, fn: (a: MapCommands, e: KeyboardEvent) => void, opt: { label?: "typed" | "always"; inFind?: boolean } = {}) => {
      const run = (e: KeyboardEvent) => {
        if (!this.api) return true;
        // A dialog is open in the map (the Export or Shortcuts sheet, a colour picker): the key is the dialog's, not the map's behind it.
        if (this.hostEl?.querySelector('[role="dialog"]')) return true;
        // obsidian: activeDocument follows a popped-out window, whose elements are not this window's
        // HTMLElement — so nodeType, not instanceof.
        const a = activeDocument.activeElement as HTMLElement | null;
        if (a?.nodeType === 1 && this.hostEl?.contains(a)) {
          // A text field of the map's own (the title, find) keeps its keys: ⌘A selects its text, ⌘Z undoes typing.
          // ⌘F in Find is still Find's, though: it selects the query again rather than opening Obsidian's search.
          if (a.tagName === "INPUT" || a.tagName === "TEXTAREA") { if (!(opt.inFind && a.classList.contains("find-input"))) return true; }
          // So does a node label being typed into, for ⌘Z and ⇧⌘Z: they take back typing, not a map change.
          // Until something is typed there, ⌘Z undoes the map — a node Enter made by mistake goes.
          else if (opt.label && a.classList.contains("node-label") && a.isContentEditable && (opt.label === "always" || this.api.typed())) return true;
        }
        fn(this.api, e); return false;
      };
      // Letters are registered uppercase. obsidian: the keymap matches a key by `key` or by its "vkey", and a
      // letter's vkey is the uppercase letter of its keyCode (keyCodes 65–90 → "A"–"Z"). So ⌥F, which macOS
      // reports as "ƒ", and ⌘Z on a Cyrillic or Greek layout still match; a "Key" + code spelling never would.
      this.scope!.register(mods, /^[a-z]$/.test(key) ? key.toUpperCase() : key, run);
    };
    bind(["Mod"], "z", a => a.undo(), { label: "typed" });
    bind(["Mod"], "e", a => a.toggleEdit());
    // obsidian: F2 is Obsidian's "rename file" for any file view. In a map it edits the selected node, all its text selected.
    bind([], "F2", a => a.editAll());
    // Lists: ⌘Enter is Obsidian's own "toggle checkbox"; ⇧⌘7 is the numbered list everywhere else.
    bind(["Mod"], "Enter", a => a.toggleTask());
    // obsidian: ⇧⌘7 matches by the 7 key's code. Where "/" is ⇧7 (German, Nordic, Swiss, Spanish) that is also
    // the chord for ⌘/, and the character typed says which was meant.
    bind(["Mod", "Shift"], "7", (a, e) => (e.key === "/" ? a.toggleInspector() : a.toggleOrdered()));
    bind(["Mod", "Shift"], "z", a => a.redo(), { label: "always" });
    bind(["Mod"], "1", a => a.shift("map"));
    bind(["Mod"], "2", a => a.shift("outline"));
    bind(["Mod"], "3", a => a.toggleLayout());
    bind(["Mod"], "b", a => a.format("bold"));
    bind(["Mod"], "i", a => a.format("italic"));
    bind(["Mod"], "u", a => a.format("underline"));
    bind(["Mod"], "/", a => a.toggleInspector());
    bind(["Mod"], "f", a => a.search(), { inFind: true });
    bind(["Mod"], "a", a => a.selectAll());
    bind(["Mod"], ".", a => a.toggleCollapse());
    bind(["Mod", "Alt"], "f", a => a.toggleFocus());
    bind(["Mod"], "ArrowUp", a => a.reorder(-1));
    bind(["Mod"], "ArrowDown", a => a.reorder(1));
    bind(["Mod", "Shift"], "0", a => a.fit());
    bind(["Mod", "Alt"], "=", a => a.zoomBy(1.2));
    bind(["Mod", "Alt"], "-", a => a.zoomBy(1 / 1.2));
    bind(["Mod", "Shift"], "l", a => a.align("left"));
    bind(["Mod", "Shift"], "e", a => a.align("center"));
    bind(["Mod", "Shift"], "r", a => a.align("right"));
    bind(["Mod", "Alt"], "0", a => a.size(undefined));
    bind(["Mod", "Alt"], "1", a => a.size(1));
    bind(["Mod", "Alt"], "2", a => a.size(2));
    bind(["Mod", "Alt"], "3", a => a.size(3));
    // obsidian: quitting closes no view, and the window goes once the saves handed to "quit" finish.
    // The node being typed into reaches the document, and this save writes it — the 2-second debounce never would.
    this.registerEvent(this.app.workspace.on("quit", (tasks) => {
      this.api?.flushEdit?.();
      tasks.addPromise(this.save());
    }));
  }

  /** For commands: the live map API, if a map is loaded. */
  commands(): MapCommands | null { return this.api; }

  /** obsidian: arriving from outside — a [[Note#^id]] link brings its block id as `subpath`; a search
   *  hit, and the editor swapped out for this view, bring a `line`. Either lands on that node. */
  setEphemeralState(state: unknown): void {
    const id = this.nodeForState(state);
    if (!id) return;
    if (this.api) this.api.reveal(id);
    else this.pendingReveal = id;
  }

  private pendingReveal: string | null = null;

  private nodeForState(state: unknown): string | null {
    const s = (state ?? {}) as { subpath?: unknown; line?: unknown };
    if (!this.doc) return null;
    if (typeof s.subpath === "string") {
      const m = /^#\^([A-Za-z0-9-]+)$/.exec(s.subpath.trim());
      return m && this.doc.nodes[m[1]] ? m[1] : null;
    }
    if (typeof s.line === "number" && s.line > 0) {
      // The node whose id is on that line or the next one that carries an id (a wrapped node's id is on its last line).
      const lines = this.data.split("\n");
      for (let i = s.line; i < Math.min(lines.length, s.line + 40); i++) {
        const m = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(lines[i]);
        if (m) return this.doc.nodes[m[1]] && m[1] !== this.doc.rootId ? m[1] : null;
      }
    }
    return null;
  }

  getViewType(): string { return MAP_VIEW_TYPE; }
  getDisplayText(): string { return this.file?.basename ?? PLUGIN_NAME; }
  getIcon(): string { return "git-branch"; }

  private isMd(): boolean { return this.file?.extension === "md"; }

  /** The file's text as this view last loaded or wrote it. Obsidian saves whatever this returns when the
   *  view closes, so a map that was only looked at hands back the text it was given, byte for byte. */
  private lastText = "";
  /** Why the file could not be read; the view shows this instead of an editable map, and saves nothing. */
  private loadError: string | null = null;
  private errorEl: HTMLElement | null = null;

  getViewData(): string { return this.lastText; }

  private saveQueue: Promise<void> = Promise.resolve();

  /** obsidian: a save asked for while one is being written returns at once, so the quit handlers and the tab's
   *  close would stop waiting before the node just typed is written. Here each save waits for the one before it.
   *  A method, not a field: Obsidian binds its 2-second debounce to `this.save` in its own constructor. */
  save(clear?: boolean): Promise<void> {
    const next = this.saveQueue.then(() => super.save(clear));
    this.saveQueue = next.catch(() => {});
    return next;
  }

  setViewData(data: string, clear: boolean): void {
    const name = this.file?.basename ?? "Untitled";
    let doc: IODoc | null = null;
    this.loadError = null;
    if (clear) this.loadGen++;
    else if (data !== this.lastText) this.diskRev++;
    try {
      // Nothing here asks for a save: positions a note lacks are laid out in memory, and the first real edit writes them.
      // Only Markdown notes are maps; any other file that reaches this view is left untouched.
      if (!this.isMd()) throw new Error("only Markdown notes open as maps");
      if (!data.trim()) doc = newDoc(name);
      else {
        const read = fromMarkdownMap(data, name);
        // A layout block that doesn't parse is kept exactly as written, so moves and folds can't be saved into it until it is fixed.
        if (clear && read.md.rawGeometry != null) new Notice(`The layout block in “${name}” can't be read, so it is kept as it is. Positions and folds won't save until its layout block (${read.md.block ?? "%%"} … %%) is fixed.`);
        doc = read;
        if (doc.needsLayout) { doc = seedCanvasPositions(doc); doc.needsLayout = false; }
      }
    } catch (e) {
      doc = null;
      this.loadError = (e instanceof Error ? e.message : String(e)).replace(/\.$/, "");
      new Notice(`Could not read “${name}” as a map: ${this.loadError}. It is left as it is.`);
    }
    if (doc && (!doc.name || doc.name === "Imported")) doc = { ...doc, name };
    this.doc = doc;
    // React unmounts the old map later; until then its commands must not reach a view that has no map.
    if (!doc) this.api = null;
    // Text this view did not write (Sync, another pane, git) starts a fresh history: undo must not bring back
    // the map as it was before someone else's change.
    if (clear || data !== this.lastText) this.epoch++;
    this.lastText = data;
    this.renderApp();
  }

  clear(): void { this.doc = null; this.api = null; this.loadError = null; this.epoch++; this.loadGen++; this.renderApp(); }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("io-host");
    const host = this.contentEl.createDiv("io-root");
    host.tabIndex = 0;
    host.addEventListener("pointerdown", () => {
      // Keys go to the map unless the person is typing into one of its own fields.
      const a = activeDocument.activeElement;
      const typing = !!a?.instanceOf(HTMLElement) && host.contains(a) && (a.isContentEditable || a.tagName === "INPUT" || a.tagName === "TEXTAREA");
      if (!typing) host.focus({ preventScroll: true });
      this.claimExports();
    });
    this.hostEl = host;
    this.rootRef = { current: host };
    this.root = createRoot(host);
    // obsidian: a tab dragged into another window keeps its elements but changes document; the map's
    // document-level listeners were attached in the old one, so React mounts again in the new one.
    // The node being typed into is committed first: the new mount starts with no draft. (Undo history and the
    // selection still start afresh; they live in MapApp.)
    this.register(host.onWindowMigrated(() => {
      this.api?.flushEdit?.();
      this.root?.unmount();
      this.root = createRoot(host);
      this.renderApp();
    }));
    this.claimExports();
    // Exports go beside the map in front: the handler follows the active leaf, and leaves with this view.
    this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => { if (leaf === this.leaf) this.claimExports(); }));
    this.register(() => {
      if (exportOwner !== this) return;
      exportOwner = null;
      setSaveHandler(async () => "Open the map again to export it.");
    });
    // obsidian: the Obsidian theme is the app's own colours, read again whenever they change (a theme, light or dark).
    registerHostTheme(readObsidianColours(host.ownerDocument));
    this.registerEvent(this.app.workspace.on("css-change", () => {
      registerHostTheme(readObsidianColours(host.ownerDocument));
      if ((this.doc?.look?.theme ?? this.prefs().theme) === HOST_THEME_ID) applyTheme(host, HOST_THEME_ID);
      this.renderApp();
    }));
    this.addAction("file-text", "Open as Markdown", () => void this.openAsMarkdown());
    this.renderApp();
  }

  /** Same file, Obsidian's editor. The plugin stops auto-opening it as a map until it is closed. */
  async openAsMarkdown(): Promise<void> {
    const file = this.file;
    if (!file || file.extension !== "md") return;
    this.plugin.markdownOverride.add(file.path);
    await this.leaf.setViewState({ type: "markdown", state: { file: file.path } });
  }

  async onClose(): Promise<void> {
    // The node being typed into reaches the document first; Obsidian's own close then flushes the
    // pending save (FileView.onClose → onUnloadFile → save). Only then does React go.
    this.api?.flushEdit?.();
    await super.onClose();
    this.root?.unmount();
    this.root = null;
  }

  /** obsidian: another file opening in this tab (a link, the file explorer) unloads this one and saves it first.
   *  The node being typed into reaches the document before that save, as it does on close. */
  async onUnloadFile(file: TFile): Promise<void> {
    this.api?.flushEdit?.();
    await super.onUnloadFile(file);
  }

  private prefs(): Prefs {
    const s = this.plugin.settings;
    // "auto" is the Obsidian theme: the app's own colours, light or dark as the app is.
    const theme = s.mapTheme === "auto" ? HOST_THEME_ID : s.mapTheme;
    const p: Prefs = { ...DEFAULT_PREFS, ...s.mapPrefs, theme };
    if ((p.shape as string) === "canvas") { p.shape = "map"; p.mapLayout = "free"; } // pre-merge prefs
    return p;
  }

  private renderApp(): void {
    if (!this.root) return;
    this.showLoadError();
    if (!this.doc) { this.root.render(null); return; }
    this.root.render(createElement(MapApp, {
      doc: this.doc,
      onDoc: this.docSink(),
      onTour: () => void this.plugin.openTour(),
      mac: Platform.isMacOS || Platform.isIosApp,
      prefs: this.prefs(),
      onPrefs: (patch: Partial<Prefs>) => {
        const { theme, ...rest } = patch;
        this.plugin.settings.mapPrefs = { ...this.plugin.settings.mapPrefs, ...rest };
        if (theme) this.plugin.settings.mapTheme = theme;
        void this.plugin.saveSettings();
        this.renderApp();
      },
      rootRef: this.rootRef,
      epoch: this.epoch,
      onApi: this.setApi,
      onOpenLink: (href: string, wiki: boolean) => {
        if (wiki) { void this.app.workspace.openLinkText(href, this.file?.path ?? "", true); return; }
        // A node shows the link's label, not its address, so the address is checked before anything opens.
        const how = linkAction(href);
        if (how.action === "open") window.open(href);
        else if (how.action === "confirm") {
          void this.plugin.ask("Open this Obsidian link?", `It can open notes and run commands: ${href}`, [{ key: "open", label: "Open", cls: "mod-cta" }, { key: "cancel", label: "Cancel" }])
            .then(answer => { if (answer === "open") window.open(href); });
        } else new Notice(`Link not opened: ${how.reason}.`);
      },
      resolveEmbed: (file: string): { url: string; kind: "image" | "audio" } | null => {
        const f = this.app.metadataCache.getFirstLinkpathDest(file, this.file?.path ?? "");
        if (!f) return null;
        return { url: this.app.vault.getResourcePath(f), kind: embedKind(f.name) === "audio" ? "audio" : "image" };
      },
      onSaveAttachment: (file: File) => this.saveAttachment(file),
      linksFromDrag: (dt: DataTransfer) => this.linksFromDrag(dt),
      onHoverLink: (target: HTMLElement, href: string, event: MouseEvent) => {
        this.app.workspace.trigger("hover-link", { event, source: MAP_VIEW_TYPE, hoverParent: this, targetEl: target, linktext: href, sourcePath: this.file?.path ?? "" });
      },
      fileName: this.file?.basename,
      fileKey: `load-${this.loadGen}`,
      onRenameFile: async (name: string) => {
        const file = this.file;
        if (!file) return false;
        const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
        if (!clean || clean === file.basename) return clean === file.basename;
        const dir = file.parent?.path && file.parent.path !== "/" ? `${file.parent.path}/` : "";
        const path = normalizePath(`${dir}${clean}.${file.extension}`);
        if (this.app.vault.getAbstractFileByPath(path)) { new Notice(`A note called “${clean}” already exists here.`); return false; }
        try { await this.app.fileManager.renameFile(file, path); }
        catch (e) { new Notice(`Could not rename: ${e instanceof Error ? e.message : String(e)}`); return false; }
        this.renderApp();
        return true;
      },
      customTheme: this.plugin.settings.customTheme,
      onCustomTheme: (def) => {
        this.plugin.settings.customTheme = def;
        void this.plugin.saveSettings();
        this.renderApp();
      },
      onOpenTag: (tag: string) => {
        // The same thing a click on a tag does in the editor: the core search, filtered to it.
        const search = (this.app as unknown as { internalPlugins?: { getPluginById?(id: string): { instance?: { openGlobalSearch?(q: string): void } } | null } }).internalPlugins?.getPluginById?.("global-search");
        if (search?.instance?.openGlobalSearch) search.instance.openGlobalSearch(`tag:#${tag}`);
        else new Notice("Turn on the core search plugin to look up tags.");
      },
      onContextMenu: (event: MouseEvent, id: string | null) => this.showContextMenu(event, id),
    }));
  }

  /** A file that could not be read: a short explanation in Obsidian's empty-state look, in place of the map. */
  private showLoadError(): void {
    const host = this.hostEl;
    if (!host) return;
    host.toggle(this.loadError === null);
    if (this.loadError === null) { this.errorEl?.remove(); this.errorEl = null; return; }
    this.errorEl?.remove();
    const el = this.errorEl = this.contentEl.createDiv("empty-state");
    const box = el.createDiv("empty-state-container");
    box.createDiv({ cls: "empty-state-title", text: "This map can’t be read" });
    box.createDiv({ text: `${this.loadError}. Nothing is saved while it looks like this.` });
    if (this.isMd()) {
      const list = box.createDiv("empty-state-action-list");
      const open = list.createDiv({ cls: "empty-state-action", text: "Open as Markdown" });
      open.addEventListener("click", () => void this.openAsMarkdown());
    }
  }

  /** Secondary click: the same actions as the keyboard and the palette, as an Obsidian menu. */
  private showContextMenu(event: MouseEvent, id: string | null): void {
    const a = this.api;
    if (!a) return;
    const menu = new Menu();
    if (id) {
      menu.addItem(i => i.setTitle("Add child").setIcon("plus").onClick(() => a.addChild()));
      menu.addItem(i => i.setTitle("Add sibling").setIcon("corner-down-right").onClick(() => a.addSibling()));
      menu.addItem(i => i.setTitle("Focus on this branch").setIcon("focus").onClick(() => a.toggleFocus()));
      menu.addItem(i => i.setTitle("Collapse or expand").setIcon("chevrons-down-up").onClick(() => a.toggleCollapse()));
      menu.addSeparator();
      menu.addItem(i => i.setTitle("Numbered item").setIcon("list-ordered").onClick(() => a.toggleOrdered()));
      menu.addItem(i => i.setTitle("Checkbox").setIcon("check-square").onClick(() => a.toggleTask()));
      menu.addSeparator();
      menu.addItem(i => i.setTitle("Copy branch").setIcon("copy").onClick(() => void a.copy(false)));
      menu.addItem(i => i.setTitle("Cut branch").setIcon("scissors").onClick(() => void a.copy(true)));
      menu.addItem(i => i.setTitle("Paste as children").setIcon("clipboard-paste").onClick(() => void a.paste()));
      menu.addSeparator();
      menu.addItem(i => i.setTitle("Delete").setIcon("trash-2").setWarning(true).onClick(() => a.deleteSelection()));
    } else {
      menu.addItem(i => i.setTitle("Add idea").setIcon("plus").onClick(() => a.addChild()));
      menu.addItem(i => i.setTitle("Paste").setIcon("clipboard-paste").onClick(() => void a.paste()));
      menu.addSeparator();
      menu.addItem(i => i.setTitle("Fit to window").setIcon("maximize").onClick(() => a.fit()));
      menu.addItem(i => i.setTitle("Tidy layout").setIcon("layout-grid").onClick(() => a.tidy()));
      menu.addItem(i => i.setTitle("Find").setIcon("search").onClick(() => a.search()));
      menu.addItem(i => i.setTitle("Export…").setIcon("share").onClick(() => a.export()));
    }
    menu.showAtMouseEvent(event);
  }

  /** Every change to the map comes through here. obsidian: `data` is kept in step with the file text, because
   *  Obsidian's quit and background handlers save only a view whose `data` differs from what it last saved. */
  /** The onDoc handed to the map for the file now loaded. A map from an earlier load keeps the one it was given,
   *  so a change still on its way from it (an import, an attachment) reaches nothing when the tab has moved on. */
  private docSink(): (next: IODoc) => void {
    // The render that shows a reload hands the map a new one, so what it commits from then on is taken (typing kept
    // on top of the reload); a change made against the map as it was before the reload reaches nothing.
    const gen = `${this.loadGen}:${this.diskRev}`;
    if (this.sink?.gen !== gen) this.sink = { gen, fn: (next) => { if (gen === `${this.loadGen}:${this.diskRev}`) this.onDoc(next); } };
    return this.sink.fn;
  }

  private readonly onDoc = (next: IODoc): void => {
    // An unreadable file, or none: a change still on its way from the old map (a pasted image landing late) is dropped.
    if (this.loadError !== null || !this.doc) return;
    this.doc = next;
    this.lastText = toMarkdownMap(next);
    this.data = this.lastText;
    this.requestSave();
    this.renderApp();
  };

  private readonly setApi = (api: MapCommands | null): void => {
    this.api = api;
    const id = this.pendingReveal;
    if (api && id) { this.pendingReveal = null; window.setTimeout(() => api.reveal(id), 30); }
  };

  /** Notes dragged from Obsidian's file explorer (or anything carrying an obsidian:// URL) as link text. */
  private linksFromDrag(dt: DataTransfer): string[] {
    const src = this.file?.path ?? "";
    const dm = (this.app as unknown as { dragManager?: { draggable?: { type?: string; file?: TFile; files?: TFile[] } | null } }).dragManager;
    const d = dm?.draggable;
    let files: TFile[] = [];
    if (d?.type === "file" && d.file instanceof TFile) files = [d.file];
    else if (d?.type === "files" && Array.isArray(d.files)) files = d.files.filter((f): f is TFile => f instanceof TFile);
    if (!files.length) {
      const text = dt.getData("text/plain") || dt.getData("text/uri-list") || "";
      for (const name of obsidianOpenFiles(text)) {
        const f = this.app.metadataCache.getFirstLinkpathDest(name, src);
        if (f) files.push(f);
      }
      if (!files.length) for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) {
        const f = this.app.metadataCache.getFirstLinkpathDest(m[1], src);
        if (f) files.push(f);
      }
    }
    return files.map(f => {
      const link = this.app.metadataCache.fileToLinktext(f, src, true);
      return embedKind(f.name) === "other" ? `[[${link}]]` : `![[${f.path === link ? link : this.app.metadataCache.fileToLinktext(f, src, false)}]]`;
    });
  }

  /** A pasted image or audio file goes where Obsidian puts attachments; the node gets ![[link]]. */
  private async saveAttachment(file: File): Promise<string | null> {
    try {
      const ext = (file.name.split(".").pop() || file.type.split("/")[1] || "bin").toLowerCase();
      const generic = !file.name || /^(image|audio|blob|clipboard)\.[a-z0-9]+$/i.test(file.name);
      const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", " ");
      const name = generic ? `Pasted ${file.type.startsWith("audio") ? "audio" : "image"} ${stamp}.${ext}` : file.name;
      const src = this.file?.path ?? "";
      const path = await this.app.fileManager.getAvailablePathForAttachment(name, src);
      const tf = await this.app.vault.createBinary(path, await file.arrayBuffer());
      return this.app.metadataCache.fileToLinktext(tf, src, false);
    } catch (e) {
      new Notice(`Could not save the attachment: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private claimExports(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the exporters keep one save handler, so the module tracks which view owns it
    exportOwner = this;
    setSaveHandler((f, d) => this.saveExport(f, d));
  }

  /** Exports land next to the map file, always as a new file: an existing note, the map included, is never
   *  written over. Text goes through the vault as text, PNG as bytes. */
  private async saveExport(filename: string, data: string | Blob): Promise<string | null> {
    const file = this.file;
    const siblings = new Set((file?.parent?.children ?? []).map(f => f.name.toLowerCase()));
    const taken = (p: string) => !!this.app.vault.getAbstractFileByPath(normalizePath(p)) || siblings.has(p.slice(p.lastIndexOf("/") + 1).toLowerCase());
    const path = normalizePath(exportPath(filename, file ? { path: file.path, basename: file.basename, dir: file.parent?.path ?? "" } : null, taken));
    if (typeof data === "string") await this.app.vault.create(path, data);
    else await this.app.vault.createBinary(path, await data.arrayBuffer());
    new Notice(`Saved ${path}`);
    return null;
  }

  focusMap(): void { this.hostEl?.focus({ preventScroll: true }); }
}
