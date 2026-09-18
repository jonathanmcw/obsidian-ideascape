// The export, run for real.
//
// `npm run verify:export` bundles the exporters and runs them in Chromium: the PNG is drawn on a real canvas
// and read back pixel by pixel, and the OPML is read back by a real XML parser. Neither can be done under
// `node --test`, which has no canvas and no DOMParser — test/export.test.ts covers everything that can.
//
// What it is looking for is the promise the export sheet makes: the picture is the map as the screen draws it,
// in the theme it is in, with nothing clipped at its edges, and the structured files read back as the same map.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = new URL("..", import.meta.url).pathname;
const src = path => `${root}src/${path}`;

const bundle = await build({
  stdin: {
    contents: `
      export { slug, toMarkdown, toOPML, toPNG } from ${JSON.stringify(src("organiser/model/exporters.ts"))};
      export { fromOPML } from ${JSON.stringify(src("organiser/model/opml.ts"))};
      export { toJSONCanvas, fromJSONCanvas } from ${JSON.stringify(src("organiser/model/jsoncanvas.ts"))};
      export { fromMarkdownMap } from ${JSON.stringify(src("organiser/model/markdown.ts"))};
      export { addChild, emptyDoc, setCollapsed, setText, walk } from ${JSON.stringify(src("organiser/model/doc.ts"))};
      export { frameFor, leftOf } from ${JSON.stringify(src("organiser/layout/index.ts"))};
      export { metricsFor } from ${JSON.stringify(src("organiser/layout/measure.ts"))};
      export { THEMES, themeById } from ${JSON.stringify(src("organiser/theme.ts"))};
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true, write: false, format: "iife", globalName: "IO", platform: "browser", logLevel: "error",
  define: { "process.env.NODE_ENV": '"production"' },
});

const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><meta charset='utf-8'><title>export</title><body>");
// obsidian: the two helpers Obsidian puts on window and document. The exporters draw on a canvas made through
// them, so that a map popped out into its own window exports from that window's canvas.
await page.evaluate(() => {
  window.createEl = tag => document.createElement(tag);
  document.win = window;
  window.activeWindow = window;
  window.activeDocument = document;
});
await page.addScriptTag({ content: bundle.outputFiles[0].text });

// Helpers that live in the page: a map to export, and a picture read back as pixels.
await page.evaluate(() => {
  window.MAP = "# Lisbon weekend\n\n- Packing ^p\n  - **passport** and tickets ^a\n  - [ ] charger ^b\n- Eating ^e\n  - 1. Time Out Market ^f\n  - `pastéis de nata` ^g\n- 旅行の記録 ^j\n";
  window.picture = async blob => {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const c = canvas.getContext("2d");
    c.drawImage(bitmap, 0, 0);
    const all = c.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const at = (x, y) => { const i = (y * bitmap.width + x) * 4; return [all[i], all[i + 1], all[i + 2], all[i + 3]]; };
    return { w: bitmap.width, h: bitmap.height, at, data: all };
  };
  window.rgb = value => {
    const c = document.createElement("canvas").getContext("2d");
    c.fillStyle = value;
    c.fillRect(0, 0, 1, 1);
    return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  window.header = async blob => {
    const head = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
    const long = at => (head[at] << 24 | head[at + 1] << 16 | head[at + 2] << 8 | head[at + 3]) >>> 0;
    return { magic: [...head.slice(0, 8)].join(","), w: long(16), h: long(20) };
  };
});

const SHAPES = ["map", "org", "canvas", "outline"];

/* ---------- the picture is the map, at the size the layout says ---------- */

for (const shape of SHAPES) {
  const seen = await page.evaluate(async shape => {
    const doc = IO.fromMarkdownMap(window.MAP, "Lisbon weekend");
    const frame = IO.frameFor(doc, shape);
    const { blob, scale } = await IO.toPNG(doc, shape, "paper", "outline", 2);
    const b = frame.bounds;
    return {
      scale,
      header: await window.header(blob),
      want: [Math.round(Math.max(320, b.maxX - b.minX + 96) * 2), Math.round(Math.max(240, b.maxY - b.minY + 96) * 2)],
      type: blob.type,
    };
  }, shape);
  check(seen.header.magic === "137,80,78,71,13,10,26,10", `${shape}: the file is not a PNG (${seen.header.magic})`);
  check(seen.type === "image/png", `${shape}: saved as ${seen.type}`);
  check(seen.scale === 2, `${shape}: drawn at ${seen.scale}×, not the 2× the sheet promises`);
  check(
    seen.header.w === seen.want[0] && seen.header.h === seen.want[1],
    `${shape}: the picture is ${seen.header.w}x${seen.header.h}, not the ${seen.want.join("x")} the layout bounds plus 48px of margin come to`,
  );
}

/* ---------- every theme's own colours, and a margin nothing is drawn in ---------- */

const themes = await page.evaluate(() => IO.THEMES.map(t => ({ id: t.id, dark: t.dark })));
check(themes.length >= 4, `only ${themes.length} themes to check`);
for (const theme of themes) {
  const seen = await page.evaluate(async id => {
    const doc = IO.fromMarkdownMap(window.MAP, "Lisbon weekend");
    const { blob } = await IO.toPNG(doc, "map", id, "filled", 2);
    const pic = await window.picture(blob);
    const stage = window.rgb(IO.themeById(id).vars["--stage"]);
    const same = (x, y) => { const p = pic.at(x, y); return p[0] === stage[0] && p[1] === stage[1] && p[2] === stage[2] && p[3] === 255; };
    // The 48px margin, at 2×, is 96 device pixels. Nothing may be drawn in the outer 24 of them, on any side:
    // that is the test for a picture whose content runs off its own edge.
    let painted = 0;
    for (let x = 0; x < pic.w; x += 3) for (const y of [0, 12, 23, pic.h - 24, pic.h - 13, pic.h - 1]) if (!same(x, y)) painted++;
    for (let y = 0; y < pic.h; y += 3) for (const x of [0, 12, 23, pic.w - 24, pic.w - 13, pic.w - 1]) if (!same(x, y)) painted++;
    // And something must be drawn inside it, or a picture of nothing would pass every check above.
    let ink = 0;
    for (let y = 96; y < pic.h - 96; y += 2) for (let x = 96; x < pic.w - 96; x += 2) if (!same(x, y)) ink++;
    return { painted, ink, stage, corner: pic.at(1, 1), size: [pic.w, pic.h] };
  }, theme.id);
  check(seen.painted === 0, `${theme.id}: ${seen.painted} pixels are drawn in the margin — the picture is clipped at its edges`);
  check(seen.ink > 500, `${theme.id}: only ${seen.ink} pixels of the picture are not background — is anything drawn?`);
  check(
    seen.corner.slice(0, 3).join() === seen.stage.join(),
    `${theme.id}: the picture's background is rgb(${seen.corner.slice(0, 3)}), not the theme's own rgb(${seen.stage})`,
  );
  // A dark theme's picture must actually be dark: a picture that always came out in the light theme's colours
  // would still agree with itself above.
  const light = seen.stage[0] + seen.stage[1] + seen.stage[2] > 3 * 128;
  check(light === !theme.dark, `${theme.id}: a ${theme.dark ? "dark" : "light"} theme drew a ${light ? "light" : "dark"} picture`);
}

/* ---------- the text is drawn in the pill the layout measured for it ---------- */

for (const shape of SHAPES) {
  const overflowing = await page.evaluate(shape => {
    const doc = IO.fromMarkdownMap(window.MAP, "Lisbon weekend");
    const frame = IO.frameFor(doc, shape);
    const out = [];
    for (const id of frame.order) {
      const box = frame.boxes[id];
      const m = IO.metricsFor(doc, id, shape, box.depth);
      // The pill's own padding, from the exporter: 22px inside the root, 16 inside every other node.
      const padX = shape === "outline" ? 0 : id === doc.rootId ? 22 : 16;
      const room = box.w - padX * 2;
      if (m.textW + m.lead.w > room + 0.5) out.push(`${doc.nodes[id].text.split("\n")[0]}: ${Math.round(m.textW + m.lead.w)}px of text in ${Math.round(room)}px of pill`);
    }
    return out;
  }, shape);
  check(overflowing.length === 0, `${shape}: text drawn wider than the pill it sits in — ${overflowing.join("; ")}`);
}

/* ---------- a folded branch is not in the picture, though it is in the file ---------- */

{
  const seen = await page.evaluate(async () => {
    const open = IO.fromMarkdownMap(window.MAP, "Lisbon weekend");
    const folded = IO.setCollapsed(open, "p", true);
    const [a, b] = await Promise.all([IO.toPNG(open, "map", "paper", "outline", 2), IO.toPNG(folded, "map", "paper", "outline", 2)]);
    return {
      drawn: Object.keys(IO.frameFor(folded, "map").boxes),
      written: IO.toMarkdown(folded).includes("passport"),
      smaller: (await window.header(b.blob)).w < (await window.header(a.blob)).w,
    };
  });
  check(!seen.drawn.includes("a"), "a folded branch's nodes are still drawn into the picture");
  check(seen.written, "a folded branch is missing from the Markdown, where it should be kept");
  check(seen.smaller, "folding a branch did not make the picture any smaller");
}

/* ---------- embedded images are in the picture, and one that will not load says so ---------- */

{
  const seen = await page.evaluate(async () => {
    // An 8x8 pure red PNG, as an embed the map can resolve.
    const red = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC";
    const doc = IO.fromMarkdownMap("# Trip\n\n- look ![[shot.png]] ^a\n", "Trip");
    const count = async resolve => {
      const { blob } = await IO.toPNG(doc, "map", "paper", "outline", 2, resolve);
      const pic = await window.picture(blob);
      let reds = 0;
      for (let i = 0; i < pic.data.length; i += 4) if (pic.data[i] > 200 && pic.data[i + 1] < 60 && pic.data[i + 2] < 60) reds++;
      return reds;
    };
    return {
      withImage: await count(() => ({ url: red, kind: "image" })),
      missing: await count(() => null),
      broken: await count(() => ({ url: "data:image/png;base64,not-a-png", kind: "image" })),
    };
  });
  check(seen.withImage > 100, `an embedded image drew ${seen.withImage} of its pixels into the export`);
  check(seen.missing === 0, "a map with no image resolver still drew an image");
  check(seen.broken === 0, "an image that could not be loaded was drawn anyway, rather than as its placeholder");
}

/* ---------- a map too large to draw at 2x is drawn smaller, never refused in silence ---------- */

{
  const seen = await page.evaluate(async () => {
    // Six hundred leaves in an org chart: tens of thousands of pixels wide, past what a browser will draw at 2x.
    let doc = IO.emptyDoc("Wide");
    doc = IO.setText(doc, doc.rootId, "Wide");
    for (let i = 0; i < 600; i++) [doc] = IO.addChild(doc, doc.rootId, `leaf number ${i}`);
    const wide = IO.frameFor(doc, "org").bounds;
    const started = performance.now();
    let scale = null, error = null, header = null;
    try {
      const png = await IO.toPNG(doc, "org", "paper", "outline", 2);
      scale = png.scale;
      header = await window.header(png.blob);
    } catch (err) {
      error = String(err.message ?? err);
    }
    return { css: Math.round(wide.maxX - wide.minX + 96), scale, error, header, ms: Math.round(performance.now() - started) };
  });
  check(seen.error === null, `a ${seen.css}px-wide map was refused instead of being drawn smaller: ${seen.error}`);
  check(seen.scale !== null && seen.scale < 2, `a ${seen.css}px-wide map reports ${seen.scale}×; it cannot have been drawn at 2×`);
  check(seen.header && seen.header.w > 1000, `the smaller picture came out ${seen.header?.w}px wide`);
}

/* ---------- and one no scale can hold is refused in words, not in silence ---------- */

{
  const seen = await page.evaluate(async () => {
    let doc = IO.emptyDoc("Vast");
    doc = IO.setText(doc, doc.rootId, "Vast");
    for (let i = 0; i < 6000; i++) [doc] = IO.addChild(doc, doc.rootId, `leaf number ${i}`);
    try {
      await IO.toPNG(doc, "org", "paper", "outline", 2);
      return { error: null };
    } catch (err) {
      return { error: String(err.message ?? err) };
    }
  });
  check(seen.error !== null, "a map far past what any canvas holds was reported as exported");
  check(
    seen.error === null || (/too large/i.test(seen.error) && /Markdown|\.canvas/.test(seen.error)),
    `a map too large to draw says "${seen.error}" — it should say so plainly and name a format that would work`,
  );
}

/* ---------- OPML, read back by a real XML parser ---------- */

{
  const seen = await page.evaluate(() => {
    const hostile = 'R&D "quotes" <tags> and 旅行\nsecond line\twith a tab';
    let doc = IO.fromMarkdownMap("# Plans\n\n- one ^a\n  - under one ^b\n- two ^c\n", "Plans");
    doc = IO.setText(doc, "a", hostile);
    const xml = IO.toOPML(doc);
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    const back = IO.fromOPML(xml, "Plans");
    const shape = d => IO.walk(d, d.rootId).map(({ id, depth }) => `${depth}:${d.nodes[id].text}`);
    return {
      wellFormed: !parsed.querySelector("parsererror"),
      title: parsed.querySelector("head > title")?.textContent,
      here: shape(doc),
      there: shape(back),
      hostile,
    };
  });
  check(seen.wellFormed, "the OPML export is not well-formed XML");
  check(seen.title === "Plans", `the OPML title is ${JSON.stringify(seen.title)}`);
  check(
    JSON.stringify(seen.here) === JSON.stringify(seen.there),
    `OPML did not read back as the map it was written from:\n    out ${JSON.stringify(seen.here)}\n    in  ${JSON.stringify(seen.there)}`,
  );
}

/* ---------- .canvas, read back by its own reader ---------- */

{
  const seen = await page.evaluate(() => {
    const doc = IO.fromMarkdownMap("# Plans\n\n- one ^a\n  - under one ^b\n- [x] two ^c\n", "Plans");
    const back = IO.fromJSONCanvas(IO.toJSONCanvas(doc), "Plans");
    const shape = d => IO.walk(d, d.rootId).map(({ id, depth }) => `${depth}:${d.nodes[id].text}:${d.nodes[id].task ?? ""}`);
    return { here: shape(doc), there: shape(back) };
  });
  check(JSON.stringify(seen.here) === JSON.stringify(seen.there), `.canvas did not read back as the map it was written from:\n    out ${JSON.stringify(seen.here)}\n    in  ${JSON.stringify(seen.there)}`);
}

await browser.close();

assert.deepEqual(problems, [], `the export is wrong:\n  ${problems.join("\n  ")}`);
console.log(`Checked the export rendered: a PNG in ${SHAPES.length} shapes and ${themes.length} themes, drawn to the layout's own bounds with a clear margin, and OPML and .canvas read back as the same map.`);
