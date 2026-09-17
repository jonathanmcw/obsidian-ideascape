import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
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

console.log(`Verified release output ${manifest.version}: main.js, manifest.json, styles.css`);
