export interface Theme {
  id: string
  name: string
  dark: boolean
  /** CSS custom properties applied to :root. */
  vars: Record<string, string>
  /** Eight branch colours — index 0-7, inherited down each branch. */
  branches: string[]
}

const BRANCHES_LIGHT = [
  '#c2683c', // terracotta
  '#4a6fa5', // blue
  '#4f8a6b', // green
  '#a3773a', // ochre
  '#8a5a94', // plum
  '#3f8a86', // teal
  '#b0566a', // rose
  '#75823c', // olive
]

const BRANCHES_DARK = [
  '#e08a56',
  '#7aa2dd',
  '#6fbd92',
  '#d3a45c',
  '#b98cc4',
  '#5fbcb6',
  '#e0808f',
  '#a8b85e',
]

export const THEMES: Theme[] = [
  {
    id: 'paper',
    name: 'Paper',
    dark: false,
    branches: BRANCHES_LIGHT,
    vars: {
      '--bg': '#f2f0eb',
      '--surface': '#ffffff',
      '--surface-2': '#faf9f6',
      '--rail': '#eeece6',
      '--stage': '#f7f5f1',
      '--line': 'rgba(35,31,26,0.10)',
      '--line-strong': 'rgba(35,31,26,0.18)',
      '--ink': '#231f1a',
      '--ink-2': 'rgba(35,31,26,0.72)',
      '--ink-3': 'rgba(35,31,26,0.62)',
      '--accent': '#3b6ef5',
      '--accent-soft': 'rgba(59,110,245,0.12)',
      '--danger': '#c73e3e',
      '--edge': 'rgba(35,31,26,0.26)',
      '--shadow-1': '0 1px 2px rgba(35,31,26,0.06), 0 2px 6px rgba(35,31,26,0.05)',
      '--shadow-2': '0 2px 4px rgba(35,31,26,0.07), 0 8px 20px rgba(35,31,26,0.09)',
      '--shadow-3': '0 8px 16px rgba(35,31,26,0.10), 0 24px 48px rgba(35,31,26,0.14)',
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    dark: false,
    branches: [
      '#c25c4c',
      '#3f72c4',
      '#3f8f70',
      '#a07a2e',
      '#7d5aa8',
      '#2f8f96',
      '#b04f74',
      '#6f8438',
    ],
    vars: {
      '--bg': '#eef1f5',
      '--surface': '#ffffff',
      '--surface-2': '#f7f9fc',
      '--rail': '#e7ebf2',
      '--stage': '#f4f6fa',
      '--line': 'rgba(20,28,42,0.10)',
      '--line-strong': 'rgba(20,28,42,0.18)',
      '--ink': '#141c2a',
      '--ink-2': 'rgba(20,28,42,0.72)',
      '--ink-3': 'rgba(20,28,42,0.62)',
      '--accent': '#2f6bff',
      '--accent-soft': 'rgba(47,107,255,0.12)',
      '--danger': '#c73e3e',
      '--edge': 'rgba(20,28,42,0.24)',
      '--shadow-1': '0 1px 2px rgba(20,28,42,0.06), 0 2px 6px rgba(20,28,42,0.05)',
      '--shadow-2': '0 2px 4px rgba(20,28,42,0.07), 0 8px 20px rgba(20,28,42,0.09)',
      '--shadow-3': '0 8px 16px rgba(20,28,42,0.10), 0 24px 48px rgba(20,28,42,0.14)',
    },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    dark: true,
    branches: BRANCHES_DARK,
    vars: {
      '--bg': '#17161a',
      '--surface': '#232227',
      '--surface-2': '#1d1c21',
      '--rail': '#1b1a1f',
      '--stage': '#1f1e23',
      '--line': 'rgba(255,255,255,0.10)',
      '--line-strong': 'rgba(255,255,255,0.20)',
      '--ink': '#eceaf0',
      '--ink-2': 'rgba(236,234,240,0.74)',
      '--ink-3': 'rgba(236,234,240,0.60)',
      '--accent': '#6f96ff',
      '--accent-soft': 'rgba(111,150,255,0.18)',
      '--danger': '#ef6b6b',
      '--edge': 'rgba(255,255,255,0.28)',
      '--shadow-1': '0 1px 2px rgba(0,0,0,0.4)',
      '--shadow-2': '0 2px 4px rgba(0,0,0,0.4), 0 8px 20px rgba(0,0,0,0.45)',
      '--shadow-3': '0 8px 16px rgba(0,0,0,0.45), 0 24px 48px rgba(0,0,0,0.55)',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    dark: true,
    branches: [
      '#f0996a',
      '#79a8f0',
      '#68c79a',
      '#dcae63',
      '#c194d6',
      '#5fc9c4',
      '#ef8ba0',
      '#b3c46a',
    ],
    vars: {
      '--bg': '#0f1420',
      '--surface': '#1a2130',
      '--surface-2': '#151b28',
      '--rail': '#131926',
      '--stage': '#161d2b',
      '--line': 'rgba(190,214,255,0.12)',
      '--line-strong': 'rgba(190,214,255,0.22)',
      '--ink': '#e6edfa',
      '--ink-2': 'rgba(230,237,250,0.74)',
      '--ink-3': 'rgba(230,237,250,0.60)',
      '--accent': '#6f9dff',
      '--accent-soft': 'rgba(111,157,255,0.18)',
      '--danger': '#ef6b6b',
      '--edge': 'rgba(190,214,255,0.30)',
      '--shadow-1': '0 1px 2px rgba(0,0,0,0.45)',
      '--shadow-2': '0 2px 4px rgba(0,0,0,0.45), 0 8px 20px rgba(0,0,0,0.5)',
      '--shadow-3': '0 8px 16px rgba(0,0,0,0.5), 0 24px 48px rgba(0,0,0,0.6)',
    },
  },
]

export const DEFAULT_THEME = 'paper'

/** obsidian: how many colours a map can add to a theme's eight, as branch indices 8–11. */
export const CUSTOM_SLOTS = 4

/** obsidian: the one theme the person defines, kept in the plugin's settings. It starts from a
 *  built-in theme and overrides what shows most: the stage, the accent, the eight branch colours. */
export interface CustomThemeDef {
  name: string
  /** id of the built-in theme whose surfaces and ink it borrows */
  base: string
  stage?: string
  accent?: string
  branches: string[]
}

export const CUSTOM_THEME_ID = 'custom'

export function defaultCustomTheme(): CustomThemeDef {
  return { name: 'Custom', base: 'paper', branches: [...BRANCHES_LIGHT] }
}

let customTheme: Theme = buildCustomTheme(defaultCustomTheme())

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0]
}

