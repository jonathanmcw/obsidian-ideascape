import { themeById, type HostColours } from "./organiser/theme";

/** obsidian: the app's own colours for the map's Obsidian theme — whatever theme is installed, light or dark.
 *  Each variable is resolved to plain sRGB by painting it on a one-pixel canvas, so a theme that writes its
 *  colours with color-mix() or another colour space still gives the map numbers it can work with. */
export function readObsidianColours(doc: Document): HostColours | null {
  // Without a document to read (tests, a view not yet in a window) the map keeps to its built-in themes.
  try { return read(doc); } catch { return null; }
}

function read(doc: Document): HostColours {
  const dark = doc.body.classList.contains("theme-dark");
  const base = themeById(dark ? "graphite" : "paper");
  const win = doc.defaultView;
  const style = win?.getComputedStyle(doc.body);
  const canvas = doc.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const probe = doc.body.createSpan({ attr: { "aria-hidden": "true" } });
  probe.hide();
  try {

    const resolve = (name: string): { hex: string; css: string } | null => {
      if (!win || !ctx || !style?.getPropertyValue(name).trim()) return null;
      probe.style.color = `var(${name})`;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = win.getComputedStyle(probe).color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      return { hex, css: a === 255 ? hex : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})` };
    };
    const css = (name: string, fallback: string) => resolve(name)?.css ?? fallback;

    // The eight named colours every Obsidian theme defines, in the order the built-in themes use their hues.
    const named = ["orange", "blue", "green", "yellow", "purple", "cyan", "pink", "red"];
    const colours: HostColours = {
      name: "Obsidian",
      dark,
      stage: css("--background-primary", base.vars["--stage"]),
      surface: css("--background-secondary", base.vars["--surface"]),
      surface2: css("--background-secondary-alt", css("--background-secondary", base.vars["--surface-2"])),
      line: css("--background-modifier-border", base.vars["--line"]),
      lineStrong: css("--background-modifier-border-hover", base.vars["--line-strong"]),
      ink: css("--text-normal", base.vars["--ink"]),
      inkMuted: css("--text-muted", base.vars["--ink-2"]),
      edge: css("--text-faint", base.vars["--edge"]),
      accent: resolve("--interactive-accent")?.hex ?? base.vars["--accent"],
      danger: css("--text-error", base.vars["--danger"]),
      branches: named.map((n, i) => resolve(`--color-${n}`)?.hex ?? base.branches[i]),
    };
    return colours;
  } finally {
    probe.remove();
  }
}
