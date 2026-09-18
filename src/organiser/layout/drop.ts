// What lies under a point on the map, and where a node dragged there would land: pure functions of the document,
// its frame (whose `shape` says how it was laid out) and a point in world coordinates, so they can be tested
// without a DOM. The Stage calls them while a drag is in hand.
import type { IODoc, NodeId } from '../model/types.ts'
import { subtreeIds } from '../model/doc.ts'
import { leftOf, type Box, type Frame } from './index.ts'

export interface DropTarget {
  parent: NodeId
  index: number
  /** Tidy map, root as parent: the side of the root the drop chose. */
  side?: -1 | 1
  /** World coordinates of the slot line: from (x, y), `w` long — across, or down when `down` is set. */
  x: number
  y: number
  w: number
  /** Org chart, between siblings in a row: the slot line runs down between them. */
  down?: true
  /** A place between two outline rows rather than inside one: the line is the whole of what is shown, because
   *  ringing the parent as well would read as "into that row", which is the confusion this distinguishes. */
  between?: true
}

/** The node under (wx, wy), leaving out `exclude`; the visually topmost when boxes overlap. */
export function hitTest(frame: Frame, wx: number, wy: number, exclude: ReadonlySet<NodeId>): NodeId | null {
  const kind = frame.shape
  // Reverse order so the visually topmost (last painted) node wins.
  for (let i = frame.order.length - 1; i >= 0; i--) {
    const id = frame.order[i]
    if (exclude.has(id)) continue
    const b = frame.boxes[id]
    if (!b) continue
    const l = leftOf(b, kind)
    if (wx >= l && wx <= l + b.w && wy >= b.y - b.h / 2 && wy <= b.y + b.h / 2) return id
  }
  return null
}

/** The slot a drop at (wx, wy) would land in under `parentId`, among that parent's visible children. */
export function slotIn(doc: IODoc, frame: Frame, parentId: NodeId, wx: number, wy: number, exclude: ReadonlySet<NodeId>): DropTarget {
  const kind = frame.shape
  const parent = doc.nodes[parentId]
  const pb = frame.boxes[parentId]
  const reduced = parent.children.filter((c) => !exclude.has(c))
  const all = parent.collapsed ? [] : reduced.filter((c) => frame.boxes[c])
  // The root fans out both ways: only the side the pointer is on counts,
  // and dropping there is also how a branch is moved across.
  const side: -1 | 1 = wx >= pb.x ? 1 : -1
  const atRoot = kind === 'map' && parentId === doc.rootId
  const kids = atRoot ? all.filter((c) => frame.boxes[c].dir === side) : all
  // Org chart: children spread along a row are ordered left to right; a stack of leaves top to bottom, as the Map is.
  if (kind === 'org' && !all.some((c) => frame.boxes[c].stack)) return slotInRow(frame, parentId, wx, reduced, all)
  let before: NodeId | null = null
  for (const c of kids) {
    if (wy < frame.boxes[c].y) {
      before = c
      break
    }
  }
  const index = before ? reduced.indexOf(before) : kids.length ? reduced.indexOf(kids[kids.length - 1]) + 1 : reduced.length
  const kidBoxes = kids.map((c) => frame.boxes[c])
  const at = before ? kids.indexOf(before) : kidBoxes.length
  let lineY: number
  if (!kidBoxes.length) lineY = pb.y + pb.h / 2 + 10
  else if (at === 0) lineY = kidBoxes[0].y - kidBoxes[0].h / 2 - 6
  else if (at >= kidBoxes.length) {
    const last = kidBoxes[kidBoxes.length - 1]
    lineY = last.y + last.h / 2 + 6
  } else {
    const a = kidBoxes[at - 1]
    const b = kidBoxes[at]
    lineY = (a.y + a.h / 2 + b.y - b.h / 2) / 2
  }
  const anchorBox = kidBoxes[Math.min(at, kidBoxes.length - 1)] ?? pb
  const lineX = kidBoxes.length || !atRoot ? leftOf(anchorBox, kind) : side > 0 ? pb.x + pb.w / 2 + 40 : pb.x - pb.w / 2 - 40 - Math.max(70, pb.w)
  return { parent: parentId, index, x: lineX, y: kidBoxes.length || !atRoot ? lineY : pb.y, w: Math.max(70, anchorBox.w), ...(atRoot ? { side } : {}) }
}

