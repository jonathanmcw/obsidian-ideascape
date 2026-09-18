/*
 * The phone half of `npm run review`, run while Obsidian is in its own phone emulation: a phone-shaped window, the
 * map, the outline, and the keyboard dock a person types against. Same renderer capture as the desktop pass.
 *
 * Like the desktop pass, every step waits for the thing it is photographing, and the window is raised for the
 * duration: a window behind another app composites nothing, so capturePage hands back the frame from before the
 * change and every picture comes out one state behind its own name.
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
  const until = async (test, what, ms = 6000) => {
    const started = Date.now();
    while (Date.now() - started < ms) {
      if (test()) return;
      await sleep(80);
    }
    throw new Error(`waited for ${what}`);
  };

  // Raced against a timer: a window that gets no animation frames would otherwise never return from this.
  const painted = () => Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
    sleep(400),
  ]);
  const shot = async (name) => {
    await sleep(500);
    await painted();
    fs.writeFileSync(`${out}/${name}.png`, (await win.webContents.capturePage()).toPNG());
    taken.push(name);
  };
  const step = async (name, fn) => {
    try { await fn(); await shot(name); } catch (error) { missed.push(`${name}: ${error.message}`); }
  };
  /** Press a node the way a finger does, so the selection and the dock appear as they do in use. */
  const pressNode = async () => {
    const node = document.querySelector(".io-root .node:not(.is-root)");
    if (!node) throw new Error("no node on screen");
    const box = node.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, pointerId: 1, isPrimary: true, pointerType: "touch", button: 0 };
    node.dispatchEvent(new PointerEvent("pointerdown", at));
    node.dispatchEvent(new PointerEvent("pointerup", at));
    await until(() => seen(".io-root .node.is-selected"), "a selected node");
  };
  const shape = async (which) => {
    run(`map-shape-${which}`);
    await until(() => seen(`.io-root .stage.shape-${which}`), `the ${which}`);
    await sleep(800); // the Shift is a 450ms morph
  };
  const theme = async (which) => {
    app.changeTheme(which);
    await until(() => document.body.classList.contains(which === "obsidian" ? "theme-dark" : "theme-light"), `the ${which} theme`);
    await sleep(500); // the map re-reads Obsidian's colours on a theme change
  };

  try {
    win.setContentBounds({ x: 120, y: 60, width: config.width ?? 414, height: config.height ?? 880 });
    remote.app.focus({ steal: true });
    win.show();
    win.focus();
    win.moveTop();
    win.setAlwaysOnTop(true);
    await sleep(1500);

    // Open the file first, then make it a map: setViewState alone leaves a leaf that is already a map showing
    // whatever it had.
    const file = app.vault.getAbstractFileByPath(note);
    const leaf = app.workspace.getMostRecentLeaf();
    if (file) await leaf.openFile(file);
    if (leaf.view.getViewType() !== "ideascape") await leaf.setViewState({ type: "ideascape", state: { file: note } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await until(() => seen(".io-root .stage"), "the map to be drawn", 15000);
    await sleep(1200);

    await step("20-phone-map", async () => { await shape("map"); run("map-fit"); await sleep(700); });
    await step("21-phone-outline", async () => { await shape("outline"); });
    await step("22-phone-dock", async () => {
      await pressNode();
      run("map-edit");
      await until(() => seen(".io-root .node-toolbar.is-docked"), "the dock over the node being edited");
      await sleep(600);
    });
    await step("23-phone-dock-more", async () => {
      // The dock names its buttons with a hidden span (NodeBar's <Name>), not an aria-label, so the text is read.
      const more = [...document.querySelectorAll(".node-toolbar.is-docked .nt-main > button")].find(b => /more/i.test(b.textContent ?? ""));
      if (!more) throw new Error("no More button in the dock");
      more.click();
      await until(() => seen(".io-root .nt-phone-more"), "the More panel");
      await sleep(400);
    });
    await step("24-phone-map-light", async () => {
      document.querySelector(".io-root")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(300);
      await theme("moonstone");
      await shape("map");
      run("map-fit");
      await sleep(700);
    });
    await theme("obsidian").catch(() => {});
  } finally {
    win.setAlwaysOnTop(false);
    fs.writeFileSync(`${out}/done-phone.json`, JSON.stringify({ taken, missed }, null, 1));
  }
  return JSON.stringify({ taken: taken.length, missed });
})()
