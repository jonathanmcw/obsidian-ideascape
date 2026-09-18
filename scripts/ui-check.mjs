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
import esbuild from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// The node bar is the one piece of chrome whose shape is chosen at runtime — dockFit reads the stage's width and
// decides how much of the bar a screen can hold — so the fixture mounts the component rather than copying it. Built
// here, fresh, every run: a stale bundle would check a bar the plugin no longer draws.
await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../test/ui/nodebar-fixture.tsx", import.meta.url))],
  outfile: fileURLToPath(new URL("../test/ui/fixture.js", import.meta.url)),
  bundle: true,
  format: "iife",
  jsx: "automatic",
  target: "es2022",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
});

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
  // The narrowest phone in common use (many Android handsets report 360dp): where the dock's eight keys are tightest.
  { name: "phone-360", shell: "phone", width: 360, height: 1700 },
  // A tablet: Obsidian's hand-held chrome at a width that is not a phone's.
  { name: "tablet", shell: "tablet", width: 1024, height: 1400 },
  // And a tablet Obsidian labels `is-phone`, which many are: the dock is theirs, the width is not. At 820 the row
  // takes back what a phone folds under More; at 1100 it takes every formatting key. Both are the widths dockFit
  // names, rendered — the thresholds themselves are unit-tested in test/mobile-ui.test.ts.
  { name: "tablet-phone", shell: "phone", width: 820, height: 1400, fit: "roomy" },
  { name: "tablet-phone-wide", shell: "phone", width: 1100, height: 1400, fit: "full" },
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
    hasTouch: shell.shell === "phone" || shell.shell === "tablet",
    isMobile: shell.shell === "phone" || shell.shell === "tablet",
  });
  const page = await context.newPage();
  for (const theme of THEMES) {
    const state = `${shell.name}-${theme}`;
    await page.goto(`${harness}?theme=${theme}&shell=${shell.shell}${shell.editing ? "&editing=1" : ""}`);
    await page.waitForTimeout(120);

    // Before anything is measured: the page must be as wide as it was asked to be. A fixture with no
    // `<meta name="viewport">` falls back to the classic 980px layout viewport, and every measurement below is then
    // taken on a screen no phone has — while all of them still pass. That is how the phone shells were checked at
    // 980px for weeks. The harness carries the meta tag; this is the check that notices when it stops.
    const measured = await page.evaluate(() => window.innerWidth);
    check(
      measured === shell.width,
      `${state}: the page is ${measured}px wide, not the ${shell.width}px it was opened at — every measurement below is of the wrong screen (is test/ui/harness.html missing its <meta name="viewport">?)`,
    );

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
      shown: [".doc-name", ".toolbar .seg-shape .seg-btn", ".toolbar .icon-btn", ".corner .history button", ".find-input", ".node-toolbar .nt-main button", ".sheet .icon-btn", ".node-check",
        // Focus stands beside the view toggle at every width — a phone folds the toolbar's centre away, and this
        // must not go with it.
        ".toolbar .toolbar-left .icon-btn",
        // Fit sits with the zoom steps it belongs to, not in a menu; it stands down while typing, with them.
        ...(shell.editing ? [] : [".corner .zoom button:last-child", ".help"])],
      hidden: [
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
      check(gone, `${state}: \`${sel}\` should be hidden on a hand-held, where Obsidian's own header already shows it`);
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

    // The phone's own contract: Obsidian Canvas's 40px corner controls.
    if (shell.shell === "phone" && !shell.editing) {
      const sizes = await page.evaluate(() => {
        const box = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
        return { zoom: box(".zoom button"), undo: box(".history button"), help: box(".help"), check: box(".node-check") };
      });
      check(sizes.zoom?.[0] === 40 && sizes.zoom?.[1] === 40, `phone: zoom buttons are ${sizes.zoom}, not Canvas's 40x40`);
      check(sizes.undo?.[0] === 40 && sizes.undo?.[1] === 40, `phone: undo is ${sizes.undo}, not 40x40`);
      check(sizes.help?.[0] === 40 && sizes.help?.[1] === 40, `phone: the shortcuts button is ${sizes.help}, not 40x40`);
      check(sizes.check?.[0] === 15 && sizes.check?.[1] === 15, `phone: the checkbox is ${sizes.check}, not the square 15x15 it is drawn as`);

      // The checkbox's invisible slop, reaching the 44px a finger needs around its 15px square.
      const slop = await page.evaluate(() => {
        const el = document.querySelector(".node-check");
        return el ? 15 - Number.parseFloat(getComputedStyle(el, "::after").top) * 2 : NaN;
      });
      check(Math.round(slop) === 44, `phone: the checkbox reaches ${Math.round(slop)}px, not the 44px a finger needs`);
    }

    // The node bar, as this shell actually renders it. Its shape is chosen at runtime rather than by the
    // stylesheet — NodeBar asks dockFit how much of itself the stage can hold — so the fixture mounts the
    // component and this reads back what came out. The surface with More open is the one measured: everything the
    // bar can show is on screen there at once.
    const bar = await page.evaluate(() => {
      const stage = document.querySelector('[data-live-bar="more"]');
      const el = stage?.querySelector(".node-toolbar");
      const row = el?.querySelector(".nt-main");
      if (!stage || !el || !row) return null;
      const r = e => { const b = e.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width), height: Math.round(b.height) }; };
      // --accent as a colour the browser has resolved, to compare a computed background against.
      const probe = document.createElement("span");
      probe.style.backgroundColor = getComputedStyle(document.querySelector(".io-root")).getPropertyValue("--accent").trim();
      document.body.append(probe);
      const accent = getComputedStyle(probe).backgroundColor;
      probe.remove();
      // Counted on screen, not in the DOM: a control that is drawn nowhere is not a control, and one hidden behind
      // `hidden` or a `display: none` would otherwise stand in for the key it replaced.
      const drawn = e => { const b = e.getBoundingClientRect(); return b.width >= 1 && b.height >= 1; };
      const count = sel => [...el.querySelectorAll(sel)].filter(drawn).length;
      const keys = [...row.querySelectorAll("button")].filter(drawn);
      const done = row.querySelector(".nt-done");
      const del = row.querySelector(".nt-delete");
      const doneStyle = done && getComputedStyle(done);
      return {
        docked: el.classList.contains("is-docked"),
        stageWidth: stage.clientWidth,
        screen: window.innerWidth,
        keys: keys.map(b => ({ ...r(b), name: b.textContent.trim() || b.className || "?" })),
        rowFormats: [...row.querySelectorAll(".fmt")].filter(drawn).length,
        moreFormats: count(".nt-phone-format > button"),
        // Both places an alignment control can be drawn: the row's dropdown, and the group More opens on a phone.
        aligns: count(".nt-align-drop, .nt-phone-align > button"),
        arrange: count(".nt-phone-arrange > button"),
        moreDelete: count(".nt-phone-danger > button"),
        tight: !!el.querySelector(".nt-tail.is-tight"),
        deleteInRow: !!del && drawn(del),
        doneLast: keys.at(-1) === done,
        deleteBeforeDone: keys.at(-2) === del,
        // The gap the stylesheet holds between Delete and Done, and the emptiness the tail's auto margin opens
        // before them — without it the pair sits in the middle of the row with the rest.
        pairGap: done && del ? Math.round(done.getBoundingClientRect().left - del.getBoundingClientRect().right) : null,
        runUp: del && keys.at(-3) ? Math.round(del.getBoundingClientRect().left - keys.at(-3).getBoundingClientRect().right) : null,
        toRight: done ? Math.round(row.getBoundingClientRect().right - done.getBoundingClientRect().right) : null,
        done: done ? { ...r(done), radius: doneStyle.borderTopLeftRadius, background: doneStyle.backgroundColor } : null,
        accent,
        overflow: Math.round(row.scrollWidth - row.clientWidth),
        dock: r(el),
      };
    });
    check(bar, `${state}: no node bar was rendered — did the fixture bundle fail to mount?`);

    // What the shell should have got. A phone keeps the short row; a tablet Obsidian labels a phone unpacks More
    // into the room beside it; a wide one takes every formatting key. Anything not docked is the floating bar,
    // which already shows everything and is measured by the size and token checks above.
    const FITS = {
      phone: { keys: 8, rowFormats: 1, moreFormats: 6, aligns: 3, moreDelete: 1, tight: true },
      roomy: { keys: 13, rowFormats: 4, moreFormats: 3, aligns: 1, moreDelete: 0, tight: false },
      full: { keys: 16, rowFormats: 7, moreFormats: 0, aligns: 1, moreDelete: 0, tight: false },
    };
    const fit = shell.shell === "phone" ? shell.fit ?? "phone" : null;
    check(bar?.docked === (fit !== null), `${state}: the bar came out ${bar?.docked ? "docked" : "floating"} on a ${shell.width}px ${shell.shell}`);

    if (bar && fit) {
      const want = FITS[fit];
      check(bar.keys.length === want.keys, `${state} (${fit}): the row has ${bar.keys.length} keys, not ${want.keys}`);
      check(bar.rowFormats === want.rowFormats, `${state} (${fit}): ${bar.rowFormats} formatting keys stand in the row, not ${want.rowFormats}`);
      check(bar.moreFormats === want.moreFormats, `${state} (${fit}): More holds ${bar.moreFormats} formatting keys, not ${want.moreFormats}`);
      // A duplicate of this was shipped: the row grew its alignment dropdown while More kept the three keys it
      // replaced, and both were on screen at once.
      check(bar.aligns === want.aligns, `${state} (${fit}): ${bar.aligns} alignment controls are on screen, not ${want.aligns}`);
      check(bar.moreDelete === want.moreDelete, `${state} (${fit}): More holds ${bar.moreDelete} Delete keys, not ${want.moreDelete} — a roomy row carries it itself`);
      check(bar.arrange === 2, `${state} (${fit}): More holds ${bar.arrange} arrange keys, not the two an outline row needs`);
      check(bar.tight === want.tight, `${state} (${fit}): the tail is ${bar.tight ? "tight" : "roomy"}`);

      // Every key a 44px-tall target, and none narrower than the floor the row falls to when it is full.
      for (const k of bar.keys) check(k.width >= 34 && k.height === 44, `${state} (${fit}): "${k.name}" is ${k.width}x${k.height}, outside the 34x44 floor`);

      // The row must fit the screen it is drawn on. `toRight` is signed on purpose: the last key ending past the
      // row's own right edge reads as a negative distance, and a `<= 8` written alone would accept it.
      check(bar.overflow <= 0, `${state} (${fit}): the row's ${bar.keys.length} keys overflow it by ${bar.overflow}px`);
      check(bar.dock.left >= 0 && bar.dock.right <= bar.screen, `${state} (${fit}): the dock spans ${bar.dock.left}–${bar.dock.right} on a ${bar.screen}px screen`);
      check(bar.toRight >= 0 && bar.toRight <= 8, `${state} (${fit}): the last key ends ${bar.toRight}px from the row's right edge`);

      // Done ends the row, with Delete before it — the far right is where a thumb goes to finish.
      check(bar.doneLast, `${state} (${fit}): Done is not the last key in the row`);
    }

    // A roomy bar's tail: Delete and Done stand together at the right-hand end, held apart, and Done is drawn as a
    // filled circle — the one key pressed every time, found without reading the row.
    if (bar && (fit === "roomy" || fit === "full")) {
      check(bar.deleteBeforeDone, `${state} (${fit}): Delete does not stand beside Done at the end of the row`);
      check(Math.abs(bar.pairGap - 22) <= 1, `${state} (${fit}): Delete and Done are ${bar.pairGap}px apart, not the 22px that keeps them from being neighbours`);
      check(bar.runUp >= 24, `${state} (${fit}): only ${bar.runUp}px of empty row stands before Delete — the pair has not been pushed to the end`);
      check(bar.done?.radius === "50%", `${state} (${fit}): Done's corners are ${bar.done?.radius}, not the 50% that draws it round`);
      check(bar.done?.width === bar.done?.height, `${state} (${fit}): Done is ${bar.done?.width}x${bar.done?.height} — a circle needs a square`);
      check(bar.done?.background === bar.accent, `${state} (${fit}): Done is filled ${bar.done?.background}, not the accent ${bar.accent}`);
    }
    // A phone's tail has no room for that: Delete lives under More, and Done is a plain key.
    if (bar && fit === "phone") {
      check(!bar.deleteInRow, `${state}: a phone's row carries Delete, which belongs under More there`);
      check(bar.done?.radius !== "50%", `${state}: Done is drawn as a circle on a phone, where it is not the wide bar's anchor`);
    }

    // What the layout reserved must be what the sheet draws. measure.ts sizes every node from a canvas — the
    // checkbox at CHECK_W, a #tag padded by TAG_PAD, code at 0.92em in the mono face, bold at 700 — and no
    // stylesheet can reach that measurement. So a control the sheet draws wider than its reservation pushes the
    // text out of the box that was made for it, which is the Android checkbox's bug stated generally: it was a
    // <button>, and a theme that sizes buttons for touch sized that one too.
    const row = await page.evaluate(() => {
      const el = document.querySelector("[data-live-row] .node");
      const lead = el?.querySelector(".node-lead");
      const label = el?.querySelector(".node-label");
      if (!lead || !label) return null;
      const w = e => Math.round(e.getBoundingClientRect().width * 10) / 10;
      return { ...window.__row, leadDrawn: w(lead), textDrawn: w(label), check: w(label.ownerDocument.querySelector("[data-live-row] .node-check")) };
    });
    check(row, `${state}: the row fixture did not render`);
    if (row) {
      check(Math.abs(row.leadDrawn - row.leadW) <= 1, `${state}: the lead is drawn ${row.leadDrawn}px wide, against the ${row.leadW}px the layout reserved for it`);
      check(row.check === 15, `${state}: the checkbox is drawn ${row.check}px wide, not the 15px measure.ts reserves (CHECK_W)`);
      check(Math.abs(row.textDrawn - row.textW) <= 1, `${state}: the text is drawn ${row.textDrawn}px wide, against the ${row.textW}px the layout measured`);
    }

    // And it must still hold with a theme pulling at it. A theme loads after the plugin's sheet and can name any
    // element the plugin draws with, so the sheet has to win on its own — which it does at two classes, against
    // anything a theme writes without `!important`. (An `!important` rule still wins; that is the line, and it is
    // why the checkbox is a span: there is no element left for such a rule to name.)
    await page.addStyleTag({ content: `
      button, [role="checkbox"] { min-width: 6em; padding: 6px 14px; border-radius: 999px; height: var(--input-height); }
      code, mark, b, i, u, s, a { padding: 2px 6px; font-size: 1.15em; letter-spacing: .04em; margin: 0 2px; }
      code { font-family: "Courier New", monospace; }
      span, div { line-height: 2.4; }
      /* Inherited, not aimed: a theme that spaces its body text spaces the label with it, and the canvas that
         measured the label never sees it. */
      body, .io-root, .nodes { letter-spacing: .05em; word-spacing: .1em; }` });
    const themed = await page.evaluate(() => {
      const el = document.querySelector("[data-live-row] .node");
      const w = s => Math.round(el.querySelector(s).getBoundingClientRect().width * 10) / 10;
      return { leadDrawn: w(".node-lead"), textDrawn: w(".node-label"), check: w(".node-check"), height: Math.round(el.querySelector(".node-label").getBoundingClientRect().height) };
    });
    if (row) {
      check(themed.check === row.check, `${state}: a theme moved the checkbox to ${themed.check}px — it was ${row.check}px`);
      check(themed.leadDrawn === row.leadDrawn, `${state}: a theme moved the lead to ${themed.leadDrawn}px — it was ${row.leadDrawn}px`);
      check(themed.textDrawn === row.textDrawn, `${state}: a theme moved the row's text to ${themed.textDrawn}px — it was ${row.textDrawn}px, and the layout cannot see the difference`);
    }
    // Reloaded, because the style tag above outlives the page otherwise and every check after it would be reading
    // a themed page.
    await page.goto(`${harness}?theme=${theme}&shell=${shell.shell}${shell.editing ? "&editing=1" : ""}`);
    await page.waitForTimeout(80);

    // The dock's glyphs are one step below Obsidian's navbar (26px), which is drawn right under them.
    if (bar && fit) {
      const glyph = await page.evaluate(() => {
        const icon = document.querySelector(".node-toolbar.is-docked .io-icon");
        return icon ? Math.round(icon.getBoundingClientRect().width) : null;
      });
      check(glyph === 20, `${state}: the dock's icons are ${glyph}px, not the 20px that sits a step under Obsidian's 26px navbar`);
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

/* -------------------- the label's own editing -------------------- */
// The tests beside this one build a DOM of their own: it has no selection, no ranges and no editing commands, so
// the one thing they cannot see is whether a format can be taken back — and taking one back is exactly what was
// broken. Highlight, code and links used to move nodes about by hand, which leaves the browser's undo history
// describing a label that no longer exists: ⌘Z took back the typing and left the highlight standing, so the words
// went and the colour stayed. They go through the same command bold does now, and this drives a real
// contenteditable, with real keystrokes, to hold them to it.
{
  const { build } = await import("esbuild");
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("../src/organiser/ui/wysiwyg.ts", import.meta.url))],
    bundle: true, format: "iife", globalName: "W", write: false, logLevel: "silent",
  });
  const module = bundle.outputFiles[0].text;

  /** A label of its own for each case: the browser's undo history is per document, and resetting one by hand
   *  would be the very thing under test. */
  const labelPage = async (context, text) => {
    const page = await context.newPage();
    await page.setContent('<div id="l" class="node-label" contenteditable spellcheck="false"></div>');
    await page.addScriptTag({ content: module });
    await page.evaluate(() => {
      // obsidian: elements are built through the window the document belongs to; a plain page has no `win`.
      document.win = { createEl: t => document.createElement(t), createFragment: () => document.createDocumentFragment() };
      window.L = document.getElementById("l");
      window.md = () => W.domToMarkdown(L);
      window.undo = () => document.execCommand("undo");
      window.pick = word => {
        const walk = n => { if (n.nodeType === 3 && n.data.includes(word)) return n; for (const c of n.childNodes) { const f = walk(c); if (f) return f; } return null; };
        const node = walk(L);
        if (!node) throw new Error(`no "${word}" in the label`);
        const at = node.data.indexOf(word);
        const range = document.createRange();
        range.setStart(node, at); range.setEnd(node, at + word.length);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      };
    });
    await page.click("#l");
    if (text) await page.keyboard.type(text);
    return page;
  };

  const context = await browser.newContext();

  // The guard. Every check below reads the label after an undo, so a harness that has stopped driving the
  // browser's own undo would pass the lot by doing nothing at all. Prove plain typing can be taken back first.
  {
    const page = await labelPage(context, "guard");
    const [typed, after] = await page.evaluate(() => { const was = L.textContent; undo(); return [was, L.textContent]; });
    check(typed === "guard" && after !== "guard", `editing: the harness is not driving the browser's undo (${JSON.stringify(typed)} → ${JSON.stringify(after)}), so none of the editing checks below are testing anything`);
    await page.close();
  }

  for (const [tag, wrapped] of [["mark", "keep ==this== safe"], ["code", "keep `this` safe"]]) {
    const page = await labelPage(context, "keep this safe");
    const r = await page.evaluate(tag => {
      pick("this");
      W.toggleInline(L, tag);
      const on = { md: md(), sel: getSelection().toString(), placing: L.querySelectorAll("[data-placing]").length };
      W.toggleInline(L, tag);
      const off = md();
      undo();
      const back = md();
      const staleAfterUndo = L.querySelectorAll(`[data-placing]`).length;
      undo();
      return { on, off, back, plain: md(), staleAfterUndo };
    }, tag);
    check(r.on.md === wrapped, `editing: ${tag} wrote ${JSON.stringify(r.on.md)}, not ${JSON.stringify(wrapped)}`);
    check(r.on.sel === "this", `editing: ${tag} left ${JSON.stringify(r.on.sel)} selected, not the text it had just wrapped`);
    check(r.on.placing === 0, `editing: ${tag} left the mark it places elements with behind in the label`);
    check(r.off === "keep this safe", `editing: taking ${tag} off wrote ${JSON.stringify(r.off)}`);
    check(r.back === wrapped, `editing: undo after taking ${tag} off gave ${JSON.stringify(r.back)}, not ${JSON.stringify(wrapped)} — the change never reached the browser's undo history`);
    check(r.plain === "keep this safe", `editing: a second undo gave ${JSON.stringify(r.plain)}, not the text before ${tag} was put on`);
    // Undo restores the markup as the command recorded it, so the mark used to find a new element must not come
    // back with it: a stale one would have the next format select the wrong words.
    check(r.staleAfterUndo === 0, `editing: undo brought back ${r.staleAfterUndo} placing mark(s) for ${tag}, which the next format would find instead of its own`);
    await page.close();
  }

  // Bold inside a highlight is the reason this is not `removeFormat`: that empties everything in the selection,
  // and leaves a link alone entirely.
  {
    const page = await labelPage(context, "alpha beta gamma");
    const r = await page.evaluate(() => {
      pick("beta");
      document.execCommand("styleWithCSS", false, "false");
      document.execCommand("bold");
      const all = document.createRange(); all.selectNodeContents(L);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(all);
      W.toggleInline(L, "mark");
      const on = md();
      W.toggleInline(L, "mark");
      return { on, off: md() };
    });
    check(r.on === "==alpha **beta** gamma==", `editing: highlighting over bold wrote ${JSON.stringify(r.on)}`);
    check(r.off === "alpha **beta** gamma", `editing: taking the highlight off wrote ${JSON.stringify(r.off)} — the bold inside it did not survive`);
    await page.close();
  }

  // A caret rather than a selection: the link arrives with something to stand on, selected to be typed over.
  {
    const page = await labelPage(context, "see also ");
    const r = await page.evaluate(() => {
      const end = document.createRange(); end.selectNodeContents(L); end.collapse(false);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(end);
      W.toggleInline(L, "a", { class: "node-link", "data-wiki": "1" });
      const on = { md: md(), sel: getSelection().toString() };
      undo();
      return { on, back: md() };
    });
    check(r.on.md === "see also [[Note]]", `editing: a link at the caret wrote ${JSON.stringify(r.on.md)}`);
    check(r.on.sel === "Note", `editing: the new link left ${JSON.stringify(r.on.sel)} selected, so its placeholder cannot be typed over`);
    // The label keeps its trailing space here; it is the draft that is trimmed when the node is left.
    check(r.back === "see also ", `editing: undo after a link gave ${JSON.stringify(r.back)}`);
    await page.close();
  }

  // The browser writes the space beside an insertion as a non-breaking one to hold its rendering still; the file
  // must never be given it.
  {
    const page = await labelPage(context, "keep this safe");
    const nbsp = await page.evaluate(() => { pick("this"); W.toggleInline(L, "mark"); return { html: L.innerHTML, md: md() }; });
    check(!nbsp.md.includes(" "), `editing: a non-breaking space reached the file in ${JSON.stringify(nbsp.md)}`);
    await page.close();
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
console.log("Checked a label edited in a real contenteditable: every format goes on, comes off, and is taken back by the browser's own undo.");
