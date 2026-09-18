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
    const file = app.vault.getAbstractFileByPath(note);
    if (!file) throw new Error(`${note} is not in this vault`);
    // Open the file first, then make it a map: setViewState alone leaves a leaf that is already a map showing
    // whatever it had — which is how a run of this once photographed an empty Untitled map fourteen times.
    const leaf = app.workspace.getMostRecentLeaf();
    await leaf.openFile(file);
    if (leaf.view.getViewType() !== "ideascape") await leaf.setViewState({ type: "ideascape", state: { file: note } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await sleep(1800);
    // Opening a marked note can leave a twin leaf behind — one drawn, one not, each with its own camera and shape.
    // Keep the one on screen and make it active, or a command lands on the leaf nobody is photographing.
    const leaves = app.workspace.getLeavesOfType("ideascape");
    const onScreen = leaves.find(l => l.containerEl?.offsetParent) ?? leaves[0];
    for (const other of leaves) if (other !== onScreen) other.detach();
    if (onScreen) app.workspace.setActiveLeaf(onScreen, { focus: true });
    await sleep(700);
    const shown = onScreen?.view?.file?.path ?? onScreen?.getViewState()?.state?.file;
    if (shown !== note) throw new Error(`opened ${shown}, not ${note}`);
  };
  /** Ask for a shape and wait until the view is actually wearing it. */
  const shape = async (which) => {
    for (let tries = 0; tries < 3; tries++) {
      run(`map-shape-${which}`);
      await sleep(700);
      if (document.querySelector(`.io-root .stage.shape-${which}`)) return;
    }
    throw new Error(`the view would not become a ${which}`);
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
  await step("01-map-dark", async () => { await theme("obsidian"); await open(); await shape("map"); run("map-fit"); await sleep(600); });
  await step("02-outline-dark", async () => { await shape("outline"); await sleep(600); });
  await step("03-map-light", async () => { await theme("moonstone"); await shape("map"); run("map-fit"); await sleep(600); });
  await step("04-outline-light", async () => { await shape("outline"); await sleep(600); });

  // Everything that opens over the map.
  await step("05-panel-light", async () => { await shape("map"); run("map-properties"); await sleep(600); });
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
