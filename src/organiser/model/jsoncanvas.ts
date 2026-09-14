/**
 * JSON Canvas 1.0 (jsoncanvas.org, MIT) read/write.
 *
 * The spec is deliberately conservative: it has no notion of parent/child, of
 * sibling order, or of collapsed state. Following the plan in the design
 * transcript, we stay a *valid* 1.0 file and put the tree in extension fields
 * that other readers ignore:
 *
 *   - tree edges carry `"kind": "child"`  (Obsidian draws them as normal edges)
 *   - the file carries a namespaced `"ideaOrganiser"` block with the root id,
 *     explicit child order, the collapsed set, and what else a node carries that
 *     the spec has no place for: heading size, task state, numbering, width, side
 *     of the root, and the map's own look
 *
 * Reading back is defensive: if the extension block is missing (a file authored
 * in Obsidian, say) we reconstruct a tree from the edges and fall back to
 * geometry for ordering, so a plain .canvas still opens.
 */
import type { DocLook, IODoc, IONode, NodeId } from './types.ts'
import { lookFromFile, lookToFile, makeNode, uid, walk } from './doc.ts'

const EXT = 'ideaOrganiser'
const NODE_W = 200
const NODE_H = 44

/** Branch index -> JSON Canvas colour. Presets 1-6 are semantic and portable;
 *  the last two branches have no preset so they travel as hex. */
const CANVAS_COLOR: (string | undefined)[] = ['1', '2', '3', '4', '5', '6', '#4a8f8b', '#8f4a7d']

interface JCNode {
  id: string
  type: string
  text?: string
  file?: string
  url?: string
  label?: string
  x: number
  y: number
  width: number
  height: number
  color?: string
}

interface JCEdge {
  id: string
  fromNode: string
  fromSide?: string
  toNode: string
  toSide?: string
  color?: string
  label?: string
  kind?: string
}

interface JCFile {
  nodes?: JCNode[]
  edges?: JCEdge[]
  [EXT]?: {
    version: number
    rootId: string
    childOrder: Record<string, string[]>
    collapsed: string[]
    align?: Record<string, string>
    name?: string
    size?: Record<string, 1 | 2 | 3>
    task?: Record<string, string>
    ordered?: string[]
    width?: Record<string, number>
    side?: Record<string, -1 | 1>
    look?: DocLook
  }
}

export function toJSONCanvas(doc: IODoc): string {
  const nodes: JCNode[] = Object.values(doc.nodes).map((n) => ({
    id: n.id,
    type: 'text',
    text: n.text,
    x: Math.round(n.x - NODE_W / 2),
    y: Math.round(n.y - NODE_H / 2),
    width: NODE_W,
    height: NODE_H,
    ...(n.branch != null && CANVAS_COLOR[n.branch] ? { color: CANVAS_COLOR[n.branch] } : {}),
  }))

  const edges: JCEdge[] = []
  for (const n of Object.values(doc.nodes)) {
    for (const c of n.children) {
      edges.push({
        id: `e-${n.id}-${c}`,
        fromNode: n.id,
        fromSide: 'right',
        toNode: c,
        toSide: 'left',
        kind: 'child',
      })
    }
  }
  for (const l of doc.links) {
    edges.push({ id: l.id, fromNode: l.from, fromSide: 'bottom', toNode: l.to, toSide: 'top' })
  }

  const childOrder: Record<string, string[]> = {}
  for (const n of Object.values(doc.nodes)) {
    if (n.children.length) childOrder[n.id] = [...n.children]
  }
  const all = Object.values(doc.nodes)
  const table = <T,>(pick: (n: IONode) => T | undefined) => {
    const out: Record<string, T> = {}
    for (const n of all) {
      const v = pick(n)
      if (v != null) out[n.id] = v
    }
    return Object.keys(out).length ? out : undefined
  }
  const size = table((n) => n.size)
  const task = table((n) => n.task)
  const width = table((n) => n.width)
  const side = table((n) => (n.parent === doc.rootId ? n.side : undefined))
  const ordered = all.filter((n) => n.ordered).map((n) => n.id)
  const look = lookToFile(doc.look)

  const file: JCFile = {
    nodes,
    edges,
    [EXT]: {
      version: 1,
      rootId: doc.rootId,
      childOrder,
      collapsed: Object.values(doc.nodes).filter((n) => n.collapsed).map((n) => n.id),
      align: Object.fromEntries(
        Object.values(doc.nodes).filter((n) => n.align).map((n) => [n.id, n.align as string]),
      ),
      name: doc.name,
      ...(size ? { size } : {}),
      ...(task ? { task } : {}),
      ...(ordered.length ? { ordered } : {}),
      ...(width ? { width } : {}),
      ...(side ? { side } : {}),
      ...(Object.keys(look).length ? { look } : {}),
    },
  }
  return JSON.stringify(file, null, 2)
}

