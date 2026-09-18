// The host's decisions that need no Obsidian import, so `node --test` can run them. The map view
// and the plugin call these; everything here is plain text and plain objects in, answers out.
import { PLUGIN_NAME } from "./brand.ts";
import { MAP_FORMATS, isLayoutBlockLine } from "./organiser/model/markdown.ts";

/* ---------- opening a note as a map ---------- */

const FM_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)??---(?:\r?\n|$)/;
const TRAILING_ID = /(^|\s)\^[A-Za-z0-9-]+\s*$/;
const MARKER_LINE = new RegExp(`^(?:${MAP_FORMATS.map(f => f.key).join("|")})\\s*:`);
const HEADING = /^\s*#{1,6}(\s|$)/;
const ITEM = /^\s*([-*+]|\d+[.)])(\s|$)/;

interface Row { text: string; gap: boolean } // gap: a blank line sits above it

function noteParts(text: string): { fm: string[]; rows: Row[] } {
  let t = text.replace(/\r\n?/g, "\n");
  const m = FM_RE.exec(t);
  const fm = m ? (m[1] ?? "").split("\n").map(l => l.trimEnd()).filter(l => !MARKER_LINE.test(l)) : [];
  while (fm.length && !fm[fm.length - 1]) fm.pop();
  if (m) t = t.slice(m[0].length);
  const lines = t.split("\n").map(l => l.trimEnd());
  // The layout block is the map's own: the last one (… %% pair) goes, whatever sits after it stays.
  let open = lines.length - 1;
  while (open >= 0 && !isLayoutBlockLine(lines[open])) open--;
  const close = open < 0 ? -1 : lines.findIndex((l, i) => i > open && l.trim() === "%%");
  if (close > open) lines.splice(open, close - open + 1);
  const rows: Row[] = [];
  let gap = false;
  for (const l of lines) {
    // An indented `\` alone is how older maps wrote a blank line inside a node; the map now writes it blank in code.
    if (!l.trim() || /^\s+\\$/.test(l)) { gap = rows.length > 0; continue; }
    rows.push({ text: l, gap });
    gap = false;
  }
  return { fm, rows };
}

/** The frontmatter block at the top of a note, fences included, however long it runs; "" when there is none. */
export function frontmatterHead(text: string): string {
  if (!/^---\r?\n/.test(text)) return "";
  const close = /\n---(?:\r?\n|$)/g;
  close.lastIndex = text.indexOf("\n");
  const m = close.exec(text);
  return m ? text.slice(0, m.index + m[0].length) : "";
}

/** The same line, or the same line with a block id added where it had none. */
function sameLine(src: string, out: string): boolean {
  return out === src || (!TRAILING_ID.test(src) && out.replace(TRAILING_ID, "") === src);
}

/** For a line that opens a fenced code block, a %% or <!-- --> comment or a $$ block at the top level of a note:
 *  the test for its closing line. The map reads only list items, so what sits inside one of these must come back
 *  exactly as it was. */
function regionEnd(line: string): ((l: string) => boolean) | null {
  const fence = /^(`{3,}|~{3,})/.exec(line)?.[1];
  if (fence) return l => new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}\\s*$`).test(l);
  const count = (l: string, mark: string) => l.split(mark).length - 1;
  if (line.startsWith("%%") && count(line, "%%") % 2) return l => l.includes("%%");
  if (line.startsWith("$$") && count(line, "$$") % 2) return l => l.includes("$$");
  if (line.startsWith("<!--") && !line.includes("-->", 4)) return l => l.includes("-->");
  return null;
}

function short(line: string): string {
  const t = line.trim();
  return t.length > 60 ? `${t.slice(0, 59)}…` : t;
}

/**
 * What writing `out` (the note after a trip through the map) would do to `src`, beyond what a map
 * adds on purpose: block ids, the map key and the layout block. Null when that is all;
 * otherwise about how many lines change or move, and the first of them, for a one-line summary.
 */
