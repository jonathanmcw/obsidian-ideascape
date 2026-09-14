// Show the welcome window again in a vault, the way a first run shows it: turn Ideascape on if it's off, forget
// that the welcome was seen, and reload the vault so it opens on layout ready.
// Usage: npm run welcome:again -- "Vault name"   (needs Obsidian 1.12+ with its command line tool, and the vault open)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const vault = process.argv.slice(2).find(a => !a.startsWith("--")) ?? process.env.OBSIDIAN_VAULT_NAME;
if (!vault) {
  console.error('Give the vault\'s name: npm run welcome:again -- "My vault", or set OBSIDIAN_VAULT_NAME.');
  process.exit(1);
}
const { id } = JSON.parse(readFileSync("manifest.json", "utf8"));

const obsidian = (...args) => execFileSync("obsidian", [...args, `vault=${vault}`], { encoding: "utf8", timeout: 30_000 }).trim();
const evaluate = code => obsidian("eval", `code=${code}`).replace(/^=> /, "");
const pause = ms => new Promise(r => setTimeout(r, ms));

// Obsidian only enables plugins it has read from disk, so a freshly copied plugin needs a rescan first.
if (evaluate(`String(!!app.plugins.plugins[${JSON.stringify(id)}])`) !== "true") {
  evaluate("app.plugins.loadManifests(); 'scanning'");
  await pause(1000);
  const out = obsidian("plugin:enable", `id=${id}`, "filter=community");
  if (/error/i.test(out)) { console.error(out); process.exit(1); }
  await pause(1000);
}

// Enabling marks the welcome as seen, so the flag is cleared after it, then written before the reload.
evaluate(`(p => { p.settings.welcomed = false; void p.saveSettings(); return 'reset'; })(app.plugins.plugins[${JSON.stringify(id)}])`);
await pause(1000);
const base = evaluate("app.vault.adapter.basePath");
const config = evaluate("app.vault.configDir");
const saved = JSON.parse(readFileSync(join(base, config, "plugins", id, "data.json"), "utf8"));
if (saved.welcomed !== false) { console.error("The welcome flag did not save; try again."); process.exit(1); }

obsidian("reload");
console.log(`Reloading "${vault}": the welcome window opens once the vault has loaded.`);