const HEX_RE = /^#[0-9a-f]{6}$/i

/** How much light a colour throws back, on the sRGB curve the contrast formulas use. */
function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** What a ring, a caret or a selection outline needs to be found on its background. Not text contrast: these are
 *  shapes several pixels thick, and holding a chosen hue matters more than the 4.5 a letter would need. */
const RING_CONTRAST = 2.4

/**
 * An accent the eye can still find on this stage. Selection rings, the focus ring and the caret are all drawn in
 * the accent, so a custom accent chosen within a whisker of the custom background would leave a selected node
 * looking unselected. The hue the person picked is kept and stays their setting; only how light it is moves here,
 * only as far as it must, and only in what is drawn.
 */
function ringable(accent: string, stage: string): string {
  if (!HEX_RE.test(accent) || !HEX_RE.test(stage)) return accent
  const bg = luminance(hexToRgb(stage))
  const from = hexToRgb(accent)
  if (contrast(luminance(from), bg) >= RING_CONTRAST) return accent
  const hex = (rgb: [number, number, number]) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  const mix = (toward: number, t: number) => from.map((v) => Math.round(v + (toward - v) * t)) as [number, number, number]
  // Both ways out of the background are tried, and the nearest colour that clears the floor wins. Walking one way
  // by a fixed number of steps can stop just short, which is how an accent can still vanish into its stage.
  let best = from
  let bestGap = -1
  for (const toward of [0, 255]) {
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const rgb = mix(toward, t)
      const gap = contrast(luminance(rgb), bg)
      if (gap >= RING_CONTRAST) return hex(rgb)
      if (gap > bestGap) { bestGap = gap; best = rgb }
    }
  }
  // Nothing reached the floor, which only a mid-grey stage can do: the most distinct colour found still wins.
  return hex(best)
}

