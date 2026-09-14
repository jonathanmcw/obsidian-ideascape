import type { ReactNode } from 'react'
import { parseInline, safeHref, type Run } from '../model/inline'

interface Props {
  text: string
  /** The wrapped lines of the *plain* text, as the layout measured them. */
  lines: string[]
  onOpenLink: (href: string, wiki: boolean) => void
  onHoverLink?: (target: HTMLElement, href: string, event: MouseEvent) => void
  /** obsidian: a #tag chip was clicked; the host searches the vault for it. */
  onOpenTag?: (tag: string) => void
}

function paint(t: string, run: Run, key: string, onOpenLink: Props['onOpenLink'], onHoverLink?: Props['onHoverLink'], onOpenTag?: Props['onOpenTag']): ReactNode {
  let el: ReactNode = t
  if (run.tag) {
    const tag = t.replace(/^#/, '')
    return (
      <a
        key={key + 't'}
        className="node-tag"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpenTag?.(tag)
        }}
      >
        {t}
      </a>
    )
  }
  if (run.code) el = <code key={key}>{el}</code>
  if (run.b) el = <b key={key + 'b'}>{el}</b>
  if (run.i) el = <i key={key + 'i'}>{el}</i>
  if (run.u) el = <u key={key + 'u'}>{el}</u>
  if (run.s) el = <s key={key + 's'}>{el}</s>
  if (run.mark) el = <mark key={key + 'm'}>{el}</mark>
  if (run.href) {
    const wiki = !!run.wiki
    const href = wiki ? run.href : safeHref(run.href)
    // obsidian: an address that isn't the web, mail or Obsidian is shown as its text, never opened.
    if (!href) return el
    el = (
      <a
        key={key + 'a'}
        className="node-link"
        href={wiki ? undefined : href}
        title={wiki ? `Open “${href}”` : href}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseOver={(e) => wiki && onHoverLink?.(e.currentTarget, href, e.nativeEvent)}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpenLink(href, wiki)
        }}
      >
        {el}
      </a>
    )
  }
  return el
}

/** obsidian: the node's text with its inline Markdown painted, line by line as laid out. */
export function RichLabel({ text, lines, onOpenLink, onHoverLink, onOpenTag }: Props) {
  const rich = parseInline(text)
  if (!rich.runs.some((r) => r.b || r.i || r.u || r.s || r.mark || r.code || r.href || r.tag)) return <>{lines.join('\n')}</>
  const out: ReactNode[] = []
  let cursor = 0
  lines.forEach((line, li) => {
    if (li) out.push('\n')
    const start = rich.plain.indexOf(line, cursor)
    if (start < 0) {
      out.push(line)
      return
    }
    const end = start + line.length
    cursor = end
    for (const run of rich.runs) {
      const s = Math.max(run.start, start)
      const e = Math.min(run.end, end)
      if (e <= s) continue
      out.push(paint(rich.plain.slice(s, e), run, `${li}-${s}`, onOpenLink, onHoverLink, onOpenTag))
    }
  })
  return <>{out}</>
}
