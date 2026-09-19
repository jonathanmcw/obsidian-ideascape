/**
 * obsidian: node text is Markdown. This reads the inline subset a pill can show —
 * **bold**, *italic* / _italic_, <u>underline</u>, ~~strike~~, ==highlight==, `code`,
 * [[wikilinks|alias]], [text](url) and #tags — into plain text plus style runs over it.
 * Layout measures the plain text; the renderer paints the runs. Unmatched markers stay literal.
 * $math$, inline HTML tags and \x escapes are opaque: shown as written (an escape shows its
 * character), never parsed inside, and kept byte for byte by the editor.
 */
export interface Run {
  start: number
  end: number
  b?: true
  i?: true
  u?: true
  s?: true
  mark?: true
  code?: true
  href?: string
  wiki?: true
  /** A #tag, the `#` included in the text; the run is the whole tag. */
  tag?: true
  /** The source this run was read from, for the editor to write back as it was while the run's
   *  text is unchanged: `$math$` or an HTML tag (shown as written), a `\x` escape (shown as its
   *  character), a code span or a link (however its backticks or brackets were spelled). */
  raw?: string
  /** Italic written `_x_`, bold written `__x__`: the editor writes them back the same way. */
  iMark?: '_'
  bMark?: '__'
}
export type EmbedKind = 'image' | 'audio' | 'other'
export interface Embed {
  file: string
  alias?: string
  kind: EmbedKind
}
export interface Rich {
  plain: string
  runs: Run[]
  /** ![[file]] embeds, shown as blocks under the text (images, audio); never part of `plain`. */
  embeds: Embed[]
}

/** obsidian: a tag is `#` at the start or after whitespace, then letters, digits, `_`, `-` and `/`,
 *  with at least one character that is not a digit — the rules Obsidian's own tag pane uses. */
const TAG_RE = /^#([\p{L}\p{N}_\-/]+)/u
export function tagAt(src: string, i: number): string | null {
  if (src[i] !== '#' || (i > 0 && !/\s/.test(src[i - 1]))) return null
  const m = TAG_RE.exec(src.slice(i, i + 120))
  if (!m || !/[^\p{N}]/u.test(m[1])) return null
  return m[1]
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic)$/i
const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|oga|flac|aac|webm|3gp|opus)$/i
export function embedKind(file: string): EmbedKind {
  return IMAGE_EXT.test(file) ? 'image' : AUDIO_EXT.test(file) ? 'audio' : 'other'
}

/** Text without its media embeds, the images and audio `embedsOf` gives back — only the embed and the one line break
 *  that carried it go; every other character stays: blank lines, a trailing newline mid-edit, and a `![[note]]`
 *  transclusion, which the label shows as a link. */
export function stripEmbeds(src: string): string {
  // The reader says where they are, so the two can never disagree: `![[x.png]]` inside a code span, inside math
  // or behind a backslash is text to both. Cut from the last one back, so the earlier places still hold.
  const media: [number, number][] = []
  parse(src, null, media)
  let out = src
  for (const [from, to] of media.reverse()) {
    // An embed with a line to itself takes the line break ahead of it and the blanks after it.
    const blanks = /^[ \t]*(?=\n|$)/.exec(src.slice(to))
    const alone = !!blanks && (from === 0 || src[from - 1] === '\n')
    const end = alone ? to + blanks[0].length : to
    out = out.slice(0, alone && from > 0 ? from - 1 : from) + out.slice(end)
  }
  return out
}
export function embedsOf(src: string): Embed[] {
  return parseInline(src).embeds
}
/** Text plus its media embeds, one per line after the text. The text itself is left as it is. */
export function withEmbeds(text: string, embeds: Embed[]): string {
  if (!embeds.length) return text
  const lines = embeds.map((e) => `![[${e.file}${e.alias ? '|' + e.alias : ''}]]`)
  return (text.length && !text.endsWith('\n') ? text + '\n' : text) + lines.join('\n')
}

/** obsidian: the link addresses a map will open — the web, mail and Obsidian's own URIs. Anything
 *  else (javascript:, data:, file:, another app's scheme) shows as text and is never opened. */
export function safeHref(href: string): string | null {
  return /^(?:https?|mailto|obsidian):/i.test(href) ? href : null
}

