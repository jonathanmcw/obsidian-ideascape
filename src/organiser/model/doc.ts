import type { DocLook } from './types'
import type { Align, IODoc, IONode, NodeId } from './types.ts'

export const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export function makeNode(partial: Partial<IONode> & { id?: NodeId }): IONode {
  // Only the fields actually given count: an inherited `x` or `size` (a polluted prototype) is not a field.
  const p = Object.create(null) as Partial<IONode>
  for (const k of Object.keys(partial) as (keyof IONode)[]) (p as Record<string, unknown>)[k] = partial[k]
  return {
    id: p.id ?? uid(),
    text: p.text ?? '',
    parent: p.parent ?? null,
    children: p.children ?? [],
    collapsed: p.collapsed ?? false,
    x: p.x ?? 0,
    y: p.y ?? 0,
    branch: p.branch ?? null,
    ...(p.align ? { align: p.align } : {}),
    ...(p.width ? { width: p.width } : {}),
    ...(p.size ? { size: p.size } : {}),
    ...(p.side ? { side: p.side } : {}),
    ...(p.ordered ? { ordered: true as const } : {}),
    ...(p.task != null ? { task: p.task } : {}),
  }
}

export function emptyDoc(name = 'Untitled'): IODoc {
  const root = makeNode({ text: 'Untitled idea' })
  const now = Date.now()
  return {
    id: uid(),
    name,
    rootId: root.id,
    nodes: { [root.id]: root },
    links: [],
    createdAt: now,
    updatedAt: now,
  }
}

export const node = (doc: IODoc, id: NodeId): IONode | undefined => doc.nodes[id]

export function ancestors(doc: IODoc, id: NodeId): NodeId[] {
  const out: NodeId[] = []
  let cur = doc.nodes[id]
  while (cur?.parent) {
    out.unshift(cur.parent)
    cur = doc.nodes[cur.parent]
  }
  return out
}

export function isDescendant(doc: IODoc, id: NodeId, maybeAncestor: NodeId): boolean {
  let cur = doc.nodes[id]
  while (cur?.parent) {
    if (cur.parent === maybeAncestor) return true
    cur = doc.nodes[cur.parent]
  }
  return false
}

/** Depth-first walk in child order. `respectCollapse` skips hidden subtrees. */
export function walk(
  doc: IODoc,
  from: NodeId,
  respectCollapse = false,
): { id: NodeId; depth: number }[] {
  const out: { id: NodeId; depth: number }[] = []
  const visit = (id: NodeId, depth: number) => {
    const n = doc.nodes[id]
    if (!n) return
    out.push({ id, depth })
    if (respectCollapse && n.collapsed) return
    for (const c of n.children) visit(c, depth + 1)
  }
  visit(from, 0)
  return out
}

export function subtreeIds(doc: IODoc, id: NodeId): NodeId[] {
  return walk(doc, id).map((w) => w.id)
}

/* ------------------------------------------------------------------ *
 * Mutations. Every one takes a doc and returns a new doc — the history
 * stack just keeps references, so undo is free.
 * ------------------------------------------------------------------ */

function clone(doc: IODoc): IODoc {
  const nodes: Record<NodeId, IONode> = {}
  for (const k of Object.keys(doc.nodes)) nodes[k] = { ...doc.nodes[k], children: [...doc.nodes[k].children] }
  return { ...doc, nodes, links: doc.links.map((l) => ({ ...l })), updatedAt: Date.now() }
}

/** Branch colour: children of the root each start a new branch; everyone else
 *  inherits from their parent. */
function branchFor(doc: IODoc, parentId: NodeId): number | null {
  if (parentId !== doc.rootId) return doc.nodes[parentId]?.branch ?? null
  const used = doc.nodes[doc.rootId].children.map((c) => doc.nodes[c]?.branch ?? 0)
  for (let i = 0; i < 8; i++) if (!used.includes(i)) return i
  return used.length % 8
}

export function addChild(doc: IODoc, parentId: NodeId, text = '', at?: number): [IODoc, NodeId] {
  const d = clone(doc)
  const parent = d.nodes[parentId]
  if (!parent) return [doc, parentId]
  parent.collapsed = false
  const child = makeNode({
    text,
    parent: parentId,
    branch: branchFor(d, parentId),
    x: parent.x + 180,
    y: parent.y + parent.children.length * 44,
  })
  d.nodes[child.id] = child
  const index = at ?? parent.children.length
  parent.children.splice(index, 0, child.id)
  return [d, child.id]
}