/** Org chart: the slot among children spread along a row, by where the pointer is across it. */
function slotInRow(frame: Frame, parentId: NodeId, wx: number, reduced: NodeId[], kids: NodeId[]): DropTarget {
  const pb = frame.boxes[parentId]
  const boxes = kids.map((c) => frame.boxes[c])
  const at = boxes.findIndex((b) => wx < b.x)
  const before = at < 0 ? boxes.length : at
  const index = before < kids.length ? reduced.indexOf(kids[before]) : kids.length ? reduced.indexOf(kids[kids.length - 1]) + 1 : reduced.length
  if (!boxes.length) {
    // Nothing under it yet: the line sits below the parent, where the first child will hang.
    const w = Math.max(70, pb.w)
    return { parent: parentId, index, x: pb.x - w / 2, y: pb.y + pb.h / 2 + 10, w }
  }
  const top = Math.min(...boxes.map((b) => b.y - b.h / 2))
  const bottom = Math.max(...boxes.map((b) => b.y + b.h / 2))
  const a = boxes[before - 1]
  const b = boxes[before]
  const x = !a ? b.x - b.w / 2 - 7 : !b ? a.x + a.w / 2 + 7 : (a.x + a.w / 2 + b.x - b.w / 2) / 2
  return { parent: parentId, index, x, y: top, w: Math.max(24, bottom - top), down: true }
}

/**
 * Tidy layouts: a drop in the empty space beside a run of siblings is a drop
 * into that run — a column in the Mind map, a row or a stack of leaves in the
 * Org chart — so a node can be reordered among its siblings without having to
 * land on the parent pill. Returns the parent whose run of children is under
 * the pointer, nearest first, own parent on ties.
 */
export function columnUnder(doc: IODoc, frame: Frame, wx: number, wy: number, exclude: ReadonlySet<NodeId>, ownParent: NodeId | null): NodeId | null {
  const kind = frame.shape
  if (kind === 'org') return runUnder(doc, frame, wx, wy, exclude, ownParent)
  if (kind !== 'map') return null
  const SLACK = 28
  let best: { id: NodeId; score: number } | null = null
  for (const id of frame.order) {
    if (exclude.has(id)) continue
    const n = doc.nodes[id]
    if (!n || n.collapsed || !n.children.length) continue
    const groups = new Map<number, Box[]>()
    for (const c of n.children) {
      if (exclude.has(c)) continue
      const b = frame.boxes[c]
      if (!b) continue
      const g = groups.get(b.dir) ?? []
      g.push(b)
      groups.set(b.dir, g)
    }
    if (id === doc.rootId) {
      // An empty side of the root is a column too, so a branch can be
      // dragged across even when nothing hangs there yet.
      const rb = frame.boxes[id]
      for (const side of [-1, 1] as const) {
        if (groups.has(side) || !rb) continue
        const minX = side < 0 ? rb.x - rb.w / 2 - 360 : rb.x + rb.w / 2
        const maxX = side < 0 ? rb.x - rb.w / 2 : rb.x + rb.w / 2 + 360
        const reach = Math.max(rb.h / 2 + SLACK, 80)
        if (wx < minX || wx > maxX || wy < rb.y - reach || wy > rb.y + reach) continue
        const score = Math.abs((minX + maxX) / 2 - wx) + 100 // real columns win when they overlap
        if (!best || score < best.score) best = { id, score }
      }
    }
    for (const g of groups.values()) {
      const minX = Math.min(...g.map((b) => leftOf(b, kind))) - SLACK
      const maxX = Math.max(...g.map((b) => leftOf(b, kind) + b.w)) + SLACK
      const minY = g[0].y - g[0].h / 2 - SLACK
      const maxY = g[g.length - 1].y + g[g.length - 1].h / 2 + SLACK
      if (wx < minX || wx > maxX || wy < minY || wy > maxY) continue
      // Inside the band: prefer the column whose centre line is nearest, own parent on a tie.
      const score = Math.abs((minX + maxX) / 2 - wx) - (id === ownParent ? 1 : 0)
      if (!best || score < best.score) best = { id, score }
    }
  }
  return best?.id ?? null
}

