// obsidian: WYSIWYG editing of a node. The contenteditable holds real <b>/<i>/<u>/<s>/<mark>/<code>/<a>
// elements while editing; the file and the layout only ever see Markdown. Rendering in is the inline
// parser; reading out gathers the DOM into styled stretches, writes them with balanced markers, and
// escapes a typed character only where it would otherwise read as formatting. Everything derives
// from the label's own document, so a map in a popped-out window edits like one in the main window.
import { ESCAPABLE, parseInline, traceInline, type Rich, type Run } from '../model/inline.ts'

const ELEMENT_NODE = 1
const TEXT_NODE = 3

/** Fill a label element with the rich rendering of Markdown text. */
export function renderInto(el: HTMLElement, text: string): void {
  el.textContent = ''
  el.appendChild(fragmentFor(el.ownerDocument, parseInline(text)))
  // What it was opened with: while the label still shows exactly that, that is what it reads back as.
  el.dataset.source = text
}

/** Parsed text as label nodes — what a label is filled with, and what pasted Markdown becomes. */
export function fragmentFor(doc: Document, rich: Rich): DocumentFragment {
  const frag = doc.createDocumentFragment()
  for (const run of rich.runs) {
    const t = rich.plain.slice(run.start, run.end)
    if (t) frag.appendChild(nodeFor(doc, t, run))
  }
  return frag
}

function nodeFor(doc: Document, t: string, run: Run): Node {
  let node: Node = doc.createTextNode(t)
  const wrap = (tag: string, data?: Record<string, string | undefined>) => {
    const e = doc.createElement(tag)
    for (const [k, v] of Object.entries(data ?? {})) if (v) e.dataset[k] = v
    e.appendChild(node)
    node = e
  }
  // Math, an HTML tag or an escape: the span remembers the source it was written as.
  if (run.raw) wrap('span', { raw: run.raw })
  if (run.code) wrap('code')
  if (run.b) wrap('b', { mark: run.bMark })
  if (run.i) wrap('i', { mark: run.iMark })
  if (run.u) wrap('u')
  if (run.s) wrap('s')
  if (run.mark) wrap('mark')
  if (run.href != null) {
    const a = doc.createElement('a')
    // An empty address (`[[|alias]]`) goes nowhere: it looks like text, as on the map, but reads back as the link it was.
    if (run.href) a.className = 'node-link'
    a.dataset.href = run.href
    if (run.wiki) a.dataset.wiki = '1'
    a.appendChild(node)
    node = a
  }
  return node
}

/* -------------------- reading the label back -------------------- */

/** How a stretch of label text looks. */
interface Look {
  b: boolean
  i: boolean
  u: boolean
  s: boolean
  mark: boolean
  code: boolean
  href?: string
  wiki: boolean
  /** Set when the bold or italic came from text written `__x__` / `_x_`. */
  bMark?: '__'
  iMark?: '_'
}
const PLAIN: Look = { b: false, i: false, u: false, s: false, mark: false, code: false, wiki: false }

/** A text node's worth of label, or a kept source span (`raw`) whose text is untouched. */
interface Piece {
  text: string
  look: Look
  raw?: string
}

function collect(node: Node, look: Look, out: Piece[]): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === TEXT_NODE) {
      if (child.textContent) out.push({ text: child.textContent, look })
      return
    }
    if (child.nodeType !== ELEMENT_NODE) return
    const el = child as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (tag === 'br') {
      out.push({ text: '\n', look })
      return
    }
    if (tag === 'div' || tag === 'p') {
      const last = out[out.length - 1]
      if (last && !last.text.endsWith('\n')) out.push({ text: '\n', look })
      collect(el, look, out)
      return
    }
    const raw = el.dataset?.raw
    if (raw && el.childNodes.length === 1 && el.firstChild?.nodeType === TEXT_NODE && el.textContent === parseInline(raw).plain) {
      out.push({ text: el.textContent, look, raw })
      return
    }
    collect(el, lookOf(el, tag, look), out)
  })
}

