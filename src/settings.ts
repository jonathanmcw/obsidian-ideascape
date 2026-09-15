import { Platform, PluginSettingTab, Setting, type App, type SettingDefinition, type SettingDefinitionItem } from "obsidian";
import type MapPlugin from "./main.ts";
import { CUSTOM_THEME_ID, THEMES, defaultCustomTheme, type CustomThemeDef } from "./organiser/theme";
import { DEFAULT_PREFS, type NodeStyle, type OutlineWidth, type Prefs } from "./organiser/model/store";
import { LAYOUT_LABEL, MAP_LAYOUTS, ORG_CHART, type MapLayout } from "./organiser/model/types";
import { shownLayout } from "./organiser/layout/arrange";
import { PLUGIN_NAME } from "./brand.ts";
import { MARKER } from "./organiser/model/markdown";
import { chord } from "./tour.ts";

export interface MapSettings {
  mapsFolder: string;
  mapTheme: string; // "auto" is the Obsidian theme (the app's own colours, light or dark), or a theme id
  /** obsidian: the one theme the person defines (Document panel → Edit the custom theme). */
  customTheme: CustomThemeDef;
  mapPrefs: Omit<Prefs, "theme">;
  /** A note carrying the map key opens in the map view. */
  autoOpenMaps: boolean;
  /** The plugin's button in the left ribbon. */
  showRibbon: boolean;
  /** Marked notes wear a MAP tag in the file explorer. */
  explorerBadges: boolean;
  /** The welcome window has been shown. */
  welcomed: boolean;
}

export const DEFAULT_SETTINGS: MapSettings = {
  mapsFolder: "maps",
  mapTheme: "auto",
  customTheme: defaultCustomTheme(),
  autoOpenMaps: true,
  showRibbon: true,
  explorerBadges: true,
  welcomed: false,
  mapPrefs: { shape: DEFAULT_PREFS.shape, nodeStyle: DEFAULT_PREFS.nodeStyle, inspectorOpen: false, reduceMotion: false, outlineWidth: "column", mapLayout: "auto", discardEmptyOnEsc: true },
};

/** A setting, described once: Obsidian 1.13 and later render (and search) it from `getSettingDefinitions`; older
 *  versions get the same rows from `display`. */
type SettingKey = "mapsFolder" | "mapTheme" | "autoOpenMaps" | "showRibbon" | "explorerBadges"
  | "mapPrefs.nodeStyle" | "mapPrefs.mapLayout" | "mapPrefs.outlineWidth" | "mapPrefs.discardEmptyOnEsc" | "mapPrefs.reduceMotion";
type Row = { name: string; desc: string; aliases?: string[] } & (
  | { action: { button: string; run: () => void } }
  | { toggle: SettingKey }
  | { dropdown: SettingKey; options: Record<string, string> }
  | { folder: SettingKey }
);
type Group = { heading?: string; rows: Row[] };

