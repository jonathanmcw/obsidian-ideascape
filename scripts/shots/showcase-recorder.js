/*
 * Runs inside Obsidian through `obsidian eval`. The shell wrapper supplies
 * `window.__ideascapeShowcase` and turns the renderer-only PNG frames into a GIF.
 *
 * Keeping the recorder in the renderer is deliberate: Electron's capturePage()
 * can only see Obsidian, so floating screen-recording or agent overlays can never
 * appear at the edge of the finished demo.
 */
(async () => {
  const config = window.__ideascapeShowcase;
  delete window.__ideascapeShowcase;
  if (!config?.out) throw new Error("Missing showcase output directory");

  const fs = require("fs");
  const path = require("path");
  const electron = require("electron").remote;
  const frameMs = Math.round(1000 / (config.fps ?? 12));
  const out = config.out;
  const notePath = "Maps/Weekend in Lisbon.md";
  const sleep = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const until = async (test, message, timeout = 5000) => {
    const started = performance.now();
    while (performance.now() - started < timeout) {
      const value = test();
      if (value) return value;
      await sleep(40);
    }
    throw new Error(message);
  };

  fs.mkdirSync(out, { recursive: true });
  for (const name of fs.readdirSync(out)) {
    if (/^frame-\d+\.png$/.test(name) || name === "done.json") fs.rmSync(path.join(out, name));
  }

  // One leaf, no sidebars, and a window whose leaf is the same aspect ratio as
  // the 840 x 606 README image. macOS may cap the height; these dimensions still
  // produce a 977 x 705 CSS-pixel leaf on the current display.
  const win = electron.getCurrentWindow();
  win.setContentBounds({ x: 80, y: 40, width: 1118, height: 870 });
  win.show();
  win.focus();
  app.workspace.leftSplit.collapse();
  app.workspace.rightSplit.collapse();
  const leaves = [];
  app.workspace.rootSplit.children.forEach(group => (group.children ?? []).forEach(leaf => leaves.push(leaf)));
  leaves.slice(1).forEach(leaf => leaf.detach());
  if (typeof app.changeTheme === "function") app.changeTheme("obsidian");
  await sleep(900);

  const seed = "---\nideascape: root\n---\n# Weekend in Lisbon\n";
  let file = app.vault.getAbstractFileByPath(notePath);
  if (file) await app.vault.modify(file, seed);
  else file = await app.vault.create(notePath, seed);

  const leaf = app.workspace.getMostRecentLeaf();
  await leaf.openFile(file);
  if (leaf.view.getViewType() !== "ideascape") {
    await leaf.setViewState({ type: "ideascape", state: { file: notePath }, active: true });
  }
  app.workspace.setActiveLeaf(leaf, { focus: true });
  const visibleLeaf = await until(
    () => app.workspace.getLeavesOfType("ideascape").find(candidate => candidate.containerEl?.offsetParent),
    "The Ideascape demo leaf did not become visible",
  );
  app.workspace.getLeavesOfType("ideascape").filter(candidate => candidate !== visibleLeaf).forEach(candidate => candidate.detach());
  await until(() => visibleLeaf.view.commands?.(), "Ideascape commands were not ready");
  visibleLeaf.view.commands().shift("map");
  await sleep(500);
  visibleLeaf.view.commands().fit();
  await sleep(700);

  const host = visibleLeaf.containerEl;
  let frame = 0;
  const keycasts = [];
  let activeKeycast = null;
  let pillTimer = 0;
  const showKey = (keys, label, hold = 1050) => {
    window.clearTimeout(pillTimer);
    if (activeKeycast && activeKeycast.end == null) activeKeycast.end = frame;
    activeKeycast = { start: frame, end: null, keys, label };
    keycasts.push(activeKeycast);
    pillTimer = window.setTimeout(() => {
      if (activeKeycast && activeKeycast.end == null) activeKeycast.end = frame;
      activeKeycast = null;
    }, hold);
  };

  const api = () => {
    const commands = visibleLeaf.view.commands?.();
    if (!commands) throw new Error("Ideascape commands disappeared during recording");
    return commands;
  };
  const nodeId = text => {
    const node = Object.values(visibleLeaf.view.doc?.nodes ?? {}).find(candidate => candidate.text === text);
    if (!node) throw new Error(`Could not find node: ${text}`);
    return node.id;
  };
  const select = async text => {
    api().reveal(nodeId(text));
    await sleep(220);
  };
  const typeNode = async (kind, text, hint) => {
    if (hint) showKey(hint.keys, hint.label, hint.hold);
    api()[kind]();
    const editor = await until(
      () => document.activeElement?.classList?.contains("node-label") && document.activeElement.isContentEditable && document.activeElement,
      `The editor did not open for: ${text}`,
    );
    await sleep(90);
    for (const character of Array.from(text)) {
      document.execCommand("insertText", false, character);
      await sleep(character === " " ? 24 : 43);
    }
    await sleep(160);
    api().toggleEdit();
    await until(() => document.activeElement !== editor || !editor.isContentEditable, `The editor did not close for: ${text}`);
    await sleep(190);
  };
  const fit = async (pause = 700) => {
    api().fit();
    await sleep(pause);
  };

  let recording = true;
  const capture = async () => {
    const webContents = electron.getCurrentWebContents();
    while (recording) {
      const started = performance.now();
      const rect = host.getBoundingClientRect();
      const image = await webContents.capturePage({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
      fs.writeFileSync(path.join(out, `frame-${String(frame).padStart(5, "0")}.png`), image.toPNG());
      frame += 1;
      await sleep(Math.max(1, frameMs - (performance.now() - started)));
    }
  };
  const captureTask = capture();

  try {
    await sleep(900);
    api().reveal(visibleLeaf.view.doc.rootId);
    await typeNode("addChild", "Where to stay", { keys: ["Tab"], label: "Add child", hold: 1100 });
    await typeNode("addSibling", "What to eat");
    await fit();
    api().zoomBy(0.84);
    await sleep(350);

    await typeNode("addChild", "Pastéis de Belém");
    showKey(["⌘", "↵"], "Make checklist", 1250);
    api().toggleTask();
    await sleep(620);
    await typeNode("addSibling", "Bifana");
    await typeNode("addSibling", "Ginjinha");
    await fit(900);

    await select("What to eat");
    await typeNode("addSibling", "What to see");
    await typeNode("addChild", "Alfama");
    await typeNode("addSibling", "LX Factory");
    await typeNode("addSibling", "Belém Tower");
    await typeNode("addSibling", "Tram 28 at dusk");
    await fit(900);

    showKey(["⇧", "⌘", "7"], "Number list", 1400);
    for (const text of ["Alfama", "LX Factory", "Belém Tower", "Tram 28 at dusk"]) {
      await select(text);
      api().toggleOrdered();
      await sleep(120);
    }
    await sleep(500);

    await select("What to eat");
    showKey(["⌘", "B"], "Bold", 950);
    api().format("bold");
    await sleep(850);
    await select("Tram 28 at dusk");
    api().format("italic");
    await sleep(900);

    await select("What to see");
    showKey(["⌘", "."], "Fold branch", 1150);
    api().toggleCollapse();
    await sleep(1350);
    api().toggleCollapse();
    await sleep(900);

    showKey(["⌥", "⌘", "F"], "Focus on branch", 1250);
    api().toggleFocus();
    await sleep(1500);
    api().toggleFocus();
    await fit(900);

    showKey(["⌘", "2"], "Outline view", 1150);
    api().shift("outline");
    await sleep(1700);
    showKey(["⌘", "1"], "Map view", 1150);
    api().shift("map");
    await sleep(500);
    await fit(900);
    await sleep(1700);
  } finally {
    recording = false;
    await captureTask;
    window.clearTimeout(pillTimer);
    if (activeKeycast && activeKeycast.end == null) activeKeycast.end = frame;
  }

  const result = { frames: frame, fps: Math.round(1000 / frameMs), width: 840, height: 606, keycasts };
  fs.writeFileSync(path.join(out, "done.json"), JSON.stringify(result, null, 2));
  return JSON.stringify(result);
})();