function lookOf(el: HTMLElement, tag: string, up: Look): Look {
  const css = el.style
  const weight = css?.fontWeight ?? ''
  const deco = `${css?.textDecorationLine ?? ''} ${css?.textDecoration ?? ''}`
  const look = { ...up }
  if (tag === 'b' || tag === 'strong' || /^(bold|bolder|[6-9]00)$/.test(weight)) {
    if (!up.b) look.bMark = el.dataset?.mark === '__' ? '__' : undefined
    look.b = true
  } else if (/^(normal|lighter|[1-5]00)$/.test(weight)) {
    look.b = false
    look.bMark = undefined
  }
  if (tag === 'i' || tag === 'em' || css?.fontStyle === 'italic') {
    if (!up.i) look.iMark = el.dataset?.mark === '_' ? '_' : undefined
    look.i = true
  } else if (css?.fontStyle === 'normal') {
    look.i = false
    look.iMark = undefined
  }
  if (tag === 'u' || /underline/.test(deco)) look.u = true
  if (tag === 's' || tag === 'strike' || tag === 'del' || /line-through/.test(deco)) look.s = true
  if (tag === 'mark') look.mark = true
  if (tag === 'code') look.code = true
  if (tag === 'a') {
    look.href = el.dataset?.href ?? el.getAttribute('href') ?? ''
    look.wiki = !!el.dataset?.wiki
  }
  return look
}

/** Read the edited DOM back as Markdown. */
export function domToMarkdown(root: HTMLElement): string {
  const pieces: Piece[] = []
  collect(root, PLAIN, pieces)
  // The browser keeps a trailing line break so the last line can hold the caret; it is not text.
  const last = pieces[pieces.length - 1]
  if (last && !last.raw && last.text.endsWith('\n')) {
    last.text = last.text.slice(0, -1)
    if (!last.text) pieces.pop()
  }
  const kept = plan(pieces, true, false)
  const target = runsOf(kept.segs)
  const source = root.dataset?.source
  if (source != null && shows(parseInline(source), target)) return source
  // Kept source spans and the `_` / `__` spellings first; each fallback only when it could differ.
  // Last, a link whose text the parser would read differently is written as its text.
  const tries: [Plan, boolean][] = [[kept, true]]
  if (kept.marked) tries.push([kept, false])
  if (kept.raw) tries.push([plan(pieces, false, false), false])
  const strict = plan(pieces, false, true)
  if (strict.dropped) tries.push([strict, false])
  let md = ''
  for (const [p, marks] of tries) {
    const out = attempt(p, p === strict ? runsOf(strict.segs) : target, marks)
    if (out.ok) return out.md
    md = out.md
  }
  return md
}

interface Part {
  text: string
  raw?: string
  /** Characters that may need a backslash: offset in `text`, and an id across the whole label. */
  cands: { j: number; id: number }[]
}
interface Seg {
  look: Look
  parts: Part[]
  text: string
}
interface Plan {
  segs: Seg[]
  /** How many candidate characters there are. */
  count: number
  /** The candidates at either end of a stretch of text — next to a marker, where a stall usually is. */
  edges: number[]
  /** Some bold or italic has a `__` / `_` spelling to try. */
  marked: boolean
  /** Some text is a kept source span. */
  raw: boolean
  /** Some link was written as plain text. */
  dropped: boolean
}

function sameLook(a: Look, b: Look): boolean {
  return a.b === b.b && a.i === b.i && a.u === b.u && a.s === b.s && a.mark === b.mark && a.code === b.code && a.href === b.href && a.wiki === b.wiki
}

/** Pieces as the stretches the Markdown is written in. `keepRaw`: kept source spans are written as
 *  they were, otherwise their text is ordinary text. `strict`: a link whose spelling the parser may
 *  read differently becomes its text. */