export class MapSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MapPlugin) { super(app, plugin); }

  private groups(): Group[] {
    const key = (keys: string) => chord(keys, Platform.isMacOS || Platform.isIosApp);
    const s = this.plugin.settings;
    return [
      {
        rows: [
          { name: "Take the tour", desc: "A map where every node shows a feature by using it. Opens the one in your maps folder, or writes it there.", aliases: ["help", "tutorial", "getting started", "welcome"], action: { button: "Open", run: () => void this.plugin.openTour() } },
          { name: "Maps folder", desc: `Where new maps and the tour are created. A map is a Markdown note with the ${MARKER} property; its list is the tree.`, aliases: ["location", "directory"], folder: "mapsFolder" },
        ],
      },
      {
        // A map can pin its own theme, node style and layout in its Document panel; these are what a map uses until
        // it does, and what a new map starts from.
        heading: "Defaults for new maps",
        rows: [
          {
            name: "Theme",
            desc: `Obsidian uses the app's own colours and follows its light or dark mode. A map can pin its own theme in its document panel (${key("⌘/")}).`,
            aliases: ["colour", "color", "dark", "light"],
            dropdown: "mapTheme",
            options: { auto: "Obsidian", ...Object.fromEntries(THEMES.map(t => [t.id, t.name])), [CUSTOM_THEME_ID]: `${s.customTheme?.name?.trim() || "Custom"} (your theme)` },
          },
          { name: "Node style", desc: "How a node wears its branch colour, for maps that have not chosen their own.", dropdown: "mapPrefs.nodeStyle", options: { outline: "Outline", bar: "Bar", filled: "Filled" } },
          {
            name: "Layout",
            desc: `Where nodes go, for maps that have not chosen: a mind map, ${ORG_CHART ? "an org chart, " : ""}or the positions you give them. ${key("⌘3")} in a map pins its choice.`,
            aliases: ["mind map", "free"],
            dropdown: "mapPrefs.mapLayout",
            options: Object.fromEntries(MAP_LAYOUTS.map(l => [l, LAYOUT_LABEL[l]])),
          },
        ],
      },
      {
        heading: "Behaviour",
        rows: [
          { name: "Outline width", desc: "The outline as a centred column, or stretched to the window.", dropdown: "mapPrefs.outlineWidth", options: { column: "Centred column", full: "Full width" } },
          { name: "Esc removes an empty node", desc: "Leaving a node that is still empty with the escape key takes it back out, and the selection returns to where it came from.", toggle: "mapPrefs.discardEmptyOnEsc" },
          { name: "Open marked notes as maps", desc: `Notes with the ${MARKER} property open in the map view. Turn off to open them in the editor; the file menu still has Open as a map.`, toggle: "autoOpenMaps" },
          { name: "Reduce motion", desc: "Switching between map and outline becomes a 200 ms crossfade.", aliases: ["animation"], toggle: "mapPrefs.reduceMotion" },
          { name: "Ribbon icon", desc: `Show the ${PLUGIN_NAME} button in the left ribbon. One click makes a new map. The command palette has them all either way.`, toggle: "showRibbon" },
          { name: "Mark maps in the file explorer", desc: `Notes with the ${MARKER} property show a small map tag beside their name.`, aliases: ["badge", "tag"], toggle: "explorerBadges" },
        ],
      },
    ];
  }

  getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
    return this.groups().map(g => ({
      type: "group" as const,
      heading: g.heading,
      items: g.rows.map((r): SettingDefinition<SettingKey> => {
        const base = { name: r.name, desc: r.desc, aliases: r.aliases };
        if ("action" in r) return { ...base, action: () => r.action.run() };
        if ("toggle" in r) return { ...base, control: { type: "toggle", key: r.toggle } };
        if ("folder" in r) return { ...base, control: { type: "folder", key: r.folder, placeholder: DEFAULT_SETTINGS.mapsFolder } };
        return { ...base, control: { type: "dropdown", key: r.dropdown, options: r.options } };
      }),
    }));
  }

  getControlValue(key: string): unknown {
    const s = this.plugin.settings;
    switch (key as SettingKey) {
      case "mapsFolder": return s.mapsFolder;
      case "mapTheme": return s.mapTheme;
      case "autoOpenMaps": return s.autoOpenMaps;
      case "showRibbon": return s.showRibbon;
      case "explorerBadges": return s.explorerBadges;
      case "mapPrefs.nodeStyle": return s.mapPrefs.nodeStyle;
      case "mapPrefs.mapLayout": return shownLayout(s.mapPrefs.mapLayout ?? "auto");
      case "mapPrefs.outlineWidth": return s.mapPrefs.outlineWidth ?? "column";
      case "mapPrefs.discardEmptyOnEsc": return s.mapPrefs.discardEmptyOnEsc ?? true;
      case "mapPrefs.reduceMotion": return s.mapPrefs.reduceMotion;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    switch (key as SettingKey) {
      case "mapsFolder": s.mapsFolder = String(value).trim() || DEFAULT_SETTINGS.mapsFolder; break;
      case "mapTheme": s.mapTheme = String(value); break;
      case "autoOpenMaps": s.autoOpenMaps = Boolean(value); break;
      case "showRibbon": s.showRibbon = Boolean(value); break;
      case "explorerBadges": s.explorerBadges = Boolean(value); break;
      case "mapPrefs.nodeStyle": s.mapPrefs.nodeStyle = value as NodeStyle; break;
      case "mapPrefs.mapLayout": s.mapPrefs.mapLayout = value as MapLayout; break;
      case "mapPrefs.outlineWidth": s.mapPrefs.outlineWidth = value as OutlineWidth; break;
      case "mapPrefs.discardEmptyOnEsc": s.mapPrefs.discardEmptyOnEsc = Boolean(value); break;
      case "mapPrefs.reduceMotion": s.mapPrefs.reduceMotion = Boolean(value); break;
    }
    await this.plugin.saveSettings();
    if (key === "showRibbon") this.plugin.applyRibbon();
    if (key === "explorerBadges") this.plugin.decorateExplorer();
  }

  /** Obsidian before 1.13: the same rows, drawn one by one. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const g of this.groups()) {
      if (g.heading) new Setting(containerEl).setName(g.heading).setHeading();
      for (const r of g.rows) {
        const row = new Setting(containerEl).setName(r.name).setDesc(r.desc);
        if ("action" in r) row.addButton(b => b.setButtonText(r.action.button).onClick(() => r.action.run()));
        else if ("toggle" in r) row.addToggle(t => t.setValue(this.getControlValue(r.toggle) as boolean).onChange(v => this.setControlValue(r.toggle, v)));
        else if ("folder" in r) row.addText(t => t.setPlaceholder(DEFAULT_SETTINGS.mapsFolder).setValue(this.getControlValue(r.folder) as string).onChange(v => this.setControlValue(r.folder, v)));
        else row.addDropdown(d => d.addOptions(r.options).setValue(this.getControlValue(r.dropdown) as string).onChange(v => this.setControlValue(r.dropdown, v)));
      }
    }
  }
}
