// What the map's commands do to the document, its undo history and the text being typed into a node —
// and how the view's selection follows when nodes come and go — kept free of React and the DOM so it can be
// tested. MapApp holds one Session in a ref, in step with its props and state, so a handler always reads the
// latest, even after an await.
import type { IODoc, NodeId } from './model/types'
import { ancestors, removeNode, setCollapsed, setText } from './model/doc.ts'
import { embedsOf, stripEmbeds, withEmbeds } from './model/inline.ts'

/** Undo history as whole-document snapshots: every mutation returns a new document, so a step is a reference. */
export class History {
  past: IODoc[] = []
  future: IODoc[] = []
  /** The key the latest step was recorded under, while commits sharing it keep folding into that step. */
  private run: string | null = null

  /** The document is about to change from `prev`. Consecutive commits sharing a `coalesce` key fold into
   *  one step — a colour slider's every pixel is one change to take back, not a hundred. */
  record(prev: IODoc, coalesce?: string): void {
    if (!coalesce || this.run !== coalesce) this.past = [...this.past.slice(-99), prev]
    this.run = coalesce ?? null
    this.future = []
  }

  undo(cur: IODoc): IODoc | null {
    const prev = this.past.pop()
    this.run = null
    if (!prev) return null
    this.future.push(cur)
    return prev
  }

  redo(cur: IODoc): IODoc | null {
    const next = this.future.pop()
    this.run = null
    if (!next) return null
    this.past.push(cur)
    return next
  }

  /** Take back the latest step, keeping nothing to redo — but only while it is still the run recorded under `coalesce`.
   *  Returns the document from before that step. */
  drop(coalesce: string): IODoc | null {
    if (this.run !== coalesce) return null
    this.run = null
    return this.past.pop() ?? null
  }

  clear(): void {
    this.past = []
    this.future = []
    this.run = null
  }
}

/** The node being typed into. `created`: Tab or Enter made it in this edit. */
export interface Editing {
  id: NodeId
  created?: boolean
}

export interface Session {
  /** The latest document: the host's, or the one a command has just committed. */
  doc: IODoc
  history: History
  edit: Editing | null
  /** The text being typed, embeds included; it reaches the document when the node is left. */
  draft: string | null
  /** The draft as the edit opened: until the text moves away from it, nothing has been typed. */
  initial: string | null
  /** Folded branches opened to show a node Find (or a link) landed on. They are open on screen only, and reach
   *  the file with the next change — never on their own. */
  opened: Set<NodeId>
  /** Which map the document is — its file — so reading it again is told apart from another map landing in the view. */
  map: string | null
  /** The branches last cut, as clipboard text and their ids in the order a paste recreates them. Pasting that
   *  same text back into this map is a move: the ids, and every [[Map#^id]] link into the branch, can survive it. */
  lastCut: { text: string; ids: NodeId[] } | null
}

export function newSession(doc: IODoc): Session {
  return { doc, history: new History(), edit: null, draft: null, initial: null, opened: new Set(), map: null, lastCut: null }
}

/** What reading the map from its file did. 'other': another map landed in the view, and everything started over.
 *  For the same map, what became of the node being typed into, when the file changed it — 'changed': what was typed
 *  went on top of the file's text as an undo step; 'reopened': nothing had been typed, and the edit now holds the
 *  file's text; 'removed': the file no longer has the node, and the edit ended. Null: nothing to tell. */
export type Reload = 'other' | 'changed' | 'reopened' | 'removed' | null

/** The host read the map from its file (a new epoch): opened, switched to, or changed on disk by Sync or another pane.
 *  The history starts over — undo must not bring back the map as it was before someone else's change. `key` names
 *  the file; the document's own id can't, as it is minted afresh on every read until the file carries one.
 *  Another map starts over entirely, what was cut from the last one included. The same map read again keeps the node
 *  being typed into; when the file changed that node's text, the typing is kept, but committed straight away as a step
 *  on top of the file's version, so undo brings that version back instead of the typing silently writing over it when
 *  the node is left. */
export function reload(s: Session, doc: IODoc, key: string): Reload {
  const prev = s.doc
  const other = s.map !== key
  s.doc = doc
  s.map = key
  s.history.clear()
  if (other) {
    s.edit = null
    s.draft = null
    s.initial = null
    s.opened = new Set()
    // Another map's branches, pasted here, are new nodes.
    s.lastCut = null
    return 'other'
  }
  const e = s.edit
  if (!e || s.draft === null) return null
  if (!has(doc, e.id)) {
    s.edit = null
    s.draft = null
    s.initial = null
    return 'removed'
  }
  // Its creation is not in the history any more: emptied and left with Esc, it now goes as a step of its own.
  if (e.created) s.edit = { id: e.id }
  const was = has(prev, e.id) ? prev.nodes[e.id].text : null
  const now = doc.nodes[e.id].text
  if (was === now) return null
  if (was !== null && s.draft === s.initial && s.draft === draftOf(was)) {
    s.draft = s.initial = draftOf(now)
    return 'reopened'
  }
  if (flushDraft(s) === doc) return null
  // ⌘Z now belongs to the map, and takes the file's version back first.
  s.initial = s.draft
  return 'changed'
}

