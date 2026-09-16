import type { DocLook } from './types'
/**
 * obsidian: Markdown is the map's file format.
 *
 *   ---
 *   ideascape: 1             ← the marker the plugin opens on (other keys are preserved)
 *   ---
 *   # Plan a small trip ^r1  ← the root; the id is an Obsidian block id
 *   - Where ^a1              ← children are a nested list, in sibling order
 *     - Lisbon ^a2
 *   1. First ^b1             ← numbered items and tasks are what they are in any note
 *   - [x] Book it ^c1
 *   %%ideascape              ← geometry the list cannot hold, in an Obsidian comment
 *   {"v":1,"pos":{"a1":[-190,-150]},"collapsed":[],"links":[],"align":{},"branch":{}}
 *   %%
 *
 * Any nested-list Markdown opens (ids are minted, positions laid out later). Round-trips
 * through this module are exact. A note's own text — before, between and after the items,
 * and after the geometry block — is kept where it was; fenced code in an item is kept as it
 * is, and a list line in the note's own code, comments or math is never an item. The last
 * layout block is the one read.
 * Maps written before the plugin had its own name say `idea-map:` and `%%ideamap`; they read the
 * same and keep what they say (see MAP_FORMATS).
 * The same file reads as an outline in Obsidian, mobile, git, Logseq, Workflowy, and
 * every node is block-linkable: [[Plan a small trip#^a2]].
 */
import type { Align, FreeLink, IODoc, IONode, NodeId } from './types.ts'
import { lookFromFile, lookToFile, makeNode, ordinalOf } from './doc.ts'

/** obsidian: how a map note is marked and how its layout block opens. New maps are written with the first,
 *  the plugin's id. A note written with an earlier one reads the same and is written back with its own,
 *  so opening a map never rewrites it just to rename the marker. */
export const MAP_FORMATS = [
  { key: 'ideascape', block: '%%ideascape' },
  { key: 'idea-map', block: '%%ideamap' },
] as const
/** The key new maps are written with. */
export const MARKER = MAP_FORMATS[0].key
const KEY_ALT = MAP_FORMATS.map((f) => f.key).join('|')
const BLOCK_ALT = MAP_FORMATS.map((f) => f.block).join('|')
const BLOCK_LINE_RE = new RegExp(`^(?:${BLOCK_ALT})\\s*$`)

/** Frontmatter as Obsidian's metadata cache reads it carries one of the map keys. */
export function hasMapKey(fm: Record<string, unknown> | undefined): boolean {
  return !!fm && MAP_FORMATS.some((f) => Object.hasOwn(fm, f.key))
}
/** A line that opens a layout block, whichever format wrote it. */
export function isLayoutBlockLine(line: string): boolean {
  return BLOCK_LINE_RE.test(line)
}
const blockFor = (key: string | undefined): string => MAP_FORMATS.find((f) => f.key === key)?.block ?? MAP_FORMATS[0].block

interface Geometry {
  v: 1
  look?: DocLook
  pos?: Record<string, [number, number]>
  collapsed?: string[]
  links?: [string, string][]
  align?: Record<string, Align>
  branch?: Record<string, number>
  width?: Record<string, number>
  size?: Record<string, number>
  side?: Record<string, -1 | 1>
}

export interface MdExtras {
  /** obsidian: the file's basename; a root that equals it is not written as an H1, unless the file had one. */
  basename?: string
  frontmatter?: string // raw lines between the fences, marker included
  preamble?: string // text between frontmatter and the heading
  /** The file's own `# heading` was read as the root: written back, with its block id when it had one. */
  heading?: 'plain' | 'id'
  /** The note's text between the heading and the list — paragraphs, other headings — kept as it is. */
  intro?: string
  /** The note's text between two items, kept as it is and written after the node it followed: after
   *  its whole branch, or — when it came before that node's first child — ahead of its children. */
  between?: { after: NodeId; text: string; beforeChildren?: true }[]
  postscript?: string // text after the list and before the geometry block
  /** Text after the geometry block — an "append to note" lands here — written back after it. */
  trailer?: string
  /** A geometry block whose JSON would not parse, kept and written back exactly as it was. */
  rawGeometry?: string
  /** Windows line endings, when the file had them; the file is written back with them. */
  eol?: '\r\n'
  /** The map key the file was marked with, and the line its layout block opened with: written back as they were. */
  key?: string
  block?: string
}

