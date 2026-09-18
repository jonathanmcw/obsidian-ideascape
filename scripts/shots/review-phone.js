/*
 * The phone half of `npm run review`, run while Obsidian is in its own phone emulation: a phone-shaped window, the
 * map, the outline, and the keyboard dock a person types against. Same renderer capture as the desktop pass.
 */
(async () => {
  const config = window.__ideascapeReview;
  delete window.__ideascapeReview;
  const fs = require("fs");
  const { remote } = require("electron");
  const win = remote.getCurrentWindow();
  const out = config.out;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const run = id => app.commands.executeCommandById(`ideascape:${id}`);
  const taken = [];
  const missed = [];

  // capturePage hands back the last composited frame: wait for two, or the picture is the screen as it was.
  // Raced against a timer: a window behind another app gets no animation frames at all, and waiting on one
  // then never returns — which stalled a whole pass three pictures in.
  const painted = () => Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
    sleep(400),
  ]);
  const shot = async (name) => {
    await sleep(600);
    await painted();
    fs.writeFileSync(`${out}/${name}.png`, (await win.webContents.capturePage()).toPNG());
    taken.push(name);
  };
  const step = async (name, fn) => {
    try { await fn(); await shot(name); } catch (error) { missed.push(`${name}: ${error.message}`); }
  };
  const pressNode = async () => {
    const node = document.querySelector(".io-root .node:not(.is-root)");
    if (!node) throw new Error("no node on screen");
    const box = node.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, pointerId: 1, isPrimary: true, pointerType: "touch", button: 0 };
    node.dispatchEvent(new PointerEvent("pointerdown", at));
    node.dispatchEvent(new PointerEvent("pointerup", at));
    await sleep(400);
  };

  win.setContentBounds({ x: 120, y: 60, width: config.width ?? 414, height: config.height ?? 880 });
  await sleep(1500);
  const file = app.vault.getAbstractFileByPath(config.note);
  const leaf = app.workspace.getMostRecentLeaf();
  if (file) await leaf.openFile(file);
  if (leaf.view.getViewType() !== "ideascape") await leaf.setViewState({ type: "ideascape", state: { file: config.note } });
  app.workspace.setActiveLeaf(leaf, { focus: true });
  await sleep(2000);

  await step("20-phone-map", async () => { run("map-shape-map"); await sleep(800); run("map-fit"); });
  await step("21-phone-outline", async () => { run("map-shape-outline"); await sleep(1000); });
  await step("22-phone-dock", async () => { await pressNode(); run("map-edit"); await sleep(900); });
  await step("23-phone-dock-more", async () => {
    // The dock names its buttons with a hidden span (NodeBar's <Name>), not an aria-label, so the text is read.
    const more = [...document.querySelectorAll(".node-toolbar.is-docked .nt-main > button")].find(b => /more/i.test(b.textContent ?? ""));
    if (!more) throw new Error("no More button in the dock");
    more.click();
    await sleep(700);
  });
  await step("24-phone-map-light", async () => {
    document.querySelector(".io-root")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    app.changeTheme("moonstone");
    await sleep(1400);
    run("map-shape-map");
    await sleep(800);
    run("map-fit");
  });
  app.changeTheme("obsidian");

  fs.writeFileSync(`${out}/done-phone.json`, JSON.stringify({ taken, missed }, null, 1));
  return JSON.stringify({ taken: taken.length, missed });
})()