export function fromJSONCanvas(src: string, fallbackName = 'Imported'): IODoc {
  const file: unknown = JSON.parse(src)
  const jcNodes = list(isRecord(file) ? file.nodes : undefined).filter(
    (n): n is Record<string, unknown> => isRecord(n) && (n.type === 'text' || n.type === 'file' || n.type === 'link'),
  )
  if (jcNodes.length === 0) throw new Error('That .canvas file has no nodes.')

  const ext = isRecord(file) && isRecord(file[EXT]) ? file[EXT] : undefined
  const nodes: Record<NodeId, IONode> = {}
  // Every id in the file is looked up through this map, never straight on `nodes`: an id that is not
  // a usable block id ("__proto__", "node_1") gets a fresh one, and a duplicate keeps its node.
  const byFileId = new Map<string, NodeId>()
  const ref = (v: unknown): NodeId | undefined => (typeof v === 'string' ? byFileId.get(v) : undefined)
  for (const jn of jcNodes) {
    const fileId = typeof jn.id === 'string' ? jn.id : ''
    const id = /^[A-Za-z0-9-]+$/.test(fileId) && !Object.hasOwn(nodes, fileId) ? fileId : freshId(nodes)
    if (fileId && !byFileId.has(fileId)) byFileId.set(fileId, id)
    const text = [jn.text, jn.label, jn.file, jn.url].find((t): t is string => typeof t === 'string') ?? ''
    const num = (v: unknown, or: number) => (typeof v === 'number' && Number.isFinite(v) ? v : or)
    nodes[id] = makeNode({
      id,
      // Node text is Markdown per the spec, and may be several lines — keep them all. A canvas
      // from elsewhere has a leading heading marker lifted off the first line (a #tag stays);
      // this app's own files keep their text exactly.
      text: (ext ? text : text.replace(/^#{1,6}\s+/, '')).trimEnd(),
      x: num(jn.x, 0) + num(jn.width, NODE_W) / 2,
      y: num(jn.y, 0) + num(jn.height, NODE_H) / 2,
    })
  }

  const edges = list(isRecord(file) ? file.edges : undefined).filter(isRecord)
  const treeEdges = edges.filter((e) => e.kind === 'child')
  // No extension marker? Then treat every edge that doesn't create a cycle or a
  // second parent as a tree edge, and the rest as free links.
  const structural = treeEdges.length ? treeEdges : edges
  const links: { id: string; from: string; to: string }[] = []
  const linkId = (e: Record<string, unknown>) => (typeof e.id === 'string' && e.id ? e.id : uid())

  const parentOf = new Map<NodeId, NodeId>()
  const wouldCycle = (child: NodeId, parent: NodeId) => {
    let cur: NodeId | undefined = parent
    while (cur) {
      if (cur === child) return true
      cur = parentOf.get(cur)
    }
    return false
  }
  for (const e of structural) {
    const from = ref(e.fromNode)
    const to = ref(e.toNode)
    if (!from || !to) continue
    if (parentOf.has(to) || wouldCycle(to, from)) {
      links.push({ id: linkId(e), from, to })
      continue
    }
    parentOf.set(to, from)
  }
  if (treeEdges.length) {
    for (const e of edges) {
      if (e.kind === 'child') continue
      const from = ref(e.fromNode)
      const to = ref(e.toNode)
      if (from && to) links.push({ id: linkId(e), from, to })
    }
  }

  for (const [child, parent] of parentOf) {
    nodes[child].parent = parent
    nodes[parent].children.push(child)
  }

  // Ordering: explicit child order if we have it, otherwise top-to-bottom.
  const childOrder = new Map(entries(ext?.childOrder))
  for (const [fileId, id] of byFileId) {
    const n = nodes[id]
    const explicit = childOrder.get(fileId)
    if (Array.isArray(explicit)) {
      const known = [...new Set(explicit.map(ref))].filter((c): c is NodeId => !!c && nodes[c].parent === n.id)
      const extra = n.children.filter((c) => !known.includes(c))
      n.children = [...known, ...extra]
    } else {
      n.children.sort((a, b) => nodes[a].y - nodes[b].y || nodes[a].x - nodes[b].x)
    }
  }

  const roots = Object.values(nodes).filter((n) => !n.parent)
  // The root the file names only counts if nothing is its parent: attaching the other roots under a node
  // that has a parent would close a loop.
  const named = ref(ext?.rootId)
  let rootId = named && !nodes[named].parent ? named : roots[0]?.id
  if (!rootId) {
    // Every node has a parent, so the edges go round: the first node leaves its parent and heads the tree.
    rootId = Object.keys(nodes)[0]
    const p = nodes[rootId].parent
    if (p) {
      nodes[p].children = nodes[p].children.filter((c) => c !== rootId)
      nodes[rootId].parent = null
    }
  }

  // A .canvas can legitimately hold several disconnected trees. We keep one
  // document, so the extra roots become children of the first one.
  for (const r of roots) {
    if (r.id === rootId) continue
    r.parent = rootId
    nodes[rootId].children.push(r.id)
  }

  const doc: IODoc = {
    id: uid(),
    name: typeof ext?.name === 'string' ? ext.name : fallbackName,
    rootId,
    nodes,
    links,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  // Assign branch colours from the tree, ignoring whatever the file said, so
  // the palette stays consistent with this app's themes.
  for (const { id } of walk(doc, rootId)) {
    const n = doc.nodes[id]
    if (!n.parent) n.branch = null
    else if (n.parent === rootId) n.branch = doc.nodes[rootId].children.indexOf(id) % 8
    else n.branch = doc.nodes[n.parent].branch
  }

  for (const c of list(ext?.collapsed)) {
    const id = ref(c)
    if (id) doc.nodes[id].collapsed = true
  }
  for (const [fileId, a] of entries(ext?.align)) {
    const id = ref(fileId)
    if (id && (a === 'left' || a === 'center' || a === 'right')) doc.nodes[id].align = a
  }
  for (const [fileId, z] of entries(ext?.size)) {
    const id = ref(fileId)
    if (id && (z === 1 || z === 2 || z === 3)) doc.nodes[id].size = z
  }
  for (const [fileId, t] of entries(ext?.task)) {
    const id = ref(fileId)
    if (id && id !== rootId && typeof t === 'string' && [...t].length === 1) doc.nodes[id].task = t
  }
  for (const c of list(ext?.ordered)) {
    const id = ref(c)
    if (id && id !== rootId) doc.nodes[id].ordered = true
  }
  for (const [fileId, w] of entries(ext?.width)) {
    const id = ref(fileId)
    if (id && typeof w === 'number' && Number.isFinite(w) && w > 0) doc.nodes[id].width = w
  }
  for (const [fileId, s] of entries(ext?.side)) {
    const id = ref(fileId)
    if (id && doc.nodes[id].parent === rootId && (s === -1 || s === 1)) doc.nodes[id].side = s
  }
  const look = lookFromFile(ext?.look)
  if (Object.keys(look).length) doc.look = look

  return doc
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const entries = (v: unknown): [string, unknown][] => (isRecord(v) ? Object.entries(v) : [])
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
function freshId(nodes: Record<NodeId, IONode>): NodeId {
  let id = uid()
  while (Object.hasOwn(nodes, id)) id = uid()
  return id
}
