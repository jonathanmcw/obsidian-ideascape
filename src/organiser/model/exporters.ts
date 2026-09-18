import type { IODoc, LayoutKind } from './types.ts'
import { parseInline, type Rich } from './inline.ts'
import { walk } from './doc.ts'
import { escapeRootLine, guardCaret, itemLines } from './markdown.ts'
import { frameFor, leftOf, linkPath, treePath } from '../layout/index.ts'
import { branchColor, themeById } from '../theme.ts'
import { CHECK_W, MEDIA_GAP, ROW_LEAD, metricsFor } from '../layout/measure.ts'

/** Markdown, as a nested list. Maps are routinely deeper than six levels, headings cap at H6, and a nested list
 *  is the representation Obsidian, Logseq and Workflowy all read back as an outline without flattening it. */
export function toMarkdown(doc: IODoc): string {
  const rows = walk(doc, doc.rootId)
  const lines: string[] = []

  /** A multi-line node stays one list item: continuation lines are indented to
   *  sit under the first, which is how Markdown keeps them in the same bullet.
   *  Lines are escaped the way the map's own file escapes them, so a line reading
   *  "- passport" or "[x] done" stays text instead of becoming an item or a task. */
  const item = (id: string, indent: string) => {
    const n = doc.nodes[id]
    return itemLines(doc, n.text ? n : { ...n, text: 'Untitled' }, indent)
  }
  /** A heading's further lines, as paragraphs under it. */
  const body = (rest: string[]) => rest.map((l) => (l.trim() ? guardCaret(escapeRootLine(l)) : ''))

  const [rootHead, ...rootRest] = (doc.nodes[doc.rootId].text || doc.name).split('\n')
  lines.push(`# ${guardCaret(rootHead)}`, ...(rootRest.length ? ['', ...body(rootRest)] : []), '')
  for (const { id, depth } of rows) {
    if (depth === 0) continue
    lines.push(...item(id, '  '.repeat(depth - 1)))
  }
  return lines.join('\n') + '\n'
}

export function toOPML(doc: IODoc): string {
  // Newlines, tabs and carriage returns must be character references: XML parsers
  // normalise them inside an attribute value to a space. Characters XML does not
  // allow at all (C0 controls, unpaired surrogates, U+FFFE/U+FFFF) are dropped,
  // or the whole file would fail to parse.
  // A surrogate pair is matched whole and kept; a surrogate on its own is dropped (no lookbehind: older iOS lacks it).
  const esc = (s: string) =>
    s
      // eslint-disable-next-line no-control-regex -- these are the control characters XML 1.0 forbids, matched in order to drop them
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/g, (m) => (m.length === 2 ? m : ''))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '&#10;')
      .replace(/\t/g, '&#9;')
      .replace(/\r/g, '&#13;')

  // A root with no text takes the map's name, as the Markdown export and the map's own file both do —
  // an outline whose top line reads "Untitled" tells the app it is opened in nothing.
  const render = (id: string, indent: string): string => {
    const n = doc.nodes[id]
    const attr = `text="${esc(n.text || (id === doc.rootId ? doc.name : '') || 'Untitled')}"`
    if (!n.children.length) return `${indent}<outline ${attr} />`
    const kids = n.children.map((c) => render(c, indent + '  ')).join('\n')
    return `${indent}<outline ${attr}>\n${kids}\n${indent}</outline>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${esc(doc.name)}</title>
    <dateModified>${new Date(doc.updatedAt).toUTCString()}</dateModified>
  </head>
  <body>
${render(doc.rootId, '    ')}
  </body>
</opml>
`
}

/** How many free links a Markdown/OPML export will silently drop. Surfaced in
 *  the export sheet rather than lost quietly. */
export function droppedLinkCount(doc: IODoc): number {
  return doc.links.length
}

/* ------------------------------------------------------------------ *
 * PNG — the current shape, drawn straight onto a 2d canvas from the same
 * layout the screen uses, so what you export is what you see.
 * ------------------------------------------------------------------ */

