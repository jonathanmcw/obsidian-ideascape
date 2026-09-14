import { Modal, SuggestModal, setIcon, type App, type TFile } from "obsidian";
import { hasMapKey } from "./organiser/model/markdown";

/** What the welcome window can do: the plugin's own entry points, so the window teaches the real ones. */
export interface WelcomeActions {
  newMap(): Promise<void>;
  openTour(): Promise<void>;
  openMap(file: TFile): Promise<void>;
  /** The Markdown note in front of the person, if any. */
  noteToConvert(): TFile | null;
}

/** Shown once, the first time the plugin is turned on: the three things to know in the first minute. It writes nothing
 *  until a choice is made. */
export class WelcomeModal extends Modal {
  constructor(app: App, private readonly actions: WelcomeActions) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("io-welcome");
    this.titleEl.setText("Ideascape is ready");
    this.contentEl.createEl("p", { cls: "io-welcome-lede", text: "Mind maps that stay plain Markdown notes." });

    const note = this.actions.noteToConvert();
    const choices = this.contentEl.createDiv("io-welcome-choices");
    this.choice(choices, "git-branch", "New map", "A blank map in your maps folder.", () => void this.actions.newMap());
    this.choice(
      choices,
      "file-symlink",
      note ? `Turn “${note.basename}” into a map` : "Turn a note into a map",
      "Any time: right-click a note, then Open as a map.",
      () => (note ? void this.actions.openMap(note) : new NotePicker(this.app, f => void this.actions.openMap(f)).open()),
    );
    this.choice(choices, "sparkles", "Take the 2-minute tour", "A map where every node shows a feature.", () => void this.actions.openTour());

    const foot = this.contentEl.createDiv("modal-button-container");
    foot.createEl("button", { text: "Not now" }).addEventListener("click", () => this.close());
  }

  private choice(parent: HTMLElement, icon: string, title: string, hint: string, run: () => void): void {
    const b = parent.createEl("button", { cls: "io-welcome-choice" });
    setIcon(b.createSpan("io-welcome-icon"), icon);
    const words = b.createSpan("io-welcome-words");
    words.createSpan({ cls: "io-welcome-title", text: title });
    words.createSpan({ cls: "io-welcome-hint", text: hint });
    b.addEventListener("click", () => { this.close(); run(); });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Pick a Markdown note to open as a map, most recently changed first. Notes that are maps already are left out:
 *  they open as maps by themselves. */
class NotePicker extends SuggestModal<TFile> {
  constructor(app: App, private readonly chosen: (file: TFile) => void) {
    super(app);
    this.setPlaceholder("Choose a note to open as a map");
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to open as a map" },
      { command: "esc", purpose: "to dismiss" },
    ]);
    this.emptyStateText = "No note matches. Maps you already have are not listed.";
  }

  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase();
    return this.app.vault.getMarkdownFiles()
      .filter(f => f.path.toLowerCase().includes(q) && !hasMapKey(this.app.metadataCache.getFileCache(f)?.frontmatter))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 50);
  }

  // Obsidian's own one-line suggestion rows: the name, and the folder at the far end, so every row is the same height.
  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.addClass("mod-complex");
    el.createDiv("suggestion-content").createDiv({ cls: "suggestion-title", text: file.basename });
    const folder = file.parent && !file.parent.isRoot() ? file.parent.path : "";
    if (folder) el.createDiv("suggestion-aux").createSpan({ cls: "suggestion-flair io-welcome-path", text: folder });
  }

  onChooseSuggestion(file: TFile): void {
    this.chosen(file);
  }
}
