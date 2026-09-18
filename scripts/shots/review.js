/*
 * A pass through the map's surfaces, photographed for a person to look at. Runs inside Obsidian through
 * `obsidian eval` (see scripts/shots/review.mjs), capturing the renderer — so no screen-recording border, agent
 * overlay or neighbouring window can reach the pictures.
 *
 * This is the human half of the checks: `npm run ui` measures the chrome and can say a control is 12px or
 * invisible, but only eyes can say a map looks right. Every state the plugin puts a person in gets one picture.
 */
(async () => {
  const config = window.__ideascapeReview;
  delete window.__ideascapeReview;
  const fs = require("fs");
  const { remote } = require("electron");
  const win = remote.getCurrentWindow();
  const out = config.out;
  const note = config.note ?? "Maps/Launch a podcast.md";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const run = id => app.commands.executeCommandById(`ideascape:${id}`);
  const taken = [];
  const missed = [];

  fs.mkdirSync(out, { recursive: true });
  const shot = async (name) => {
    await sleep(500);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(`${out}/${name}.png`, image.toPNG());
    taken.push(name);
  };
  const step = async (name, fn) => {
    try {
      await fn();
      await shot(name);
    } catch (error) {
      missed.push(`${name}: ${error.message}`);
    }
  };

  const theme = async (which) => { app.changeTheme(which); await sleep(1400); };
  const open = async () => {
    const leaf = app.workspace.getMostRecentLeaf();
    await leaf.setViewState({ type: "ideascape", state: { file: note } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await sleep(1600);
  };
  /** Press a node the way a finger does, so the bar and the selection appear as they do in use. */
  const pressNode = async () => {
    const node = document.querySelector(".io-root .node.as-pill:not(.is-root)");
    if (!node) throw new Error("no node on screen");
    const box = node.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, pointerId: 1, isPrimary: true, button: 0 };
    node.dispatchEvent(new PointerEvent("pointerdown", at));
    node.dispatchEvent(new PointerEvent("pointerup", at));
    await sleep(400);
  };
  const escape = async () => {
    document.querySelector(".io-root")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(400);
  };

  win.setContentBounds({ x: 60, y: 60, width: config.width ?? 1280, height: config.height ?? 860 });
  app.workspace.leftSplit.collapse();
  app.workspace.rightSplit.collapse();
  await sleep(800);

  // The two views, in both themes: the surfaces a person spends the day in.
  await step("01-map-dark", async () => { await theme("obsidian"); await open(); run("map-shape-map"); await sleep(600); run("map-fit"); });
  await step("02-outline-dark", async () => { run("map-shape-outline"); await sleep(900); });
  await step("03-map-light", async () => { await theme("moonstone"); run("map-shape-map"); await sleep(900); run("map-fit"); });
  await step("04-outline-light", async () => { run("map-shape-outline"); await sleep(900); });

  // Everything that opens over the map.
  await step("05-panel-light", async () => { run("map-shape-map"); await sleep(700); run("map-properties"); });
  await step("06-panel-dark", async () => { await theme("obsidian"); });
  await step("07-node-bar-dark", async () => { run("map-properties"); await sleep(500); await pressNode(); });
  await step("08-editing-dark", async () => { run("map-edit"); await sleep(600); });
  await step("09-find-dark", async () => { await escape(); await escape(); run("map-find"); await sleep(400); });
  await step("10-focus-dark", async () => { await escape(); await pressNode(); run("map-focus"); await sleep(800); });
  await step("11-shortcuts-dark", async () => {
    await escape(); await escape();
    document.querySelector(".io-root")?.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    await sleep(700);
  });
  await step("12-export-dark", async () => { await escape(); await sleep(400); run("map-export"); await sleep(700); });
  await step("13-export-light", async () => { await theme("moonstone"); });
  await step("14-map-after", async () => { await escape(); await theme("obsidian"); await sleep(400); run("map-fit"); });

  fs.writeFileSync(`${out}/done.json`, JSON.stringify({ taken, missed }, null, 1));
  return JSON.stringify({ taken: taken.length, missed });
})()
