// The map's chrome, rendered, measured, and photographed.
//
// `npm run ui` loads test/ui/harness.html in Chromium at each shell and theme, reads computed styles, and fails on
// anything a person would see as broken: a control that is invisible or too small to hit, a token that did not
// resolve, text set in the wrong family. The tests beside it read the stylesheet as text, which cannot see any of
// that — every UI regression this plugin has shipped was valid CSS.
//
// `npm run ui -- --shots <dir>` also saves a picture of each surface in each state, and an index.html to flip
// through them. Nothing here touches Obsidian: it is the stylesheet over the app's own variables.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const harness = new URL("../test/ui/harness.html", import.meta.url).href;
const shotsAt = process.argv.indexOf("--shots");
const shotDir = shotsAt > -1 ? process.argv[shotsAt + 1] : null;

/** Shells: the widths and body classes Obsidian itself puts the view in. */
const SHELLS = [
  { name: "desktop", shell: "desktop", width: 1280, height: 1600 },
  { name: "narrow-pane", shell: "desktop", width: 520, height: 1600 },
  { name: "phone", shell: "phone", width: 390, height: 1700 },
  // Typing on a phone: the dock owns the bottom, so the corner keeps history only and moves out of its way.
  { name: "phone-editing", shell: "phone", width: 390, height: 1700, editing: true },
];
const THEMES = ["light", "dark"];

const px = value => Number.parseFloat(value) || 0;
const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };

const browser = await chromium.launch();
const shots = [];