export function buildCustomTheme(def: CustomThemeDef): Theme {
  const base = THEMES.find((t) => t.id === def.base) ?? THEMES[0]
  const vars = { ...base.vars }
  if (def.stage) {
    vars['--stage'] = def.stage
    vars['--bg'] = def.stage
  }
  if (def.accent) {
    const shown = ringable(def.accent, vars['--stage'] ?? '')
    const [r, g, b] = hexToRgb(shown)
    vars['--accent'] = shown
    vars['--accent-soft'] = `rgba(${r},${g},${b},${base.dark ? 0.18 : 0.12})`
  }
  const branches = base.branches.map((c, i) => (def.branches[i] && /^#[0-9a-f]{6}$/i.test(def.branches[i]) ? def.branches[i] : c))
  return { id: CUSTOM_THEME_ID, name: def.name.trim() || 'Custom', dark: base.dark, vars, branches }
}

/** Called by the host whenever the definition changes; every lookup after sees the new theme. */
export function registerCustomTheme(def: CustomThemeDef): Theme {
  customTheme = buildCustomTheme(def)
  return customTheme
}

/** The built-in themes and the custom one, in the order the Document panel shows them. */
/** obsidian: the theme that follows the app — its stage, surfaces, ink, accent and named colours, read by
 *  the host from its own styles and registered again whenever they change. Here it is only colours. */
export const HOST_THEME_ID = 'obsidian'

/** The host's colours, already resolved: CSS colour strings, with `accent` and `branches` as #rrggbb. */
export interface HostColours {
  name: string
  dark: boolean
  stage: string
  surface: string
  surface2: string
  line: string
  lineStrong: string
  ink: string
  inkMuted: string
  edge: string
  accent: string
  danger: string
  branches: string[]
}

let hostTheme: Theme | null = null

export function buildHostTheme(c: HostColours): Theme {
  // Shadows aren't something an app's theme names; borrow the built-in ones for the same light or dark.
  const like = THEMES.find((t) => t.dark === c.dark) ?? THEMES[0]
  const [r, g, b] = hexToRgb(c.accent)
  const fallback = c.dark ? BRANCHES_DARK : BRANCHES_LIGHT
  return {
    id: HOST_THEME_ID,
    name: c.name,
    dark: c.dark,
    vars: {
      '--bg': c.surface2,
      '--surface': c.surface,
      '--surface-2': c.surface2,
      '--rail': c.surface2,
      '--stage': c.stage,
      '--line': c.line,
      '--line-strong': c.lineStrong,
      '--ink': c.ink,
      // Muted ink twice: an app's faintest text is too faint for labels and counts.
      '--ink-2': c.inkMuted,
      '--ink-3': c.inkMuted,
      '--accent': c.accent,
      '--accent-soft': `rgba(${r},${g},${b},${c.dark ? 0.18 : 0.12})`,
      '--danger': c.danger,
      '--edge': c.edge,
      '--shadow-1': like.vars['--shadow-1'],
      '--shadow-2': like.vars['--shadow-2'],
      '--shadow-3': like.vars['--shadow-3'],
    },
    branches: fallback.map((f, i) => (c.branches[i] && /^#[0-9a-f]{6}$/i.test(c.branches[i]) ? c.branches[i] : f)),
  }
}

/** Called by the host when its colours may have changed (theme, light or dark); null when it has none to offer. */
export function registerHostTheme(c: HostColours | null): void {
  hostTheme = c ? buildHostTheme(c) : null
}

export function allThemes(): Theme[] {
  return [...(hostTheme ? [hostTheme] : []), ...THEMES, customTheme]
}

export function themeById(id: string): Theme {
  if (id === HOST_THEME_ID) return hostTheme ?? THEMES[0]
  if (id === CUSTOM_THEME_ID) return customTheme
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

// obsidian: themes are applied to the view's root element, never to the document.
export function applyTheme(root: HTMLElement, id: string) {
  const theme = themeById(id)
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v)
  theme.branches.forEach((c, i) => root.style.setProperty(`--branch-${i}`, c))
  root.dataset.theme = theme.id
  root.style.colorScheme = theme.dark ? 'dark' : 'light'
}

/** A node's branch colour: one of the theme's eight, or one of the map's own (indices 8 and up,
 *  from `palette`); a custom slot that is empty falls back to the theme colour at that place. */
export function branchColor(themeId: string, branch: number | null, palette?: readonly string[]): string {
  if (branch == null) return 'var(--ink-3)'
  if (branch >= 8) {
    const own = palette?.[branch - 8]
    if (own) return own
  }
  return themeById(themeId).branches[branch % 8]
}
