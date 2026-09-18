// npm run review — a pass through the map's surfaces in the real Obsidian, for a person to look through.
//
//   npm run review                      # desktop states from demo-vault, into review/
//   VAULT="My vault" npm run review     # another vault (the note is Maps/Launch a podcast.md by default)
//   OUT=/tmp/shots npm run review
//
// The pictures come from Electron's own renderer capture, so nothing outside Obsidian's window can appear in them.
// Phone states come from Obsidian's phone emulation, which reloads the app; they are taken in a second pass and the
// emulation is always turned back off.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const vault = process.env.VAULT ?? "demo-vault";
const out = resolve(process.env.OUT ?? "review");
const note = process.env.NOTE ?? "Maps/Launch a podcast.md";
const cli = ["/Applications/Obsidian.app/Contents/MacOS/obsidian", "/usr/local/bin/obsidian"].find(existsSync) ?? "obsidian";

/** One `obsidian eval`, with a ceiling: a renderer that never answers must not hang the run. The CLI can return
 *  before the renderer has finished the work it was given, so a pass is waited for by the file it writes, not by
 *  what this prints. */
function evaluate(code, seconds = 120) {
  try {
    return execFileSync("perl", ["-e", "alarm shift; exec @ARGV", String(seconds), cli, `vault=${vault}`, "eval", `code=${code}`], { encoding: "utf8" }).replace(/^=> /, "").trim();
  } catch (error) {
    return `error: ${error.stderr?.toString().trim() || error.message}`;
  }
}
const asFile = path => `eval(require('fs').readFileSync(${JSON.stringify(path)},'utf8'))`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Wait for the renderer to say it finished, and report what it could not photograph. */
async function waitFor(file, seconds) {
  for (let waited = 0; waited < seconds * 1000; waited += 1000) {
    if (existsSync(file)) {
      const done = JSON.parse(readFileSync(file, "utf8"));
      if (done.missed?.length) for (const miss of done.missed) console.log(`    could not take ${miss}`);
      return done.taken.length;
    }
    await sleep(1000);
  }
  return `gave up after ${seconds}s`;
}

mkdirSync(out, { recursive: true });
const renderer = resolve("scripts/shots/review.js");

console.log(`Obsidian (${vault}) → ${out}`);
for (const stale of ["done.json", "done-phone.json"]) if (existsSync(`${out}/${stale}`)) rmSync(`${out}/${stale}`);

evaluate(`window.__ideascapeReview=${JSON.stringify({ out, note })};${asFile(renderer)}`, 20);
console.log(`  desktop: ${await waitFor(`${out}/done.json`, 180)} pictures`);

// The phone: Obsidian's own emulation, which reloads the app. It is turned off again whatever happens above.
console.log("  phone: emulating…");
evaluate("app.emulateMobile(true); 'on'", 20);
await sleep(14000);
evaluate(`window.__ideascapeReview=${JSON.stringify({ out, note, width: 414, height: 880, phone: true })};${asFile(resolve("scripts/shots/review-phone.js"))}`, 20);
console.log(`  phone: ${await waitFor(`${out}/done-phone.json`, 150)} pictures`);
evaluate("app.emulateMobile(false); 'off'", 20);
await sleep(10000);

const shots = readdirSync(out).filter(name => name.endsWith(".png")).sort();
const cards = shots.map(name => `<figure><img src="${name}" alt="${name}" loading="lazy"><figcaption>${name.replace(/\.png$/, "").replace(/^\d+-/, "").replace(/-/g, " ")}</figcaption></figure>`).join("\n");
writeFileSync(`${out}/index.html`, `<!doctype html><meta charset="utf-8"><title>Ideascape — ${shots.length} surfaces to review</title>
<style>
  body { margin: 0; padding: 32px; background: #141414; color: #e6e6e6; font: 14px/1.6 -apple-system, BlinkMacSystemFont, sans-serif; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  p.note { margin: 0 0 28px; color: #8a8a8a; }
  .grid { display: grid; gap: 28px; grid-template-columns: repeat(auto-fit, minmax(460px, 1fr)); }
  figure { margin: 0; }
  img { width: 100%; display: block; border-radius: 10px; background: #1e1e1e; box-shadow: 0 2px 10px rgba(0,0,0,.4); }
  figcaption { margin-top: 8px; color: #9a9a9a; font-size: 12px; text-transform: capitalize; }
</style>
<h1>Ideascape ${JSON.parse(readFileSync("manifest.json", "utf8")).version} — ${shots.length} surfaces</h1>
<p class="note">Taken in Obsidian from ${vault}, renderer capture. ${new Date().toLocaleString()}</p>
<div class="grid">\n${cards}\n</div>\n`);
console.log(`  ${shots.length} pictures → ${out}/index.html`);