export function conversionChange(src: string, out: string): { lines: number; first: string } | null {
  const a = noteParts(src), b = noteParts(out);
  let changed = 0;
  let first: string | null = null;
  const note = (line: string) => { changed++; first ??= line; };
  for (const l of a.fm) if (!b.fm.includes(l)) note(l);
  for (const l of b.fm) if (!a.fm.includes(l)) note(l);

  // Every line the map writes, by its text and by its text without an id, in file order.
  const at = new Map<string, number[]>();
  const index = (key: string, k: number) => { const list = at.get(key); if (list) list.push(k); else at.set(key, [k]); };
  b.rows.forEach((r, k) => { index(r.text, k); const bare = r.text.replace(TRAILING_ID, ""); if (bare !== r.text) index(bare, k); });

  // Where each of the note's lines stands. In a top-level code block or comment: after the line that opens it, up to
  // and including the one that closes it. In a list: from an item until a heading, such a block, or unindented text
  // after a blank line; nothing inside a block is an item.
  const inList: boolean[] = [], inBlock: boolean[] = [], opens: boolean[] = [], closes: boolean[] = [];
  let list = false, end: ((l: string) => boolean) | null = null;
  a.rows.forEach((r, i) => {
    inBlock[i] = end !== null;
    closes[i] = !!end?.(r.text);
    const next = end ? null : regionEnd(r.text);
    opens[i] = next !== null;
    if (inBlock[i] || opens[i]) list = false;
    else if (ITEM.test(r.text)) list = true;
    else if (HEADING.test(r.text) || (r.gap && !/^\s/.test(r.text))) list = false;
    inList[i] = list;
    end = closes[i] ? null : end ?? next;
  });
  // Maps from before block ids moved to a node's first line had the id on its last line when that was code.
  const idMovedToHead = (src: string, k: number): boolean => {
    const id = /\^([A-Za-z0-9-]+)\s*$/.exec(src)?.[1];
    // Only a closing fence ever carried a node's id in older maps; a `^word` at the end of a code line is code.
    if (!id || ITEM.test(src) || !/^\s*(`{3,}|~{3,})\s*\^[A-Za-z0-9-]+\s*$/.test(src) || b.rows[k].text !== src.replace(TRAILING_ID, "").trimEnd()) return false;
    const lead = (t: string) => /^\s*/.exec(t)![0].length;
    for (let h = k - 1; h >= 0; h--) if (ITEM.test(b.rows[h].text) && lead(b.rows[h].text) < lead(src)) return b.rows[h].text.endsWith(` ^${id}`);
    return false;
  };

  // Walk the note in order; each line must turn up later in the map's text than the one before it.
  let j = 0;
  const extra: string[] = [];
  for (let i = 0; i < a.rows.length; i++) {
    const s = a.rows[i];
    let k = (at.get(s.text) ?? []).find(k => k >= j && sameLine(s.text, b.rows[k].text));
    k ??= (at.get(s.text.replace(TRAILING_ID, "").trimEnd()) ?? []).find(k => k >= j && idMovedToHead(s.text, k));
    if (k === undefined) { note(s.text); continue; }
    for (let x = j; x < k; x++) extra.push(b.rows[x].text);
    const o = b.rows[k];
    const up = a.rows[i - 1]?.text;
    // A blank line gained or lost splits or merges a paragraph, an item's own included, and makes a list loose or
    // tight. Beside a heading or a block, or between prose and a list that starts after it, it changes nothing.
    const gapCounts = up !== undefined && !HEADING.test(up) && !HEADING.test(s.text) && !opens[i] && !closes[i - 1] && (!ITEM.test(s.text) || inList[i - 1]);
    // Inside a code block or comment nothing may be added: no block id, no blank line.
    if (s.gap !== o.gap && (gapCounts || inBlock[i]) || (inBlock[i] && o.text !== s.text)) note(s.text);
    j = k + 1;
  }
  for (let x = j; x < b.rows.length; x++) extra.push(b.rows[x].text);
  if (!changed && !extra.length) return null;
  return { lines: Math.max(changed, extra.length), first: short(first ?? extra[0]) };
}

/* ---------- exports ---------- */

/**
 * Where an export lands: beside the map, under a name nothing has yet, and never the map itself.
 * `untitled…` names take the map's file name. `taken` answers for the vault; the map's own path is
 * refused whatever it says, compared without case, as macOS and Windows file systems do.
 */
export function exportPath(filename: string, map: { path: string; basename: string; dir: string } | null, taken: (path: string) => boolean): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot) : "";
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const name = stem.startsWith("untitled") ? (map?.basename ?? PLUGIN_NAME) + stem.slice("untitled".length) : stem;
  const dir = map?.dir && map.dir !== "/" ? `${map.dir}/` : "";
  const own = map?.path.toLowerCase();
  const at = (n: number) => `${dir}${name}${n > 1 ? `-${n}` : ""}${ext}`;
  let n = 1;
  while (at(n).toLowerCase() === own || taken(at(n))) n++;
  return at(n);
}

/* ---------- links ---------- */

/** What the map does with a Markdown link's address. Web and email links open; an Obsidian link asks first,
 *  since it can open notes and run commands; anything else is refused, with the reason for a notice. */
export function linkAction(href: string): { action: "open" } | { action: "confirm" } | { action: "refuse"; reason: string } {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href.trim())?.[1]?.toLowerCase();
  if (scheme === "https" || scheme === "http" || scheme === "mailto") return { action: "open" };
  if (scheme === "obsidian") return { action: "confirm" };
  return { action: "refuse", reason: scheme ? `the map only opens web, email and Obsidian links, and this one is “${scheme}:”` : "the map only opens web, email and Obsidian links, and this address has no scheme" };
}

/** The `file` of each obsidian://open link in dragged text, decoded. A malformed escape (`file=bad%`) is skipped,
 *  not thrown: this runs on every dragover. */
export function obsidianOpenFiles(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/obsidian:\/\/open\?[^\s]*?file=([^&\s]+)/g)) {
    try { out.push(decodeURIComponent(m[1])); } catch { /* not a link that can be followed */ }
  }
  return out;
}
