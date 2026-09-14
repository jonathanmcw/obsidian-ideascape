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
import ribbonDark from "./welcome/ribbon-dark.webp";
import ribbonLight from "./welcome/ribbon-light.webp";

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

/** Four slides: what a map is, the two views, how a note becomes a map, and where new maps and the tour live. */
export function slides(mac = macKeys()): Slide[] {
  const k = (keys: string) => chord(keys, mac);
  return [
    {
      title: "Your notes, as mind maps",
      body: "A map is an ordinary Markdown note: its heading is the centre and its nested list is the tree. Read and edit it anywhere, map it here.",
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
    {
      title: "Start with the tour",
      body: "The ribbon button makes a new map in your maps folder. The tour is a map where every node shows a feature by using it, so it is the quickest way in.",
      image: { dark: ribbonDark, light: ribbonLight },
      alt: "The ribbon menu beside the file explorer, offering New map and Take the tour",
    },
  ];
}

/** Shown once, the first time the plugin is turned on. Arrow keys and the dots move between slides; the last slide
 *  opens the tour. It writes nothing until that button is pressed. */
export class WelcomeModal extends Modal {
  private readonly slides = slides();
  private index = 0;
  private shot!: HTMLImageElement;
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

    const figure = this.contentEl.createEl("figure", { cls: "io-welcome-figure" });
    this.shot = figure.createEl("img", { cls: "io-welcome-shot", attr: { width: 1200, height: 747, decoding: "async" } });
    const words = this.contentEl.createDiv("io-welcome-words");
    this.heading = words.createEl("h2", { cls: "io-welcome-title" });
    this.body = words.createEl("p", { cls: "io-welcome-body" });

    const foot = this.contentEl.createDiv("io-welcome-foot");
    const dots = foot.createDiv({ cls: "io-welcome-dots", attr: { role: "tablist" } });
    this.dots = this.slides.map((s, i) => {
      const dot = dots.createEl("button", { cls: "io-welcome-dot", attr: { role: "tab", "aria-label": `${i + 1} of ${this.slides.length}: ${s.title}` } });
      dot.addEventListener("click", () => this.show(i));
      return dot;
    });
    const actions = foot.createDiv("io-welcome-actions");
    this.back = actions.createEl("button", { text: "Back" });
    this.back.addEventListener("click", () => this.show(this.index - 1));
    this.next = actions.createEl("button", { cls: "mod-cta" });
    this.next.addEventListener("click", () => {
      if (this.index < this.slides.length - 1) this.show(this.index + 1);
      else { this.close(); void this.actions.openTour(); }
    });

    this.scope.register([], "ArrowLeft", () => { this.show(this.index - 1); return false; });
    this.scope.register([], "ArrowRight", () => { this.show(this.index + 1); return false; });
    // The screenshots follow the theme, so a theme change while the window is open swaps them too.
    this.themeRef = this.app.workspace.on("css-change", () => this.paint());
    this.show(0);
  }

  private show(i: number): void {
    if (i < 0 || i >= this.slides.length) return;
    const moved = i !== this.index;
    this.index = i;
    if (moved) {
      this.modalEl.addClass("is-switching");
      // One frame with the old slide faded, then the new one fades in: the CSS transition does the rest.
      window.requestAnimationFrame(() => { this.paint(); this.modalEl.removeClass("is-switching"); });
    } else this.paint();
    this.next.focus();
  }

  private paint(): void {
    const s = this.slides[this.index];
    const dark = this.modalEl.ownerDocument.body.classList.contains("theme-dark");
    this.shot.src = dark ? s.image.dark : s.image.light;
    this.shot.alt = s.alt;
    this.heading.setText(s.title);
    this.body.setText(s.body);
    this.dots.forEach((d, k) => d.setAttribute("aria-selected", String(k === this.index)));
    const last = this.index === this.slides.length - 1;
    this.back.toggleVisibility(this.index > 0);
    this.next.setText(last ? "Open the tour" : "Next");
  }

  onClose(): void {
    if (this.themeRef) this.app.workspace.offref(this.themeRef);
    this.themeRef = null;
    this.contentEl.empty();
  }
}