function plan(pieces: Piece[], keepRaw: boolean, strict: boolean): Plan {
  const merge = (segs: Seg[], look: Look, parts: Part[]) => {
    const prev = segs[segs.length - 1]
    if (prev && sameLook(prev.look, look)) prev.parts.push(...parts)
    else segs.push({ look, parts: [...parts], text: '' })
  }
  let segs: Seg[] = []
  for (const p of pieces) merge(segs, p.look, [{ text: p.text, raw: keepRaw ? p.raw : undefined, cands: [] }])
  // Code inside a link is just the link: the file has no way to say both.
  const written: Seg[] = []
  let dropped = false
  for (const seg of segs) {
    const text = seg.parts.map((x) => x.text).join('')
    let look = seg.look
    if (look.href != null) {
      // A wikilink keeps its address even when it is empty; the text standing in for it would change where the link goes.
      const href = look.wiki ? look.href.trim() : look.href || text
      // The parser ends a [[link]] at its first ]], and a [link] at its first ] (and reads [[ as a wikilink).
      const inner = text === href ? href : `${href}|${text}`
      const ok = look.wiki ? !!href && !href.includes('|') && `${inner}]]`.indexOf(']]') === inner.length : /^[^)\s]+$/.test(href) && !text.includes(']') && !text.startsWith('[')
      look = ok || !strict ? { ...look, href, code: false } : { ...look, href: undefined, wiki: false }
      dropped ||= !ok && strict
    }
    // Code and links are written whole: as their kept source when they are one untouched span of it.
    const raw = seg.parts.length === 1 ? seg.parts[0].raw : undefined
    const read = raw ? parseInline(raw).runs : []
    const whole = read.length === 1 && !!read[0].code === look.code && read[0].href === look.href ? raw : undefined
    const parts = look.code || look.href != null ? [{ text, raw: whole, cands: [] }] : seg.parts
    merge(written, look, parts)
  }
  segs = written
  let count = 0
  const edges: number[] = []
  for (const seg of segs) {
    seg.text = seg.parts.map((x) => x.text).join('')
    if (seg.look.code || seg.look.href != null) continue
    for (const part of seg.parts) {
      if (part.raw != null) continue
      const t = part.text
      for (let j = 0; j < t.length; j++) {
        if (!ESCAPABLE.includes(t[j]) || (t[j] === '!' && j + 1 < t.length && t[j + 1] !== '[')) continue
        if (j === 0 || j === t.length - 1) edges.push(count)
        part.cands.push({ j, id: count++ })
      }
    }
  }
  return { segs, count, edges, marked: pieces.some((p) => p.look.bMark || p.look.iMark), raw: pieces.some((p) => p.raw), dropped }
}

interface Target {
  plain: string
  runs: [number, string][]
}

function keyOf(r: { b?: boolean; i?: boolean; u?: boolean; s?: boolean; mark?: boolean; code?: boolean; href?: string; wiki?: boolean }): string {
  return `${r.b ? 'b' : ''}${r.i ? 'i' : ''}${r.u ? 'u' : ''}${r.s ? 's' : ''}${r.mark ? 'm' : ''}${r.code ? 'c' : ''}${r.href != null ? (r.wiki ? '[[' : '[') + r.href : ''}`
}

function pushRun(runs: [number, string][], end: number, key: string) {
  const prev = runs[runs.length - 1]
  if (prev && prev[1] === key) prev[0] = end
  else runs.push([end, key])
}

function runsOf(segs: Seg[]): Target {
  let plain = ''
  const runs: [number, string][] = []
  for (const seg of segs) {
    plain += seg.text
    pushRun(runs, plain.length, keyOf(seg.look))
  }
  return { plain, runs }
}

/** The parsed Markdown shows exactly the label's text and styles, and nothing became an embed. */
function shows(rich: Rich, want: Target): boolean {
  if (rich.embeds.length || rich.plain !== want.plain) return false
  const runs: [number, string][] = []
  for (const r of rich.runs) pushRun(runs, r.end, keyOf(r))
  return runs.length === want.runs.length && runs.every(([end, key], k) => end === want.runs[k][0] && key === want.runs[k][1])
}

const MARKS = ['b', 'i', 's', 'u', 'mark'] as const
const SPELL: Record<(typeof MARKS)[number], [string, string]> = { b: ['**', '**'], i: ['*', '*'], s: ['~~', '~~'], u: ['<u>', '</u>'], mark: ['==', '=='] }

