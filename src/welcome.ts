import { Modal, type App, type EventRef } from "obsidian";
import { PLUGIN_NAME } from "./brand";
import { MAP_FORMATS } from "./organiser/model/markdown";
import { chord, macKeys } from "./organiser/ui/keys";
import convertDark from "./welcome/convert-dark.webp";
import convertLight from "./welcome/convert-light.webp";
import mapDark from "./welcome/map-dark.webp";
import mapLight from "./welcome/map-light.webp";
import outlineDark from "./welcome/outline-dark.webp";
import outlineLight from "./welcome/outline-light.webp";

const PANEL_ID = "io-welcome-panel";

/** What the welcome window can do: the tour is the one action it ends on. */
export interface WelcomeActions {
  openTour(): Promise<void>;
}

export interface Slide {
  title: string;
  body: string;
  /** The same demo-vault screenshot in Obsidian's dark and light themes, inlined by the build. */
  image: { dark: string; light: string };
  alt: string;
}

/** Three slides: what a map is, the two views, and how a note becomes a map. Start, on the last, opens the tour. */
export function slides(mac = macKeys()): Slide[] {
  const k = (keys: string) => chord(keys, mac);
  return [
    {
      title: "Your notes, as mind maps",
      body: "A map is an ordinary Markdown note: its heading is the centre and its nested list is the tree. Read and edit it anywhere, map it here. The ribbon button starts a new one.",
      image: { dark: mapDark, light: mapLight },
      alt: "A weekend in Kyoto as a mind map: Friday, Saturday, Sunday, Pack and Budget branch off the centre",
    },
    {
      title: "One note, two views",
      body: `${k("⌘1")} shows the map and ${k("⌘2")} the outline. Fold, focus and find work in both, and both edit the same note.`,
      image: { dark: outlineDark, light: outlineLight },
      alt: "The same Kyoto weekend as an outline, with a coloured bar marking each branch",
    },
    {
      title: "Turn a note into a map",
      body: `Right-click any note and choose Open as a map. Its heading becomes the centre and its lists become branches. Notes with the ${MAP_FORMATS[0].key} property open as maps on their own.`,
      image: { dark: convertDark, light: convertLight },
      alt: "The file menu on a note in the file explorer, with Open as a map among its items and the Kyoto map behind",
    },
  ];
}

/** Shown once, the first time the plugin is turned on. Arrow keys and the dots move between slides; Start, on the
 *  last slide, opens the tour. It writes nothing until that button is pressed. */
export class WelcomeModal extends Modal {
  private readonly slides = slides();
  private index = 0;
  private shot!: HTMLImageElement;
  private panel!: HTMLElement;
  private heading!: HTMLElement;
  private body!: HTMLElement;
  private dots: HTMLButtonElement[] = [];
  private back!: HTMLButtonElement;
  private next!: HTMLButtonElement;
  private themeRef: EventRef | null = null;

  constructor(app: App, private readonly actions: WelcomeActions) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("io-welcome");
    this.titleEl.setText(PLUGIN_NAME);
    this.modalEl.setAttribute("aria-label", `${PLUGIN_NAME} welcome`);

    // The picture and its words are the panel the dots control, so a screen reader reads them as one slide.
    this.panel = this.contentEl.createDiv({ cls: "io-welcome-panel", attr: { role: "tabpanel", id: PANEL_ID } });
    const panel = this.panel;
    const figure = panel.createEl("figure", { cls: "io-welcome-figure" });
    this.shot = figure.createEl("img", { cls: "io-welcome-shot", attr: { width: 1200, height: 747 } });
    const words = panel.createDiv("io-welcome-words");
    this.heading = words.createEl("h2", { cls: "io-welcome-title" });
    this.body = words.createEl("p", { cls: "io-welcome-body" });

    const foot = this.contentEl.createDiv("io-welcome-foot");
    const dots = foot.createDiv({ cls: "io-welcome-dots", attr: { role: "tablist" } });
    this.dots = this.slides.map((s, i) => {
      const dot = dots.createEl("button", { cls: "io-welcome-dot", attr: { role: "tab", id: `${PANEL_ID}-tab-${i}`, "aria-controls": PANEL_ID, "aria-label": `${i + 1} of ${this.slides.length}: ${s.title}` } });
      dot.addEventListener("click", () => this.show(i, "dot"));
      // One dot at a time is a tab stop, and the arrows walk between them: the row is one control, not three.
      dot.addEventListener("keydown", (e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        this.show((this.index + step + this.slides.length) % this.slides.length, "dot");
      });
      return dot;
    });
    const actions = foot.createDiv("io-welcome-actions");
    this.back = actions.createEl("button", { text: "Back" });
    this.back.addEventListener("click", () => this.show(this.index - 1, "back"));
    this.next = actions.createEl("button", { cls: "mod-cta" });
    this.next.addEventListener("click", () => {
      if (this.index < this.slides.length - 1) this.show(this.index + 1, "next");
      else { this.close(); void this.actions.openTour(); }
    });

    this.scope.register([], "ArrowLeft", () => { this.show(this.index - 1, "keep"); return false; });
    this.scope.register([], "ArrowRight", () => { this.show(this.index + 1, "keep"); return false; });
    // The screenshots follow the theme, so a theme change while the window is open swaps them too.
    this.themeRef = this.app.workspace.on("css-change", () => this.paint());
    this.show(0, "next");
  }

  /** `where` says what should hold the keyboard afterwards: the button that carries the window forward, the dot
   *  the person is walking along, or whatever had focus already. */
  private show(i: number, where: "next" | "back" | "dot" | "keep"): void {
    if (i < 0 || i >= this.slides.length) return;
    const moved = i !== this.index;
    this.index = i;
    this.paint();
    // The new picture is in place at once; a short fade only softens the change. Nothing here waits for an
    // animation frame, so a window that is not being drawn still shows the slide when it is.
    if (moved && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) this.shot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease" });
    const strandedOnBack = where === "keep" && this.index === 0 && this.modalEl.ownerDocument.activeElement === this.back;
    if (where === "next" || strandedOnBack) this.next.focus();
    // Back keeps the keyboard on Back, so a second press carries on the way it was going. On the first slide Back
    // is hidden, so the keyboard would have nowhere to sit: it moves to the button that is still there.
    else if (where === "back") (this.index > 0 ? this.back : this.next).focus();
    else if (where === "dot") this.dots[this.index]?.focus();
  }

  private paint(): void {
    const s = this.slides[this.index];
    const dark = this.modalEl.ownerDocument.body.classList.contains("theme-dark");
    this.shot.src = dark ? s.image.dark : s.image.light;
    this.shot.alt = s.alt;
    this.heading.setText(s.title);
    this.body.setText(s.body);
    this.dots.forEach((d, k) => {
      d.setAttribute("aria-selected", String(k === this.index));
      d.tabIndex = k === this.index ? 0 : -1;
    });
    // The panel is named by the dot that is showing it, so it is not an unnamed region.
    this.panel.setAttribute("aria-labelledby", `${PANEL_ID}-tab-${this.index}`);
    const last = this.index === this.slides.length - 1;
    this.back.toggleVisibility(this.index > 0);
    this.next.setText(last ? "Start" : "Next");
  }

  onClose(): void {
    if (this.themeRef) this.app.workspace.offref(this.themeRef);
    this.themeRef = null;
    this.contentEl.empty();
  }
}