/** Org chart: the parent whose row (or stack) of children is under the pointer. */
function runUnder(doc: IODoc, frame: Frame, wx: number, wy: number, exclude: ReadonlySet<NodeId>, ownParent: NodeId | null): NodeId | null {
  const SLACK = 28
  let best: { id: NodeId; score: number } | null = null
  for (const id of frame.order) {
    if (exclude.has(id)) continue
    const n = doc.nodes[id]
    if (!n || n.collapsed || !n.children.length) continue
    const g = n.children.filter((c) => !exclude.has(c) && frame.boxes[c]).map((c) => frame.boxes[c])
    if (!g.length) continue
    const minX = Math.min(...g.map((b) => b.x - b.w / 2))
    const maxX = Math.max(...g.map((b) => b.x + b.w / 2))
    const minY = Math.min(...g.map((b) => b.y - b.h / 2))
    const maxY = Math.max(...g.map((b) => b.y + b.h / 2))
    if (wx < minX - SLACK || wx > maxX + SLACK || wy < minY - SLACK || wy > maxY + SLACK) continue
    // Inside the band: nearest the run's centre line, then nearest its ends; own parent on a tie.
    const stack = g.some((b) => b.stack)
    const off = stack ? Math.abs((minX + maxX) / 2 - wx) + Math.max(0, minY - wy, wy - maxY) : Math.abs((minY + maxY) / 2 - wy) + Math.max(0, minX - wx, wx - maxX)
    const score = off - (id === ownParent ? 1 : 0)
    if (!best || score < best.score) best = { id, score }
  }
  return best?.id ?? null
}

/** How much of an outline row's height, at each end, means "between the rows" rather than "into this row". */
const ROW_EDGE = 0.3
const ROW_EDGE_MIN = 7
const ROW_EDGE_MAX = 16

/**
 * An outline row is three bands, the way every outliner reads one: its top edge puts the branch above that row, its
 * bottom edge below it, and the middle makes it a child. Rows are stacked 4px apart, so without the bands the only
 * drop a finger could reach was "make a child" — a drag between two rows landed inside the row it passed over.
 */
function outlineTarget(doc: IODoc, frame: Frame, overId: NodeId, wy: number, exclude: ReadonlySet<NodeId>): DropTarget | null {
  const b = frame.boxes[overId]
  const node = doc.nodes[overId]
  if (!b || !node || overId === doc.rootId) return null
  const parentId = node.parent
  const parent = parentId ? doc.nodes[parentId] : null
  if (!parentId || !parent) return null
  const edge = Math.min(ROW_EDGE_MAX, Math.max(ROW_EDGE_MIN, b.h * ROW_EDGE))
  const top = b.y - b.h / 2
  const bottom = b.y + b.h / 2
  const above = wy < top + edge
  const below = wy > bottom - edge
  if (!above && !below) return null

  // Below an open row, the place between it and its own first child is that child's place, not its sibling's: the
  // line a person sees is the same one, and this is the reading that keeps a branch where they dropped it.
  const kids = node.collapsed ? [] : node.children.filter((c) => !exclude.has(c) && frame.boxes[c])
  if (below && kids.length) return { parent: overId, index: doc.nodes[overId].children.filter((c) => !exclude.has(c)).indexOf(kids[0]), x: leftOf(frame.boxes[kids[0]], 'outline'), y: bottom, w: Math.max(70, frame.boxes[kids[0]].w), between: true }

  const reduced = parent.children.filter((c) => !exclude.has(c))
  const at = reduced.indexOf(overId)
  if (at < 0) return null
  return { parent: parentId, index: above ? at : at + 1, x: leftOf(b, 'outline'), y: above ? top : bottom, w: Math.max(70, b.w), between: true }
}

/** Where `movingIds` would land if dropped at (wx, wy) in a tidy shape: onto the node under the point, between two
 *  outline rows, or into the column of siblings beside it. Null when the point is over none of them. */
export function dropTargetFor(doc: IODoc, frame: Frame, wx: number, wy: number, movingIds: NodeId[]): DropTarget | null {
  const exclude = new Set(movingIds.flatMap((m) => subtreeIds(doc, m)))
  const overId = hitTest(frame, wx, wy, exclude)
  const ownParent = movingIds.length === 1 ? doc.nodes[movingIds[0]]?.parent ?? null : null
  if (frame.shape === 'outline' && overId && !exclude.has(overId)) {
    const between = outlineTarget(doc, frame, overId, wy, exclude)
    if (between) return between
  }
  const parentId = overId && !exclude.has(overId) ? overId : columnUnder(doc, frame, wx, wy, exclude, ownParent)
  if (!parentId) return null
  return slotIn(doc, frame, parentId, wx, wy, exclude)
}
