/*
 * A pass through the map's surfaces, photographed for a person to look at. Runs inside Obsidian through
 * `obsidian eval` (see scripts/shots/review.mjs), capturing the renderer — so no screen-recording border, agent
 * overlay or neighbouring window can reach the pictures.
 *
 * This is the human half of the checks: `npm run ui` measures the chrome and can say a control is 12px or
 * invisible, but only eyes can say a map looks right. Every state the plugin puts a person in gets one picture.
 *
 * Every step waits for the thing it is photographing to be on screen, rather than sleeping and hoping. Sleeping is
 * how a run of this produced fourteen pictures, each one state behind its own name.
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
  const seen = sel => !!document.querySelector(sel);
  const taken = [];
  const missed = [];

  /** Wait for the screen to say a thing is true, or give up and say what was waited for. */
  const until = async (test, what, ms = 5000) => {
    const started = Date.now();
    while (Date.now() - started < ms) {
      if (test()) return;
      await sleep(80);
    }
    throw new Error(`waited for ${what}`);
  };

  fs.mkdirSync(out, { recursive: true });
  /** Two frames, then the picture: capturePage hands back the last composited frame, so a shot taken straight
   *  after a change catches the screen as it was. */
  // Raced against a timer: a window behind another app gets no animation frames at all, and waiting on one
  // then never returns — which stalled a whole pass three pictures in.
  const painted = () => Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
    sleep(400),
  ]);
  const shot = async (name) => {
    await sleep(350);
    await painted();
    fs.writeFileSync(`${out}/${name}.png`, (await win.webContents.capturePage()).toPNG());
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

  const theme = async (which) => {
    app.changeTheme(which);
    await until(() => document.body.classList.contains(which === "obsidian" ? "theme-dark" : "theme-light"), `the ${which} theme`);
    await sleep(500); // the map re-reads Obsidian's colours on a theme change; let it repaint in the new ones
  };
  const open = async () => {
    const file = app.vault.getAbstractFileByPath(note);
    if (!file) throw new Error(`${note} is not in this vault`);
    // Open the file first, then make it a map: setViewState alone leaves a leaf that is already a map showing
    // whatever it had — which is how a run of this once photographed an empty Untitled map fourteen times.
    const leaf = app.workspace.getMostRecentLeaf();
    await leaf.openFile(file);
    if (leaf.view.getViewType() !== "ideascape") await leaf.setViewState({ type: "ideascape", state: { file: note } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await until(() => seen(".io-root .stage"), "the map to be drawn");
    // Opening a marked note can leave a twin leaf behind — one drawn, one not, each with its own camera and shape.
    // Keep the one on screen, or a command lands on the leaf nobody is photographing.
    const leaves = app.workspace.getLeavesOfType("ideascape");
    const onScreen = leaves.find(l => l.containerEl?.offsetParent) ?? leaves[0];
    for (const other of leaves) if (other !== onScreen) other.detach();
    if (onScreen) app.workspace.setActiveLeaf(onScreen, { focus: true });
    await sleep(600);
    const shown = onScreen?.view?.file?.path ?? onScreen?.getViewState()?.state?.file;
    if (shown !== note) throw new Error(`opened ${shown}, not ${note}`);
  };
  /** Ask for a shape, wait until the view wears it, then let the Shift finish: it is a 450ms morph. */
  const shape = async (which) => {
    run(`map-shape-${which}`);
    await until(() => seen(`.io-root .stage.shape-${which}`), `the ${which}`);
    await sleep(800);
  };
  const panel = async (open) => {
    if (seen(".io-root .app.inspector-open") !== open) run("map-properties");
    await until(() => seen(".io-root .app.inspector-open") === open, `the panel ${open ? "open" : "closed"}`);
    await sleep(400);
  };
  /** Press a node the way a finger does, so the bar and the selection appear as they do in use. */
  const pressNode = async () => {
    const node = document.querySelector(".io-root .node.as-pill:not(.is-root)");
    if (!node) throw new Error("no node on screen");
    const box = node.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, pointerId: 1, isPrimary: true, button: 0 };
    node.dispatchEvent(new PointerEvent("pointerdown", at));
    node.dispatchEvent(new PointerEvent("pointerup", at));
    await until(() => seen(".io-root .node.is-selected"), "a selected node");
  };
  const key = (k) => document.querySelector(".io-root")?.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  const clear = async () => {
    for (let i = 0; i < 3; i++) { key("Escape"); await sleep(250); }
    await until(() => !seen(".io-root [role='dialog']") && !seen(".io-root .find"), "everything closed");
  };

  win.setContentBounds({ x: 60, y: 60, width: config.width ?? 1280, height: config.height ?? 860 });
  // A window behind another app composites nothing: capturePage then hands back the frame from before the change,
  // so every picture comes out one state behind its name however long the pass waits. Raised for the pass, as
  // scripts/shots/capture.sh raises it for the same reason, and put back at the end.
  remote.app.focus({ steal: true });
  win.show();
  win.focus();
  win.moveTop();
  win.setAlwaysOnTop(true);
  app.workspace.leftSplit.collapse();
  app.workspace.rightSplit.collapse();
  await sleep(800);

  // The two views, in both themes. Nothing selected, nothing open: these show the view itself.
  await step("01-map-dark", async () => { await theme("obsidian"); await open(); await clear(); await panel(false); await shape("map"); run("map-fit"); await sleep(700); });
  await step("02-outline-dark", async () => { await shape("outline"); });
  await step("03-map-light", async () => { await theme("moonstone"); await shape("map"); run("map-fit"); await sleep(700); });
  await step("04-outline-light", async () => { await shape("outline"); });

  // Everything that opens over the map.
  await step("05-panel-light", async () => { await shape("map"); run("map-fit"); await sleep(600); await panel(true); });
  await step("06-panel-dark", async () => { await theme("obsidian"); });
  // The node bar belongs to editing, not to selection (Stage's barId is the node being edited), so a selected node
  // and a node being typed into are two pictures, not one.
  await step("07-selected-dark", async () => { await panel(false); await pressNode(); });
  await step("08-editing-dark", async () => { run("map-edit"); await until(() => seen(".io-root .node-toolbar"), "the node bar over the node being edited"); });
  await step("09-find-dark", async () => { await clear(); run("map-find"); await until(() => seen(".io-root .find"), "the find bar"); });
  await step("10-focus-dark", async () => { await clear(); await pressNode(); run("map-focus"); await until(() => seen(".io-root .canvas-wrap.is-focused"), "focus mode"); await sleep(600); });
  await step("11-shortcuts-dark", async () => { await clear(); key("?"); await until(() => seen(".io-root .sk-sheet"), "the shortcuts sheet"); });
  await step("12-export-dark", async () => { await clear(); run("map-export"); await until(() => seen(".io-root .sheet"), "the export sheet"); });
  await step("13-export-light", async () => { await theme("moonstone"); await until(() => seen(".io-root .sheet"), "the export sheet in the light theme"); });
  await step("14-map-after", async () => { await clear(); await theme("obsidian"); run("map-fit"); await sleep(700); });

  win.setAlwaysOnTop(false);
  fs.writeFileSync(`${out}/done.json`, JSON.stringify({ taken, missed }, null, 1));
  return JSON.stringify({ taken: taken.length, missed });
})()