for (const shell of SHELLS) {
  // A touch context, so the sheet's `@media (pointer: coarse)` rules — the 44px targets and the checkbox's slop —
  // are the ones under test. A resized desktop page still reports a fine pointer and would skip them.
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: shell.width, height: shell.height },
    hasTouch: shell.shell === "phone",
    isMobile: shell.shell === "phone",
  });
  const page = await context.newPage();
  for (const theme of THEMES) {
    const state = `${shell.name}-${theme}`;
    await page.goto(`${harness}?theme=${theme}&shell=${shell.shell}${shell.editing ? "&editing=1" : ""}`);
    await page.waitForTimeout(120);

    // Every button a person can see must be big enough to hit. Hiding one can be deliberate (the phone hides the
    // note's name), so what must exist in each state is named in CONTRACT below — that is the check that catches a
    // rule spliced into a selector list, which is how the phone lost its zoom and undo buttons.
    const controls = await page.$$eval("button, [role='button']", nodes =>
      nodes.map(el => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const slop = getComputedStyle(el, "::before").content !== "none" ? 12 : 0;
        return {
          name: el.getAttribute("aria-label") || el.className || el.tagName,
          surface: el.closest("[data-surface]")?.dataset.surface ?? "?",
          display: style.display,
          visibility: style.visibility,
          width: box.width + slop,
          height: box.height + slop,
          radius: style.borderTopLeftRadius,
          family: style.fontFamily,
        };
      }),
    );
    check(controls.length > 20, `${state}: the harness rendered only ${controls.length} controls`);
    const floor = shell.name === "phone" ? 24 : 20;
    for (const c of controls) {
      if (c.display === "none" || c.visibility === "hidden" || (c.width === 0 && c.height === 0)) continue;
      check(c.width >= floor && c.height >= floor, `${state}: ${c.surface} — "${c.name}" is ${Math.round(c.width)}x${Math.round(c.height)}, under ${floor}px`);
    }

    // What each state must show, and what it deliberately hides. A control that stops being drawn — because its
    // rule was spliced, renamed or deleted — fails here rather than on someone's phone.
    const CONTRACT = {
      shown: [".toolbar .seg-shape .seg-btn", ".toolbar .icon-btn", ".corner .history button", ".find-input", ".node-toolbar .nt-main button", ".sheet .icon-btn", ".node-check",
        ...(shell.editing ? [] : [".help"])],
      hidden: [
        ...(shell.shell === "phone" ? [".doc-name"] : []),
        // While typing, the keyboard dock is the place for controls: zoom and the shortcuts sheet stand down.
        ...(shell.editing ? [".corner .zoom", ".help"] : []),
      ],
    };
    for (const sel of CONTRACT.shown) {
      const seen = await page.evaluate(s => {
        const el = document.querySelector(s);
        if (!el) return "missing";
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return style.display === "none" || style.visibility === "hidden" || box.width < 1 || box.height < 1 ? "hidden" : "shown";
      }, sel);
      check(seen === "shown", `${state}: \`${sel}\` is ${seen} — it must be on screen in every state`);
    }
    for (const sel of CONTRACT.hidden) {
      const gone = await page.evaluate(s => {
        const el = document.querySelector(s);
        return !el || getComputedStyle(el).display === "none";
      }, sel);
      check(gone, `${state}: \`${sel}\` should be hidden on a phone, where Obsidian's own header already shows it`);
    }

    // Obsidian's variables must actually reach the sheet: a renamed or missing token resolves to nothing, and the
    // control quietly takes a browser default.
    const tokens = await page.evaluate(() => {
      const root = document.querySelector(".io-root");
      const read = name => getComputedStyle(root).getPropertyValue(name).trim();
      const icon = document.querySelector(".toolbar .io-icon");
      const label = document.querySelector(".node-label");
      const chrome = document.querySelector(".doc-name-btn");
      const sheet = document.querySelector(".sheet");
      const iconBtn = document.querySelector(".toolbar .icon-btn");
      return {
        panel: read("--io-r-panel"), control: read("--io-r-control"), dialog: read("--io-r-dialog"),
        fast: read("--io-fast"), micro: read("--io-font-micro"),
        iconStroke: icon ? getComputedStyle(icon).strokeWidth : null,
        nodeFamily: label ? getComputedStyle(label).fontFamily : null,
        chromeFamily: chrome ? getComputedStyle(chrome).fontFamily : null,
        sheetRadius: sheet ? getComputedStyle(sheet).borderTopLeftRadius : null,
        iconBtnRadius: iconBtn ? getComputedStyle(iconBtn).borderTopLeftRadius : null,
      };
    });
    for (const [name, value] of Object.entries(tokens)) check(value && value !== "none", `${state}: ${name} did not resolve (${value})`);
    check(px(tokens.panel) === 8, `${state}: panels should take Obsidian's --radius-m (8px), got ${tokens.panel}`);
    check(px(tokens.fast) === 140, `${state}: fast motion should be --anim-duration-fast (140ms), got ${tokens.fast}`);
    // 16-grid icons at two thirds of Obsidian's 24-grid stroke: the same weight on screen as the app's own icons.
    check(Math.abs(px(tokens.iconStroke) - 1.75 * 2 / 3) < 0.02, `${state}: toolbar icons are ${tokens.iconStroke} thick, not two thirds of --icon-m-stroke-width`);
    // Node text is measured against a fixed stack in layout/measure.ts; the interface font must not reach it.
    check(/-apple-system/.test(tokens.nodeFamily ?? ""), `${state}: node labels are set in ${tokens.nodeFamily}, not the stack measure.ts measures`);
    check(/Inter/.test(tokens.chromeFamily ?? ""), `${state}: chrome is set in ${tokens.chromeFamily}, not --font-interface`);
    check(px(tokens.iconBtnRadius) === px(tokens.control), `${state}: icon buttons should take --io-r-control (${tokens.control}), got ${tokens.iconBtnRadius}`);

    // The phone's own contract: Obsidian Canvas's 40px corner controls, and a 44px dock.
    if (shell.shell === "phone" && !shell.editing) {
      const sizes = await page.evaluate(() => {
        const box = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
        return { zoom: box(".zoom button"), undo: box(".history button"), help: box(".help"), dock: box(".node-toolbar.is-docked .nt-main > button"), check: box(".node-check") };
      });
      check(sizes.zoom?.[0] === 40 && sizes.zoom?.[1] === 40, `phone: zoom buttons are ${sizes.zoom}, not Canvas's 40x40`);
      check(sizes.undo?.[0] === 40 && sizes.undo?.[1] === 40, `phone: undo is ${sizes.undo}, not 40x40`);
      check(sizes.help?.[0] === 40 && sizes.help?.[1] === 40, `phone: the shortcuts button is ${sizes.help}, not 40x40`);
      check(sizes.dock?.[0] === 44 && sizes.dock?.[1] === 44, `phone: dock buttons are ${sizes.dock}, not 44x44`);
      check(sizes.check?.[0] === 15 && sizes.check?.[1] === 15, `phone: the checkbox is ${sizes.check}, not the square 15x15 it is drawn as`);

      // The dock's groups: six formatting keys, three alignments, four arrange keys, every one a 44px target, and
      // the checkbox's invisible slop reaching the same 44px around its 15px square.
      const dock = await page.evaluate(() => {
        const group = sel => [...document.querySelectorAll(`${sel} > button`)].map(b => Math.round(b.getBoundingClientRect().width));
        const check = document.querySelector(".node-check");
        const inset = check ? Number.parseFloat(getComputedStyle(check, "::after").top) : NaN;
        return { format: group(".nt-phone-format"), align: group(".nt-phone-align"), arrange: group(".nt-phone-arrange"), slop: 15 - inset * 2 };
      });
      check(dock.format.length === 6 && dock.format.every(w => w === 44), `phone: the dock's formatting keys are ${dock.format}, not six 44px targets`);
      check(dock.align.length === 3 && dock.align.every(w => w === 44), `phone: the dock's alignments are ${dock.align}, not three 44px targets`);
      check(dock.arrange.length === 4 && dock.arrange.every(w => w === 44), `phone: the dock's arrange keys are ${dock.arrange}, not four 44px targets`);
      check(Math.round(dock.slop) === 44, `phone: the checkbox reaches ${Math.round(dock.slop)}px, not the 44px a finger needs`);

      // The dock's glyphs are one step below Obsidian's navbar (26px), which is drawn right under them.
      const glyph = await page.evaluate(() => {
        const icon = document.querySelector(".node-toolbar.is-docked .io-icon");
        return icon ? Math.round(icon.getBoundingClientRect().width) : null;
      });
      check(glyph === 20, `phone: the dock's icons are ${glyph}px, not the 20px that sits a step under Obsidian's 26px navbar`);
    }

    if (shotDir) {
      mkdirSync(shotDir, { recursive: true });
      for (const surface of await page.$$("[data-surface]")) {
        const name = `${state}-${await surface.getAttribute("data-surface")}`;
        await surface.screenshot({ path: `${shotDir}/${name}.png` });
        shots.push(name);
      }
    }
  }
  await context.close();
}

await browser.close();

if (shotDir) {
  const cards = shots.map(name => `<figure><img src="${name}.png" alt="${name}"><figcaption>${name.replace(/-/g, " ")}</figcaption></figure>`).join("\n");
  writeFileSync(`${shotDir}/index.html`, `<!doctype html><meta charset="utf-8"><title>Ideascape chrome — ${shots.length} pictures</title>
<style>body{margin:0;padding:24px;background:#151515;color:#ddd;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif}
h1{font-size:16px;margin:0 0 16px}figure{margin:0 0 24px}img{max-width:100%;border-radius:8px;display:block;background:#222}
figcaption{margin-top:6px;color:#888;font-size:12px}</style>
<h1>Ideascape chrome — ${shots.length} pictures, ${SHELLS.length} shells × ${THEMES.length} themes</h1>\n${cards}\n`);
  console.log(`  ${shots.length} pictures → ${shotDir}/index.html`);
}

assert.deepEqual(problems, [], `the rendered chrome is wrong:\n  ${problems.join("\n  ")}`);
console.log(`Checked the chrome rendered at ${SHELLS.length} widths in ${THEMES.length} themes: every control visible, hittable and on Obsidian's tokens.`);