/** Markdown for a plan with the candidates in `esc` escaped; `pos` gets where each candidate landed. */
function emit(p: Plan, marks: boolean, esc: Uint8Array): { md: string; pos: Int32Array } {
  let md = ''
  const pos = new Int32Array(p.count)
  // Open markers, outermost first. A stretch that drops one closes back to it and reopens the rest,
  // so the markers always nest — bold then italic across overlapping text included.
  const open: { k: (typeof MARKS)[number]; close: string }[] = []
  p.segs.forEach((seg, n) => {
    const look = seg.look
    let keep = 0
    while (keep < open.length && look[open[keep].k]) keep++
    for (let s = open.length - 1; s >= keep; s--) md += open[s].close
    open.length = keep
    // What lasts longest opens outermost, so it need not close and reopen around the rest.
    const lasts = (k: (typeof MARKS)[number]) => {
      let m = n
      while (m < p.segs.length && p.segs[m].look[k]) m++
      return m
    }
    for (const k of [...MARKS].sort((a, b) => lasts(b) - lasts(a))) {
      if (!look[k] || open.some((o) => o.k === k)) continue
      const [a, b] = marks && k === 'b' && look.bMark ? ['__', '__'] : marks && k === 'i' && look.iMark ? ['_', '_'] : SPELL[k]
      md += a
      open.push({ k, close: b })
    }
    if ((look.code || look.href != null) && seg.parts[0]?.raw != null) md += seg.parts[0].raw
    else if (look.code) md += codeSpan(seg.text)
    else if (look.href != null) md += look.wiki ? (seg.text === look.href ? `[[${look.href}]]` : `[[${look.href}|${seg.text}]]`) : `[${seg.text}](${look.href})`
    else
      for (const part of seg.parts) {
        if (part.raw != null) {
          md += part.raw
          continue
        }
        let from = 0
        for (const c of part.cands) {
          md += part.text.slice(from, c.j)
          if (esc[c.id]) md += '\\'
          pos[c.id] = md.length
          md += part.text[c.j]
          from = c.j + 1
        }
        md += part.text.slice(from)
      }
  })
  for (let s = open.length - 1; s >= 0; s--) md += open[s].close
  return { md, pos }
}

/** Backticks that fence `code`: a run length the code itself doesn't contain, padded when it
 *  starts or ends with a backtick (or with a space at both ends, which the padding would eat). */
