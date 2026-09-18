import type { IODoc, LayoutKind, MapLayout, NodeId, Shape } from '../model/types.ts'
import { rootSides, walk } from '../model/doc.ts'
import { ROW_GAP, metricsFor, outlineIndent } from './measure.ts'

export interface Box {
  /** Centre for map/canvas; left edge for outline rows. Always vertical centre. */
  x: number
  y: number
  w: number
  h: number
  depth: number
  /** Which way this node's children fan out. -1 left, 1 right, 0 n/a. */
  dir: -1 | 0 | 1
  /** One of a run of leaves stacked in a column under its parent: in the Org chart, and in Free while they still
   *  hang that way. */
  stack?: true
}

export interface Frame {
  shape: LayoutKind
  boxes: Record<NodeId, Box>
  /** Stagger order for the Shift — parents move first, then their children. */
  order: NodeId[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

const LEVEL_GAP = 54
const SIBLING_GAP = 12

/** Left edge of a box, regardless of anchoring. */
export function leftOf(b: Box, shape: LayoutKind): number {
  return shape === 'outline' ? b.x : b.x - b.w / 2
}
/** Which side of a node its knob and count stand on: the branch's outer edge, away from the root. The map's own
 *  layouts record that as the box's direction. The Free layout stores positions and nothing else, so every box reads
 *  dir 0 and everything would sit on the right, on both sides of the root — the same map, rearranged, answering
 *  differently. There it is read from where the node actually sits. */
export function knobOnRight(box: Box, kind: LayoutKind, rootX?: number): boolean {
  if (kind === 'canvas' && rootX !== undefined) return box.x >= rootX
  return box.dir >= 0
}

export function rightOf(b: Box, shape: LayoutKind): number {
  return shape === 'outline' ? b.x + b.w : b.x + b.w / 2
}

function boundsOf(boxes: Record<NodeId, Box>, shape: LayoutKind) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of Object.values(boxes)) {
    minX = Math.min(minX, leftOf(b, shape))
    maxX = Math.max(maxX, rightOf(b, shape))
    minY = Math.min(minY, b.y - b.h / 2)
    maxY = Math.max(maxY, b.y + b.h / 2)
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

/* ------------------------------------------------------------------ *
 * Map — root at the centre, branches fanning left and right. First half
 * of the root's children go left, the rest go right.
 * ------------------------------------------------------------------ */

interface SizedTree {
  id: string
  w: number
  h: number
  /** Height of the whole subtree band. */
  band: number
  children: SizedTree[]
}

function buildSized(doc: IODoc, id: NodeId, shape: LayoutKind): SizedTree {
  const n = doc.nodes[id]
  const m = metricsFor(doc, id, shape)
  const kids = n.collapsed ? [] : n.children.map((c) => buildSized(doc, c, shape))
  const stacked = kids.length
    ? kids.reduce((sum, k) => sum + k.band, 0) + SIBLING_GAP * (kids.length - 1)
    : 0
  return { id, w: m.w, h: m.h, band: Math.max(m.h, stacked), children: kids }
}

function placeSide(
  t: SizedTree,
  cx: number,
  cy: number,
  dir: -1 | 1,
  depth: number,
  out: Record<NodeId, Box>,
  order: NodeId[],
) {
  out[t.id] = { x: cx, y: cy, w: t.w, h: t.h, depth, dir }
  order.push(t.id)
  if (!t.children.length) return
  const total = t.children.reduce((s, k) => s + k.band, 0) + SIBLING_GAP * (t.children.length - 1)
  let cursor = cy - total / 2
  for (const k of t.children) {
    const kcy = cursor + k.band / 2
    const edge = dir === 1 ? cx + t.w / 2 + LEVEL_GAP : cx - t.w / 2 - LEVEL_GAP
    const kcx = dir === 1 ? edge + k.w / 2 : edge - k.w / 2
    placeSide(k, kcx, kcy, dir, depth + 1, out, order)
    cursor += k.band + SIBLING_GAP
  }
}

export function mapLayout(doc: IODoc, rootId: NodeId = doc.rootId): Frame {
  const tree = buildSized(doc, rootId, 'map')
  const boxes: Record<NodeId, Box> = {}
  const order: NodeId[] = [rootId]

  boxes[rootId] = { x: 0, y: 0, w: tree.w, h: tree.h, depth: 0, dir: 0 }

  const kids = tree.children
  const sides = rootSides(doc)
  const left = kids.filter((k) => sides[k.id] === -1)
  const right = kids.filter((k) => sides[k.id] !== -1)

  for (const [group, dir] of [
    [left, -1],
    [right, 1],
  ] as [SizedTree[], -1 | 1][]) {
    if (!group.length) continue
    const total = group.reduce((s, k) => s + k.band, 0) + SIBLING_GAP * (group.length - 1)
    let cursor = -total / 2
    for (const k of group) {
      const kcy = cursor + k.band / 2
      const edge = dir === 1 ? tree.w / 2 + LEVEL_GAP : -tree.w / 2 - LEVEL_GAP
      const kcx = dir === 1 ? edge + k.w / 2 : edge - k.w / 2
      placeSide(k, kcx, kcy, dir, 1, boxes, order)
      cursor += k.band + SIBLING_GAP
    }
  }

  return { shape: 'map', boxes, order, bounds: boundsOf(boxes, 'map') }
}

/* ------------------------------------------------------------------ *
 * Org chart — the tree from the top down: the root at the top, each
 * level a row below it. A node sits centred over the span of its
 * children's boxes; each branch keeps a block of its own, so no two
 * branches share any width. Rows are top-aligned: a row starts below
 * the tallest node of the row above, whichever branch that is in.
 *
 * Compact leaves: below the root, four or more children with nothing under any of them
 * (leaves, or folded) stack in one column to the right of a spine down
 * from the parent's centre, instead of one very wide row.
 * ------------------------------------------------------------------ */

/** Vertical gap between rows; the elbows cross it halfway. */
export const ORG_ROW_GAP = 60
/** Horizontal gap between neighbouring branches in a row. */
const ORG_SIBLING_GAP = 20
/** From the spine to the left edge of a stacked leaf. */
const ORG_STACK_INDENT = 20
/** How many leaves it takes before they stack. */
export const ORG_STACK_MIN = 4

interface OrgTree {
  id: NodeId
  w: number
  h: number
  depth: number
  children: OrgTree[]
  /** The children stack in a column rather than spread along a row. */
  stacked: boolean
  /** Horizontal reach of the whole branch, from the node's centre. */
  left: number
  right: number
  /** Each child's centre x, from this node's centre. */
  offsets: number[]
}

function buildOrg(doc: IODoc, id: NodeId, depth: number): OrgTree {
  const n = doc.nodes[id]
  const m = metricsFor(doc, id, 'org')
  const children = n.collapsed ? [] : n.children.map((c) => buildOrg(doc, c, depth + 1))
  // Never under the root: an org chart's top level always spreads along its row, even while its branches are empty.
  const stacked = depth > 0 && children.length >= ORG_STACK_MIN && children.every((k) => !k.children.length)
  const t: OrgTree = { id, w: m.w, h: m.h, depth, children, stacked, left: -m.w / 2, right: m.w / 2, offsets: [] }
  if (!children.length) return t
  if (stacked) {
    t.offsets = children.map((k) => ORG_STACK_INDENT + k.w / 2)
    t.right = Math.max(t.right, ...children.map((k) => ORG_STACK_INDENT + k.w))
    return t
  }
  // Branches side by side, then centred as a group under the span of the children's own boxes.
  const at: number[] = []
  let cursor = 0
  children.forEach((k, i) => {
    at.push(i === 0 ? -k.left : cursor - k.left)
    cursor = at[i] + k.right + ORG_SIBLING_GAP
  })
  const first = children[0]
  const last = children[children.length - 1]
  const centre = (at[0] - first.w / 2 + at[at.length - 1] + last.w / 2) / 2
  t.offsets = at.map((x) => x - centre)
  t.left = Math.min(t.left, -centre)
  t.right = Math.max(t.right, at[at.length - 1] + last.right - centre)
  return t
}

export function orgLayout(doc: IODoc, rootId: NodeId = doc.rootId): Frame {
  const tree = buildOrg(doc, rootId, 0)
  // The height of each row: its tallest node, leaving out the stacked leaves, which hang in columns of their own.
  const rowH: number[] = []
  const measure = (t: OrgTree) => {
    rowH[t.depth] = Math.max(rowH[t.depth] ?? 0, t.h)
    if (!t.stacked) t.children.forEach(measure)
  }
  measure(tree)
  // Rows are top-aligned; the root's centre is the origin, as in the Mind map.
  const rowTop: number[] = [-tree.h / 2]
  for (let d = 1; d <= rowH.length; d++) rowTop[d] = rowTop[d - 1] + (rowH[d - 1] ?? 0) + ORG_ROW_GAP

  const boxes: Record<NodeId, Box> = {}
  const order: NodeId[] = []
  const place = (t: OrgTree, cx: number, top: number, stack: boolean) => {
    boxes[t.id] = { x: cx, y: top + t.h / 2, w: t.w, h: t.h, depth: t.depth, dir: 0, ...(stack ? { stack: true as const } : {}) }
    order.push(t.id)
    let y = rowTop[t.depth + 1]
    t.children.forEach((k, i) => {
      if (!t.stacked) return place(k, cx + t.offsets[i], rowTop[k.depth], false)
      place(k, cx + t.offsets[i], y, true)
      y += k.h + SIBLING_GAP
    })
  }
  place(tree, 0, rowTop[0], false)
  return { shape: 'org', boxes, order, bounds: boundsOf(boxes, 'org') }
}

/* ------------------------------------------------------------------ *
 * Outline — one row per visible node, indented by depth.
 * ------------------------------------------------------------------ */

export function outlineLayout(doc: IODoc, rootId: NodeId = doc.rootId): Frame {
  const boxes: Record<NodeId, Box> = {}
  const order: NodeId[] = []
  const rows = walk(doc, rootId, true)
  // obsidian: rows are stacked by their measured height (a wrapped row is taller), with a small gap.
  let y = 0
  for (const { id, depth } of rows) {
    const indent = outlineIndent(depth)
    const m = metricsFor(doc, id, 'outline', depth)
    boxes[id] = { x: indent, y: y + m.h / 2, w: m.w, h: m.h, depth, dir: 0 }
    order.push(id)
    y += m.h + ROW_GAP
  }
  return { shape: 'outline', boxes, order, bounds: boundsOf(boxes, 'outline') }
}

/* ------------------------------------------------------------------ *
 * Canvas — whatever x/y the document stores.
 * ------------------------------------------------------------------ */

export function canvasLayout(doc: IODoc, rootId: NodeId = doc.rootId): Frame {
  const boxes: Record<NodeId, Box> = {}
  const order: NodeId[] = []
  for (const { id, depth } of walk(doc, rootId, true)) {
    const n = doc.nodes[id]
    const m = metricsFor(doc, id, 'canvas')
    boxes[id] = { x: n.x, y: n.y, w: m.w, h: m.h, depth, dir: 0 }
    order.push(id)
  }
  // A run of leaves still hanging in one column below and right of its parent's centre, as the Org chart stacks them,
  // is a stack here too: its connectors run down beside the column, not through the leaves above.
  for (const id of order) {
    const n = doc.nodes[id]
    const pb = boxes[id]
    const kids = n.collapsed ? [] : n.children.map((c) => boxes[c]).filter(Boolean)
    if (kids.length < ORG_STACK_MIN || n.children.some((c) => doc.nodes[c] && !doc.nodes[c].collapsed && doc.nodes[c].children.length)) continue
    const edge = kids[0].x - kids[0].w / 2
    const column = kids.every((k) => Math.abs(k.x - k.w / 2 - edge) < 1 && edge > pb.x && k.y - k.h / 2 >= pb.y + pb.h / 2)
    if (column) for (const c of n.children) if (boxes[c]) boxes[c] = { ...boxes[c], stack: true }
  }
  return { shape: 'canvas', boxes, order, bounds: boundsOf(boxes, 'canvas') }
}

export function kindFor(shape: Shape, mapLayout: MapLayout = 'auto'): LayoutKind {
  return shape === 'outline' ? 'outline' : mapLayout === 'free' ? 'canvas' : mapLayout === 'org' ? 'org' : 'map'
}

export function frameFor(doc: IODoc, kind: LayoutKind, rootId: NodeId = doc.rootId): Frame {
  if (kind === 'outline') return outlineLayout(doc, rootId)
  if (kind === 'canvas') return canvasLayout(doc, rootId)
  if (kind === 'org') return orgLayout(doc, rootId)
  return mapLayout(doc, rootId)
}

export function layoutFor(doc: IODoc, shape: Shape, rootId: NodeId = doc.rootId, mapLayout: MapLayout = 'auto'): Frame {
  return frameFor(doc, kindFor(shape, mapLayout), rootId)
}

/**
 * A fresh layout that keeps what did not change from the one before: each box whose x, y, w, h, depth and dir are
 * the same is the previous Box object, and an unchanged order is the previous array. Typing into one node moves
 * only that node and the ones laid out from it, so a view keyed on box identity redraws those alone.
 */
export function keepBoxes(prev: Frame | null, next: Frame): Frame {
  if (!prev || prev.shape !== next.shape) return next
  const boxes: Record<NodeId, Box> = {}
  for (const id of Object.keys(next.boxes)) {
    const a = prev.boxes[id]
    const b = next.boxes[id]
    boxes[id] = a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.depth === b.depth && a.dir === b.dir && a.stack === b.stack ? a : b
  }
  const sameOrder = prev.order.length === next.order.length && next.order.every((id, i) => prev.order[i] === id)
  return { ...next, boxes, order: sameOrder ? prev.order : next.order }
}

/* ------------------------------------------------------------------ *
 * Focus. One rule across all three shapes: the branch keeps the
 * position it already had, everything else dims, and the camera moves in.
 * Nothing is re-laid-out, so nothing jumps and leaving focus is instant,
 * in the Outline and everywhere else.
 *
 * The Canvas is the one exception: there the
 * other clusters drift outward as well as dimming, because on a free
 * canvas there is no reading order to fall back on.
 * ------------------------------------------------------------------ */

export function applyFocus(doc: IODoc, base: Frame, focusId: NodeId | null): Frame {
  if (!focusId || !doc.nodes[focusId] || focusId === doc.rootId) return base

  if (base.shape === 'canvas') {
    // Non-focused clusters drift outward from the focus, then dim. Stored x/y
    // is untouched — this is purely visual.
    const inFocus = new Set(walk(doc, focusId).map((w) => w.id))
    const anchor = base.boxes[focusId]
    const boxes: Record<NodeId, Box> = {}
    for (const [id, b] of Object.entries(base.boxes)) {
      if (inFocus.has(id)) {
        boxes[id] = b
        continue
      }
      const dx = b.x - anchor.x
      const dy = b.y - anchor.y
      const len = Math.hypot(dx, dy) || 1
      boxes[id] = { ...b, x: b.x + (dx / len) * 40, y: b.y + (dy / len) * 40 }
    }
    return { ...base, boxes, bounds: boundsOf(boxes, base.shape) }
  }

  return base
}

/* ------------------------------------------------------------------ *
 * Connector geometry.
 * ------------------------------------------------------------------ */

export function treePath(parent: Box, child: Box, shape: LayoutKind): string {
  if (shape === 'outline') {
    // Rows don't get tree connectors — indentation is the connector.
    return ''
  }
  if (shape === 'org') return elbowPath(parent, child)
  // Free: a leaf of a stack is reached from the parent's bottom centre, turning into its left edge beside the column.
  if (child.stack) {
    const px = parent.x
    const py = parent.y + parent.h / 2
    const cx = child.x - child.w / 2
    return `M${px} ${py} C${px} ${child.y} ${px} ${child.y} ${cx} ${child.y}`
  }
  // One connector style for both map layouts: the curve leaves the parent's
  // edge and arrives at the child's edge. Auto knows the side from the tidy
  // layout; Free reads it from where the child actually sits. A child parked
  // above or below its parent (spans overlap) is joined top-to-bottom instead
  // of threading a curve through the box.
  const dx = child.x - parent.x
  const dy = child.y - parent.y
  const stored = shape === 'map' ? child.dir : 0
  if (stored === 0 && Math.abs(dx) < (parent.w + child.w) / 2) {
    const down = dy >= 0 ? 1 : -1
    const x1 = parent.x
    const y1 = parent.y + (down * parent.h) / 2
    const x2 = child.x
    const y2 = child.y - (down * child.h) / 2
    const my = y1 + (y2 - y1) * 0.5
    return `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`
  }
  const dir = stored === 0 ? (dx >= 0 ? 1 : -1) : stored
  const x1 = parent.x + (dir * parent.w) / 2
  const y1 = parent.y
  const x2 = child.x - (dir * child.w) / 2
  const y2 = child.y
  const mx = x1 + (x2 - x1) * 0.5
  return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`
}

/** How round an elbow's corners are, so the org chart's lines sit with the map's curves. */
const ELBOW_R = 4

/**
 * Org chart connector: from the parent's bottom centre straight down to halfway across the gap above the child's row,
 * across to above the child, and down into its top centre. A stacked leaf is reached down the spine instead, with a
 * short stub into its left edge. Each is one child's line; drawn together in one path, siblings share the stem and
 * the bar without the shared part being painted twice.
 */
function elbowPath(parent: Box, child: Box): string {
  const px = parent.x
  const py = parent.y + parent.h / 2
  const corner = (len: number) => Math.max(0, Math.min(ELBOW_R, Math.abs(len) / 2))
  if (child.stack) {
    const cx = child.x - child.w / 2
    const cy = child.y
    const r = Math.min(corner(cy - py), corner(cx - px) * 2)
    const sy = Math.sign(cy - py) || 1
    const sx = Math.sign(cx - px) || 1
    return `M${px} ${py} V${cy - sy * r} Q${px} ${cy} ${px + sx * r} ${cy} H${cx}`
  }
  const cx = child.x
  const top = child.y - child.h / 2
  const bar = top - ORG_ROW_GAP / 2
  const dx = cx - px
  if (Math.abs(dx) < 1) return `M${px} ${py} V${bar} H${cx} V${top}`
  const r = Math.min(corner(dx), corner(bar - py) * 2, corner(top - bar) * 2)
  const sx = Math.sign(dx)
  const s1 = Math.sign(bar - py) || 1
  const s2 = Math.sign(top - bar) || 1
  return `M${px} ${py} V${bar - s1 * r} Q${px} ${bar} ${px + sx * r} ${bar} H${cx - sx * r} Q${cx} ${bar} ${cx} ${bar + s2 * r} V${top}`
}

export function linkPath(a: Box, b: Box): string {
  const lift = Math.min(90, Math.max(30, Math.abs(a.x - b.x) * 0.25))
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2 + lift
  return `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`
}

/**
 * obsidian: Snap to grid. The point of a node that lands on a dot is the edge its text is aligned
 * to; with no alignment set, the edge that faces its parent — children fanning right line up by
 * their left edges, the way the tidy layout stacks them — and the root, or a centred node, by its
 * centre. Returns the centre x that puts that point on the grid.
 */
export function snapX(doc: IODoc, id: NodeId, w: number, x: number, grid: number): number {
  const n = doc.nodes[id]
  const parent = n?.parent ? doc.nodes[n.parent] : undefined
  const side = n && parent ? Math.sign(n.x - parent.x) : 0
  const align = n?.align ?? (side > 0 ? 'left' : side < 0 ? 'right' : 'center')
  const off = align === 'left' ? -w / 2 : align === 'right' ? w / 2 : 0
  return Math.round((x + off) / grid) * grid - off
}