const ID_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/
const ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
/** `[ ]`, `[x]` or any single-character state at the head of an item, as Obsidian reads it. */
const TASK_RE = /^\[(.)\](?:\s+|$)/
const H1_RE = /^#\s+(.*)$/
/** A line the writer escapes because it would otherwise read as a list item, heading or quote. */
const BLOCK_RE = /^(\s*)([-*+>#]|\d+[.)])(\s|$)/
/** A heading of any level; under the root's heading it is the note's own, never the root's. */
const HEADING_RE = /^\s*#{1,6}(\s|$)/
/** A code fence — three or more backticks or tildes — opening a block of code. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
const closesFence = (open: string, line: string) => {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)
  return !!m && m[1][0] === open[0] && m[1].length >= open.length
}
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export function newMdId(taken: Set<string>): string {
  let id = ''
  do id = Math.random().toString(36).slice(2, 8)
  while (taken.has(id) || id.length < 6)
  taken.add(id)
  return id
}

export function isMarkdownMap(src: string): boolean {
  const m = FM_RE.exec(src)
  return !!m && new RegExp(`^(?:${KEY_ALT})\\s*:`, 'm').test(m[1])
}

/* ------------------------------------------------------------------ write */

/** A line of text escaped where it would read as something else: a list item, heading or quote, an
 *  escape of its own (a leading backslash), or nothing at all (an empty line). With `fences`, a code
 *  fence that is not part of fenced code in the text is escaped too, so it cannot open a code block
 *  that runs over the rest of the note; the root's lines keep their fences as they are. */
function escapeLine(line: string, fences = true): string {
  const l = BLOCK_RE.test(line) || /^\s*\\/.test(line) || (fences && /^\s*(```|~~~)/.test(line)) ? line.replace(/^(\s*)/, '$1\\') : line === '' ? '\\' : line
  return l
}
/** The root's lines sit at the start of a line: one reading as a layout block's opening line would open one,
 *  and a heading would read as the note's own text. */
export function escapeRootLine(line: string): string {
  return BLOCK_LINE_RE.test(line) || HEADING_RE.test(line) ? line.replace(/^(\s*)/, '$1\\') : escapeLine(line, false)
}
/** A line that will not carry the block id must not end in a bare ^word, or the reader would take it for one. */
export function guardCaret(line: string): string {
  return line.replace(/(^|\s)\^([A-Za-z0-9-]+)\s*$/, '$1\\^$2')
}

/** The head of an item line: its marker, its task box, its heading level, its first line of text —
 *  what `- [x] ## Done ^id` is made of. The text is escaped where it would otherwise read as one
 *  of those parts on the way back in. */
function itemHead(doc: IODoc, n: IONode, rawFirst: string): string {
  const marker = n.ordered ? `${ordinalOf(doc, n.id) ?? 1}.` : '-'
  const task = n.task != null ? `[${n.task}] ` : ''
  const guardTask = (t: string) => (n.task == null && TASK_RE.test(t) ? `\\${t}` : t)
  // An empty heading is just its hashes, so it reads back as a heading; text that is only hashes is escaped.
  const first = n.size ? (rawFirst ? `${'#'.repeat(n.size)} ${guardTask(rawFirst)}` : '#'.repeat(n.size)) : /^#{1,6}(\s|$)/.test(rawFirst) || rawFirst.startsWith('\\') ? `\\${rawFirst}` : guardTask(rawFirst)
  return `${marker} ${task}${first}`
}
/** Reads the parts `itemHead` wrote: task box and heading level in either order, then the text. */
function readItemHead(t0: string): { text: string; task?: string; size?: 1 | 2 | 3 } {
  let t = t0
  let task: string | undefined
  let size: 1 | 2 | 3 | undefined
  const takeTask = () => {
    const tm = TASK_RE.exec(t)
    if (tm && task == null) { task = tm[1]; t = t.slice(tm[0].length) }
  }
  takeTask()
  const hm = /^(#{1,3})(?:\s+([\s\S]*))?$/.exec(t)
  if (hm) { size = hm[1].length as 1 | 2 | 3; t = hm[2] ?? '' }
  takeTask()
  return { text: t, ...(task != null ? { task } : {}), ...(size ? { size } : {}) }
}

/**
 * For each line that opens a code fence, the index of the line that closes it; -1 when nothing closes
 * it before the end or before a line ending in a block id. The writer and the reader pair a node's
 * fences with this one rule, so fenced code always reads back as the code that was written.
 * Linear: once a fence finds nothing, later fences of its kind, no shorter, fail without a second look.
 */
function pairFences(lines: string[]): number[] {
  const close = lines.map(() => -1)
  const failed = new Map<string, { len: number; until: number }>()
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_RE.exec(lines[i])
    if (!open) continue
    const f = open[1]
    const memo = failed.get(f[0])
    if (memo && i < memo.until && f.length >= memo.len) continue
    let j = i + 1
    while (j < lines.length && !ID_RE.test(lines[j]) && !closesFence(f, lines[j])) j++
    if (j < lines.length && closesFence(f, lines[j])) {
      close[i] = j
      i = j
    } else failed.set(f[0], { len: f.length, until: j })
  }
  return close
}

/** Which of a node's lines are fenced code, from an opening fence to the one that closes it. A fence
 *  that nothing closes is ordinary text, and is escaped. */
function codeLines(lines: string[]): boolean[] {
  const code = lines.map(() => false)
  pairFences(lines).forEach((j, i) => { if (j >= 0) code.fill(true, i, j + 1) })
  return code
}

/** A block of the note's own text that holds its lines as they are: fenced code, a `%%` comment, an
 *  HTML comment or a `$$` block, opened at the start of a line. The map says what closes each. */
const NOTE_BLOCK_RE = /^( {0,3})(?:(`{3,}|~{3,})|(%%)|(<!--)|(\$\$))/
const NOTE_BLOCK_CLOSE: Record<string, string> = { '%%': '%%', '<!--': '-->', '$$': '$$' }

/**
 * The note's blocks outside any item, as the reader meets them: `end(i)` is the line that closes the
 * block line `i` opens, or -1 when it opens none. Nothing inside one is an item. The closing line is
 * indented no further than the opening one and is not an item, and a line ending in a block id
 * stops the search, as in `pairFences`: every item the map writes has one, so a stray opener in the
 * note's text or the root can never swallow the map's own items. A block nothing closes is text.
 */
function noteBlocks(lines: string[]): (i: number) => number {
  const failed = new Map<string, { len: number; lead: number; until: number }>()
  return (i) => {
    const m = NOTE_BLOCK_RE.exec(lines[i])
    if (!m) return -1
    const lead = m[1].length
    const fence = m[2]
    const open = fence ?? m[3] ?? m[4] ?? m[5]
    const close = fence ? '' : NOTE_BLOCK_CLOSE[open]
    // A comment or math block that closes on its own line is inline text.
    if (!fence && lines[i].includes(close, lead + open.length)) return -1
    const kind = fence ? fence[0] : open
    const memo = failed.get(kind)
    if (memo && i < memo.until && open.length >= memo.len && lead <= memo.lead) return -1
    let j = i + 1
    let itemLead = -1
    for (; j < lines.length && !ID_RE.test(lines[j]); j++) {
      const l = lines[j]
      const at = leadOf(l).length
      if (ITEM_RE.test(l)) itemLead = at
      // A line under an item belongs to that item: it can't close a block opened outside it.
      if (at > lead || (itemLead >= 0 && at > itemLead)) continue
      if (fence ? closesFence(fence, l) : l.includes(close) && !ITEM_RE.test(l)) return j
    }
    failed.set(kind, { len: open.length, lead, until: j })
    return -1
  }
}
const leadOf = (s: string) => /^\s*/.exec(s)![0]

/**
 * A node as list lines: the head, then its other lines indented under it. Fenced code is written
 * exactly as it is. `id` is the block id: at the end of the last line, or on the head when the node is
 * one line or its last line is code — a closing fence may not carry anything after it. Spaces before
 * the id are dropped, as the reader drops them, so the line reads back as it was written.
 */
export function itemLines(doc: IODoc, n: IONode, indent: string, id?: NodeId): string[] {
  const [rawFirst, ...rest] = (n.text || '').split('\n')
  const code = codeLines(rest)
  const onHead = id != null && (!rest.length || code[rest.length - 1])
  const out = [onHead ? `${indent}${itemHead(doc, n, rawFirst.trimEnd())} ^${id}` : `${indent}${guardCaret(itemHead(doc, n, rawFirst))}`]
  rest.forEach((l, i) => {
    if (code[i]) out.push(l.trim() ? `${indent}  ${l}` : '')
    else if (id != null && !onHead && i === rest.length - 1) out.push(`${indent}  ${escapeLine(l.trimEnd())} ^${id}`)
    else out.push(`${indent}  ${guardCaret(escapeLine(l))}`)
  })
  return out
}

function ensureMarker(fm: string | undefined, rootId: string, key: string = MARKER): string {
  const body = (fm ?? '').replace(/\s+$/, '')
  const line = `${key}: ${rootId}`
  const re = new RegExp(`^${key}\\s*:.*$`, 'm')
  if (re.test(body)) return body.replace(re, line)
  return body ? `${line}\n${body}` : line
}

/**
 * The given nodes and their subtrees as a plain nested list — what ⌘C puts on
 * the clipboard. No block ids, so it pastes cleanly into any note or back into
 * a map (where fresh ids are minted), and heading sizes travel as `## text`.
 */
export function toMarkdownList(doc: IODoc, ids: NodeId[]): string {
  const out: string[] = []
  const walk = (id: NodeId, depth: number) => {
    const n = doc.nodes[id]
    if (!n) return
    out.push(...itemLines(doc, n, '  '.repeat(depth)))
    for (const c of n.children) walk(c, depth + 1)
  }
  for (const id of ids) walk(id, 0)
  return out.join('\n') + (out.length ? '\n' : '')
}

/**
 * Clipboard text as a forest of nodes. A nested list becomes the tree it
 * describes; an `# H1` above the list is a node too; anything without list
 * markers is one node per non-empty line. The result is a detached doc whose
 * root's children are the pasted top-level nodes (see `graft`).
 */
export function fromClipboardText(text: string): IODoc | null {
  const src = text.replace(/\r\n?/g, '\n')
  if (!src.trim()) return null
  const hasList = src.split('\n').some((l) => ITEM_RE.test(l))
  const hasH1 = src.split('\n').some((l) => H1_RE.test(l))
  if (hasList || hasH1) {
    const d = fromMarkdownMap(src, '')
    if (hasH1) {
      // The heading is a node in its own right: wrap it so the root stays a carrier.
      const carrier = makeNode({ id: newMdId(new Set(Object.keys(d.nodes))), text: '' })
      d.nodes[d.rootId].parent = carrier.id
      carrier.children = [d.rootId]
      d.nodes[carrier.id] = carrier
      return { ...d, rootId: carrier.id }
    }
    // With every list line inside code or a comment, the text pastes line by line, as below.
    if (d.nodes[d.rootId].children.length) return d
  }
  const lines = src.split('\n').map((l) => l.trim()).filter(Boolean)
  const d = fromMarkdownMap(lines.map((l) => `- ${escapeLine(l)}`).join('\n') + '\n', '')
  return d.nodes[d.rootId].children.length ? d : null
}

export function toMarkdownMap(doc: IODoc, extras: MdExtras = (doc as IODoc & { md?: MdExtras }).md ?? {}): string {
  const out: string[] = []
  const root = doc.nodes[doc.rootId]
  out.push('---', ensureMarker(extras.frontmatter, root.id, extras.key), '---')
  if (extras.preamble?.trim()) out.push(extras.preamble.replace(/\s+$/, ''), '')
  const [rootHead, ...rootRest] = (root.text || doc.name || 'Untitled').split('\n')
  const titled = !extras.basename || !!extras.heading || rootRest.length > 0 || rootHead !== extras.basename
  if (titled) {
    out.push(`# ${guardCaret(rootHead)}${extras.heading === 'id' ? ` ^${root.id}` : ''}`)
    for (let i = 0; i < rootRest.length; i++) out.push(guardCaret(escapeRootLine(rootRest[i])))
  }
  if (extras.intro?.trim()) out.push(extras.intro)
  else if (titled) out.push('')
  // The note's own text between items follows the node it came after; if that node is gone, it moves to the end.
  const between = new Map<string, string[]>()
  for (const b of extras.between ?? []) {
    const key = `${b.beforeChildren ? '>' : ''}${b.after}`
    between.set(key, [...(between.get(key) ?? []), b.text])
  }
  const take = (key: string) => {
    const text = between.get(key)
    if (text) out.push(...text)
    between.delete(key)
  }
  const walk = (id: NodeId, depth: number) => {
    const n = doc.nodes[id]
    if (!n) return
    out.push(...itemLines(doc, n, '  '.repeat(depth), n.id))
    take(`>${id}`)
    for (const c of n.children) walk(c, depth + 1)
    take(id)
  }
  for (const c of root.children) walk(c, 0)
  for (const t of [...[...between.values()].flat(), extras.postscript ?? '']) {
    const kept = t.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')
    if (kept) out.push('', kept)
  }

  // Geometry in tree order, so the file is byte-stable however the nodes were inserted.
  const pos: Record<string, [number, number]> = {}
  const align: Record<string, Align> = {}
  const branch: Record<string, number> = {}
  const width: Record<string, number> = {}
  const size: Record<string, number> = {}
  const side: Record<string, -1 | 1> = {}
  if (root.size) size[root.id] = root.size
  for (const c of root.children) if (doc.nodes[c]?.side) side[c] = doc.nodes[c].side!
  const visit = (id: NodeId) => {
    const n = doc.nodes[id]
    if (!n) return
    pos[n.id] = [Math.round(n.x), Math.round(n.y)]
    if (n.align) align[n.id] = n.align
    if (n.width) width[n.id] = Math.round(n.width)
    for (const c of n.children) visit(c)
  }
  visit(doc.rootId)
  for (const n of Object.values(doc.nodes)) if (!Object.hasOwn(pos, n.id)) pos[n.id] = [Math.round(n.x), Math.round(n.y)] // orphans, defensively
  root.children.forEach((c, i) => {
    const b = doc.nodes[c]?.branch
    if (b != null && b !== i % 8) branch[c] = b
  })
  // The map's own look, only the keys it pins, so an unpinned map's file is unchanged.
  const look = lookToFile(doc.look)
  const g: Geometry = {
    v: 1,
    pos,
    collapsed: Object.values(doc.nodes).filter((n) => n.collapsed).map((n) => n.id).sort(),
    links: doc.links.map((l) => [l.from, l.to] as [string, string]),
    align,
    branch,
    ...(Object.keys(width).length ? { width } : {}),
    ...(Object.keys(size).length ? { size } : {}),
    ...(Object.keys(side).length ? { side } : {}),
    ...(Object.keys(look).length ? { look } : {}),
  }
  out.push('', extras.block ?? blockFor(extras.key), extras.rawGeometry ?? JSON.stringify(g), '%%')
  if (extras.trailer) out.push(extras.trailer)
  out.push('')
  return extras.eol ? out.join('\n').replace(/\n/g, extras.eol) : out.join('\n')
}

/* ------------------------------------------------------------------- read */

export function fromMarkdownMap(src: string, fallbackName = 'Untitled'): IODoc & { md: MdExtras; needsLayout: boolean; unplaced?: NodeId[] } {
  let text = src.replace(/\r\n?/g, '\n')
  const extras: MdExtras = {}
  // obsidian: a note written on Windows keeps its line endings; the first line break decides.
  if (/^[^\n]*\r\n/.test(src)) extras.eol = '\r\n'
  const fm = FM_RE.exec(text)
  let markerId: string | null = null
  if (fm) {
    extras.frontmatter = fm[1]
    const key = new RegExp(`^(${KEY_ALT})\\s*:`, 'm').exec(fm[1])?.[1]
    if (key) extras.key = key
    const mv = key ? new RegExp(`^${key}\\s*:\\s*([A-Za-z0-9-]+)\\s*$`, 'm').exec(fm[1]) : null
    if (mv && mv[1] !== '1' && mv[1] !== 'true') markerId = mv[1]
    text = text.slice(fm[0].length)
  }
  extras.basename = fallbackName
  let geometry: Record<string, unknown> | null = null
  const block = findGeometry(text)
  if (block) {
    let g: unknown = null
    try { g = JSON.parse(block.body) } catch { g = null }
    // Unreadable JSON (a stray comma from a hand edit or a merge) is kept, not replaced by a fresh layout.
    if (isRecord(g)) geometry = g
    else extras.rawGeometry = block.body
    if (block.after.trim()) extras.trailer = block.after.replace(/\s+$/, '')
    extras.block = block.open
    text = text.slice(0, block.start)
  }

  const lines = text.split('\n')
  const taken = new Set<string>()
  const nodes: Record<NodeId, IONode> = {}
  const order: NodeId[] = []
  const stripId = (s: string): [string, string | null] => {
    const m = ID_RE.exec(s)
    return m ? [s.slice(0, m.index).replace(/\s+$/, ''), m[1]] : [s, null]
  }
  const unescape = (l: string) => l.replace(/^(\s*)\\/, '$1').replace(/(^|\s)\\\^([A-Za-z0-9-]+)$/, '$1^$2')
  const mint = (want: string | null) => {
    if (want && !taken.has(want)) { taken.add(want); return want }
    return newMdId(taken)
  }

  // 1. preamble, heading, and the note's text between the heading and the list
  const indentOf = (s: string) => s.replace(/\t/g, '    ').length
  // Fenced code, comments and math in the note's own text: a list line or a `# line` inside one is not the map's.
  const blockEnd = noteBlocks(lines)
  let listStart = 0
  while (listStart < lines.length && !ITEM_RE.test(lines[listStart])) listStart = Math.max(listStart, blockEnd(listStart)) + 1
  let h1 = -1
  for (let k = 0; k < listStart && h1 < 0; k++) {
    const end = blockEnd(k)
    if (end >= 0) k = end
    else if (H1_RE.test(lines[k])) h1 = k
  }
  let rootText: string | null = null
  let rootId: string | null = null
  const rootRest: string[] = []
  let pending: string[] = [] // lines that are not part of any item, since the last one
  const pre = lines.slice(0, h1 < 0 ? listStart : h1)
  if (pre.join('\n').trim()) extras.preamble = pre.join('\n').replace(/\s+$/, '')
  if (h1 >= 0) {
    const [t, id] = stripId(H1_RE.exec(lines[h1])![1])
    rootText = unescape(t)
    rootId = id
    extras.heading = id ? 'id' : 'plain'
    // The root's own further lines sit right under the heading, up to a blank line. A line the writer
    // would have escaped (a heading, a quote) is the note's own text, and so is everything after the blank.
    // A block (the root's own code, say) is the root's only when every line of it could be.
    const rootLine = (l: string) => l.trim() !== '' && !BLOCK_RE.test(l) && !HEADING_RE.test(l)
    let k = h1 + 1
    for (; k < listStart && rootLine(lines[k]); k++) {
      const end = blockEnd(k)
      if (end >= 0 && !lines.slice(k, end + 1).every(rootLine)) break
      for (const last = Math.max(k, end); k < last; k++) rootRest.push(unescape(lines[k]))
      rootRest.push(unescape(lines[k]))
    }
    // With no list at all, what follows is written after the (empty) list, as the writer puts it.
    const intro = lines.slice(k, listStart).join('\n')
    if (intro.trim() && listStart < lines.length) extras.intro = intro
    else pending.push(...lines.slice(k, listStart))
  }
  let i = listStart
  const root = makeNode({ id: mint(rootId ?? markerId), text: [rootText ?? fallbackName, ...rootRest].join('\n') })
  nodes[root.id] = root
  order.push(root.id)

  // 2. the list, with the note's own text between and after its items kept in place
  const stack: { indent: number; id: NodeId }[] = []
  let last: IONode | null = null // the item that more-indented lines continue
  let lastIndent = 0
  let ownId = false // whether `last` has the id the file gave it
  let prev: IONode | null = null // the last item read, whatever came after it
  const between: NonNullable<MdExtras['between']> = []
  const isText = (l: string) => l.trim() !== ''
  /** A continuation line without the item's indentation; indentation beyond it (code) is kept. */
  const dedent = (l: string) => {
    const lead = leadOf(l)
    return ' '.repeat(Math.max(0, indentOf(lead) - lastIndent - 2)) + l.slice(lead.length)
  }
  /** Fences in the item's indented lines, paired as the writer pairs them (see `pairFences`), from
   *  the first fence on: `from` is the line they start at. Worked out once per item. */
  let fences: { from: number; close: number[] } | null = null
  const fenceEnd = (at: number): number => {
    if (!fences) {
      let end = at
      while (end < lines.length && (!isText(lines[end]) || indentOf(leadOf(lines[end])) > lastIndent)) end++
      fences = { from: at, close: pairFences(lines.slice(at, end).map((l) => (isText(l) ? dedent(l) : ''))) }
    }
    const j = fences.close[at - fences.from] ?? -1
    return j < 0 ? -1 : fences.from + j
  }
  for (; i < lines.length; i++) {
    const line = lines[i]
    const m = ITEM_RE.exec(line)
    if (m) {
      const indent = indentOf(m[1])
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
      const parent = stack.length ? stack[stack.length - 1].id : root.id
      if (prev && pending.some(isText)) between.push({ after: prev.id, text: pending.join('\n'), ...(parent === prev.id ? { beforeChildren: true as const } : {}) })
      pending = []
      const [t0, id] = stripId(m[3])
      const { text: t, task, size } = readItemHead(t0)
      const n = makeNode({ id: mint(id), text: unescape(t), parent, ...(size ? { size } : {}), ...(task != null ? { task } : {}), ...(/\d/.test(m[2]) ? { ordered: true as const } : {}) })
      nodes[n.id] = n
      nodes[parent].children.push(n.id)
      order.push(n.id)
      stack.push({ indent, id: n.id })
      last = prev = n
      lastIndent = indent
      ownId = n.id === id
      fences = null
      continue
    }
    if (last && isText(line) && indentOf(leadOf(line)) > lastIndent && !pending.some(isText)) {
      pending = []
      // Fenced code in the item's text is kept line for line: no escapes, no block ids. A line that is
      // only a backslash is a blank line as an older version wrote one.
      const end = FENCE_RE.test(dedent(line)) ? fenceEnd(i) : -1
      if (end >= 0) {
        for (; i <= end; i++) last.text += '\n' + (isText(lines[i]) ? dedent(lines[i]).replace(/^\\$/, '') : '')
        i = end
        continue
      }
      const [t, id] = stripId(dedent(line).replace(/\s+$/, ''))
      last.text += '\n' + unescape(t)
      // The id at the end of a multi-line item's text is its block id — unless the item already has one.
      if (id && !ownId) {
        ownId = true
        if (!taken.has(id)) {
          const p = nodes[last.parent!].children
          taken.delete(last.id)
          delete nodes[last.id]
          taken.add(id)
          last.id = id
          nodes[id] = last
          stack[stack.length - 1].id = id
          p[p.length - 1] = id
          order[order.length - 1] = id
        }
      }
      continue
    }
    // The note's own code, comment or math between items: kept whole, however its lines look.
    for (const end = blockEnd(i); i < end; i++) pending.push(lines[i])
    pending.push(lines[i])
    if (isText(line)) last = null
  }
  if (between.length) extras.between = between
  const post = pending.join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')
  if (post) extras.postscript = post

  // 3. branch colours: children of the root each start a branch; everyone else inherits
  for (const id of order) {
    const n = nodes[id]
    if (!n.parent) n.branch = null
    else if (n.parent === root.id) n.branch = root.children.indexOf(id) % 8
    else n.branch = nodes[n.parent].branch
  }
  // Every key in the block comes from the file: only a node's own id counts (never "__proto__" or
  // "constructor"), and every value is checked before it lands on a node.
  const has = (id: unknown): id is NodeId => typeof id === 'string' && Object.hasOwn(nodes, id)
  const links: FreeLink[] = []
  let needsLayout = true
  let unplaced: NodeId[] | undefined
  if (geometry) {
    const placed = new Set<NodeId>()
    for (const [id, p] of entries(geometry.pos)) {
      if (!has(id) || !Array.isArray(p) || !isCoord(p[0]) || !isCoord(p[1])) continue
      nodes[id].x = p[0]
      nodes[id].y = p[1]
      placed.add(id)
    }
    // Some nodes placed: the rest (an item typed in the editor, or synced in) are placed beside them later.
    if (placed.size) {
      unplaced = order.filter((id) => !placed.has(id))
      needsLayout = unplaced.length > 0
    }
    for (const id of list(geometry.collapsed)) if (has(id) && nodes[id].children.length) nodes[id].collapsed = true
    for (const l of list(geometry.links)) if (Array.isArray(l) && has(l[0]) && has(l[1]) && l[0] !== l[1]) links.push({ id: `${l[0]}-${l[1]}`, from: l[0], to: l[1] })
    for (const [id, a] of entries(geometry.align)) if (has(id) && (a === 'left' || a === 'center' || a === 'right')) nodes[id].align = a
    for (const [id, w] of entries(geometry.width)) if (has(id) && typeof w === 'number' && Number.isFinite(w) && w > 0) nodes[id].width = w
    for (const [id, z] of entries(geometry.size)) if (has(id) && (z === 1 || z === 2 || z === 3)) nodes[id].size = z
    for (const [id, s] of entries(geometry.side)) if (has(id) && nodes[id].parent === root.id && (s === -1 || s === 1)) nodes[id].side = s
    for (const [id, b] of entries(geometry.branch)) {
      if (!has(id) || nodes[id].parent !== root.id || !isBranch(b)) continue
      for (const sid of subtree(nodes, id)) nodes[sid].branch = b
    }
  }
  const look = lookFromFile(geometry?.look)
  const now = Date.now()
  return { id: root.id, name: rootText ?? fallbackName, rootId: root.id, nodes, links, createdAt: now, updatedAt: now, md: extras, needsLayout, ...(unplaced?.length ? { unplaced } : {}), ...(Object.keys(look).length ? { look } : {}) }
}

/**
 * The geometry block: the last layout block opening line (`%%ideascape`, or `%%ideamap` in older maps) that
 * a `%%` line closes. `start` is where the text before it ends (the newline ahead of the block), `open` the opening
 * line without trailing space, `body` what sits between the two lines, and `after` the text after the closing line.
 */
/** The character offsets a fenced code block covers, so text quoting the format is not mistaken for it. */
function fencedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  let at = 0
  let fence: { mark: string; from: number } | null = null
  let inComment = false
  // One walk, in the order a reader takes the note: inside fenced code only a closing fence counts, inside an
  // Obsidian comment only a %% line counts, and a comment that opens and closes on one line changes nothing.
  for (const line of text.split('\n')) {
    const end = at + line.length
    if (fence) {
      if (closesFence(fence.mark, line)) {
        ranges.push([fence.from, end])
        fence = null
      }
    } else if (inComment) {
      if (/^%%/.test(line)) inComment = false
    } else {
      const m = FENCE_RE.exec(line)
      if (m) fence = { mark: m[1], from: at }
      else if (/^%%/.test(line) && !line.slice(2).includes('%%')) inComment = true
    }
    at = end + 1
  }
  // A fence nothing closes runs to the end of the note, the way a reader sees it.
  if (fence) ranges.push([fence.from, text.length])
  return ranges
}

function findGeometry(text: string): { start: number; open: string; body: string; after: string } | null {
  // The newline ahead of the line is matched, not looked behind for: older iOS has no lookbehind.
  const fenced = fencedRanges(text)
  const inCode = (i: number) => fenced.some(([from, to]) => i >= from && i < to)
  const all = [...text.matchAll(new RegExp(`(?:^|\\n)((?:${BLOCK_ALT})[ \\t]*)(?=\\n)`, 'g'))]
    .map((m) => ({ index: m.index + m[0].length - m[1].length, line: m[1] }))
  // A note that documents the format must not have its own layout read out of the example. Where every candidate
  // sits in code — a note whose fence is never closed, with the map's own block after it — the block is still the
  // map's, and losing every position to a stray fence would be the worse answer.
  const loose = all.filter((o) => !inCode(o.index))
  // When nothing is loose, code stops counting for this note: the block and the %% that closes it both sit in it.
  const strict = loose.length > 0
  const opens = strict ? loose : all
  for (let k = opens.length - 1; k >= 0; k--) {
    const o = opens[k]
    const bodyStart = o.index + o.line.length + 1
    const close = /^%%[ \t]*$/gm
    close.lastIndex = bodyStart
    let c = close.exec(text)
    while (c && strict && inCode(c.index)) c = close.exec(text)
    if (!c) continue
    return {
      start: Math.max(0, o.index - 1),
      open: o.line.trimEnd(),
      body: text.slice(bodyStart, Math.max(bodyStart, c.index - 1)),
      after: text.slice(c.index + c[0].length).replace(/^\n/, ''),
    }
  }
  return null
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const entries = (v: unknown): [string, unknown][] => (isRecord(v) ? Object.entries(v) : [])
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
/** A usable coordinate: a finite number, and not so far out that fitting the map to the window breaks. */
const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7
/** Theme branches 0–7, then the map's own colour slots 8–11. */
const isBranch = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 12

function subtree(nodes: Record<NodeId, IONode>, id: NodeId): NodeId[] {
  const out: NodeId[] = []
  const visit = (x: NodeId) => { out.push(x); for (const c of nodes[x]?.children ?? []) visit(c) }
  visit(id)
  return out
}
