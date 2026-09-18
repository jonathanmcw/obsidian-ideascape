/*
 * The plugin on a real iPhone, driven and photographed over the USB cable.
 *
 * Obsidian on iOS is a WKWebView, and Apple's inspector will attach to it. `ios_webkit_debug_proxy` puts that
 * connection on a local port, so this machine can read the phone's DOM, run the plugin's own commands, and take a
 * picture of the webview at the device's full pixel ratio — none of which the desktop can stand in for. Everything
 * mobile in this plugin had until now been checked against an emulated phone that lies about its width, its
 * keyboard and its chrome.
 *
 *   brew install ios-webkit-debug-proxy        # once
 *   ios_webkit_debug_proxy -c null:9221,:9222-9232 --no-frontend &
 *   node scripts/shots/phone.mjs <command>
 *
 * The phone must be unlocked, trusted, and showing Obsidian: the webview only exists while the app is in front.
 */
import { writeFileSync, mkdirSync } from "node:fs";

const PROXY = process.env.PHONE_PROXY ?? "http://localhost:9222";

/** The Obsidian webview, found by its scheme rather than by a page number: the id changes every time the app comes
 *  back to the front, so anything that remembers one is broken by the next unlock. */
export async function findObsidian() {
  const res = await fetch(`${PROXY}/json`).catch(() => null);
  if (!res) throw new Error(`no answer from the proxy at ${PROXY} — is ios_webkit_debug_proxy running, and the phone unlocked?`);
  const pages = await res.json();
  const page = pages.find(p => (p.url ?? "").startsWith("capacitor://"));
  if (!page) throw new Error(`Obsidian is not in front on the phone — ${pages.length} other page(s) are open`);
  return page.webSocketDebuggerUrl;
}

/** One conversation with the webview. iOS wraps every inspector message in a Target indirection, and the domains
 *  must be enabled *inside* the target: a bare Runtime.evaluate is acknowledged and then silently dropped. */
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl ?? (await findObsidian()));
  const pending = new Map();
  let target = null;
  let inner = 0;
  let outer = 0;

  await new Promise((resolve, reject) => {
    const fail = setTimeout(() => reject(new Error("the webview never announced a target")), 15000);
    ws.onerror = () => { clearTimeout(fail); reject(new Error("could not open the inspector socket")); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === "Target.targetCreated" && !target) { target = m.params.targetInfo.targetId; clearTimeout(fail); resolve(); return; }
      if (m.method !== "Target.dispatchMessageFromTarget") return;
      const reply = JSON.parse(m.params.message);
      const waiting = pending.get(reply.id);
      if (!waiting) return;
      pending.delete(reply.id);
      reply.error ? waiting.reject(new Error(reply.error.message)) : waiting.resolve(reply.result);
    };
  });

  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++inner;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id: ++outer, method: "Target.sendMessageToTarget", params: { targetId: target, message: JSON.stringify({ id, method, params }) } }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} went unanswered`)); }, 20000);
  });

  await call("Runtime.enable");
  await call("Page.enable");

  return {
    /** Run an expression in the page. Promises are awaited; the value comes back as JSON. */
    async eval(expression) {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.wasThrown) throw new Error(`the page threw: ${r.result?.description ?? JSON.stringify(r.result)}`);
      return r.result?.value;
    },
    /** A picture of the webview at the device's own pixel ratio. */
    async shot(path, { width, height } = {}) {
      const size = await this.eval("JSON.stringify([innerWidth, innerHeight])").then(JSON.parse);
      const r = await call("Page.snapshotRect", { x: 0, y: 0, width: width ?? size[0], height: height ?? size[1], coordinateSystem: "Viewport" });
      const png = Buffer.from(r.dataURL.split(",")[1], "base64");
      mkdirSync(path.replace(/\/[^/]+$/, ""), { recursive: true });
      writeFileSync(path, png);
      return { path, bytes: png.length };
    },
    close() { try { ws.close(); } catch { /* already gone */ } },
  };
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Run directly: a pass over the phone's surfaces.
 *   node scripts/shots/phone.mjs [outDir]
 * Every step waits for the screen to say the thing is there, as the desktop pass does — a picture taken on a timer
 * is a picture of whatever happened to be on screen.
 * ------------------------------------------------------------------ */
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? "review/phone";
  const p = await connect();
  const taken = [];
  const missed = [];

  const until = async (test, what, ms = 6000) => {
    const started = Date.now();
    while (Date.now() - started < ms) {
      if (await p.eval(`!!(${test})`)) return;
      await sleep(150);
    }
    throw new Error(`waited for ${what}`);
  };
  const step = async (name, run) => {
    try { await run(); await sleep(400); const s = await p.shot(`${out}/${name}.png`); taken.push(`${name} (${Math.round(s.bytes / 1024)}KB)`); }
    catch (e) { missed.push(`${name}: ${e.message}`); }
  };
  const shape = async (which) => {
    await p.eval(`app.commands.executeCommandById('ideascape:map-shape-${which}'), 1`);
    // Every check is a round trip down the cable, so a wait that is generous in-process is tight here: the Shift is
    // a 450ms morph and a handful of polls can cost more than that on their own.
    await until(`document.querySelector('.io-root .stage')?.classList.contains('shape-${which}')`, `the ${which}`, 12000);
    await sleep(700);
  };
  const theme = async (which) => {
    await p.eval(`app.changeTheme('${which}'), 1`);
    await until(`document.body.classList.contains('${which === "obsidian" ? "theme-dark" : "theme-light"}')`, `the ${which} theme`);
    await sleep(600);
  };

  const note = process.env.NOTE ?? "maps/Ideascape tour.md";
  await p.eval(`(async () => { const f = app.vault.getAbstractFileByPath(${JSON.stringify(note)}); if (f) await app.workspace.getMostRecentLeaf().openFile(f); })()`);
  await sleep(1500);
  await until(`document.querySelector('.io-root .stage')`, "the map to be drawn", 12000);

  await step("20-phone-map", async () => { await theme("obsidian"); await shape("map"); await p.eval("app.commands.executeCommandById('ideascape:map-fit'), 1"); await sleep(900); });
  await step("21-phone-outline", async () => { await shape("outline"); });
  await step("22-phone-editing", async () => {
    await p.eval("(()=>{const n=document.querySelector('.io-root .node:not(.is-root)'); const b=n.getBoundingClientRect(); const at={clientX:b.left+b.width/2, clientY:b.top+b.height/2, bubbles:true, pointerId:1, isPrimary:true, pointerType:'touch', button:0}; n.dispatchEvent(new PointerEvent('pointerdown',at)); n.dispatchEvent(new PointerEvent('pointerup',at));})(), 1");
    await sleep(500);
    await p.eval("app.commands.executeCommandById('ideascape:map-edit'), 1");
    await until("document.querySelector('.io-root .node-toolbar.is-docked')", "the dock");
    await sleep(500);
  });
  await step("23-phone-map-light", async () => {
    await p.eval("document.querySelector('.io-root')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})), 1");
    await sleep(400);
    await theme("moonstone");
    await shape("map");
    await p.eval("app.commands.executeCommandById('ideascape:map-fit'), 1");
    await sleep(900);
  });
  await theme("obsidian");

  console.log(`taken:\n  ${taken.join("\n  ") || "(none)"}`);
  if (missed.length) console.log(`missed:\n  ${missed.join("\n  ")}`);
  p.close();
}
