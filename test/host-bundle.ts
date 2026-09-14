// Loads a host file (view.ts, map-view.ts) under node by bundling it with esbuild against a small stand-in
// for the `obsidian` module: enough of TextFileView, the vault and Notice to drive load and save paths.
import { build } from "esbuild";

const STUB = `
export const notices = [];
export class Notice { constructor(msg) { notices.push(String(msg)); this.noticeEl = this.messageEl = { createEl: () => ({ addEventListener() {} }) }; } hide() {} }
export class TAbstractFile { constructor(path) { this.path = path; this.name = path.split("/").pop(); } }
export class TFile extends TAbstractFile { constructor(path) { super(path); this.extension = this.name.includes(".") ? this.name.split(".").pop() : ""; this.basename = this.name.replace(/\\.[^.]+$/, ""); this.stat = { ctime: 0, mtime: 0 }; } }
export class TFolder extends TAbstractFile { constructor(path, children = []) { super(path); this.children = children; } }
export const normalizePath = p => p.replace(/\\/+/g, "/").replace(/^\\/|\\/$/g, "");
export class Scope { constructor() { this.keys = []; } register(modifiers, key, func) { this.keys.push({ modifiers, key, func }); } }
export class Menu {}
export class Modal {}
export class Component { constructor() { this._cleanups = []; } register(fn) { this._cleanups.push(fn); } registerEvent() {} unload() { for (const fn of this._cleanups) fn(); } }
export class View extends Component { constructor(leaf) { super(); this.leaf = leaf; this.app = leaf.app; this.contentEl = leaf.contentEl ?? null; } addAction() {} async onClose() {} }
export class FileView extends View {
  constructor(leaf) { super(leaf); this.file = leaf.file ?? null; }
  // Obsidian 1.13.7's FileView: closing loads no file, and unloading the old one saves it.
  async onClose() { await this.loadFile(null); }
  async loadFile(f) { const t = this.file; if (t === f) return; if (t) await this.onUnloadFile(t); this.file = null; if (f) { this.file = f; await this.onLoadFile(f); } }
}
export class TextFileView extends FileView {
  // requestSave only counts here; a test calls save() where Obsidian's 2-second debounce would.
  constructor(leaf) { super(leaf); this.data = null; this.lastSavedData = null; this.saving = false; this.saveAgain = false; this.saves = 0; this.requestSave = () => { this.saves++; }; }
  async onUnloadFile() { await this.save(true); }
  // Obsidian 1.13.7's TextFileView.save, step for step: a save asked for while one is being written returns at once
  // (and, unless it clears, marks one to follow); clearing drops the view's data. \`written\` is the last text written.
  async save(clear) {
    if (!this.file) return;
    if (this.saving) { if (!clear) this.saveAgain = true; return; }
    this.saveAgain = false;
    const t = this.getViewData();
    if (this.lastSavedData === t || this.lastSavedData === null) return;
    const was = this.lastSavedData;
    if (clear) { this.data = null; this.lastSavedData = null; this.clear(); } else { this.data = t; this.lastSavedData = t; }
    this.saving = true;
    try { await Promise.resolve(); if (this.app.vault?.modify) await this.app.vault.modify(this.file, t); this.written = t; }
    catch (e) { this.lastSavedData = was; throw e; }
    finally { this.saving = false; if (this.saveAgain && !clear) this.save(); }
  }
  load(text) { this.lastSavedData = text; this.data = text; this.setViewData(text, true); }
}
export const setIcon = () => {};
export const Platform = { isMacOS: true, isIosApp: false, isMobile: false };
export class SuggestModal extends Modal {}
export class Plugin extends Component {
  constructor(app, manifest) { super(); this.app = app; this.manifest = manifest; }
  async loadData() { return null; } async saveData() {}
  registerView() {} registerExtensions() {} registerHoverLinkSource() {} addCommand() {} addSettingTab() {}
  addRibbonIcon() { return { remove() {} }; }
}
export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
export class Setting {}
`;

/** `stubs`: more modules to replace, by import name, with the given source (react-dom/client, say, to see renders). */
export async function loadHost<T = Record<string, unknown>>(entry: string, stubs: Record<string, string> = {}): Promise<T> {
  const modules: Record<string, string> = { obsidian: STUB, ...stubs };
  const file = new URL(entry, import.meta.url).pathname;
  const out = await build({
    stdin: { contents: `export * from ${JSON.stringify(file)}; import * as module from ${JSON.stringify(file)}; export { module }; export { notices, TFile, TFolder } from "obsidian";`, resolveDir: new URL(".", import.meta.url).pathname, loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", logLevel: "silent", loader: { ".webp": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "obsidian-stub", setup(b) {
      b.onResolve({ filter: /.*/ }, a => (Object.hasOwn(modules, a.path) ? { path: a.path, namespace: "stub" } : undefined));
      b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: modules[a.path], loader: "js" }));
    } }],
  });
  const code = out.outputFiles[0]!.text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`) as Promise<T>;
}