export function addSibling(doc: IODoc, id: NodeId, text = ''): [IODoc, NodeId] {
  const n = doc.nodes[id]
  if (!n || !n.parent) return addChild(doc, id, text)
  const index = doc.nodes[n.parent].children.indexOf(id) + 1
  const [d, newId] = addChild(doc, n.parent, text, index)
  // A new main branch stays on the side of the one it was made from.
  if (n.side && n.parent === d.rootId) d.nodes[newId].side = n.side
  // Enter continues the list, as it does in the editor: the next number, an open box.
  if (n.ordered) d.nodes[newId].ordered = true
  if (n.task != null) d.nodes[newId].task = ' '
  return [d, newId]
}

/** The node's number when it is a numbered item: its place in the run of numbered
 *  siblings it sits in, counting from 1 — a bullet between two runs restarts the count,
 *  which is how Markdown reads the same list. Null on bullets and on the root. */
export function ordinalOf(doc: IODoc, id: NodeId): number | null {
  const n = doc.nodes[id]
  if (!n?.ordered || !n.parent) return null
  const siblings = doc.nodes[n.parent]?.children ?? []
  let i = siblings.indexOf(id)
  if (i < 0) return null
  let k = 1
  while (i > 0 && doc.nodes[siblings[i - 1]]?.ordered) { i--; k++ }
  return k
}

export function setOrdered(doc: IODoc, id: NodeId, ordered: boolean): IODoc {
  const n = doc.nodes[id]
  if (!n || !n.parent || !!n.ordered === ordered) return doc
  const d = clone(doc)
  if (ordered) d.nodes[id].ordered = true
  else delete d.nodes[id].ordered
  return d
}

/** A task's state, or none. ' ' is an open box, 'x' a done one. */
export function setTask(doc: IODoc, id: NodeId, task: string | undefined): IODoc {
  const n = doc.nodes[id]
  if (!n || !n.parent || n.task === task) return doc
  const d = clone(doc)
  if (task == null) delete d.nodes[id].task
  else d.nodes[id].task = task
  return d
}

/** Tick or untick: an open box (or any custom state) becomes done, a done one opens. */
export function toggleTaskDone(doc: IODoc, id: NodeId): IODoc {
  const n = doc.nodes[id]
  if (!n || n.task == null) return doc
  return setTask(doc, id, n.task === 'x' ? ' ' : 'x')
}

/**
 * Which side of the root each main branch hangs on in the tidy map. With no
 * choice made, the first half goes left and the rest right. Once any branch
 * has been placed by hand, chosen sides are kept and the rest fill whichever
 * side is shorter, so nothing jumps across when a new branch is added.
 */
export function rootSides(doc: IODoc): Record<NodeId, -1 | 1> {
  const kids = doc.nodes[doc.rootId]?.children ?? []
  const out: Record<NodeId, -1 | 1> = {}
  if (!kids.some((k) => doc.nodes[k]?.side)) {
    const split = Math.floor(kids.length / 2)
    kids.forEach((k, i) => (out[k] = i < split ? -1 : 1))
    return out
  }
  let left = 0
  let right = 0
  for (const k of kids) {
    const s = doc.nodes[k]?.side
    if (!s) continue
    out[k] = s
    if (s < 0) left++
    else right++
  }
  for (const k of kids) {
    if (out[k]) continue
    const s: -1 | 1 = left < right ? -1 : 1
    out[k] = s
    if (s < 0) left++
    else right++
  }
  return out
}

/** Put a main branch on one side of the root, freezing every other branch where it is today. */
export function setSide(doc: IODoc, id: NodeId, side: -1 | 1): IODoc {
  const n = doc.nodes[id]
  if (!n || n.parent !== doc.rootId) return doc
  const d = clone(doc)
  const current = rootSides(doc)
  for (const k of d.nodes[d.rootId].children) if (!d.nodes[k].side) d.nodes[k].side = current[k]
  d.nodes[id].side = side
  return d
}

/**
 * Copy the top-level children of `clip`'s root (and their subtrees) under
 * `parentId`, minting fresh ids so a subtree can be pasted next to its own
 * source. Returns the new doc and the ids of the pasted top-level nodes.
 * Under the root each pasted node starts a branch of its own colour. The clip's
 * free links come along between the copies; a link to a node left behind does not.
 *
 * `reuseIds`, in the order the copies are made (each top-level node, then its
 * subtree, depth first — the order `toMarkdownList` writes them), gives each copy
 * an id to take back: a cut branch pasted into the same map keeps its block ids,
 * so links into it still resolve. An id the doc already has is not reused, and
 * the list is ignored unless it names exactly one id per copied node.
 */
