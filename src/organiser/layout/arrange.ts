// obsidian: the Map shape's three layouts — Mind map, Org chart, Free — as pure functions of the document, so the
// ⌘3 cycle, what switching does to the file and what Tidy lays out can be tested without a DOM.
import type { Arrangement, DocLook, IODoc, LayoutKind, MapLayout, NodeId } from '../model/types.ts'
import { MAP_LAYOUTS } from '../model/types.ts'
import { bakePositions, setLook, walk } from '../model/doc.ts'
import { frameFor } from './index.ts'

/** ⌘3: Mind map → Org chart → Free → Mind map. */
export function nextLayout(layout: MapLayout): MapLayout {
  return MAP_LAYOUTS[(MAP_LAYOUTS.indexOf(layout) + 1) % MAP_LAYOUTS.length]
}

/** The layout a map shows: one of those on offer. A layout that is hidden (the Org chart, see ORG_CHART) shows as the Mind map. */
export function shownLayout(layout: MapLayout): MapLayout {
  return MAP_LAYOUTS.includes(layout) ? layout : 'auto'
}

/** The arrangement the stored positions follow: the one Free starts from and Tidy lays out. Unset is the Mind map. */
export function freeArrangement(look: DocLook | undefined): Arrangement {
  return look?.arrange === 'org' ? 'org' : 'auto'
}

/** The arrangement a map is in — or, in Free, the one it follows — as Tidy lays it out: never a hidden one. */
export function arrangementOf(layout: MapLayout, look: DocLook | undefined): Arrangement {
  const a = layout === 'free' ? freeArrangement(look) : layout
  return MAP_LAYOUTS.includes(a) ? a : 'auto'
}

/** How an arrangement's frame is laid out. */
export function arrangementKind(a: Arrangement): LayoutKind {
  return a === 'org' ? 'org' : 'map'
}

/** An arrangement's positions, as stored x/y. What a fold hides goes where it will show when the branch opens: as
 *  far from its parent as the arrangement puts it with the branch open. */
export function arrangedPositions(doc: IODoc, a: Arrangement): Record<NodeId, { x: number; y: number }> {
  const kind = arrangementKind(a)
  const pos: Record<NodeId, { x: number; y: number }> = {}
  for (const [id, b] of Object.entries(frameFor(doc, kind).boxes)) pos[id] = { x: b.x, y: b.y }
  const folded = Object.values(doc.nodes).filter((n) => n.collapsed)
  if (!folded.length) return pos
  const open: IODoc = { ...doc, nodes: { ...doc.nodes } }
  for (const n of folded) open.nodes[n.id] = { ...n, collapsed: false }
  const opened = frameFor(open, kind).boxes
  for (const { id } of walk(doc, doc.rootId)) {
    const parent = doc.nodes[id].parent
    if (pos[id] || !parent || !pos[parent] || !opened[id] || !opened[parent]) continue
    pos[id] = { x: pos[parent].x + opened[id].x - opened[parent].x, y: pos[parent].y + opened[id].y - opened[parent].y }
  }
  return pos
}

/** Tidy for the whole map: every position laid out as `a`, which the stored positions then follow. */
export function tidied(doc: IODoc, a: Arrangement): IODoc {
  return setLook(bakePositions(doc, arrangedPositions(doc, a)), { arrange: a === 'org' ? 'org' : undefined })
}

/**
 * The document with the Map's layout pinned to `to`, switching from `from` (the layout it shows now, which may come
 * from the plugin's defaults). Free keeps the positions it was left with when it follows the arrangement it is
 * entered from; entered from the other one, the positions are laid out as that one first, so nothing moves on the
 * switch. It is one change either way: ⌘Z takes back the switch and the positions together.
 */
export function withLayout(doc: IODoc, from: MapLayout, to: MapLayout): IODoc {
  if (to !== 'free') return setLook(doc, { layout: to })
  if (from === 'free') return setLook(doc, { layout: 'free' })
  return freeArrangement(doc.look) === from ? setLook(doc, { layout: 'free' }) : setLook(tidied(doc, from), { layout: 'free' })
}
