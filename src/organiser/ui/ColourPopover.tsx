import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ColourPicker } from './ColourPicker'

interface Props {
  /** The swatch the popover hangs from. */
  anchor: HTMLElement | null
  value: string
  tone: { s: number; l: number }
  onChange: (hex: string) => void
  /** Empty the slot, or put a theme colour back. */
  onRemove?: () => void
  removeName?: string
  /** False when "remove" only puts a default back. */
  destructive?: boolean
  onClose: () => void
}

/** obsidian: a colour picker floating under its swatch — hue, saturation, lightness and hex, no
 *  words to read. Closes on a click anywhere else, Esc, or a scroll. It is portalled onto the
 *  panel itself (not its scrolling body), so the body's scrolling never clips it — and it stays
 *  inside the panel, because Obsidian's leaves contain their descendants. */
export function ColourPopover({ anchor, value, tone, onChange, onRemove, removeName = 'Remove', destructive = true, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number } | null>(null)
  const panel = anchor?.closest<HTMLElement>('.inspector') ?? null

  useLayoutEffect(() => {
    if (!anchor || !panel) return
    const r = anchor.getBoundingClientRect()
    const p = panel.getBoundingClientRect()
    const h = ref.current?.offsetHeight ?? 160
    const below = r.bottom - p.top + 6
    const top = below + h > p.height - 8 ? Math.max(8, r.top - p.top - h - 6) : below
    setPos({ top })
  }, [anchor, panel])

  useEffect(() => {
    const body = panel?.querySelector('.inspector-body')
    if (!body) return
    body.addEventListener('scroll', onClose, { once: true })
    return () => body.removeEventListener('scroll', onClose)
  }, [panel, onClose])

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor?.contains(t)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // obsidian: the swatch's own document — a popped-out window has its own.
    const doc = anchor?.ownerDocument ?? document
    doc.addEventListener('pointerdown', down, true)
    doc.addEventListener('keydown', key, true)
    return () => {
      doc.removeEventListener('pointerdown', down, true)
      doc.removeEventListener('keydown', key, true)
    }
  }, [anchor, onClose])

  if (!panel) return null
  return createPortal(
    <div ref={ref} className="cpop" role="dialog" style={pos ? { top: pos.top } : { visibility: 'hidden' }} onPointerDown={(e) => e.stopPropagation()}>
      <ColourPicker value={value} tone={tone} onChange={onChange} onRemove={onRemove} removeName={removeName} destructive={destructive} onDone={onClose} />
    </div>,
    panel,
  )
}