export function graft(doc: IODoc, parentId: NodeId, clip: IODoc, at?: number, reuseIds?: readonly NodeId[]): [IODoc, NodeId[]] {
  const parent = doc.nodes[parentId]
  const tops = clip.nodes[clip.rootId]?.children ?? []
  if (!parent || !tops.length) return [doc, []]
  const d = clone(doc)
  const target = d.nodes[parentId]
  target.collapsed = false
  const ids: NodeId[] = []
  const copies = new Map<NodeId, NodeId>()
  const count = tops.reduce((sum, t) => sum + subtreeIds(clip, t).length, 0)
  const reuse = reuseIds?.length === count ? reuseIds : undefined
  let k = 0
  const copy = (srcId: NodeId, newParent: NodeId, depth: number, branch: number | null): NodeId => {
    const s = clip.nodes[srcId]
    const want = reuse?.[k++]
    const n = makeNode({
      ...(want && /^[A-Za-z0-9-]+$/.test(want) && !Object.hasOwn(d.nodes, want) ? { id: want } : {}),
      text: s.text,
      parent: newParent,
      branch,
      x: d.nodes[newParent].x + 180,
      y: d.nodes[newParent].y + depth * 44,
      ...(s.size ? { size: s.size } : {}),
      ...(s.align ? { align: s.align } : {}),
      ...(s.width ? { width: s.width } : {}),
      ...(s.ordered ? { ordered: true as const } : {}),
      ...(s.task != null ? { task: s.task } : {}),
      // A main branch keeps the side of the root it hung on.
      ...(s.side && depth === 0 && newParent === d.rootId ? { side: s.side } : {}),
      collapsed: s.collapsed,
    })
    d.nodes[n.id] = n
    copies.set(srcId, n.id)
    n.children = s.children.map((c) => copy(c, n.id, depth + 1, branch))
    return n.id
  }
  let index = Math.max(0, Math.min(at ?? target.children.length, target.children.length))
  for (const t of tops) {
    // Picked once the pasted branches before it have joined, so each takes a colour still free.
    const id = copy(t, parentId, 0, branchFor(d, parentId))
    target.children.splice(index++, 0, id)
    ids.push(id)
  }
  // The copies are new nodes, so only the clip's own links can repeat one another.
  const linked = new Set<string>()
  for (const l of clip.links ?? []) {
    const from = copies.get(l.from)
    const to = copies.get(l.to)
    if (!from || !to || from === to || linked.has(`${to}\n${from}`) || linked.has(`${from}\n${to}`)) continue
    linked.add(`${from}\n${to}`)
    d.links.push({ id: uid(), from, to })
  }
  return [d, ids]
}

export function setText(doc: IODoc, id: NodeId, text: string): IODoc {
  if (!doc.nodes[id] || doc.nodes[id].text === text) return doc
  const d = clone(doc)
  d.nodes[id].text = text
  return d
}

export function toggleCollapse(doc: IODoc, id: NodeId): IODoc {
  const n = doc.nodes[id]
  if (!n || n.children.length === 0) return doc
  const d = clone(doc)
  d.nodes[id].collapsed = !n.collapsed
  return d
}

export function setCollapsed(doc: IODoc, id: NodeId, collapsed: boolean): IODoc {
  const n = doc.nodes[id]
  if (!n || n.collapsed === collapsed || n.children.length === 0) return doc
  const d = clone(doc)
  d.nodes[id].collapsed = collapsed
  return d
}

export function removeNode(doc: IODoc, id: NodeId): IODoc {
  if (id === doc.rootId) return doc
  const d = clone(doc)
  const doomed = new Set(subtreeIds(doc, id))
  const n = d.nodes[id]
  if (n.parent) {
    const siblings = d.nodes[n.parent].children
    siblings.splice(siblings.indexOf(id), 1)
  }
  for (const x of doomed) delete d.nodes[x]
  d.links = d.links.filter((l) => !doomed.has(l.from) && !doomed.has(l.to))
  return d
}

