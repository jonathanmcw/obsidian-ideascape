import type { IODoc, IONode, LayoutKind, NodeId } from '../model/types.ts'
import { parseInline, plainText, type Embed } from '../model/inline.ts'
import { ordinalOf } from '../model/doc.ts'

const FONT_STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "PingFang TC", "Noto Sans TC", sans-serif` // obsidian: system stack, matches styles.css

let ctx: CanvasRenderingContext2D | null = null
function measurer(): CanvasRenderingContext2D {
  if (!ctx) {
    // obsidian: activeDocument follows a popped-out window. The canvas is only measured with, never attached;
    // outside Obsidian (the tests) there is only `document`.
    const doc = typeof activeDocument === 'undefined' ? document : activeDocument
    const c = doc.win.createEl('canvas')
    ctx = c.getContext('2d')!
  }
  return ctx
}

/**
 * Measured widths, in two generations. A hit in the young one is a single lookup, which is what
 * every node costs on every keystroke. The young one fills by the characters in its keys, plus a
 * little for each entry; then it becomes the old one and the old one is dropped. A width asked for
 * again is carried up from the old one without measuring, so what a map uses stays cached however
 * large the map, and only widths nothing asked for in a whole generation are measured again. At most
 * two generations are kept, so a pasted wall of text cannot grow it without limit.
 */
let young = new Map<string, number>()
let old = new Map<string, number>()
let youngSize = 0
/** Key characters plus `ENTRY_SIZE` per entry, about a byte each: two generations stay within a few tens of MB. */
export const CACHE_GENERATION = 8_000_000
const ENTRY_SIZE = 64
/** Keeps a width in the young generation: one just measured, or one carried up from the old. */
function remember(key: string, w: number): number {
  young.set(key, w)
  youngSize += key.length + ENTRY_SIZE
  if (youngSize > CACHE_GENERATION) {
    old = young
    young = new Map()
    youngSize = 0
  }
  return w
}
/** Set when a measurement could not be trusted, so the width is used once and not cached. */
let unsure = false
/**
 * obsidian: the canvas can stop measuring while Obsidian runs: Chromium drops a 2D context under GPU or memory
 * pressure, and a canvas made in a popped-out window dies with that window. A dead one reports every width as 0,
 * which drew pills too narrow for their text. Visible text is never 0 wide, so a 0 means a fresh canvas, the widths
 * already cached are forgotten (they may be zeros from the same canvas), and if the new one fails too the width is
 * estimated for now and asked for again next time.
 */
function measured(font: string, text: string): number {
  const s = text || ' '
  const attempt = (t = s) => {
    const m = measurer()
    if (m.isContextLost?.()) return 0
    m.font = font
    return m.measureText(t).width
  }
  const w = attempt()
  if (w > 0 || !/\S/.test(s)) return w
  // Zero-width characters (a zero-width space, a joiner, a soft hyphen) are not whitespace yet truly measure 0. A
  // canvas that still measures a letter is alive, and its 0 is kept like any width.
  if (attempt('M') > 0) return 0
  ctx = null
  young = new Map()
  old = new Map()
  youngSize = 0
  const again = attempt()
  if (again > 0) return again
  unsure = true
  return s.length * (parseFloat(font.split(' ')[1]) || 14) * 0.55
}
/** A width measured now, kept only if the canvas could be trusted. */
function measureAndRemember(key: string, font: string, text: string): number {
  unsure = false
  const w = measured(font, text)
  return unsure ? w : remember(key, w)
}

export function textWidth(text: string, weight: number, size: number): number {
  const key = `${weight}|${size}|${text}`
  const kept = young.get(key)
  if (kept !== undefined) return kept
  const carried = old.get(key)
  return carried !== undefined ? remember(key, carried) : measureAndRemember(key, `${weight} ${size}px ${FONT_STACK}`, text)
}

/** Content width at which a node's text starts to wrap. A pill wider than this
 *  stops reading as a node and starts reading as a paragraph. */
export const MAX_TEXT_W = 260
export const MAX_ROOT_TEXT_W = 320
export const MAX_ROW_TEXT_W = 440

// obsidian: the outline is a column (wraps at MAX_ROW_TEXT_W) or full width; the app sets this before layout.
let outlineTextW = MAX_ROW_TEXT_W
let outlineRowW = 0
export function setOutlineWidths(textW: number, rowW: number) {
  outlineTextW = Math.max(200, textW)
  outlineRowW = rowW
}
/** The width an outline row's text (and its lead: a number or a checkbox) wraps in, at an indent. The layout and the
 *  label being typed into both use it, so a row keeps its lines while it is edited, however deep it sits. */
export function outlineTextAvailable(indent: number): number {
  return Math.max(MIN_OUTLINE_TEXT_W, outlineTextW - indent)
}

/** Characters that must not start a line (行頭禁則 / 避头标点). */
const NO_LINE_START = /^[、。，．：；！？）」』】〉》〕〗〙〛,.:;!?)\]}]/
/** Characters that must not end a line (行末禁則). */
const NO_LINE_END = /[（「『【〈《〔〖〘〚([{]$/

/** Break text into lines that fit `maxW`, mirroring what the renderer will draw.
 *  Latin breaks at spaces; CJK breaks between any two characters, with the
 *  common kinsoku rules; a single token wider than the line (a URL) is cut. */
/** Width of `text[from, to)`. The default measures one weight; metricsFor passes a run-aware one. */
export type MeasureFn = (from: number, to: number) => number

export function wrapLines(text: string, weight: number, size: number, maxW: number, mw?: MeasureFn): string[] {
  const src = text || 'Untitled'
  const measure: MeasureFn = mw ?? ((a, b) => textWidth(src.slice(a, b), weight, size))
  const out: string[] = []
  let paraStart = 0
  for (const para of src.split('\n')) {
    const paraEnd = paraStart + para.length
    if (measure(paraStart, paraEnd) <= maxW) {
      out.push(para)
      paraStart = paraEnd + 1
      continue
    }
    const tokens = para.match(/\s+|[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]|[^\s\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]+/g) ?? [para]
    let lineStart = paraStart // absolute offset where the current line begins
    let lineEnd = paraStart // absolute offset just past the current line
    let pos = paraStart
    const line = () => src.slice(lineStart, lineEnd)
    const flush = () => {
      const l = line()
      if (l.trim()) out.push(l.trimEnd())
      lineStart = lineEnd
    }
    for (const tok of tokens) {
      const tokStart = pos
      pos += tok.length
      if (lineStart === lineEnd && /^\s+$/.test(tok)) {
        lineStart = lineEnd = pos
        continue
      }
      const fits = measure(lineStart, pos) <= maxW
      if (fits || lineStart === lineEnd) {
        lineEnd = pos
      } else if (NO_LINE_START.test(tok) || NO_LINE_END.test(line())) {
        // Kinsoku: pull the offending character onto this line regardless, or
        // carry the opening bracket down with what follows.
        if (NO_LINE_END.test(line())) {
          lineEnd -= 1
          flush()
          lineEnd = pos
        } else {
          lineEnd = pos
        }
      } else {
        flush()
        // The next line starts after the break; a space the line broke at is not drawn there.
        lineStart = /^\s+$/.test(tok) ? pos : tokStart
        lineEnd = pos
      }
      // A single token wider than the line — cut it where it stops fitting.
      while (lineEnd - lineStart > 1 && measure(lineStart, lineEnd) > maxW) {
        const cut = fitCount(measure, lineStart, lineEnd, maxW)
        out.push(src.slice(lineStart, lineStart + cut))
        lineStart += cut
      }
    }
    flush()
    paraStart = paraEnd + 1
  }
  return out.length ? out : ['']
}

/** How many characters from `from` fit in `maxW`: at least one, and fewer than `to - from`, which is
 *  known not to fit. Doubles until a prefix is too wide, then halves the gap — a few dozen measurements
 *  per line of a long URL, not one for every character in it. */
function fitCount(measure: MeasureFn, from: number, to: number, maxW: number): number {
  let fits = 1 // one character always goes on the line, however wide
  let over = to - from
  for (let k = 2; k < over; k *= 2) {
    if (measure(from, from + k) > maxW) {
      over = k
      break
    }
    fits = k
  }
  while (over - fits > 1) {
    const mid = (fits + over) >> 1
    if (measure(from, from + mid) <= maxW) fits = mid
    else over = mid
  }
  return fits
}

const MONO = `ui-monospace, SFMono-Regular, Menlo, monospace`
export function monoWidth(text: string, size: number): number {
  const key = `mono|${size}|${text}`
  const kept = young.get(key)
  if (kept !== undefined) return kept
  const carried = old.get(key)
  return carried !== undefined ? remember(key, carried) : measureAndRemember(key, `500 ${size}px ${MONO}`, text)
}

/** Width of one laid-out line: found back in the plain text so styled runs measure at their real width. */
let lineCursor = 0
function lineWidth(line: string, plain: string, weight: number, size: number, mw?: MeasureFn): number {
  if (!mw) return textWidth(line, weight, size)
  let at = plain.indexOf(line, lineCursor)
  if (at < 0) at = plain.indexOf(line)
  if (at < 0) return textWidth(line, weight, size)
  lineCursor = at + line.length
  return mw(at, at + line.length)
}

/** obsidian: media under a node's text. Image sizes arrive when the image loads; until then 16:9. */
export const MEDIA_W = 200
export const AUDIO_H = 36
export const MEDIA_GAP = 6
const mediaSizes = new Map<string, { w: number; h: number }>()
export function setMediaSize(file: string, w: number, h: number): boolean {
  const cur = mediaSizes.get(file)
  if (cur && cur.w === w && cur.h === h) return false
  mediaSizes.set(file, { w, h })
  return true
}
export interface MediaBox {
  embed: Embed
  w: number
  h: number
}
export function mediaBoxes(embeds: Embed[], maxW: number): MediaBox[] {
  return embeds.map((embed) => {
    if (embed.kind === 'audio') return { embed, w: Math.max(160, maxW), h: AUDIO_H }
    const nat = mediaSizes.get(embed.file)
    const w = nat ? Math.min(maxW, nat.w) : maxW
    const h = nat ? Math.round((w * nat.h) / nat.w) : Math.round((w * 9) / 16)
    return { embed, w, h }
  })
}

export const MIN_PILL_W = 96
export const MAX_PILL_W = 720
/** vertical padding inside an outline row */
export const ROW_PAD = 6
/** obsidian: breathing room between outline rows, so a tall row never touches the next. */
export const ROW_GAP = 4
export const INDENT = 22
/** Room for the disclosure triangle + colour dot at the head of an outline row. */
export const ROW_LEAD = 34
/** The narrowest a row gets at the deepest indent: its lead, the text, and the 14px after the text. */
const MIN_OUTLINE_ROW_W = ROW_LEAD + 112
const MIN_OUTLINE_TEXT_W = MIN_OUTLINE_ROW_W - ROW_LEAD - 14
/** Keep deep outlines inside the document column. Before the app supplies a row width (tests and utilities), use
 *  the ordinary fixed indent. */
export function outlineIndent(depth: number): number {
  return outlineRowW > 0 ? Math.min(depth * INDENT, Math.max(0, outlineRowW - MIN_OUTLINE_ROW_W)) : depth * INDENT
}
/** obsidian: a task's checkbox, drawn at the head of the text, and the gap after it. */
export const CHECK_W = 15
const CHECK_GAP = 7
/** Gap after a numbered item's "3." */
const NUM_GAP = 5
/** A #tag is drawn as a chip: this much wider than its text. */
const TAG_PAD = 6

/** obsidian: what sits before the text — a number, a checkbox — and the width it takes. */
export interface Lead {
  w: number
  /** "3." for the third numbered item in a row */
  num?: string
  /** the task state character: ' ' open, 'x' done, else a custom state */
  task?: string
}

export interface NodeMetrics {
  w: number
  h: number
  fontSize: number
  fontWeight: number
  /** line height in px for this node's size */
  lineH: number
  /** Widest line, which is what centres the label. */
  textW: number
  /** The wrapped lines the renderer should draw. */
  lines: string[]
  /** obsidian: embedded media under the text */
  media: MediaBox[]
  mediaH: number
  /** obsidian: number and checkbox ahead of the text; `w` is 0 on a plain node */
  lead: Lead
}

/** What a node's size depends on beyond the node itself: whether it is the root, its number in a numbered run, and
 *  (in the Outline, which leaves room for a count chip) whether a free link touches it. */
export interface NodePlace {
  isRoot: boolean
  ordinal: number | null
  linked: boolean
  /** Outline indentation consumes this much of the shared document width. */
  depth?: number
}

export function metricsFor(doc: IODoc, id: NodeId, shape: LayoutKind, depth = 0): NodeMetrics {
  const place = { isRoot: id === doc.rootId, ordinal: ordinalOf(doc, id), linked: shape === 'outline' && doc.links.some((l) => l.from === id || l.to === id), depth }
  return nodeMetrics(doc.nodes[id], place, shape)
}

/** `metricsFor` for a node whose place in the document is already known — what a view that holds only the node can ask. */
export function nodeMetrics(n: IONode, place: NodePlace, shape: LayoutKind): NodeMetrics {
  const text = plainText(n.text) // obsidian: markers are painted, never measured
  lineCursor = 0
  const runs = parseInline(n.text).runs
  const styled = runs.some((r) => r.b || r.code || r.tag)
  /** Width of text[from,to) with bold runs at 700 and code runs in the monospace face. */
  const measureFor = (weight: number, size: number): MeasureFn | undefined =>
    !styled
      ? undefined
      : (from, to) => {
          let w = 0
          for (const r of runs) {
            const a = Math.max(r.start, from)
            const b = Math.min(r.end, to)
            if (b <= a) continue
            const seg = text.slice(a, b)
            w += r.code ? monoWidth(seg, size * 0.92) : textWidth(seg, r.b ? 700 : weight, size) + (r.tag ? TAG_PAD : 0)
          }
          return w
        }
  const isRoot = place.isRoot
  const outline = shape === 'outline'
  const { fontSize, fontWeight, lineH } = fontFor(n.size, isRoot, outline)
  const embeds = parseInline(n.text).embeds
  const ord = place.ordinal
  const lead: Lead = { w: 0 }
  if (ord) {
    lead.num = `${ord}.`
    lead.w += Math.ceil(textWidth(lead.num, fontWeight, fontSize)) + NUM_GAP
  }
  if (n.task != null) {
    lead.task = n.task
    lead.w += CHECK_W + CHECK_GAP
  }

  if (outline) {
    const indent = outlineIndent(place.depth ?? 0)
    const textAvailable = outlineTextAvailable(indent)
    const rowAvailable = Math.max(ROW_LEAD + 80, outlineRowW - indent)
    const media = mediaBoxes(embeds, Math.min(360, textAvailable))
    const mediaH = media.reduce((h, m) => h + m.h + MEDIA_GAP, 0)
    const lines = wrapLines(text, fontWeight, fontSize, Math.max(40, textAvailable - lead.w), measureFor(fontWeight, fontSize))
    const textW = Math.max(...lines.map((l) => lineWidth(l, text, fontWeight, fontSize, measureFor(fontWeight, fontSize))))
    // The outline is the only shape that shows free links, as a count chip —
    // so it's the only shape that has to leave room for one.
    const links = place.linked ? 44 : 0
    return {
      w: Math.max(ROW_LEAD + lead.w + textW + 14 + links, rowAvailable),
      h: lines.length * lineH + ROW_PAD * 2 + mediaH,
      fontSize,
      fontWeight,
      lineH,
      textW,
      lines,
      media,
      mediaH,
      lead,
    }
  }

  const padX = isRoot ? 22 : 16
  const padY = isRoot ? 12 : 8
  // obsidian: a hand-set width wraps the text inside it; larger text gets a proportionally wider default.
  const scale = fontSize / 14
  const maxTextW = n.width ? Math.max(40, n.width - padX * 2 - lead.w) : Math.round((isRoot ? MAX_ROOT_TEXT_W : MAX_TEXT_W) * scale)
  const lines = wrapLines(text, fontWeight, fontSize, maxTextW, measureFor(fontWeight, fontSize))
  const textW = Math.max(...lines.map((l) => lineWidth(l, text, fontWeight, fontSize, measureFor(fontWeight, fontSize))))
  const media = mediaBoxes(embeds, n.width ? Math.max(40, n.width - padX * 2) : MEDIA_W)
  const mediaH = media.reduce((h, m) => h + m.h + MEDIA_GAP, 0)
  const mediaW = media.reduce((w, m) => Math.max(w, m.w), 0)
  return {
    w: n.width ? Math.max(MIN_PILL_W, n.width) : Math.max(56, padX * 2 + lead.w + Math.max(textW, mediaW)),
    h: lines.length * lineH + padY * 2 + mediaH,
    fontSize,
    fontWeight,
    lineH,
    textW,
    lines,
    media,
    mediaH,
    lead,
  }
}

/** Text size by heading level; the root is a touch larger than body when unsized. */
export const SIZE_PX: Record<0 | 1 | 2 | 3, number> = { 0: 14, 1: 23, 2: 19, 3: 16 }
export function fontFor(size: 1 | 2 | 3 | undefined, isRoot: boolean, outline: boolean): { fontSize: number; fontWeight: number; lineH: number } {
  const level = size ?? 0
  const fontSize = level ? SIZE_PX[level] : isRoot ? 15 : 14
  const fontWeight = level === 1 || level === 2 || isRoot ? 700 : level === 3 ? 600 : outline ? 400 : 500
  return { fontSize, fontWeight, lineH: Math.round(fontSize * 1.3) }
}
