// The rendered checks (npm run ui) are only as honest as their fixture. A fixture drifts when a component renames a
// class and the page beside it keeps the old one: the check still passes, and it is checking a page the app no
// longer draws. So every class the fixture uses must still be written somewhere in src.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Every .ts/.tsx under src, as one string: where a class is authored, however it is spelled together. */
function sources(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
      else if (/\.tsx?$/.test(entry.name)) out.push(read(`${dir}/${entry.name}`));
    }
  };
  walk("src");
  return out.join("\n");
}

test("ui fixture: every class it renders is one the components still write", () => {
  const harness = read("test/ui/harness.html");
  const code = sources();
  const css = read("src/organiser/styles.css") + read("src/styles/map-host.css");

  // The fixture's own scaffolding, which belongs to the page and not to the app.
  const scaffolding = new Set(["surface", "frame", "io-root", "app"]);
  const classes = new Set(
    [...harness.matchAll(/class="([^"]+)"/g)]
      .flatMap(match => match[1]!.split(/\s+/))
      .filter(name => name && !scaffolding.has(name)),
  );
  assert.ok(classes.size > 30, `the fixture renders only ${classes.size} classes — has it been emptied?`);

  // A class may be written whole (`className="nt-main"`) or composed (`className={`fmt fmt-${f}`}`), so a name
  // counts as written if it appears in src at all, if its stem is used in a template, or if the sheet styles it.
  const written = (name: string) => code.includes(name) || css.includes(`.${name}`) || code.includes(`${name.replace(/-[^-]+$/, "")}-\${`);
  const orphans = [...classes].filter(name => !written(name));
  assert.deepEqual(orphans, [], `the fixture draws classes nothing in src writes any more: ${orphans.join(", ")}`);
});

test("ui fixture: it dresses the sheet in the app's own variables, and reads the built stylesheet", () => {
  const harness = read("test/ui/harness.html");
  assert.match(harness, /<link rel="stylesheet" href="\.\.\/\.\.\/styles\.css">/, "the fixture must read the built stylesheet, not a copy");
  // The tokens the plugin now takes from Obsidian: if the fixture stops setting one, its checks would pass on a
  // fallback that no Obsidian user ever sees.
  for (const token of ["--radius-m", "--clickable-icon-radius", "--modal-radius", "--icon-m-stroke-width", "--font-ui-small", "--font-interface", "--anim-duration-fast"]) {
    assert.match(harness, new RegExp(`${token}:`), `the fixture must define Obsidian's ${token}`);
  }
});