/** Re-parent, keeping the whole subtree. Refuses cycles. */
export function reparent(doc: IODoc, id: NodeId, newParentId: NodeId, at?: number): IODoc {
  if (id === doc.rootId || id === newParentId) return doc
  if (isDescendant(doc, newParentId, id)) return doc
  const n = doc.nodes[id]
  if (!n || !doc.nodes[newParentId]) return doc

  const d = clone(doc)
  const moving = d.nodes[id]
  const sameParent = moving.parent === newParentId
  if (moving.parent) {
    const old = d.nodes[moving.parent].children
    const i = old.indexOf(id)
    if (i >= 0) old.splice(i, 1)
  }
  // A new main branch picks its colour before it joins, so its own colour does not count as taken.
  const nextBranch = newParentId === d.rootId ? branchFor(d, d.rootId) : d.nodes[newParentId].branch
  const target = d.nodes[newParentId]
  target.collapsed = false
  const index = Math.max(0, Math.min(at ?? target.children.length, target.children.length))
  target.children.splice(index, 0, id)
  // Moving among its own siblings keeps the branch's colour; dropped back where it was, nothing changes.
  if (sameParent) {
    const before = doc.nodes[newParentId].children
    if (before.length === target.children.length && before.every((c, i) => c === target.children[i])) return doc
    return d
  }
  moving.parent = newParentId

  // Re-colour the moved subtree to its new branch.
  for (const sid of subtreeIds(d, id)) d.nodes[sid].branch = nextBranch
  return d
}

/** Move a node up or down among its siblings. */
export function reorder(doc: IODoc, id: NodeId, delta: number): IODoc {
  const n = doc.nodes[id]
  if (!n?.parent) return doc
  const siblings = doc.nodes[n.parent].children
  const i = siblings.indexOf(id)
  const j = i + delta
  if (j < 0 || j >= siblings.length) return doc
  const d = clone(doc)
  const arr = d.nodes[n.parent].children
  arr.splice(i, 1)
  arr.splice(j, 0, id)
  return d
}

/** Shift-Tab: become the next sibling of your own parent. */
export function outdent(doc: IODoc, id: NodeId): IODoc {
  const n = doc.nodes[id]
  if (!n?.parent) return doc
  const grandparent = doc.nodes[n.parent].parent
  if (!grandparent) return doc
  const at = doc.nodes[grandparent].children.indexOf(n.parent) + 1
  return reparent(doc, id, grandparent, at)
}

/** Tab in the outline: become the last child of the sibling above you. A folded
 *  sibling unfolds, so the row you just moved does not vanish into it. */
export function indent(doc: IODoc, id: NodeId): IODoc {
  const n = doc.nodes[id]
  if (!n?.parent) return doc
  const siblings = doc.nodes[n.parent].children
  const i = siblings.indexOf(id)
  if (i <= 0) return doc
  const target = siblings[i - 1]
  const d = reparent(doc, id, target)
  if (d === doc || !d.nodes[target]?.collapsed) return d
  const e = clone(d)
  e.nodes[target].collapsed = false
  return e
}

/** Move a node and everything under it. Dragging a parent on the Canvas is
 *  expected to bring its branch along; ⌥ drops back to moveTo for one node. */
export function moveBy(doc: IODoc, id: NodeId, dx: number, dy: number): IODoc {
  if (!doc.nodes[id] || (dx === 0 && dy === 0)) return doc
  const d = clone(doc)
  for (const sid of subtreeIds(d, id)) {
    d.nodes[sid].x += dx
    d.nodes[sid].y += dy
  }
  return d
}

/** Branch colour belongs to the branch, not the node: setting it from any node
 *  recolours everything that shares its root-level ancestor. */
export function setBranchColor(doc: IODoc, id: NodeId, branch: number): IODoc {
  const n = doc.nodes[id]
  if (!n) return doc
  let top = id
  while (doc.nodes[top]?.parent && doc.nodes[top].parent !== doc.rootId) top = doc.nodes[top].parent!
  if (top === doc.rootId) return doc
  const d = clone(doc)
  for (const sid of subtreeIds(d, top)) d.nodes[sid].branch = branch
  return d
}

export function setAlign(doc: IODoc, id: NodeId, align: Align): IODoc {
  const n = doc.nodes[id]
  if (!n || n.align === align) return doc
  const d = clone(doc)
  d.nodes[id].align = align
  return d
}