/** The run that makes a new node, its first text and a move a level in or out one undo step. */
export function newNodeStep(id: NodeId): string {
  return `new-${id}`
}

/** `doc` with the branches in `opened` unfolded — the same document when none of them is folded. */
export function unfold(doc: IODoc, opened: ReadonlySet<NodeId>): IODoc {
  let d = doc
  for (const id of opened) if (has(d, id) && d.nodes[id].collapsed) d = setCollapsed(d, id, false)
  return d
}

/** Open the folded branches on the way to `id`, on screen only. False when none was folded. */
export function openTo(s: Session, id: NodeId): boolean {
  const shut = ancestors(s.doc, id).filter((a) => s.doc.nodes[a]?.collapsed && !s.opened.has(a))
  if (!shut.length) return false
  s.opened = new Set([...s.opened, ...shut])
  return true
}

/** The draft a node's text opens as: the text without its media, the media under it. */
export function draftOf(text: string): string {
  return withEmbeds(stripEmbeds(text), embedsOf(text))
}

/** `doc` with the text being typed folded in — the same document when nothing has been typed over the node's text:
 *  opening a node and leaving it writes nothing, so an image inside a sentence, a caption under its image and
 *  trailing spaces stay as the file had them. */
export function withDraft(doc: IODoc, edit: Editing | null, draft: string | null): IODoc {
  if (!edit || draft === null || !has(doc, edit.id) || draft === draftOf(doc.nodes[edit.id].text)) return doc
  return setText(doc, edit.id, draft.trim())
}

/** Put `next` in place as an undo step (or into the run `coalesce` names). False when nothing changed. */
export function commitStep(s: Session, next: IODoc, coalesce?: string): boolean {
  if (next === s.doc) return false
  s.history.record(s.doc, coalesce)
  s.doc = next
  // Commands build on `unfold`ed documents: the change has carried the opened branches into the file.
  if (s.opened.size) s.opened = new Set()
  return true
}

/** For a command that has to wait — the clipboard being read, or written — before it changes the map. Called before
 *  the wait; what it returns says, after it, whether the document is still the one the command was made against.
 *  A reload from disk, another map landing in the view and a commit from a later render all move it on, and a change
 *  built on the document from before would then write that one over the live one. */
export function unmoved(s: Session): () => boolean {
  const doc = s.doc
  return () => s.doc === doc
}

/** Whether the node being typed into has been typed into: ⌘Z then belongs to its own text. */
export function typed(s: Session): boolean {
  return !!s.edit && s.draft !== s.initial
}

/** Start typing into `id`. The draft is `seed` — or the node's text — with the node's media kept under it, once.
 *  False when the node is gone, or is already being typed into: a double-click there selects a word, it does not
 *  start over from the saved text. */
export function beginDraft(s: Session, id: NodeId, seed: string | null): boolean {
  if (s.edit?.id === id || !has(s.doc, id)) return false
  const text = s.doc.nodes[id].text
  s.edit = { id }
  s.draft = seed === null ? draftOf(text) : withEmbeds(seed, embedsOf(text))
  s.initial = s.draft
  return true
}

/** Commit the text being typed as its own undo step — or into its node's creation, while that is still the latest
 *  step. The edit stays open. Returns the document to build on. */
export function flushDraft(s: Session): IODoc {
  const e = s.edit
  if (!e) return s.doc
  const next = withDraft(s.doc, e, s.draft)
  if (next !== s.doc) commitStep(s, unfold(next, s.opened), e.created ? newNodeStep(e.id) : undefined)
  return s.doc
}

/** Tab or Enter: a new empty node, open for typing. What was being typed is committed first, as a step of its own;
 *  the new node's creation and its first text are then one step. Returns its id, or null when there was nowhere to put it. */
export function createNode(s: Session, make: (d: IODoc) => [IODoc, NodeId]): NodeId | null {
  flushDraft(s)
  const base = unfold(s.doc, s.opened)
  const [next, id] = make(base)
  if (next === base || !has(next, id)) return null
  commitStep(s, next, newNodeStep(id))
  s.edit = { id, created: true }
  s.draft = ''
  s.initial = ''
  return id
}

/** Tab and ⇧Tab moving a row a level, typing or not. The typed text is its own step first; moving a node
 *  Tab or Enter has just made is still part of making it. False when nothing moved. */
export function restructure(s: Session, id: NodeId, change: (d: IODoc) => IODoc): boolean {
  const e = s.edit
  flushDraft(s)
  const base = unfold(s.doc, s.opened)
  const next = change(base)
  if (next === base) return false
  return commitStep(s, next, e?.created && e.id === id ? newNodeStep(id) : undefined)
}