/** Characters a backslash escapes; `!` only matters before `[[`, `$` before math. */
export const ESCAPABLE = '*_~=`[<\\$!'

/** obsidian: inline math as Obsidian reads it — `$$…$$`, or `$…$` on one line with no space just
 *  inside either dollar and no digit straight after the closing one, so "$5 and $10" stays text. */
function mathAt(src: string, i: number): string | null {
  if (src.startsWith('$$', i)) {
    const j = src.indexOf('$$', i + 2)
    return j > i + 2 ? src.slice(i, j + 2) : null
  }
  if (i + 1 >= src.length || /[\s$]/.test(src[i + 1])) return null
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j]
    if (c === '\n') return null
    if (c === '\\') j++
    else if (c === '$') return /\s/.test(src[j - 1]) || /\d/.test(src[j + 1] ?? '') ? null : src.slice(i, j + 1)
  }
  return null
}

/** An inline HTML tag or comment, shown as written. */
const HTML_RE = /^<(?:\/?[A-Za-z][\w-]*(?:\s[^<>\n]*)?\/?|!--[^\n]*?--)>/

/** Where a code span that opens with `n` backticks closes: the next run of exactly `n`. */
function closingTicks(src: string, from: number, n: number): number {
  let j = src.indexOf('`', from)
  while (j >= 0) {
    let m = 1
    while (src[j + m] === '`') m++
    if (m === n) return j
    j = src.indexOf('`', j + m)
  }
  return -1
}

/** Letters and digits: `_` and `__` neither open nor close inside a word, as CommonMark reads them. */
const WORD_CHAR = /[\p{L}\p{N}]/u

/** True when the character at `at` is escaped: an odd run of backslashes stands before it. */
function escapedAt(src: string, at: number): boolean {
  let k = 0
  while (at - 1 - k >= 0 && src[at - 1 - k] === '\\') k++
  return k % 2 === 1
}

/** The first `needle` at or after `from` that no backslash escapes, or -1. */
function nextUnescaped(src: string, needle: string, from: number): number {
  let j = src.indexOf(needle, from)
  while (j >= 0 && escapedAt(src, j)) j = src.indexOf(needle, j + 1)
  return j
}

/** The next `__` that may close: unescaped and not followed by a letter or digit. */
function closingUnderscores(src: string, from: number): number {
  let j = nextUnescaped(src, '__', from)
  while (j >= 0 && j + 2 < src.length && WORD_CHAR.test(src[j + 2])) j = nextUnescaped(src, '__', j + 2)
  return j
}

/** The next `_` that may close an italic: unescaped and not followed by a letter or digit. */
function closingUnderscore(src: string, from: number): number {
  let j = nextUnescaped(src, '_', from)
  while (j >= 0 && j + 1 < src.length && WORD_CHAR.test(src[j + 1])) j = nextUnescaped(src, '_', j + 1)
  return j
}

const cache = new Map<string, Rich>()

function sameStyle(a: Partial<Run>, b: Partial<Run>): boolean {
  return (
    !!a.b === !!b.b && !!a.i === !!b.i && !!a.u === !!b.u && !!a.s === !!b.s && !!a.mark === !!b.mark && !!a.code === !!b.code &&
    a.href === b.href && !!a.wiki === !!b.wiki && !!a.tag === !!b.tag && a.raw === b.raw && a.iMark === b.iMark && a.bMark === b.bMark
  )
}

export function parseInline(src: string): Rich {
  const hit = cache.get(src)
  if (hit) return hit
  const rich = parse(src, null)
  if (cache.size > 4000) cache.clear()
  cache.set(src, rich)
  return rich
}

/** The parse plus, for each source character, whether the text shows it as itself (1) or it was
 *  read as syntax (0) — how the editor finds which typed characters need a backslash. Not cached. */
export function traceInline(src: string): { rich: Rich; shown: Uint8Array } {
  const shown = new Uint8Array(src.length)
  return { rich: parse(src, shown), shown }
}

