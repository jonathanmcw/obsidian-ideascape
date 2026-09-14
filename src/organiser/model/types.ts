export type NodeId = string

/** A single idea. The same node is drawn in all three shapes — only its
 *  geometry and chrome change, which is what makes the Shift possible. */
export interface IONode {
  id: NodeId
  text: string
  parent: NodeId | null
  /** Ordered — this order is the outline order, and the map's sibling order. */
  children: NodeId[]
  collapsed: boolean
  /** Canvas-shape position, in world coordinates, node centre. Persisted. */
  x: number
  y: number
  /** Branch colour index (0-7). Assigned at depth 1 and inherited downwards.
   *  null on the root, which is always neutral. */
  branch: number | null
  /** obsidian: a width the person set by dragging the pill's edge; text wraps inside it. Map only. */
  width?: number
  /** obsidian: heading level 1–3; undefined is body text. Written as `- ## text` in the file. */
  size?: 1 | 2 | 3
  /** obsidian: which side of the root this branch hangs on in the tidy map, once
   *  the person has dragged a branch across. Root children only; unset = balanced. */
  side?: -1 | 1
  /** Text alignment inside the pill. Only visible on a node of more than one
   *  line — a single-line pill is exactly as wide as its text. Undefined means
   *  the shape's default: centred in the Map and Canvas, left in the Outline. */
  align?: Align
  /** obsidian: a numbered item — `1. text` in the file. Its number is its place among the
   *  numbered siblings around it, worked out when drawn or written, never stored. */
  ordered?: true
  /** obsidian: a task — `- [ ] text` in the file. The character between the brackets:
   *  ' ' open, 'x' done; any other is one of Obsidian's custom states and is kept as it is. */
  task?: string
}

export type Align = 'left' | 'center' | 'right'

/** A non-tree connection. Drawn only in the Canvas shape; the Outline shows a
 *  count chip instead, and the Map hides them so the tree stays legible. */
export interface FreeLink {
  id: string
  from: NodeId
  to: NodeId
}

export interface IODoc {
  id: string
  name: string
  rootId: NodeId
  nodes: Record<NodeId, IONode>
  links: FreeLink[]
  createdAt: number
  updatedAt: number
  /** obsidian: text around the list that the Markdown format preserves verbatim (see MdExtras). */
  md?: {
    frontmatter?: string
    preamble?: string
    heading?: 'plain' | 'id'
    intro?: string
    between?: { after: NodeId; text: string; beforeChildren?: true }[]
    postscript?: string
    trailer?: string
    rawGeometry?: string
    eol?: '\r\n'
  }
  /** obsidian: set by the Markdown reader when some node has no stored position. */
  needsLayout?: boolean
  /** obsidian: the nodes without a stored position, when others have one; seedCanvasPositions places only these. */
  unplaced?: NodeId[]
  /** obsidian: theme, node style and layout pinned by this map; see DocLook. */
  look?: DocLook
}

// obsidian: the Map and the Canvas are one shape, laid out as a mind map, an org chart, or free.
export type Shape = 'map' | 'outline'

export const SHAPES: Shape[] = ['map', 'outline']

export const SHAPE_LABEL: Record<Shape, string> = {
  map: 'Map',
  outline: 'Outline',
}

/** How a frame's boxes were produced. The Map shape is 'map' (mind map), 'org' (org chart) or 'canvas' (stored x/y). */
export type LayoutKind = 'map' | 'org' | 'outline' | 'canvas'
/** obsidian: where the Map shape puts nodes. 'auto' is the Mind map — the name files have always used for it —
 *  'org' the Org chart, 'free' the positions the person gives them. */
export type MapLayout = 'auto' | 'org' | 'free'
/** obsidian: the layouts that place nodes themselves. Free follows one of them: see DocLook.arrange. */
export type Arrangement = Exclude<MapLayout, 'free'>

/** obsidian: the Org chart is built and tested but hidden until it has had more use. Off, the toolbar, ⌘3 and
 *  Settings offer Mind map and Free, and a file that pins 'org' shows the Mind map — and keeps saying 'org' until
 *  its layout is changed, so turning this back on brings those maps back as they were. */
export const ORG_CHART = false

/** The ⌘3 cycle, in order, and what the toggle, the HUD and Settings call each layout. */
export const MAP_LAYOUTS: MapLayout[] = ORG_CHART ? ['auto', 'org', 'free'] : ['auto', 'free']

export const LAYOUT_LABEL: Record<MapLayout, string> = {
  auto: 'Mind map',
  org: 'Org chart',
  free: 'Free',
}
/** How a node wears its branch colour. */
export type NodeStyle = 'bar' | 'outline' | 'filled'
/** obsidian: the map's own look, saved in the file so it reads the same wherever it is
 *  opened. A key left unset follows the plugin's defaults for new maps. */
export interface DocLook {
  theme?: string
  nodeStyle?: NodeStyle
  layout?: MapLayout
  /** obsidian: the arrangement the stored positions were laid out as — the one Free starts from and Tidy lays out
   *  again. Unset is the Mind map. Switching to Free from the other arrangement lays the positions out as that one. */
  arrange?: Arrangement
  /** obsidian: the map's own branch colours, hex, by slot — branch indices 8 and up. '' is an empty slot. */
  palette?: string[]
  /** obsidian: the dot grid behind the map; unset means shown. */
  dots?: boolean
  /** obsidian: free layout drops and nudges land on the grid. */
  snap?: boolean
}