/** obsidian: heading level for a node's text; undefined returns it to body size. */
/** obsidian: the map's own look. A key set to undefined goes back to following the plugin's defaults. */
export function setLook(doc: IODoc, patch: Partial<DocLook>): IODoc {
  const cur: DocLook = doc.look ?? {}
  const next: DocLook = { ...cur }
  for (const k of Object.keys(patch) as (keyof DocLook)[]) {
    const v = patch[k]
    if (v === undefined) delete next[k]
    else (next as Record<string, unknown>)[k] = v
  }
  if (JSON.stringify(next) === JSON.stringify(cur)) return doc
  const d = clone(doc)
  if (Object.keys(next).length) d.look = next
  else delete d.look
  return d
}

/** obsidian: the look as a file stores it — only the keys the map pins, so an unpinned map writes none. */
export function lookToFile(look: DocLook | undefined): DocLook {
  const out: DocLook = {}
  if (look?.theme) out.theme = look.theme
  if (look?.nodeStyle) out.nodeStyle = look.nodeStyle
  if (look?.layout) out.layout = look.layout
  if (look?.arrange === 'org') out.arrange = look.arrange
  if (look?.palette?.some(Boolean)) out.palette = look.palette.map((c) => c || '')
  if (look?.dots === false) out.dots = false
  if (look?.snap) out.snap = true
  return out
}

/** obsidian: the look a file gives, keeping only values the map understands. */
export function lookFromFile(v: unknown): DocLook {
  const look: DocLook = {}
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return look
  const l = v as Record<string, unknown>
  if (typeof l.theme === 'string' && l.theme) look.theme = l.theme
  if (l.nodeStyle === 'bar' || l.nodeStyle === 'outline' || l.nodeStyle === 'filled') look.nodeStyle = l.nodeStyle
  if (l.layout === 'auto' || l.layout === 'org' || l.layout === 'free') look.layout = l.layout
  if (l.arrange === 'org') look.arrange = l.arrange
  if (l.dots === false) look.dots = false
  if (l.snap === true) look.snap = true
  if (Array.isArray(l.palette)) {
    const p = l.palette.slice(0, 4).map((c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : ''))
    while (p.length && !p[p.length - 1]) p.pop()
    if (p.length) look.palette = p
  }
  return look
}

/** One of the map's own colour slots (0-based; branch index 8 + slot). undefined empties it;
 *  trailing empty slots are dropped so an untouched map writes no palette at all. */
export function setPalette(doc: IODoc, slot: number, hex: string | undefined): IODoc {
  const cur = doc.look?.palette ?? []
  const next = [...cur]
  while (next.length <= slot) next.push('')
  next[slot] = hex ?? ''
  while (next.length && !next[next.length - 1]) next.pop()
  return setLook(doc, { palette: next.length ? next : undefined })
}

export function setSize(doc: IODoc, id: NodeId, size: 1 | 2 | 3 | undefined): IODoc {
  const n = doc.nodes[id]
  if (!n || n.size === size) return doc
  const d = clone(doc)
  if (size) d.nodes[id].size = size
  else delete d.nodes[id].size
  return d
}

/** obsidian: a hand-set pill width; undefined returns the node to automatic width. */
export function setWidth(doc: IODoc, id: NodeId, width: number | undefined): IODoc {
  const n = doc.nodes[id]
  if (!n || n.width === width) return doc
  const d = clone(doc)
  if (width) d.nodes[id].width = Math.round(width)
  else delete d.nodes[id].width
  return d
}

export function moveTo(doc: IODoc, id: NodeId, x: number, y: number): IODoc {
  const n = doc.nodes[id]
  if (!n || (n.x === x && n.y === y)) return doc
  const d = clone(doc)
  d.nodes[id].x = x
  d.nodes[id].y = y
  return d
}

export function addLink(doc: IODoc, from: NodeId, to: NodeId): IODoc {
  if (from === to) return doc
  if (doc.links.some((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from))) return doc
  const d = clone(doc)
  d.links.push({ id: uid(), from, to })
  return d
}

export function rename(doc: IODoc, name: string): IODoc {
  const d = clone(doc)
  d.name = name
  return d
}

/** Bake a set of positions into the doc as the Canvas shape's stored x/y.
 *  Called once when a document is created so Canvas doesn't open as a pile. */
export function bakePositions(doc: IODoc, pos: Record<NodeId, { x: number; y: number }>): IODoc {
  const d = clone(doc)
  for (const id of Object.keys(pos)) {
    if (d.nodes[id]) {
      d.nodes[id].x = pos[id].x
      d.nodes[id].y = pos[id].y
    }
  }
  return d
}
