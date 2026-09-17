import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { cssStructureProblems } from "./css-structure.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** Git, when this is a checkout with tags; "" anywhere else (a tarball, a sandbox), where the tag check is skipped. */
const git = args => { try { return execFileSync("git", args, { cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
const json = path => JSON.parse(read(path));

const manifest = json("manifest.json");
const pkg = json("package.json");
const versions = json("versions.json");

assert.equal(pkg.version, manifest.version, "package.json and manifest.json versions must match");
assert.equal(pkg.description, manifest.description, "package.json and manifest.json descriptions must match");
assert.ok(manifest.description.length <= 250, "manifest description must fit the Community directory limit");
assert.match(manifest.description, /\.$/, "manifest description must end with a period");
assert.doesNotMatch(manifest.description, /^this (?:is a )?plugin\b/i, "manifest description must start with the user action");
assert.equal(
  versions[manifest.version],
  manifest.minAppVersion,
  "versions.json must map the release to manifest.minAppVersion",
);

// A version that already carries a tag has already been published under that number: Obsidian only updates a
// vault when the number goes up, so releasing it again reaches nobody. The tag pointing at the commit being
// released is the one case that is fine — that is what the release workflow checks out.
const tagged = git(["tag", "--list", manifest.version]).trim();
if (tagged) {
  const head = git(["rev-parse", "HEAD^{commit}"]).trim();
  const atTag = git(["rev-parse", `${manifest.version}^{commit}`]).trim();
  assert.equal(atTag, head, `${manifest.version} is already tagged at ${atTag.slice(0, 7)}: bump the version before releasing`);
}

const readme = read("README.md");
assert.match(readme, /https:\/\/community\.obsidian\.md\/plugins\/ideascape/, "README must link to the live Community listing");
assert.doesNotMatch(readme, /until (?:it is|it's) listed/i, "README must not describe the published plugin as unlisted");

for (const path of ["main.js", "manifest.json", "styles.css"]) {
  assert.ok(statSync(new URL(`../${path}`, import.meta.url)).size > 0, `${path} must be a non-empty release artifact`);
}

const main = read("main.js");
assert.doesNotMatch(main, /sourceMappingURL/, "the production bundle must not reference a source map");
assert.doesNotMatch(main, /\beval\s*\(/, "the production bundle must not use eval()");

const cssSources = ["src/styles/map-host.css", "src/organiser/styles.css"];
const expectedCss = cssSources
  .map(path => `/* ==== ${path} ==== */\n${read(path)}`)
  .join("\n\n");
const builtCss = read("styles.css");

assert.equal(builtCss, expectedCss, "styles.css must be the deterministic output of the two source stylesheets");
assert.doesNotMatch(
  builtCss,
  /@import\s+(?:url\()?['"]?https?:/i,
  "release CSS must not load a remote stylesheet",
);

const scannedCss = builtCss.replace(/\/\*[\s\S]*?\*\//g, "");
for (const [name, pattern] of [
  ["!important", /!important\b/i],
  [":has()", /:has\s*\(/i],
  ["CSS multicolumn properties", /(?:^|[;{])\s*(?:columns|column-count|column-width|column-gap)\s*:/im],
  ["display: contents", /display\s*:\s*contents\b/i],
  ["the text-decoration shorthand", /(?:^|[;{])\s*text-decoration\s*:/im],
]) {
  assert.doesNotMatch(scannedCss, pattern, `release CSS must not use ${name}`);
}

for (const block of scannedCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selector = block[1].trim().replace(/\s+/g, " ");
  const properties = [...block[2].matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)].map(match => match[1]);
  const duplicate = properties.find((property, index) => properties.indexOf(property) !== index);
  assert.equal(duplicate, undefined, `release CSS must not repeat ${duplicate} in ${selector}`);
}

// Valid CSS that is no longer shaped the way it reads: a rule spliced into a selector list, a rule left behind by
// the component it styled, a token read but never defined. None of these fail a build or a grep.
const structure = cssStructureProblems(builtCss);
assert.deepEqual(structure, [], `release CSS is misshapen:\n  ${structure.join("\n  ")}`);

// The pictures are part of what is released — the directory and the README show them. They cannot be checked for
// accuracy, only for age: a picture older than the interface it shows is one nobody has looked at since.
const lastTouched = path => Number(git(["log", "-1", "--format=%ct", "--", path]).trim()) || 0;
const uiTouched = Math.max(...["src/organiser", "src/styles", "src/welcome.ts", "src/map-view.ts"].map(lastTouched));
const shotsTaken = lastTouched("docs/screenshots");
if (uiTouched && shotsTaken && uiTouched > shotsTaken) {
  const days = Math.round((uiTouched - shotsTaken) / 86400);
  const stale = `the interface changed after the screenshots were taken (${days === 0 ? "the same day" : `${days} day${days === 1 ? "" : "s"} later`}): bash scripts/shots/capture.sh screenshots`;
  if (process.argv.includes("--strict")) assert.fail(stale);
  console.warn(`  note: ${stale}`);
}

console.log(`Verified release output ${manifest.version}: main.js, manifest.json, styles.css`);