/** Leave the node being typed into, keeping its text. With `discardEmpty` (Esc), a node left with no text, no media
 *  and no children goes: when Tab or Enter just made it, by taking its creation back — so it costs no undo step.
 *  Returns where the selection goes when the node went (the sibling before it, else its parent), else null. */
export function leave(s: Session, discardEmpty = false): NodeId | null {
  const e = s.edit
  if (!e) return null
  const typedDoc = withDraft(s.doc, e, s.draft)
  s.edit = null
  s.draft = null
  s.initial = null
  const n = typedDoc.nodes[e.id]
  if (discardEmpty && n?.parent && n.children.length === 0 && stripEmbeds(n.text).trim() === '' && embedsOf(n.text).length === 0) {
    const siblings = typedDoc.nodes[n.parent]?.children ?? []
    const i = siblings.indexOf(n.id)
    const back = e.created ? s.history.drop(newNodeStep(e.id)) : null
    if (back) {
      // What making the node unfolded folds again in the file, but stays open on screen: the selection returns into it.
      const reopen = Object.keys(back.nodes).filter((id) => back.nodes[id].collapsed && has(s.doc, id) && !s.doc.nodes[id].collapsed)
      if (reopen.length) s.opened = new Set([...s.opened, ...reopen])
      s.doc = back
    } else commitStep(s, removeNode(unfold(typedDoc, s.opened), n.id))
    return i > 0 ? siblings[i - 1] : n.parent
  }
  if (typedDoc !== s.doc) commitStep(s, unfold(typedDoc, s.opened), e.created ? newNodeStep(e.id) : undefined)
  return null
}

/** Something arrives for a node — notes dropped on it, an attachment that finished saving. For the node being typed
 *  into, it joins the draft: committed underneath, it would be written over when the node is left. For any other node,
 *  it is committed to the latest document, not the one from before a save began. Null when the node is gone. */
export function addToNode(s: Session, id: NodeId, change: (text: string) => string): 'draft' | 'doc' | null {
  if (s.edit?.id === id && s.draft !== null) {
    s.draft = change(s.draft)
    return 'draft'
  }
  if (!has(s.doc, id)) return null
  const base = unfold(withDraft(s.doc, s.edit, s.draft), s.opened)
  commitStep(s, setText(base, id, change(base.nodes[id].text)))
  return 'doc'
}

/** ⌘Z from the map (the history button, the palette). The text being typed is committed first, so undo
 *  takes the typing back — redo returns it — instead of dropping it. The edit ends. False when there was nothing to undo. */
export function undo(s: Session): boolean {
  flushDraft(s)
  const prev = s.history.undo(s.doc)
  if (!prev) return false
  s.doc = prev
  s.edit = null
  s.draft = null
  s.initial = null
  return true
}

/** ⇧⌘Z from the map. Text typed since the last step is newer than anything to redo: it is committed, and wins. */
export function redo(s: Session): boolean {
  flushDraft(s)
  const next = s.history.redo(s.doc)
  if (!next) return false
  s.doc = next
  s.edit = null
  s.draft = null
  s.initial = null
  return true
}

const has = (doc: IODoc, id: NodeId) => Object.prototype.hasOwnProperty.call(doc.nodes, id)

/** Where a selection goes when its node is gone: the nearest ancestor `prev` knew of that `doc` still has, else the root. */
export function survivor(prev: IODoc, doc: IODoc, id: NodeId): NodeId {
  const up = ancestors(prev, id)
  for (let i = up.length - 1; i >= 0; i--) if (has(doc, up[i])) return up[i]
  return doc.rootId
}

/** The ids the view holds on to between renders. */
export interface ViewIds {
  selection: NodeId | null
  multi: Set<NodeId>
  focusId: NodeId | null
  editId: NodeId | null
}

/** The view after the document went from `prev` to `doc` — an undo, a redo, a reload. Ids that are gone are
 *  taken out, and a selection that is gone moves to its nearest surviving ancestor, so the keys never act on a
 *  node that isn't there. Null when everything is still there. */
export function pruneView(prev: IODoc, doc: IODoc, v: ViewIds): ViewIds | null {
  const gone = (id: NodeId | null) => id !== null && !has(doc, id)
  const kept = [...v.multi].filter((id) => has(doc, id))
  if (!gone(v.selection) && kept.length === v.multi.size && !gone(v.focusId) && !gone(v.editId)) return null
  const selection = v.selection !== null && gone(v.selection) ? survivor(prev, doc, v.selection) : v.selection
  // The primary moved, or at most one selected node is left: back to a plain selection.
  const multi = !v.multi.size ? v.multi : selection !== v.selection || kept.length < 2 ? new Set<NodeId>() : kept.length < v.multi.size ? new Set(kept) : v.multi
  return { selection, multi, focusId: gone(v.focusId) ? null : v.focusId, editId: gone(v.editId) ? null : v.editId }
}
