// Copy the built plugin into a vault for testing.
// Usage: npm run install:vault -- /path/to/vault [--enable]   (or set OBSIDIAN_VAULT)
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const enable = args.includes("--enable");
const given = args.find(a => !a.startsWith("--")) ?? process.env.OBSIDIAN_VAULT;
if (!given) {
  console.error("Give the vault to install into: npm run install:vault -- /path/to/vault [--enable], or set OBSIDIAN_VAULT.");
  process.exit(1);
}
const vault = resolve(given);
const configDir = join(vault, ".obsidian");
if (!existsSync(configDir)) {
  console.error(`${vault} does not look like an Obsidian vault (no .obsidian folder).`);
  process.exit(1);
}
const { id } = JSON.parse(readFileSync("manifest.json", "utf8"));
for (const f of ["main.js", "manifest.json", "styles.css"]) {
  if (!existsSync(f)) { console.error(`${f} is missing: run npm run build first.`); process.exit(1); }
}
const dest = join(configDir, "plugins", id);
mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) cpSync(f, join(dest, f));
if (enable) {
  const p = join(configDir, "community-plugins.json");
  const list = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : [];
  if (!list.includes(id)) { list.push(id); writeFileSync(p, JSON.stringify(list, null, 2) + "\n"); console.log("enabled in community-plugins.json"); }
}
console.log("installed →", dest);
