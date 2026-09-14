import { useEffect, useState } from 'react'
import { hexToHsl, hslToHex, isHex, type HSL } from '../colour'

interface Props {
  /** The colour being edited, hex. */
  value: string
  /** Saturation and lightness a hue-only pick lands in — the theme's own tone. */
  tone: { s: number; l: number }
  onChange: (hex: string) => void
  /** Back to where the picker came from (the swatch row), keeping the colour. */
  onBack?: () => void
  /** Empty the slot, or put the base colour back. */
  onRemove?: () => void
  removeName?: string
  /** True when removing takes something away for good; the button reads as such. */
  destructive?: boolean
  onDone: () => void
}

const IconTrash = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 4.5h10M6.5 4.5v-1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8M6.8 7v4M9.2 7v4" />
  </svg>
)
const IconReset = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2M3.5 2.8v2.4h2.4" />
  </svg>
)
const IconTick = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8.5l3.2 3.2L13 5" />
  </svg>
)

const IconBack = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** obsidian: one small view for editing a colour, the same on the bar and in the panel. A header
 *  with the way back, the colour and its hex, and the two actions; under it three sliders — hue,
 *  saturation, lightness — each a gradient of what it changes, labelled by a letter. */
export function ColourPicker({ value, tone, onChange, onBack, onRemove, removeName = 'Remove', destructive = true, onDone }: Props) {
  const [hsl, setHsl] = useState<HSL>(() => (isHex(value) ? hexToHsl(value) : { h: 210, ...tone }))
  const [hexText, setHexText] = useState(value)
  // A new colour from outside (another slot) resets the sliders.
  useEffect(() => {
    if (isHex(value) && hslToHex(hsl) !== value.toLowerCase()) setHsl(hexToHsl(value))
    setHexText(value)
    // Deliberately not every value read here is a dependency.
  }, [value])

  const set = (next: HSL) => {
    setHsl(next)
    const hex = hslToHex(next)
    setHexText(hex)
    onChange(hex)
  }
  const hueTrack = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((h) => hslToHex({ h, s: hsl.s, l: hsl.l })).join(', ')})`
  const satTrack = `linear-gradient(to right, ${hslToHex({ ...hsl, s: 0 })}, ${hslToHex({ ...hsl, s: 100 })})`
  const lightTrack = `linear-gradient(to right, #000, ${hslToHex({ ...hsl, l: 50 })}, #fff)`
  const slider = (key: 'h' | 's' | 'l', label: string, max: number, track: string) => (
    <label className="cp-row" key={key}>
      <span className="cp-key" aria-hidden="true">{key.toUpperCase()}</span>
      <span className="sr-only">{label}</span>
      <input type="range" min={0} max={max} value={hsl[key]} style={{ background: track }} onChange={(e) => set({ ...hsl, [key]: Number(e.currentTarget.value) })} />
    </label>
  )

  return (
    <div className="cp" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="cp-head">
        {onBack && (
          <button type="button" className="icon-btn sm" onClick={onBack}>
            <IconBack />
            <span className="sr-only">Back</span>
          </button>
        )}
        <i className="cp-swatch" style={{ background: hslToHex(hsl) }} />
        <input
          className="cp-hex"
          type="text"
          value={hexText}
          spellCheck={false}
          aria-label="Hex"
          onChange={(e) => {
            const t = e.currentTarget.value.trim()
            setHexText(t)
            const hex = t.startsWith('#') ? t : `#${t}`
            if (isHex(hex)) {
              setHsl(hexToHsl(hex))
              onChange(hex.toLowerCase())
            }
          }}
        />
        <div className="cp-ctas">
          {onRemove && (
            <button type="button" className={`btn is-icon${destructive ? ' is-danger' : ''}`} onClick={onRemove}>
              {destructive ? <IconTrash /> : <IconReset />}
              <span className="sr-only">{removeName}</span>
            </button>
          )}
          <button type="button" className="btn is-icon is-primary" onClick={onDone}>
            <IconTick />
            <span className="sr-only">Done</span>
          </button>
        </div>
      </div>
      {slider('h', 'Hue', 360, hueTrack)}
      {slider('s', 'Saturation', 100, satTrack)}
      {slider('l', 'Lightness', 100, lightTrack)}
    </div>
  )
}
