import { PluginSettingTab, Setting, type App } from "obsidian";
import type MapPlugin from "./main.ts";
import { CUSTOM_THEME_ID, THEMES, defaultCustomTheme, type CustomThemeDef } from "./organiser/theme";
import { DEFAULT_PREFS, type NodeStyle, type OutlineWidth, type Prefs } from "./organiser/model/store";
import { LAYOUT_LABEL, MAP_LAYOUTS, ORG_CHART, type MapLayout } from "./organiser/model/types";
import { shownLayout } from "./organiser/layout/arrange";
import { PLUGIN_NAME } from "./brand.ts";
import { MARKER } from "./organiser/model/markdown";

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
}

export const DEFAULT_SETTINGS: MapSettings = {
  mapsFolder: "maps",
  mapTheme: "auto",
  customTheme: defaultCustomTheme(),
  autoOpenMaps: true,
  showRibbon: true,
  explorerBadges: true,
  mapPrefs: { shape: DEFAULT_PREFS.shape, nodeStyle: DEFAULT_PREFS.nodeStyle, inspectorOpen: false, reduceMotion: false, outlineWidth: "column", mapLayout: "auto", discardEmptyOnEsc: true },
};

export class MapSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MapPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();

    new Setting(containerEl).setName("Maps folder")
      .setDesc(`Where new maps are created. Maps are Markdown files with a ${MARKER} frontmatter key; the tree is a nested list with block ids.`)
      .addText(t => t.setValue(s.mapsFolder).onChange(async v => { s.mapsFolder = v.trim() || DEFAULT_SETTINGS.mapsFolder; await save(); }));

    // A map can pin its own theme, node style and layout in its Document panel (⌘/); these
    // are what a map uses until it does, and what a new map starts from.
    new Setting(containerEl).setName("Defaults for new maps").setHeading();

    new Setting(containerEl).setName("Theme")
      .setDesc("Obsidian uses the app's own colours and follows its light or dark mode. A map can pin its own theme in its document panel (⌘/).")
      .addDropdown(d => {
        d.addOption("auto", "Obsidian");
        for (const t of THEMES) d.addOption(t.id, t.name);
        d.addOption(CUSTOM_THEME_ID, `${s.customTheme?.name?.trim() || "Custom"} (your theme)`);
        d.setValue(s.mapTheme).onChange(async v => { s.mapTheme = v; await save(); });
      });

    new Setting(containerEl).setName("Node style")
      .setDesc("How a node wears its branch colour, for maps that have not chosen their own.")
      .addDropdown(d => d.addOptions({ outline: "Outline", bar: "Bar", filled: "Filled" }).setValue(s.mapPrefs.nodeStyle)
        .onChange(async v => { s.mapPrefs.nodeStyle = v as NodeStyle; await save(); }));

    new Setting(containerEl).setName("Layout")
      .setDesc(`Where nodes go, for maps that have not chosen: a mind map, ${ORG_CHART ? "an org chart, " : ""}or the positions you give them. ⌘3 in a map pins its choice.`)
      .addDropdown(d => d.addOptions(Object.fromEntries(MAP_LAYOUTS.map(l => [l, LAYOUT_LABEL[l]]))).setValue(shownLayout(s.mapPrefs.mapLayout ?? "auto"))
        .onChange(async v => { s.mapPrefs.mapLayout = v as MapLayout; await save(); }));

    new Setting(containerEl).setName("Behaviour").setHeading();

    new Setting(containerEl).setName("Outline width")
      .setDesc("The outline as a centred column, or stretched to the window.")
      .addDropdown(d => d.addOptions({ column: "Centred column", full: "Full width" }).setValue(s.mapPrefs.outlineWidth ?? "column")
        .onChange(async v => { s.mapPrefs.outlineWidth = v as OutlineWidth; await save(); }));

    new Setting(containerEl).setName("Esc removes an empty node")
      .setDesc("Leaving a node that is still empty with the escape key takes it back out, and the selection returns to where it came from.")
      .addToggle(t => t.setValue(s.mapPrefs.discardEmptyOnEsc ?? true).onChange(async v => { s.mapPrefs.discardEmptyOnEsc = v; await save(); }));

    new Setting(containerEl).setName("Open marked notes as maps")
      .setDesc(`A note with the ${MARKER} property opens in the map view; that property is the marker — leave it in place. Off: the note opens in the editor, and its file menu still opens it as a map.`)
      .addToggle(t => t.setValue(s.autoOpenMaps).onChange(async v => { s.autoOpenMaps = v; await save(); }));

    new Setting(containerEl).setName("Reduce motion")
      .setDesc("Switching between map and outline becomes a 200 ms crossfade.")
      .addToggle(t => t.setValue(s.mapPrefs.reduceMotion).onChange(async v => { s.mapPrefs.reduceMotion = v; await save(); }));

    new Setting(containerEl).setName("Ribbon icon")
      .setDesc(`Show the ${PLUGIN_NAME} button in the left ribbon: a new map, and the note in front of you as a map. The command palette has both either way.`)
      .addToggle(t => t.setValue(s.showRibbon).onChange(async v => { s.showRibbon = v; await save(); this.plugin.applyRibbon(); }));

    new Setting(containerEl).setName("Mark maps in the file explorer")
      .setDesc(`A note carrying the ${MARKER} key wears a small map tag beside its name.`)
      .addToggle(t => t.setValue(s.explorerBadges).onChange(async v => { s.explorerBadges = v; await save(); this.plugin.decorateExplorer(); }));
  }
}
