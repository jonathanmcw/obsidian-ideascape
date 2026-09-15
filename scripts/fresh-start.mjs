// Put a vault back to the moment before Ideascape was first turned on: the current build in place, no saved
// settings, the plugin off. Then turn it on in Settings › Community plugins, as a new person would.
// Usage: npm run fresh:start -- "Vault name"   (the vault open in Obsidian 1.12+ with its command line tool)
//        npm run fresh:start -- /path/to/vault  (closed vault: files only)
// Notes the plugin wrote (the tour, new maps) are left alone; delete them yourself if the test needs it.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const given = process.argv.slice(2).find(a => !a.startsWith("--"));
if (!given) { console.error('Give the vault: npm run fresh:start -- "My vault" (open in Obsidian) or /path/to/vault.'); process.exit(1); }
const { id } = JSON.parse(readFileSync("manifest.json", "utf8"));
for (const f of ["main.js", "manifest.json", "styles.css"]) {
  if (!existsSync(f)) { console.error(`${f} is missing: run npm run build first.`); process.exit(1); }
}

const isPath = given.includes("/") || existsSync(join(given, ".obsidian"));
let base = isPath ? resolve(given) : null;
const cli = (...args) => execFileSync("obsidian", [`vault=${given}`, ...args], { encoding: "utf8", timeout: 30_000 }).trim();
const evaluate = code => cli("eval", `code=${code}`).replace(/^=> /, "");
let live = false;
if (!isPath) {
  try { base = evaluate("app.vault.adapter.basePath"); live = true; }
  catch { console.error(`"${given}" is not open in Obsidian. Give the vault's path instead for a files-only reset.`); process.exit(1); }
}
const configDir = live ? evaluate("app.vault.configDir") : ".obsidian";
const dir = join(base, configDir, "plugins", id);

// 1. Off, the way Obsidian does it, so nothing of the running plugin survives.
if (live) {
  // disablePluginAndSave also drops it from community-plugins.json; the plain plugin:disable command does not.
  evaluate(`app.plugins.disablePluginAndSave(${JSON.stringify(id)}); 'off'`);
} else {
  const p = join(base, configDir, "community-plugins.json");
  if (existsSync(p)) {
    const list = JSON.parse(readFileSync(p, "utf8")).filter(x => x !== id);
    writeFileSync(p, JSON.stringify(list, null, 2) + "\n");
  }
}
// 2. The current build, and no settings: the welcome shows again and every setting is at its default.
execFileSync("node", ["scripts/install.mjs", base], { stdio: "inherit" });
rmSync(join(dir, "data.json"), { force: true });
// 3. A rescan, so the Community plugins list shows the copy just installed.
if (live) evaluate("app.plugins.loadManifests(); 'scanned'");

console.log(`\nFresh: ${id} is installed and off in "${given}", with no saved settings.`);
console.log("Now turn it on in Settings › Community plugins. The welcome opens once the plugin loads.");
