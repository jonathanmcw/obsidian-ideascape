/**
 * OPML 2.0 import. OPML is what MindNode, Xmind, iThoughts, Workflowy and most
 * outliners export, so it is the door through which existing maps arrive.
 *
 * The body may hold several top-level outlines; the first becomes the root
 * and the rest become its children, matching what the JSON Canvas importer
 * does with several disconnected trees. Text comes from `text` (the spec) or
 * `title` (what some exporters write instead).
 */
import type { IODoc, NodeId } from './types.ts'
import { makeNode, uid } from './doc.ts'
import { seedCanvasPositions } from './store.ts'

export function fromOPML(src: string, fallbackName = 'Imported'): IODoc {
  const xml = new DOMParser().parseFromString(src, 'application/xml')
  if (xml.querySelector('parsererror')) throw new Error('That file is not well-formed OPML.')
  const body = xml.querySelector('body')
  const tops = body ? Array.from(body.children).filter((el) => el.tagName === 'outline') : []
  if (!tops.length) throw new Error('That OPML file has no outlines in its body.')

  const doc: IODoc = {
    id: uid(),
    name: xml.querySelector('head > title')?.textContent?.trim() || fallbackName,
    rootId: '',
    nodes: {},
    links: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  const textOf = (el: Element) => (el.getAttribute('text') ?? el.getAttribute('title') ?? '').trim()

  const add = (el: Element, parent: NodeId | null, branch: number | null): NodeId => {
    const node = makeNode({ text: textOf(el), parent, branch })
    doc.nodes[node.id] = node
    if (parent) doc.nodes[parent].children.push(node.id)
    Array.from(el.children)
      .filter((c) => c.tagName === 'outline')
      .forEach((c, i) => {
        // Children of the root each start a branch; everything below inherits.
        const childBranch = parent === null ? i % 8 : branch
        add(c, node.id, childBranch)
      })
    return node.id
  }

  if (tops.length === 1) {
    doc.rootId = add(tops[0], null, null)
  } else {
    const root = makeNode({ text: doc.name })
    doc.nodes[root.id] = root
    doc.rootId = root.id
    tops.forEach((t, i) => add(t, root.id, i % 8))
  }

  return seedCanvasPositions(doc)
}

export const looksLikeOPML = (src: string) => /^\s*(<\?xml[^>]*>\s*)?<opml[\s>]/i.test(src)