/** `media`, when given, collects where each media embed sits in the source, `![[` to `]]`. */
function parse(src: string, shown: Uint8Array | null, media?: [number, number][]): Rich {
  let plain = ''
  const runs: Run[] = []
  const embeds: Embed[] = []
  const flags = { b: false, i: false, u: false, s: false, mark: false }
  let italicMarker: '*' | '_' | null = null
  let boldMarker: '**' | '__' | null = null
  let link: { href: string; wiki: boolean } | null = null
  let cur: Run | null = null
  /** `from`: where `t` sits in the source, character for character; -1 when it doesn't. */
  const push = (t: string, from: number, extra?: Partial<Run>) => {
    if (!t) return
    if (shown && from >= 0) shown.fill(1, from, from + t.length)
    const style: Partial<Run> = {
      ...(flags.b ? { b: true, ...(boldMarker === '__' ? { bMark: '__' } : {}) } : {}),
      ...(flags.i ? { i: true, ...(italicMarker === '_' ? { iMark: '_' } : {}) } : {}),
      ...(flags.u ? { u: true } : {}),
      ...(flags.s ? { s: true } : {}),
      ...(flags.mark ? { mark: true } : {}),
      ...(link ? { href: link.href, ...(link.wiki ? { wiki: true } : {}) } : {}),
      ...extra,
    }
    const start = plain.length
    plain += t
    if (cur && sameStyle(cur, style)) cur.end = plain.length
    else {
      cur = { start, end: plain.length, ...style }
      runs.push(cur)
    }
  }
  /** Source kept as written: a run of its own, so the editor can hold on to it. */
  const pushRaw = (t: string, from: number, raw: string) => {
    push(t, from, { raw })
    cur = null
  }
  const n = src.length
  let i = 0
  while (i < n) {
    const ch = src[i]
    if (ch === '\\' && i + 1 < n && ESCAPABLE.includes(src[i + 1])) {
      pushRaw(src[i + 1], i + 1, src.slice(i, i + 2))
      i += 2
      continue
    }
    if (ch === '`') {
      let ticks = 1
      while (src[i + ticks] === '`') ticks++
      const j = closingTicks(src, i + ticks, ticks)
      if (j > i + ticks) {
        let from = i + ticks
        let to = j
        // One space just inside both ends is padding (it lets code start or end with a backtick).
        if (src[from] === ' ' && src[to - 1] === ' ' && to - from > 2 && src.slice(from, to).trim()) { from++; to-- }
        push(src.slice(from, to), from, { code: true, raw: src.slice(i, j + ticks) })
        cur = null
        i = j + ticks
      } else {
        // No closing run: the backticks are just backticks.
        push(src.slice(i, i + ticks), i)
        i += ticks
      }
      continue
    }
    if (ch === '$') {
      const math = mathAt(src, i)
      if (math) {
        pushRaw(math, i, math)
        i += math.length
        continue
      }
    }
    if (src.startsWith('![[', i)) {
      const j = src.indexOf(']]', i + 3)
      if (j > i + 2) {
        const inner = src.slice(i + 3, j)
        const bar = inner.indexOf('|')
        const file = (bar >= 0 ? inner.slice(0, bar) : inner).trim()
        const alias = bar >= 0 ? inner.slice(bar + 1).trim() : undefined
        const kind = embedKind(file)
        if (kind === 'other') {
          link = { href: file, wiki: true }
          push(alias || file, -1, { raw: src.slice(i, j + 2) })
          link = null
          cur = null
        } else {
          embeds.push({ file, alias: alias || undefined, kind })
          media?.push([i, j + 2])
          // the embed sat on its own line: drop that one line break (the one before it, else the one after)
          if (plain.endsWith('\n')) {
            plain = plain.slice(0, -1)
            const last = runs[runs.length - 1]
            if (last && last.end > plain.length) last.end = plain.length
            if (last && last.end <= last.start) {
              runs.pop()
              if (cur === last) cur = runs[runs.length - 1] ?? null
            }
            i = j + 2
          } else if (src[j + 2] === '\n') i = j + 3
          else i = j + 2
          continue
        }
        i = j + 2
        continue
      }
    }
    if (src.startsWith('[[', i)) {
      const j = src.indexOf(']]', i + 2)
      if (j > i + 1) {
        const inner = src.slice(i + 2, j)
        const bar = inner.indexOf('|')
        const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim()
        const label = bar >= 0 ? inner.slice(bar + 1) : inner
        // No target to open: `[[|alias]]` stays as written.
        if (target) {
          link = { href: target, wiki: true }
          push(label || target, label ? (bar >= 0 ? i + 3 + bar : i + 2) : -1, { raw: src.slice(i, j + 2) })
          link = null
          // Two links side by side stay two links.
          cur = null
          i = j + 2
          continue
        }
      }
    }
    if (ch === '[') {
      const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(src.slice(i))
      if (m) {
        link = { href: m[2], wiki: false }
        push(m[1] || m[2], m[1] ? i + 1 : i + 3, { raw: m[0] })
        link = null
        cur = null
        i += m[0].length
        continue
      }
    }
    if (ch === '#') {
      const tag = tagAt(src, i)
      if (tag) {
        push('#' + tag, i, { tag: true })
        i += tag.length + 1
        // The tag's run must not swallow the text after it.
        cur = null
        continue
      }
    }
    if (src.startsWith('<u>', i) && src.indexOf('</u>', i + 3) >= 0) {
      flags.u = true
      i += 3
      continue
    }
    if (src.startsWith('</u>', i) && flags.u) {
      flags.u = false
      i += 4
      continue
    }
    if (ch === '<') {
      const tag = HTML_RE.exec(src.slice(i, i + 400))
      if (tag) {
        pushRaw(tag[0], i, tag[0])
        i += tag[0].length
        continue
      }
    }
    // Bold and italic both open: *** closes both, so a following * can reopen the italic.
    if (flags.b && flags.i && boldMarker === '**' && italicMarker === '*' && src.startsWith('***', i)) {
      flags.b = flags.i = false
      boldMarker = italicMarker = null
      i += 3
      continue
    }
    let took = false
    for (const [marker, key] of [
      ['**', 'b'],
      ['__', 'b'],
      ['~~', 's'],
      ['==', 'mark'],
    ] as const) {
      if (!src.startsWith(marker, i)) continue
      const under = marker === '__'
      const open = !flags[key]
      let can = true
      if (open) {
        // An escaped marker ahead is not a closer; `__` opens only outside a word.
        const close = under ? closingUnderscores(src, i + 2) : nextUnescaped(src, marker, i + 2)
        can = close >= 0 && (!under || i === 0 || !WORD_CHAR.test(src[i - 1]))
      } else if (under) {
        // `__` closes only where a word does not continue.
        can = i + 2 >= n || !WORD_CHAR.test(src[i + 2])
      }
      if (can) {
        flags[key] = !flags[key]
        if (key === 'b') boldMarker = flags.b ? marker : null
        i += 2
        took = true
      } else if (under && !(flags.i && italicMarker === '_')) {
        // An intraword `__` that cannot pair is literal, both characters, so its tail cannot open `_`.
        push(marker, i)
        i += 2
        took = true
      } else if (marker === '**' && !(flags.i && italicMarker === '*')) {
        // A `**` that cannot pair gives up one `*` as text; the other may still open an italic, as Obsidian reads `**Note*`.
        push('*', i)
        i += 1
        took = true
      }
      break
    }
    if (took) continue
    if (ch === '*' || ch === '_') {
      if (flags.i && italicMarker === ch) {
        flags.i = false
        italicMarker = null
        i++
        continue
      }
      const wordStart = ch === '*' || i === 0 || !WORD_CHAR.test(src[i - 1])
      // The closer must not be escaped, and `_` must not close inside a word.
      const close = ch === '*' ? nextUnescaped(src, ch, i + 1) : closingUnderscore(src, i + 1)
      const closeOk = close > i + 1 && (ch === '*' || close + 1 >= n || !WORD_CHAR.test(src[close + 1]))
      if (!flags.i && wordStart && closeOk) {
        flags.i = true
        italicMarker = ch
        i++
        continue
      }
    }
    push(ch, i)
    i++
  }
  return { plain, runs, embeds }
}

export function plainText(src: string): string {
  return src.includes('*') || src.includes('_') || src.includes('~') || src.includes('=') || src.includes('`') || src.includes('[') || src.includes('<') || src.includes('\\') || src.includes('!')
    ? parseInline(src).plain
    : src
}
