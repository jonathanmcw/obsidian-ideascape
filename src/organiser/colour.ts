/**
 * obsidian: small colour helpers for the palette and the custom theme — hex ↔ HSL, the hue a
 * colour sits at, and the tone (saturation, lightness) a theme's branch colours share, so a
 * colour picked by hue alone lands in the same family as the theme's own.
 */
export interface HSL {
  h: number // 0–360
  s: number // 0–100
  l: number // 0–100
}

export const HEX_RE = /^#[0-9a-f]{6}$/i

export function isHex(s: unknown): s is string {
  return typeof s === 'string' && HEX_RE.test(s)
}

export function hexToHsl(hex: string): HSL {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return { h: 0, s: 0, l: 50 }
  const r = parseInt(m[1], 16) / 255
  const g = parseInt(m[2], 16) / 255
  const b = parseInt(m[3], 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d > 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return { h: Math.round(h) % 360, s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hslToHex({ h, s, l }: HSL): string {
  const S = Math.min(100, Math.max(0, s)) / 100
  const L = Math.min(100, Math.max(0, l)) / 100
  const H = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * L - 1)) * S
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1))
  const m = L - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (H < 60) [r, g, b] = [c, x, 0]
  else if (H < 120) [r, g, b] = [x, c, 0]
  else if (H < 180) [r, g, b] = [0, c, x]
  else if (H < 240) [r, g, b] = [0, x, c]
  else if (H < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

export function hueOf(hex: string): number {
  return hexToHsl(hex).h
}

/** The colours' indices, ordered by hue around the wheel from red. */
export function sortByHue(colors: string[]): number[] {
  return colors.map((c, i) => [hueOf(c), i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i)
}

/** The saturation and lightness the colours share, on average — a theme's tone. */
export function toneOf(colors: string[]): { s: number; l: number } {
  if (!colors.length) return { s: 55, l: 55 }
  let s = 0
  let l = 0
  for (const c of colors) {
    const v = hexToHsl(c)
    s += v.s
    l += v.l
  }
  return { s: Math.round(s / colors.length), l: Math.round(l / colors.length) }
}

/** A colour at this hue in the given tone. */
export function withHue(h: number, tone: { s: number; l: number }): string {
  return hslToHex({ h, s: tone.s, l: tone.l })
}
