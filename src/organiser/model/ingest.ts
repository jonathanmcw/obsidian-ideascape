// What comes into a map from outside it — clipboard text, a dropped map file, notes dragged in from the vault, pasted
// or dropped media — through one door. MapApp keeps the events; everything read from them is turned into something it
// can graft or add here, and every fragment is checked by `soundFragment` on the way, so a crafted clipboard or file
// is held to the same rules whichever way it arrives. Kept free of React so it can be tested.
import type { FreeLink, IODoc, IONode, NodeId } from './types.ts'
import { makeNode, uid } from './doc.ts'
import { embedsOf, stripEmbeds, withEmbeds } from './inline.ts'
import { fromClipboardText } from './markdown.ts'
import { fromJSONCanvas } from './jsoncanvas.ts'
import { fromOPML, looksLikeOPML } from './opml.ts'

/** Clipboard text as the nodes it describes — a list, a heading, lines — ready for `graft`. Null when it holds none. */
export function clipboardFragment(text: string): IODoc | null {
  const clip = fromClipboardText(text)
  return clip && soundFragment(clip)
}

/** A file dropped on the map that is another map to import: JSON Canvas or OPML. */
export function isMapFile(name: string): boolean {
  return MAP_FILE.test(name)
}
const MAP_FILE = /\.(canvas|opml|xml)$/i

/** A dropped map file's text as one branch, ready for `graft`, and how many nodes it brings. Throws, with words a
 *  person can read, when the file cannot be read as either format. */
export function mapFileFragment(name: string, text: string): { fragment: IODoc; count: number } {
  const title = name.replace(MAP_FILE, '')
  const imported = /\.opml$/i.test(name) || looksLikeOPML(text) ? fromOPML(text, title) : fromJSONCanvas(text, title)
  const fragment = soundFragment(asBranch(imported))
  if (!fragment) throw new Error('That file could not be read as JSON Canvas or OPML.')
  return { fragment, count: Object.keys(fragment.nodes).length - 1 }
}

/** A whole map, ready for `graft`: its root becomes the one branch grafted in, everything under it along. */
export function asBranch(doc: IODoc): IODoc {
  const top = makeNode({ children: [doc.rootId] })
  return { ...doc, rootId: top.id, nodes: { ...doc.nodes, [top.id]: top } }
}

/** Notes dragged in from the vault, as the host wrote them: a `[[link]]` or an `![[embed]]` each, on one line. */
export function droppedLinks(links: readonly unknown[]): string[] {
  return links.filter((l): l is string => typeof l === 'string' && LINK.test(l))
}
const LINK = /^!?\[\[[^\n]+\]\]$/

/** A dropped link's name, for the message that says what was linked. */
export const linkName = (link: string): string => link.replace(/^!?\[\[|\]\]$/g, '')

/** A node's text with dropped links added: note links join the text, media goes under it. */
export function withLinks(text: string, links: string[]): string {
  const inline = links.filter((l) => !l.startsWith('!['))
  const media = links.filter((l) => l.startsWith('!['))
  const body = stripEmbeds(text)
  const sep = inline.length && body && !body.endsWith(' ') && !body.endsWith('\n') ? ' ' : ''
  return withEmbeds(body + sep + inline.join(' '), [...embedsOf(text), ...embedsOf(media.join('\n'))])
}

/** The images and audio among pasted or dropped files — what a node can hold. */
export function mediaFiles(files: ArrayLike<File>): File[] {
  return Array.from(files).filter((f) => /^(image|audio)\//.test(f.type))
}

/**
 * The one check every fragment passes before MapApp grafts it, whatever reader made it. The fragment is copied
 * from its root down: a node is looked up only by an id the table owns (never "__proto__" or "constructor"), and
 * is taken once — a child listed twice, or a loop back up the tree, is left out. Ids that are not plain block ids
 * get fresh ones (the graft mints its own anyway), and each field keeps only a value a node can have. A free link
 * survives when both its ends do. Null when the root itself is missing.
 */
export function soundFragment(doc: IODoc): IODoc | null {
  const src: unknown = doc?.nodes
  if (!isRecord(src)) return null
  const has = (id: unknown): id is NodeId => typeof id === 'string' && Object.hasOwn(src, id) && isRecord(src[id])
  if (!has(doc.rootId)) return null
  const nodes: Record<NodeId, IONode> = {}
  const copies = new Map<NodeId, NodeId>()
  const copy = (srcId: NodeId, parent: NodeId | null): NodeId => {
    const s = src[srcId] as Record<string, unknown>
    const id = BLOCK_ID.test(srcId) && !Object.hasOwn(nodes, srcId) ? srcId : freshId(nodes)
    copies.set(srcId, id)
    const n = makeNode({
      id,
      text: typeof s.text === 'string' ? s.text : '',
      parent,
      collapsed: s.collapsed === true,
      x: isCoord(s.x) ? s.x : 0,
      y: isCoord(s.y) ? s.y : 0,
      branch: Number.isInteger(s.branch) && (s.branch as number) >= 0 && (s.branch as number) < 12 ? (s.branch as number) : null,
      ...(s.align === 'left' || s.align === 'center' || s.align === 'right' ? { align: s.align } : {}),
      ...(typeof s.width === 'number' && Number.isFinite(s.width) && s.width > 0 ? { width: s.width } : {}),
      ...(s.size === 1 || s.size === 2 || s.size === 3 ? { size: s.size } : {}),
      ...(s.side === -1 || s.side === 1 ? { side: s.side } : {}),
      ...(s.ordered === true ? { ordered: true as const } : {}),
      ...(typeof s.task === 'string' && [...s.task].length === 1 ? { task: s.task } : {}),
    })
    nodes[id] = n
    for (const c of Array.isArray(s.children) ? s.children : []) if (has(c) && !copies.has(c)) n.children.push(copy(c, id))
    return id
  }
  const rootId = copy(doc.rootId, null)
  const links: FreeLink[] = []
  for (const l of Array.isArray(doc.links) ? (doc.links as unknown[]) : []) {
    if (!isRecord(l) || typeof l.from !== 'string' || typeof l.to !== 'string') continue
    const from = copies.get(l.from)
    const to = copies.get(l.to)
    if (from && to && from !== to) links.push({ id: uid(), from, to })
  }
  const name = typeof doc.name === 'string' ? doc.name : ''
  return { id: typeof doc.id === 'string' ? doc.id : uid(), name, rootId, nodes, links, createdAt: Date.now(), updatedAt: Date.now() }
}

const BLOCK_ID = /^[A-Za-z0-9-]+$/
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
function freshId(nodes: Record<NodeId, IONode>): NodeId {
  let id = uid()
  while (Object.hasOwn(nodes, id)) id = uid()
  return id
}
