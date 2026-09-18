// npm run review — a pass through the map's surfaces in the real Obsidian, for a person to look through.
//
//   npm run review                      # desktop states from demo-vault, into review/
//   npm run review -- --phone           # and the phone, through Obsidian's own emulation (see the warning below)
//   VAULT="My vault" npm run review     # another vault (the note is Maps/Launch a podcast.md by default)
//   OUT=/tmp/shots npm run review
//
// The pictures come from Electron's own renderer capture, so nothing outside Obsidian's window can appear in them,
// and they are written into a page that embeds them — it opens anywhere, including viewers that will not fetch a
// file sitting next to the page.
//
// The phone pass is asked for, not assumed: `app.emulateMobile()` reloads Obsidian, resizes its window to a phone,
// and has been seen to take the app down with it. It is left off by default; when it is asked for, the emulation
// and the window are put back whatever happens, and if Obsidian does go down, reopen it and run:
//   obsidian vault=<vault> eval "code=app.emulateMobile(false)"
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const vault = process.env.VAULT ?? "demo-vault";
const out = resolve(process.env.OUT ?? "review");
const note = process.env.NOTE ?? "Maps/Launch a podcast.md";
const wantsPhone = process.argv.includes("--phone");
/** The window to put back afterwards, whatever the pass does to it. */
const DESK = { x: 80, y: 60, width: 1280, height: 860 };
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

// Park the cursor off the window first: Obsidian turns an aria-label into a tooltip on hover, and a cursor left
// resting over a sheet puts that tooltip in the picture. cliclick is optional — without it the pass still runs.
try { execFileSync("cliclick", ["m:20,20"], { stdio: "ignore" }); } catch { /* no cliclick: the cursor stays put */ }

evaluate(`window.__ideascapeReview=${JSON.stringify({ out, note })};${asFile(renderer)}`, 20);
console.log(`  desktop: ${await waitFor(`${out}/done.json`, 180)} pictures`);

// The phone: Obsidian's own emulation, which reloads the app and can take it down. Asked for, never assumed.
if (wantsPhone) {
  console.log("  phone: emulating (Obsidian reloads; this is the fragile part)…");
  evaluate("app.emulateMobile(true); 'on'", 20);
  try {
    // Wait for the reload to finish rather than guessing: the app answers again, and says it is a phone.
    let ready = false;
    for (let tries = 0; tries < 12 && !ready; tries++) {
      await sleep(5000);
      ready = evaluate("app.isMobile === true", 15).includes("true");
    }
    if (!ready) console.log("    Obsidian did not come back as a phone; skipping the phone pass");
    else {
      evaluate(`window.__ideascapeReview=${JSON.stringify({ out, note, width: 414, height: 880, phone: true })};${asFile(resolve("scripts/shots/review-phone.js"))}`, 20);
      console.log(`  phone: ${await waitFor(`${out}/done-phone.json`, 180)} pictures`);
    }
  } finally {
    // Always: out of emulation, back to a desktop-shaped window, however the pass ended.
    evaluate("app.emulateMobile(false); 'off'", 20);
    await sleep(12000);
    evaluate(`require('electron').remote.getCurrentWindow().setContentBounds(${JSON.stringify(DESK)}); 'restored'`, 20);
  }
} else {
  console.log("  phone: skipped (add --phone; it reloads Obsidian and can crash it)");
}

await sleep(1500); // the last picture may still be on its way to disk
// The page and the contact sheet are built with Pillow, as the rest of the shots rig is.
const version = JSON.parse(readFileSync("manifest.json", "utf8")).version;
execFileSync("python3", [resolve("scripts/shots/review-page.py"), out, version, vault], { stdio: "inherit" });
