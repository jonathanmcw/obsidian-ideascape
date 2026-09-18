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

/** Held hard when releasing (the workflow passes --strict), said out loud otherwise: these are states that are
 *  perfectly normal between releases and wrong at the moment of making one. */
const note = message => {
  if (process.argv.includes("--strict")) assert.fail(message);
  console.warn(`  note: ${message}`);
};

// Obsidian reads manifest.json from the *default branch* to decide that an update exists, and then downloads the
// assets from the release tagged with that number. Two ways for this file to mislead a person, pulling opposite
// ways:
//
//   a version with no tag at all   — every user is offered an update whose download 404s, silently, with nothing
//                                    in the repo looking out of place
//   a version tagged earlier       — ordinary between releases, and wrong at the moment of releasing: Obsidian
//                                    only updates a vault when the number goes up, so re-releasing reaches nobody
//
// So the manifest names the released version while work goes on, and a release bumps it in the very commit that is
// tagged — which is the commit the release workflow checks out. A build meant for testing goes in
// manifest-beta.json, which Obsidian never reads and BRAT does.
if (git(["rev-parse", "--git-dir"]).trim()) {
  const tagged = git(["tag", "--list", manifest.version]).trim();
  if (!tagged) {
    note(`manifest.json names ${manifest.version}, which has no tag: on the default branch Obsidian offers that version to every user and the download fails. Tag it, or leave this at the released version and put the test build in manifest-beta.json.`);
  } else {
    const head = git(["rev-parse", "HEAD^{commit}"]).trim();
    const atTag = git(["rev-parse", `${manifest.version}^{commit}`]).trim();
    if (atTag !== head) note(`${manifest.version} is the released version, tagged at ${atTag.slice(0, 7)}: bump it in the commit you tag, not before.`);
  }
}

// A beta manifest is for BRAT, never for Obsidian: the same plugin, at a version that is not the released one.
let betaManifest = null;
try {
  betaManifest = json("manifest-beta.json");
} catch { /* there need not be one */ }
if (betaManifest) {
  assert.equal(betaManifest.id, manifest.id, "manifest-beta.json must describe the same plugin as manifest.json");
  assert.notEqual(betaManifest.version, manifest.version, "manifest-beta.json must name a version that is not the released one");
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