const FONT_STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "PingFang TC", "Noto Sans TC", sans-serif` // obsidian: system stack, matches styles.css

/** canvas2d has no color-mix(), so blend the two hex colours by hand. */
function mix(a: string, b: string, t: number): string {
  const hex = (v: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(v.trim())
    return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4), 16)] : null
  }
  const ca = hex(a)
  const cb = hex(b)
  if (!ca || !cb) return b
  const c = ca.map((v, i) => Math.round(v * t + cb[i] * (1 - t)))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  c.beginPath()
  c.moveTo(x + rr, y)
  c.arcTo(x + w, y, x + w, y + h, rr)
  c.arcTo(x + w, y + h, x, y + h, rr)
  c.arcTo(x, y + h, x, y, rr)
  c.arcTo(x, y, x + w, y, rr)
  c.closePath()
}

/**
 * A canvas of this size that the platform will really give its pixels back, or null.
 *
 * A canvas past what the browser can hold is not refused: it takes a 2d context, accepts every draw, and
 * then hands back transparent pixels and a null blob. Chromium stops at 65,535px a side and around 268
 * million pixels; the WebKit behind Obsidian on an iPhone stops far earlier, and neither says so. One
 * pixel, written and read back before anything is drawn, is the only reliable question, and it is cheap.
 */
function usableCanvas(w: number, h: number): HTMLCanvasElement | null {
  // obsidian: activeWindow, the window the export was asked for in (a popped-out one included).
  const canvas = activeWindow.createEl('canvas')
  canvas.width = w
  canvas.height = h
  if (canvas.width === w && canvas.height === h) {
    const c = canvas.getContext('2d')
    if (c) {
      c.fillStyle = '#fff'
      c.fillRect(0, 0, 1, 1)
      try {
        if (c.getImageData(0, 0, 1, 1).data[3] === 255) {
          c.clearRect(0, 0, 1, 1)
          return canvas
        }
      } catch { /* a canvas too large to read from; the next size down is the answer */ }
    }
  }
  // Give the memory back now rather than at the next collection: the try after this one wants it.
  canvas.width = canvas.height = 0
  return null
}

/** The picture, and the scale it could actually be drawn at — 2×, unless the map was too large for this
 *  device to hold that, in which case the sheet says which scale it fell back to. */
export async function toPNG(
  doc: IODoc,
  shape: LayoutKind,
  themeId: string,
  nodeStyle: 'bar' | 'outline' | 'filled' = 'outline',
  scale = 2,
  resolveEmbed?: (file: string) => { url: string; kind: 'image' | 'audio' } | null,
  palette: readonly string[] = [],
): Promise<{ blob: Blob; scale: number }> {
  const theme = themeById(themeId)
  const frame = frameFor(doc, shape)
  const pad = 48
  const { minX, minY, maxX, maxY } = frame.bounds
  const w = Math.max(320, maxX - minX + pad * 2)
  const h = Math.max(240, maxY - minY + pad * 2)

  // A large map can be more picture than the device will draw. Rather than fail, it is drawn at the largest
  // scale that works: 2×, then 1×, then a half. The canvas is taken before the embeds are fetched, so a map
  // that cannot be drawn at all costs nothing to refuse.
  let canvas: HTMLCanvasElement | null = null
  let used = scale
  for (let s = scale; s >= 0.25 && !canvas; s /= 2) {
    canvas = usableCanvas(Math.round(w * s), Math.round(h * s))
    used = s
  }
  if (!canvas) {
    throw new Error(`This map is ${Math.round(w)}×${Math.round(h)}, too large to draw as one image here. Fold the branches you do not need, or export it as Markdown or .canvas.`)
  }

  // obsidian: images are loaded up front so they can be drawn synchronously below
  const images = new Map<string, HTMLImageElement>()
  if (resolveEmbed) {
    const wanted = new Set<string>()
    for (const n of Object.values(doc.nodes)) for (const e of parseInline(n.text).embeds) if (e.kind === 'image') wanted.add(e.file)
    await Promise.all(
      [...wanted].map(
        (file) =>
          new Promise<void>((done) => {
            const r = resolveEmbed(file)
            if (!r) return done()
            const img = new Image()
            const t = window.setTimeout(done, 4000)
            img.onload = () => { window.clearTimeout(t); images.set(file, img); done() }
            img.onerror = () => { window.clearTimeout(t); done() }
            img.src = r.url
          }),
      ),
    )
  }

  const c = canvas.getContext('2d')!
  // The background is laid down in the canvas's own pixels, before the scale: a canvas is a whole number of
  // pixels and the map's bounds are not, so a fill in the map's coordinates leaves the last column of the
  // picture part-transparent — a faint seam down the edge of every export.
  c.fillStyle = theme.vars['--stage']
  c.fillRect(0, 0, canvas.width, canvas.height)
  c.scale(used, used)
  c.translate(pad - minX, pad - minY)

  const ink = theme.vars['--ink']
  const surface = theme.vars['--surface']
  /** The colour this node's text is drawn in. A node with no text shows the same muted placeholder the
   *  screen shows for it (.node-empty), not full ink. */
  let textInk = ink

  // Connectors first, so pills sit on top.
  if (shape !== 'outline') {
    c.lineWidth = 1.5
    c.strokeStyle = theme.dark ? 'rgba(255,255,255,0.28)' : 'rgba(35,31,26,0.26)'
    for (const n of Object.values(doc.nodes)) {
      if (n.collapsed) continue
      const pb = frame.boxes[n.id]
      if (!pb) continue
      const kids = n.children.filter((cid) => frame.boxes[cid])
      const lines = kids.map((cid) => treePath(pb, frame.boxes[cid], shape))
      // Org chart, and a stack of leaves anywhere: a node's lines share their stem, so they are stroked as one path,
      // painted once — as on screen.
      if (shape === 'org' || kids.some((cid) => frame.boxes[cid].stack)) {
        if (lines.length) c.stroke(new Path2D(lines.join(' ')))
      } else for (const d of lines) c.stroke(new Path2D(d))
    }
    if (shape === 'canvas') {
      c.setLineDash([6, 5])
      c.strokeStyle = theme.dark ? 'rgba(255,255,255,0.20)' : 'rgba(35,31,26,0.18)'
      for (const l of doc.links) {
        const a = frame.boxes[l.from]
        const b = frame.boxes[l.to]
        if (a && b) c.stroke(new Path2D(linkPath(a, b)))
      }
      c.setLineDash([])
    }
  }

  const accent = theme.vars['--accent']
  const markBg = theme.dark ? 'rgba(211,164,92,0.38)' : 'rgba(163,119,58,0.28)'
  const codeBg = theme.dark ? 'rgba(255,255,255,0.10)' : 'rgba(35,31,26,0.08)'
  const MONO = `ui-monospace, SFMono-Regular, Menlo, monospace`

  /** Paint one laid-out line with its inline styles, anchored per `align`, and return nothing. */
  const drawLine = (line: string, rich: Rich, cursor: { at: number }, weight: number, size: number, lineH: number, anchorX: number, y: number, align: 'left' | 'center' | 'right') => {
    let start = rich.plain.indexOf(line, cursor.at)
    if (start < 0) start = rich.plain.indexOf(line)
    if (start < 0) start = 0
    const end = start + line.length
    cursor.at = end
    const segs: { t: string; r: (typeof rich.runs)[number]; w: number }[] = []
    for (const r of rich.runs) {
      const a = Math.max(r.start, start)
      const b = Math.min(r.end, end)
      if (b <= a) continue
      const t = rich.plain.slice(a, b)
      c.font = `${r.i ? 'italic ' : ''}${r.b ? 700 : weight} ${r.code ? size * 0.92 : size}px ${r.code ? MONO : FONT_STACK}`
      segs.push({ t, r, w: c.measureText(t).width })
    }
    if (!segs.length && line) {
      c.font = `${weight} ${size}px ${FONT_STACK}`
      segs.push({ t: line, r: { start, end }, w: c.measureText(line).width })
    }
    const total = segs.reduce((n, s) => n + s.w, 0)
    let x = align === 'left' ? anchorX : align === 'right' ? anchorX - total : anchorX - total / 2
    c.textAlign = 'left'
    c.textBaseline = 'middle'
    for (const sgm of segs) {
      c.font = `${sgm.r.i ? 'italic ' : ''}${sgm.r.b ? 700 : weight} ${sgm.r.code ? size * 0.92 : size}px ${sgm.r.code ? MONO : FONT_STACK}`
      if (sgm.r.mark) {
        c.fillStyle = markBg
        roundRect(c, x - 2, y - lineH / 2 + 2, sgm.w + 4, lineH - 4, 3)
        c.fill()
      }
      if (sgm.r.code) {
        c.fillStyle = codeBg
        roundRect(c, x - 2, y - lineH / 2 + 3, sgm.w + 4, lineH - 6, 3)
        c.fill()
      }
      c.fillStyle = sgm.r.href ? accent : textInk
      c.fillText(sgm.t, x, y)
      if (sgm.r.u || sgm.r.href || sgm.r.s) {
        c.strokeStyle = sgm.r.href ? accent : textInk
        c.lineWidth = 1
        c.beginPath()
        const ly = sgm.r.s ? y : y + size * 0.42
        c.moveTo(x, ly)
        c.lineTo(x + sgm.w, ly)
        c.stroke()
      }
      x += sgm.w
    }
  }

  for (const id of frame.order) {
    const box = frame.boxes[id]
    const n = doc.nodes[id]
    const isRoot = id === doc.rootId
    const color = branchColor(themeId, n.branch, palette)
    const x = leftOf(box, shape)
    const y = box.y - box.h / 2
    // The very lines the screen shows: same measurer, same widths, same wrapping.
    const m = metricsFor(doc, id, shape, box.depth)
    const rich = parseInline(n.text || 'Untitled')
    textInk = n.text ? ink : theme.vars['--ink-3']
    const cursor = { at: 0 }
    // text lines then media, centred as one block — the same stack the node lays out
    const contentTop = box.y - (m.lines.length * m.lineH + m.mediaH) / 2
    const firstY = contentTop + m.lineH / 2 + 1
    const drawMedia = (left: number, centre: boolean) => {
      let my = contentTop + m.lines.length * m.lineH
      for (const mb of m.media) {
        my += MEDIA_GAP
        const mx = centre ? left - mb.w / 2 : left
        c.save()
        roundRect(c, mx, my, mb.w, mb.h, 6)
        c.clip()
        const img = mb.embed.kind === 'image' ? images.get(mb.embed.file) : undefined
        if (img) c.drawImage(img, mx, my, mb.w, mb.h)
        else {
          c.fillStyle = theme.vars['--surface-2']
          c.fillRect(mx, my, mb.w, mb.h)
          c.fillStyle = theme.vars['--ink-2']
          c.font = `500 12px ${FONT_STACK}`
          c.textAlign = 'left'
          c.textBaseline = 'middle'
          c.fillText((mb.embed.kind === 'audio' ? '♪ ' : '') + mb.embed.file, mx + 10, my + mb.h / 2)
        }
        c.restore()
        my += mb.h
      }
    }

    /** obsidian: the number and the checkbox ahead of the first line, as the screen draws them. */
    const drawLead = (left: number) => {
      if (!m.lead.w) return
      let lx = left
      c.textAlign = 'left'
      c.textBaseline = 'middle'
      if (m.lead.num) {
        c.fillStyle = theme.vars['--ink-3']
        c.font = `${m.fontWeight} ${m.fontSize}px ${FONT_STACK}`
        c.fillText(m.lead.num, lx, firstY)
        lx += c.measureText(m.lead.num).width + 5
      }
      if (m.lead.task != null) {
        const done = m.lead.task === 'x'
        const by = firstY - CHECK_W / 2
        const branch = color === 'var(--ink-3)' ? theme.vars['--accent'] : color
        roundRect(c, lx + 0.5, by + 0.5, CHECK_W - 1, CHECK_W - 1, 4)
        if (done) {
          c.fillStyle = branch
          c.fill()
          c.strokeStyle = '#fff'
          c.lineWidth = 1.8
          c.beginPath()
          c.moveTo(lx + 3.5, firstY + 0.2)
          c.lineTo(lx + 6.3, firstY + 3)
          c.lineTo(lx + 11.5, firstY - 3)
          c.stroke()
        } else {
          c.strokeStyle = theme.vars['--ink-3']
          c.lineWidth = 1.4
          c.stroke()
          if (m.lead.task !== ' ') {
            c.fillStyle = theme.vars['--ink-2']
            c.font = `600 10px ${FONT_STACK}`
            c.textAlign = 'center'
            c.fillText(m.lead.task, lx + CHECK_W / 2, firstY)
          }
        }
      }
    }

    if (shape === 'outline') {
      if (!isRoot) {
        c.fillStyle = color === 'var(--ink-3)' ? theme.vars['--ink-3'] : color
        roundRect(c, x + 14, y + 7, 4, Math.max(4, box.h - 14), 2)
        c.fill()
      }
      drawLead(x + ROW_LEAD)
      m.lines.forEach((line, i) => drawLine(line, rich, cursor, m.fontWeight, m.fontSize, m.lineH, x + ROW_LEAD + m.lead.w, firstY + i * m.lineH, 'left'))
      drawMedia(x + ROW_LEAD, false)
    } else {
      const r = Math.min(17, box.h / 2)
      const branch = color === 'var(--ink-3)' ? theme.vars['--ink-3'] : color
      const neutral = theme.dark ? 'rgba(255,255,255,0.14)' : 'rgba(35,31,26,0.12)'

      c.fillStyle = nodeStyle === 'filled' && !isRoot ? mix(branch, theme.vars['--surface'], 0.11) : surface
      roundRect(c, x, y, box.w, box.h, r)
      c.fill()
      c.lineWidth = isRoot ? 1.5 : 1
      c.strokeStyle = isRoot || nodeStyle === 'bar' ? neutral : branch
      c.stroke()
      if (nodeStyle === 'bar' && !isRoot) {
        c.save()
        roundRect(c, x, y, box.w, box.h, r)
        c.clip()
        c.fillStyle = branch
        c.fillRect(x, y, 4, box.h)
        c.restore()
      }

      const padX = isRoot ? 22 : 16
      const align = n.align ?? 'center'
      // The lead sits ahead of the text block; the block itself keeps its alignment.
      const lw = m.lead.w
      const anchor = align === 'left' ? x + padX + lw : align === 'right' ? x + box.w - padX : x + box.w / 2 + lw / 2
      drawLead(align === 'left' ? x + padX : align === 'right' ? x + box.w - padX - m.textW - lw : x + (box.w - m.textW - lw) / 2)
      m.lines.forEach((line, i) => drawLine(line, rich, cursor, m.fontWeight, m.fontSize, m.lineH, anchor, firstY + i * m.lineH, align))
      drawMedia(x + box.w / 2, true)
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve({ blob: b, scale: used }) : reject(new Error('That image could not be made. Fold the branches you do not need, or export the map as Markdown or .canvas.'))), 'image/png')
  })
}

/* ------------------------------------------------------------------ *
 * Saving. obsidian: the host (the plugin view) installs a handler that
 * writes into the vault; nothing here starts a browser download.
 * ------------------------------------------------------------------ */

export type SaveHandler = (filename: string, data: string | Blob) => Promise<string | null>

let saveHandler: SaveHandler = async () => 'No save handler installed.'

export function setSaveHandler(fn: SaveHandler) {
  saveHandler = fn
}

/** Resolves to null on success, or to a message explaining why the file could not be saved. */
export async function download(filename: string, data: string | Blob, _mime = 'text/plain'): Promise<string | null> {
  try {
    return await saveHandler(filename, data)
  } catch (err) {
    return err instanceof Error ? err.message : 'That file could not be saved.'
  }
}

/** A file name will hold this many bytes of the map's title. Every file system in use stops a name at 255
 *  bytes, and `exportPath` still has to fit `-2` and an extension inside that. */
const NAME_BYTES = 120

/** `s`, cut to at most `max` bytes of UTF-8 — never through a character, and never left ending in a dash.
 *  Counted in bytes because that is what a file system counts: 120 Japanese characters are 360 of them. */
function cut(s: string, max: number): string {
  let bytes = 0
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    if (bytes > max) break
    out += ch
  }
  return out.replace(/-+$/, '')
}

/** The name an export lands under, from the map's title. Letters and digits of every script are kept — a map
 *  called 旅行計画 or Café must not export as `untitled` — and everything else, punctuation and emoji and the
 *  characters a path reserves (`/`, `:`, `\`) alike, becomes a dash. */
export function slug(name: string): string {
  const out = name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return cut(out, NAME_BYTES) || 'untitled'
}
