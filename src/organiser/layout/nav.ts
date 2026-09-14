// Where an arrow key goes from the selected node: a pure function of the document as the view shows it and its
// frame, so it can be tested without a DOM. MapApp turns the answer into a selection or a fold.
import type { IODoc, NodeId } from '../model/types.ts'
import { leftOf, type Box, type Frame } from './index.ts'

export type ArrowDir = 'up' | 'down' | 'left' | 'right'

/** What an arrow does: move the selection to a node, or fold or unfold one (the Outline's ← and →). */
export type ArrowMove = { select: NodeId } | { toggle: NodeId }

/**
 * The move for an arrow pressed on `from`. `doc` is the document as the view shows it — with the branches Find
 * opened — and `frame` its layout, whose `shape` says how it was laid out. With `extend` (⇧) the caller adds the
 * node to the selection instead of moving to it. Null when nothing lies that way: the selection stays put.
 */
export function arrowMove(doc: IODoc, frame: Frame, from: NodeId, dir: ArrowDir, extend = false): ArrowMove | null {
  const n = doc.nodes[from]
  if (!n) return null
  const kind = frame.shape
  if (kind === 'outline') {
    if (dir === 'up' || dir === 'down') {
      // The outline's frame holds one row per visible node, in reading order.
      const i = frame.order.indexOf(from)
      const next = frame.order[i + (dir === 'up' ? -1 : 1)]
      return next ? { select: next } : null
    }
    if (extend) return null // ⇧←/→ has no meaning in a list
    if (dir === 'left') {
      if (n.children.length && !n.collapsed) return { toggle: from }
      return n.parent ? { select: n.parent } : null
    }
    if (n.children.length && n.collapsed) return { toggle: from }
    return n.children.length ? { select: n.children[0] } : null
  }
  const start = frame.boxes[from]
  if (!start) return null
  if (kind === 'org') return orgMove(doc, frame, from, start, dir)
  // Map: spatial navigation by what is *visually* there. obsidian: edge-to-edge, not centre-to-centre.
  // 1. nodes that lie in that direction and overlap the current node's band (a row for ←/→, a column for ↑/↓)
  // 2. else the parent, if it lies in that direction
  // 3. else anything inside a 45° cone in that direction
  // Nothing there → the selection stays put.
  const me = edgesOf(start, kind)
  const horizontal = dir === 'left' || dir === 'right'
  const measure = measurer(start, kind, dir)
  // ←/→ follow the tree before the geometry: towards the root is the
  // parent, even when a cousin across the map shares the row; away from
  // it is the nearest child. Only a node with nothing that way falls
  // through to whatever is visually there.
  if (horizontal) {
    const pb = n.parent ? frame.boxes[n.parent] : undefined
    if (pb && n.parent && measure(pb).along >= -6) return { select: n.parent }
    let kid: { id: NodeId; perp: number } | null = null
    for (const id of n.children) {
      const b = frame.boxes[id]
      if (!b) continue
      const { along, perp } = measure(b)
      if (along < -6) continue
      if (!kid || perp < kid.perp) kid = { id, perp }
    }
    if (kid) return { select: kid.id }
  }
  // ↑/↓ step through the siblings first: in a map they are the column the
  // eye reads, even when a cousin's box happens to sit nearer. Only when no
  // sibling lies that way does the search widen to whatever is there.
  if (!horizontal && n.parent) {
    let sib: { id: NodeId; score: number } | null = null
    for (const id of doc.nodes[n.parent]?.children ?? []) {
      if (id === from) continue
      const b = frame.boxes[id]
      if (!b) continue
      const { along, overlap, perp, perpGap } = measure(b)
      if (along < -6) continue
      if (overlap <= 0 && perpGap > Math.max(along, 0) * 1.5) continue // free layout: far off to the side
      const score = Math.max(0, along) + perp * 0.25
      if (!sib || score < sib.score) sib = { id, score }
    }
    if (sib) return { select: sib.id }
  }
  const { primary, cone } = lookThere(frame, from, dir)
  let next: NodeId | null = primary
  if (!next && n.parent && frame.boxes[n.parent]) {
    const po = edgesOf(frame.boxes[n.parent], kind)
    const towards = dir === 'left' ? po.cx < me.cx : dir === 'right' ? po.cx > me.cx : dir === 'up' ? po.cy < me.cy : po.cy > me.cy
    if (towards) next = n.parent
  }
  if (!next) next = cone
  return next ? { select: next } : null
}

