// obsidian: the vault owns documents (one Markdown note each) and the plugin settings own prefs.
// What remains here is the shape of the prefs and the helpers other modules import.
import type { IODoc, MapLayout, NodeId, Shape } from './types.ts'
import { addChild, bakePositions, emptyDoc, makeNode, uid, walk } from './doc.ts'
import { arrangedPositions, freeArrangement } from '../layout/arrange.ts'
import { DEFAULT_THEME } from '../theme.ts'

import type { NodeStyle } from './types'
export type { NodeStyle } from './types'
export type OutlineWidth = 'column' | 'full'

export interface Prefs {
  shape: Shape
  theme: string
  /** How a node wears its branch colour. */
  nodeStyle: NodeStyle
  inspectorOpen: boolean
  /** Shortcut chips fade for good after the shortcuts have been used. */
  usedShortcuts: string[]
  reduceMotion: boolean
  /** obsidian: the outline reads as a centred column, or stretches to the window. */
  outlineWidth: OutlineWidth
  /** obsidian: the Map shape is a mind map (auto), an org chart (org), or keeps the positions you gave it (free). */
  mapLayout: MapLayout
  /** obsidian: Esc on a node that is still empty takes it back out. */
  discardEmptyOnEsc: boolean
  /** obsidian: the Document panel's "saved with the map" note has been dismissed. */
  inspectorNoteDismissed?: boolean
}

export const DEFAULT_PREFS: Prefs = {
  shape: 'map',
  theme: DEFAULT_THEME,
  nodeStyle: 'outline',
  inspectorOpen: false,
  usedShortcuts: [],
  reduceMotion: false,
  outlineWidth: 'column',
  mapLayout: 'auto',
  discardEmptyOnEsc: true,
}

/** Give a freshly-built tree sensible Canvas coordinates, so switching to the
 *  Canvas shape shows a readable arrangement rather than a heap at the origin.
 *  obsidian: when the file already placed some nodes (`doc.unplaced` lists the rest), only the
 *  rest are placed — every stored position is left where the person put it. Either way the positions
 *  follow the arrangement the map's Free layout follows (DocLook.arrange): a mind map, or an org chart. */
export function seedCanvasPositions(doc: IODoc): IODoc {
  const pos: Record<NodeId, { x: number; y: number }> = {}
  const arrangement = freeArrangement(doc.look)
  if (doc.unplaced?.length) {
    const todo = new Set(doc.unplaced)
    const at = (id: NodeId) => pos[id] ?? doc.nodes[id]
    // Org chart: as far from the node before it, or from its parent, as the org chart itself puts it.
    const org = arrangement === 'org' ? arrangedPositions(doc, 'org') : null
    for (const { id } of walk(doc, doc.rootId)) {
      const n = doc.nodes[id]
      if (!todo.has(id) || !n.parent) continue
      const parent = doc.nodes[n.parent]
      const siblings = parent.children
      const prev = siblings[siblings.indexOf(id) - 1]
      const from = prev ?? n.parent
      if (org?.[id] && org[from]) pos[id] = { x: at(from).x + org[id].x - org[from].x, y: at(from).y + org[id].y - org[from].y }
      // After the previous sibling, or beside the parent on the side it already grows towards — as addChild does.
      else if (prev) pos[id] = { x: at(prev).x, y: at(prev).y + 44 }
      else {
        const grand = parent.parent ? at(parent.parent) : null
        const dir = grand && at(n.parent).x < grand.x ? -1 : 1
        pos[id] = { x: at(n.parent).x + dir * 180, y: at(n.parent).y }
      }
    }
  } else Object.assign(pos, arrangedPositions(doc, arrangement))
  const d = bakePositions(doc, pos)
  delete d.unplaced
  return d
}

function build(name: string, rootText: string, tree: [string, string[]][]): IODoc {
  let doc: IODoc = { id: uid(), name, rootId: '', nodes: {}, links: [], createdAt: Date.now(), updatedAt: Date.now() }
  const root = makeNode({ text: rootText })
  doc.rootId = root.id
  doc.nodes[root.id] = root
  for (const [branch, children] of tree) {
    const [next, bid] = addChild(doc, doc.rootId, branch)
    doc = next
    for (const child of children) {
      const [d2] = addChild(doc, bid, child)
      doc = d2
    }
  }
  return seedCanvasPositions(doc)
}

/** The starter map teaches the basics by being a map. */
export function starterDoc(): IODoc {
  return build('Start here', 'Welcome to your first map', [
    ['Tab adds a child', ['select a node, press Tab, start typing']],
    ['Enter adds a sibling', ['like this one']],
    ['⌘1 Map · ⌘2 Outline', ['the same ideas, two ways to see them']],
    ['⌘/ opens the document panel', ['theme, node style and layout for this map']],
    ['Press ? for every shortcut', ['underneath, the map is a plain Markdown list']],
  ])
}

export function newDoc(name = 'Untitled'): IODoc {
  const d = emptyDoc(name)
  d.nodes[d.rootId].text = name
  return seedCanvasPositions(d)
}