function codeSpan(code: string): string {
  const inner = new Set((code.match(/`+/g) ?? []).map((r) => r.length))
  let n = 1
  while (inner.has(n)) n++
  const pad = code.startsWith('`') || code.endsWith('`') || (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && !!code.trim())
  const fence = '`'.repeat(n)
  return pad ? `${fence} ${code} ${fence}` : fence + code + fence
}

/** Escape what the parser read as syntax until the Markdown shows the label exactly, then take back
 *  any escape that turns out not to be needed. */
function attempt(p: Plan, target: Target, marks: boolean): { ok: boolean; md: string } {
  const esc = new Uint8Array(p.count)
  let edges = false
  for (;;) {
    const { md, pos } = emit(p, marks, esc)
    const { rich, shown } = traceInline(md)
    if (shows(rich, target)) return { ok: true, md: trim(p, target, marks, esc, md) }
    let added = false
    for (let id = 0; id < p.count; id++) if (!esc[id] && !shown[pos[id]]) { esc[id] = 1; added = true }
    if (!added && !edges) {
      edges = true
      for (const id of p.edges) if (!esc[id]) { esc[id] = 1; added = true }
    }
    if (!added) {
      if (esc.every(Boolean)) return { ok: false, md }
      esc.fill(1)
    }
  }
}

function trim(p: Plan, target: Target, marks: boolean, esc: Uint8Array, md: string): string {
  const on: number[] = []
  esc.forEach((v, id) => v && on.push(id))
  if (on.length > 16) return md
  for (let x = on.length - 1; x >= 0; x--) {
    esc[on[x]] = 0
    const out = emit(p, marks, esc).md
    if (shows(traceInline(out).rich, target)) md = out
    else esc[on[x]] = 1
  }
  return md
}

/* -------------------- editing commands -------------------- */

function inputOn(label: HTMLElement): void {
  const Ev = label.ownerDocument.defaultView?.Event ?? Event
  label.dispatchEvent(new Ev('input', { bubbles: true }))
}

/** obsidian: text pasted into a label. Markdown is read as Markdown, so a [[link]] or **bold** arrives
 *  as what it means; `literal` (⇧⌘V) puts the characters in as they are. */
export function pasteText(label: HTMLElement, text: string, literal: boolean): void {
  const doc = label.ownerDocument
  const rich = parseInline(text)
  const asIs = literal || rich.embeds.length > 0 || (rich.plain === text && !rich.runs.some((r) => r.b || r.i || r.u || r.s || r.mark || r.code || r.href || r.raw))
  // The browser's own insert keeps the label's undo history; only formatted text needs nodes.
  if (asIs) {
    doc.execCommand('insertText', false, text)
    return
  }
  const sel = doc.defaultView?.getSelection()
  const range = sel?.rangeCount ? sel.getRangeAt(0) : null
  if (!sel || !range || !label.contains(range.commonAncestorContainer)) return
  range.deleteContents()
  const frag = fragmentFor(doc, rich)
  const last = frag.lastChild
  range.insertNode(frag)
  if (last) {
    range.setStartAfter(last)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }
  inputOn(label)
}

/** obsidian: text dropped on the label being edited goes in as plain characters where it lands —
 *  never the page's markup, which would bring styles, links and remote images the file cannot hold. */
export function dropText(label: HTMLElement, x: number, y: number, text: string): void {
  const doc = label.ownerDocument
  const sel = doc.defaultView?.getSelection()
  if (!sel || !text) return
  const d = doc as unknown as { caretRangeFromPoint?(x: number, y: number): Range | null; caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null }
  let at = d.caretRangeFromPoint?.(x, y) ?? null
  if (!at) {
    const p = d.caretPositionFromPoint?.(x, y)
    if (p) {
      at = doc.createRange()
      at.setStart(p.offsetNode, p.offset)
    }
  }
  if (!at || !label.contains(at.startContainer)) {
    at = doc.createRange()
    at.selectNodeContents(label)
    at.collapse(false)
  }
  sel.removeAllRanges()
  sel.addRange(at)
  doc.execCommand('insertText', false, text)
}

/** Wrap the selection in `tag`, or unwrap if the caret already sits inside one. */
export function toggleInline(label: HTMLElement, tag: 'mark' | 'code' | 'a', attrs: Record<string, string> = {}): void {
  const doc = label.ownerDocument
  const sel = doc.defaultView?.getSelection()
  if (!sel || !sel.rangeCount) return
  const range = sel.getRangeAt(0)
  const common = range.commonAncestorContainer
  if (!label.contains(common)) return
  const anchor = common.nodeType === ELEMENT_NODE ? (common as Element) : common.parentElement
  const existing = anchor?.closest(tag)
  if (existing && label.contains(existing) && existing !== label) {
    const parent = existing.parentNode!
    while (existing.firstChild) parent.insertBefore(existing.firstChild, existing)
    parent.removeChild(existing)
    label.normalize()
    inputOn(label)
    return
  }
  const el = doc.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  if (range.collapsed) {
    el.textContent = tag === 'a' ? 'Note' : ' '
    range.insertNode(el)
    const r = doc.createRange()
    r.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(r)
  } else {
    try {
      range.surroundContents(el)
    } catch {
      const text = range.toString()
      range.deleteContents()
      el.textContent = text
      range.insertNode(el)
    }
    if (tag === 'a' && !attrs['data-href']) el.setAttribute('data-href', el.textContent ?? '')
    const r = doc.createRange()
    r.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(r)
  }
  inputOn(label)
}