/** A box's edges and centre, whichever way its shape anchors it. */
function edgesOf(b: Box, kind: Frame['shape']) {
  const l = leftOf(b, kind)
  return { l, r: l + b.w, t: b.y - b.h / 2, bt: b.y + b.h / 2, cx: l + b.w / 2, cy: b.y }
}

/** How another box lies from `start`, going `dir`. */
function measurer(start: Box, kind: Frame['shape'], dir: ArrowDir) {
  const me = edgesOf(start, kind)
  const horizontal = dir === 'left' || dir === 'right'
  return (b: Box) => {
    const o = edgesOf(b, kind)
    // distance in the travel direction, edge to edge (negative = not in that direction)
    const along = dir === 'left' ? me.l - o.r : dir === 'right' ? o.l - me.r : dir === 'up' ? me.t - o.bt : o.t - me.bt
    const overlap = horizontal ? Math.min(me.bt, o.bt) - Math.max(me.t, o.t) : Math.min(me.r, o.r) - Math.max(me.l, o.l)
    const perp = horizontal ? Math.abs(o.cy - me.cy) : Math.abs(o.cx - me.cx)
    const perpGap = horizontal ? Math.max(o.t - me.bt, me.t - o.bt) : Math.max(o.l - me.r, me.l - o.r)
    return { o, along, overlap, perp, perpGap }
  }
}

/** What is visually there from `from`, going `dir`: the nearest node overlapping its band (a row for ←/→, a column for
 *  ↑/↓), the nearest inside a 45° cone, and the nearest at all (edge to edge, either way round). */
function lookThere(frame: Frame, from: NodeId, dir: ArrowDir, skip?: ReadonlySet<NodeId>) {
  const measure = measurer(frame.boxes[from], frame.shape, dir)
  let primary: { id: NodeId; score: number } | null = null
  let cone: { id: NodeId; score: number } | null = null
  let nearest: { id: NodeId; score: number } | null = null
  for (const id of frame.order) {
    if (id === from || skip?.has(id)) continue
    const b = frame.boxes[id]
    if (!b) continue
    const { along, overlap, perp, perpGap } = measure(b)
    if (along < -6) continue
    const gap = Math.max(0, along) + Math.max(0, perpGap)
    if (!nearest || gap < nearest.score) nearest = { id, score: gap }
    if (overlap > 0) {
      const score = Math.max(0, along) + perp * 0.25
      if (!primary || score < primary.score) primary = { id, score }
    } else {
      if (perpGap > Math.max(along, 0)) continue // outside the cone
      const score = Math.max(0, along) + perpGap * 2
      if (!cone || score < cone.score) cone = { id, score }
    }
  }
  return { primary: primary?.id ?? null, cone: cone?.id ?? null, nearest: nearest?.id ?? null }
}

/**
 * Org chart: the tree first, then what is visually there. ↑ is the parent; ↓ the child nearest the node's centre
 * (the first of two as near); ← and → the sibling before and after in the row, then the nearest node on the same row.
 * In a stack of leaves ↑ and ↓ step through the stack — ↑ from the top of it is the parent — and ← and → leave it for
 * the nearest node that way. Where the tree has nothing, ↓ goes to what is straight below, if anything is.
 */
function orgMove(doc: IODoc, frame: Frame, from: NodeId, start: Box, dir: ArrowDir): ArrowMove | null {
  const n = doc.nodes[from]
  const siblings = n.parent ? (doc.nodes[n.parent]?.children ?? []).filter((id) => frame.boxes[id]) : []
  const at = siblings.indexOf(from)
  const pick = (id: NodeId | null | undefined): ArrowMove | null => (id ? { select: id } : null)
  if (start.stack && (dir === 'up' || dir === 'down')) {
    const next = siblings[at + (dir === 'up' ? -1 : 1)]
    if (next) return { select: next }
    if (dir === 'up') return pick(n.parent)
  } else if (dir === 'up') return n.parent && frame.boxes[n.parent] ? { select: n.parent } : null
  else if (dir === 'down') {
    let kid: { id: NodeId; off: number } | null = null
    for (const id of n.collapsed ? [] : n.children) {
      const b = frame.boxes[id]
      if (!b) continue
      const off = Math.abs(b.x - start.x)
      if (!kid || off < kid.off - 0.5) kid = { id, off }
    }
    if (kid) return { select: kid.id }
  } else if (!start.stack) {
    const next = at >= 0 ? siblings[at + (dir === 'left' ? -1 : 1)] : undefined
    if (next) return { select: next }
    return pick(lookThere(frame, from, dir).primary)
  }
  const there = lookThere(frame, from, dir, start.stack ? new Set(siblings) : undefined)
  return pick(dir === 'down' ? there.primary : there.primary ?? there.nearest)
}
