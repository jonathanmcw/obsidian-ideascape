interface P {
  size?: number
}

const base = (size = 16) => ({
  // Every icon carries the class the stylesheet weights: drawn on a 16 grid, they take two thirds of Obsidian's
  // 24-grid stroke, so they sit at the same optical weight as the app's own icons above them.
  className: 'io-icon',
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

/** One thing lit, the rest dimmed: what Focus does. */
export const IconFocus = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="6" opacity="0.45" />
  </svg>
)

/** Three bars, ragged the way the text will be. */
export const IconAlign = ({ align, size = 16 }: { align: 'left' | 'center' | 'right'; size?: number }) => (
  <svg className="io-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    {[1, 0.6, 0.85].map((w, i) => {
      const width = w * 12
      const x = align === 'left' ? 2 : align === 'right' ? 14 - width : 8 - width / 2
      return <rect key={i} x={x} y={3 + i * 4} width={width} height="2" rx="1" fill="currentColor" />
    })}
  </svg>
)

/** A small tidy tree: the Mind map. */
export const IconAuto = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="3.25" cy="8" r="1.5" />
    <path d="M4.75 8h2.5M7.25 8V4.25h2.25M7.25 8v3.75h2.25" />
    <circle cx="11.5" cy="4.25" r="1.5" />
    <circle cx="11.5" cy="11.75" r="1.5" />
  </svg>
)

/** A node over a bar with three below it: the Org chart. */
export const IconOrg = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="8" cy="3.25" r="1.5" />
    <path d="M8 4.75v2.5M3.25 9.5V7.25h9.5V9.5M8 7.25V9.5" />
    <circle cx="3.25" cy="11.5" r="1.5" />
    <circle cx="8" cy="11.5" r="1.5" />
    <circle cx="12.75" cy="11.5" r="1.5" />
  </svg>
)

export const IconExport = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M8 10.5V2.5M8 2.5 5.2 5.3M8 2.5l2.8 2.8" />
    <path d="M2.75 9.75v2.5A1.25 1.25 0 0 0 4 13.5h8a1.25 1.25 0 0 0 1.25-1.25v-2.5" />
  </svg>
)

export const IconPlus = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
)

export const IconMinus = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3.5 8h9" />
  </svg>
)

/** Back to where a panel came from. */
export const IconBack = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M10 3L5 8l5 5" />
  </svg>
)

/** Put a colour back to the theme's own. */
export const IconReset = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2M3.5 2.8v2.4h2.4" />
  </svg>
)

export const IconChevron = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M6 4l4 4-4 4" />
  </svg>
)

export const IconTrash = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 4.5h10M6.5 4.5V3.2A.7.7 0 0 1 7.2 2.5h1.6a.7.7 0 0 1 .7.7v1.3" />
    <path d="M4.4 4.5l.5 8a1 1 0 0 0 1 .95h4.2a1 1 0 0 0 1-.95l.5-8" />
  </svg>
)

export const IconUndo = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 7.5h6.4a3.1 3.1 0 1 1 0 6.2H6.5" />
    <path d="M5.4 4.6 2.6 7.5l2.8 2.9" />
  </svg>
)

export const IconClose = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
)

export const IconSliders = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M2.5 4.5h4M9.5 4.5h4M2.5 11.5h6M11.5 11.5h2" />
    <circle cx="8" cy="4.5" r="1.6" />
    <circle cx="10" cy="11.5" r="1.6" />
  </svg>
)

/** A wand: Tidy lays the branches out again, once. */
export const IconTidy = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M2.5 13.5l7.2-7.2" />
    <path d="M11.2 2.2l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" fill="currentColor" stroke="none" />
    <path d="M13 9.5l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z" fill="currentColor" stroke="none" />
  </svg>
)

/** Four arrows: the Free layout, positions you give yourself. */
export const IconFree = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M8 2.5v11M2.5 8h11" />
    <path d="M6 4.5L8 2.5l2 2M6 11.5l2 2 2-2M4.5 6l-2 2 2 2M11.5 6l2 2-2 2" />
  </svg>
)

/** A narrow column between margins. */
export const IconColumn = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="5.25" y="2.5" width="5.5" height="11" rx="1.2" />
    <path d="M2 4v8M14 4v8" opacity="0.4" />
  </svg>
)

/** A column stretched to the margins. */
export const IconFull = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.2" />
    <path d="M4.5 6.5h7M4.5 9.5h5" opacity="0.6" />
  </svg>
)

export const IconFit = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M2.5 6V3.5A1 1 0 0 1 3.5 2.5H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />
  </svg>
)

export const IconRedo = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M13 7.5H6.6a3.1 3.1 0 1 0 0 6.2h2.9" />
    <path d="M10.6 4.6l2.8 2.9-2.8 2.9" />
  </svg>
)

export const IconMore = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
  </svg>
)

export const IconIndent = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M2.5 3.5h11M7 8h6.5M7 12.5h6.5" />
    <path d="M2.5 6.5L4.5 8l-2 1.5" />
  </svg>
)

export const IconOutdent = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M2.5 3.5h11M7 8h6.5M7 12.5h6.5" />
    <path d="M4.5 6.5L2.5 8l2 1.5" />
  </svg>
)

/** Return without leaving the node: a line break, not a new sibling. */
export const IconNewLine = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M13.5 3.5v3A3.5 3.5 0 0 1 10 10H3" />
    <path d="M5.5 7.5 3 10l2.5 2.5" />
  </svg>
)

export const IconCheck = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 8.5l3.2 3.2L13 5" />
  </svg>
)

/** 1. 2. 3. — a numbered list. */
export const IconNumbered = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M7 4h6.5M7 8h6.5M7 12h6.5" />
    <path d="M2.4 3.2L3.6 2.4v3.4M2.3 8.1c.2-.9 1.9-1 1.9 0 0 .8-1.8 1.4-1.9 2.4h2.1M2.3 11.4h1.4c1.2 0 1.2 1.3.2 1.3h-.4.4c1.1 0 1.1 1.4-.2 1.4H2.3" strokeWidth="1.2" />
  </svg>
)

/** A ticked box — a task item. */
export const IconCheckbox = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
    <path d="M5.2 8.2l2 2 3.8-4.2" />
  </svg>
)
