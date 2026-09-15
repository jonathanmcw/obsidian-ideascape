import type * as React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Align, IODoc, LayoutKind, MapLayout, NodeId, Shape } from './model/types'
import { LAYOUT_LABEL, SHAPES, SHAPE_LABEL } from './model/types'
import {
  addChild,
  addSibling,
  ancestors,
  indent,
  moveTo,
  outdent,
  removeNode,
  setLook,
  rename,
  reorder,
  reparent,
  setSide,
  setText,
  subtreeIds,
  toggleCollapse,
  addLink,
  moveBy,
  setAlign,
  setBranchColor,
  isDescendant,
  bakePositions,
  setWidth,
  setSize,
  graft,
} from './model/doc'
import { setOrdered, setPalette, setTask, toggleTaskDone, walk } from './model/doc'
import { toMarkdownList } from './model/markdown'
import type { Prefs } from './model/store'
import { clipboardFragment, droppedLinks, isMapFile, linkName, mapFileFragment, mediaFiles, withLinks } from './model/ingest'
import { applyFocus, frameFor, keepBoxes, kindFor, layoutFor, leftOf, snapX, type Box, type Frame } from './layout'
import { arrowMove, type ArrowDir } from './layout/nav'
import { arrangementKind, arrangementOf, nextLayout, shownLayout, tidied, withLayout } from './layout/arrange'
import { activeLabel, applyFormat, type Format } from './ui/format'
import { renderInto } from './ui/wysiwyg'
import { IconChevron, IconClose, IconRedo, IconUndo } from './ui/Icons'
import { chord } from './ui/keys'
import { embedKind, embedsOf, plainText, stripEmbeds, withEmbeds, type Embed } from './model/inline'
import { MAX_ROW_TEXT_W, ROW_LEAD, setOutlineWidths } from './layout/measure'
import { applyTheme, defaultCustomTheme, registerCustomTheme, type CustomThemeDef } from './theme'
import {
  addToNode,
  beginDraft,
  commitStep,
  createNode,
  flushDraft,
  leave,
  newSession,
  openTo,
  pruneView,
  redo as redoStep,
  reload,
  restructure,
  typed,
  undo as undoStep,
  unfold,
  withDraft,
  type Editing,
  type Session,
} from './session'

const EMPTY_PALETTE: string[] = []
import { Toolbar } from './ui/Toolbar'
import { ExportSheet } from './ui/ExportSheet'
import { ShortcutsSheet } from './ui/ShortcutsSheet'
import { Inspector } from './ui/Inspector'
import { GRID, Stage, type Camera, type StageApi } from './ui/Stage'

const MORPH_MS = 450
const MORPH_TAIL = 240
const EDGE_HIDE_MS = 330
const REDUCED_MS = 200

interface EditState extends Editing {
  seed: string | null
  selectAll: boolean
}

// obsidian: the host (the plugin's file view) owns the document and the prefs;
// this component is the UI over them. `rootRef` is the element that carries
// the theme variables, the node-style attribute and the keyboard listener.
export interface MapAppProps {
  doc: IODoc
  onDoc: (next: IODoc) => void
  prefs: Prefs
  onPrefs: (patch: Partial<Prefs>) => void
  rootRef: React.RefObject<HTMLDivElement>
  /** Bumped by the host when it reads the map from its file — another file in the same view, or this one changed on
   *  disk. The history starts over; for another file, the selection too. */
  epoch: number
  /** obsidian: the map's file, which tells a new epoch on the same map from another map. Without it, the document's id. */
  fileKey?: string
  /** obsidian: [[wikilinks]] and URLs inside nodes are opened by the host. */
  onOpenLink?: (href: string, wiki: boolean) => void
  /** obsidian: opens the tour map; the shortcuts sheet links to it. */
  onTour?: () => void
  /** obsidian: the keyboard uses ⌘ and ⌥ (a Mac, or an iPad), so shortcuts are shown that way; otherwise Ctrl and Alt. */
  mac?: boolean
  /** obsidian: ![[embeds]] resolve to a URL the <img>/<audio> can load. */
  resolveEmbed?: (file: string) => { url: string; kind: 'image' | 'audio' } | null
  /** obsidian: save a pasted file into the vault; returns the link text to embed, or null. */
  onSaveAttachment?: (file: File) => Promise<string | null>
  /** obsidian: notes dragged from the file explorer, as ready-to-insert link text (`[[Note]]`, `![[img.png]]`). */
  linksFromDrag?: (dt: DataTransfer) => string[]
  /** obsidian: the Page preview plugin's hover card for a [[link]]. */
  onHoverLink?: (target: HTMLElement, href: string, event: MouseEvent) => void
  /** obsidian: a #tag chip in a node was clicked; search the vault for it. */
  onOpenTag?: (tag: string) => void
  /** obsidian: the one theme the person defines, kept in the plugin's settings. */
  customTheme?: CustomThemeDef
  onCustomTheme?: (def: CustomThemeDef) => void
  /** obsidian: the note's name, shown in the canvas corner; editing it renames the file, as
   *  Obsidian's inline title does. Without a host the map's own name is shown instead. */
  fileName?: string
  onRenameFile?: (name: string) => Promise<boolean>
  /** obsidian: secondary click on a node (id) or empty canvas (null); the host shows an Obsidian Menu. */
  onContextMenu?: (event: MouseEvent, id: NodeId | null) => void
  /** obsidian: modifier shortcuts live in the host's Scope (so they never shadow Obsidian's own),
   *  and call back into these. Called with null on unmount. */
  onApi?: (api: MapCommands | null) => void
}

export interface MapCommands {
  undo(): void
  redo(): void
  shift(shape: Shape): void
  toggleInspector(): void
  align(a: Align): void
  toggleFocus(): void
  toggleCollapse(): void
  reorder(delta: number): void
  zoomBy(k: number): void
  fit(): void
  export(): void
  toggleLayout(): void
  tidy(): void
  format(f: Format): void
  size(level: 1 | 2 | 3 | undefined): void
  /** ⌘F: open (or refocus) the find bar. */
  search(): void
  /** ⌘A: every visible node — or the text, while editing. */
  selectAll(): void
  /** ⌘E: edit the selected node's text in place, caret at the end — or, while editing, leave it. */
  toggleEdit(): void
  /** F2: edit the selected node's text with all of it selected — or, while editing, select all of it. */
  editAll(): void
  // Command palette and context menu twins of the keyboard actions.
  addChild(): void
  addSibling(): void
  deleteSelection(): void
  /** Copy or cut the selected branches to the clipboard as a Markdown list. */
  copy(cut: boolean): Promise<void>
  /** Paste the clipboard (list, heading, lines) under the selected node. */
  paste(): Promise<void>
  /** Free layout: move the selected branch by (dx, dy). */
  nudge(dx: number, dy: number): void
  /** ⌘Enter: a plain node gets a checkbox; an open one is ticked; a ticked one reopens. Every selected node moves together. */
  toggleTask(): void
  /** ⇧⌘7: numbered items ↔ bullets, for the selection. */
  toggleOrdered(): void
  /** A block link or a search hit landed on this node: unfold the way to it, select it, bring it into view. */
  reveal(id: NodeId): void
  /** While a node is being typed into: whether anything has been typed since it opened. ⌘Z then takes back the typing
   *  (the label's own undo); with nothing typed it undoes the map — a node Enter made by mistake goes. */
  typed(): boolean
  /** obsidian: the view is closing or the app quitting — the text being typed reaches the document now,
   *  as its own undo step, so the host's save has it. The edit stays open. */
  flushEdit(): void
}
export type { Format }

/** How far Obsidian's own bars reach up into the stage: the mobile navigation bar, and on the desktop the status bar
 *  once a narrow window wraps it across the bottom-left corner where the controls sit. Both are fixed elements
 *  outside the view, so they are measured rather than assumed. */
function bottomInsetFor(stage: HTMLElement): number {
  const box = stage.getBoundingClientRect()
  let inset = 0
  for (const bar of stage.ownerDocument.querySelectorAll<HTMLElement>('.mobile-navbar, .status-bar')) {
    const r = bar.getBoundingClientRect()
    if (r.height === 0 || r.top >= box.bottom || r.bottom <= box.top) continue
    // The controls live in the left 260px of the stage; a status bar that keeps to the right of them is no trouble.
    if (r.left > box.left + 260) continue
    inset = Math.max(inset, box.bottom - r.top)
  }
  return Math.round(inset)
}

export default function MapApp({ doc, onDoc, prefs, onPrefs, rootRef, epoch, onApi, onOpenLink, onTour, mac, resolveEmbed, onSaveAttachment, linksFromDrag, onHoverLink, onOpenTag, customTheme, onCustomTheme, fileName, fileKey, onRenameFile, onContextMenu }: MapAppProps) {
  // The custom theme is a registry entry: register before anything looks a theme up this render.
  const customThemeDef = useMemo(() => customTheme ?? defaultCustomTheme(), [customTheme])
  registerCustomTheme(customThemeDef)
  const palette = doc.look?.palette ?? EMPTY_PALETTE
  const dots = doc.look?.dots !== false
  const snap = !!doc.look?.snap && dots
  // obsidian: the map's own look wins over the plugin's defaults (`prefs`), key by key.
  const theme = doc.look?.theme ?? prefs.theme
  const nodeStyle = doc.look?.nodeStyle ?? prefs.nodeStyle
  const mapLayout = shownLayout(doc.look?.layout ?? prefs.mapLayout)
  // obsidian: the arrangement the map is in, or the one its Free layout follows — what Tidy lays out.
  const arrangement = arrangementOf(mapLayout, doc.look)

  const [selection, setSelection] = useState<NodeId | null>(null)
  // obsidian: every selected node when more than one is (the primary is always in `selection`).
  const [multi, setMulti] = useState<Set<NodeId>>(() => new Set())
  const selectOne = useCallback((id: NodeId | null) => {
    setSelection(id)
    setMulti((m) => (m.size ? new Set() : m))
  }, [])
  // obsidian: the document, its history and the text being typed, as the next command must see them —
  // a handler reads these, not the render it was made in. `edit` and `draftText` below mirror them for rendering.
  const sessionRef = useRef<Session | null>(null)
  if (!sessionRef.current) sessionRef.current = newSession(doc)
  const s = sessionRef.current
  const docProp = useRef(doc)
  /** The epoch the session has taken in. A document read from the file reaches it through `reload`, which compares it with the one before. */
  const epochSeen = useRef(epoch)
  if (docProp.current !== doc) {
    docProp.current = doc
    if (epochSeen.current === epoch) s.doc = doc
  }
  const [edit, setEditState] = useState<EditState | null>(null)
  const [opened, setOpened] = useState(s.opened)
  const [draftText, setDraftState] = useState<string | null>(null)
  const setEdit = useCallback((e: EditState | null) => {
    s.edit = e
    setEditState(e)
  }, [s])
  const setDraftText = useCallback((t: string | null) => {
    s.draft = t
    setDraftState(t)
  }, [s])
  // obsidian: a pill being resized shows its live width, so the text re-wraps and siblings move as you drag.
  const [widthPreview, setWidthPreview] = useState<{ id: NodeId; width: number; shift: number } | null>(null)
  // obsidian: media under the node being edited lives outside the contenteditable; the draft is text + these.
  const editEmbeds = useRef<Embed[]>([])
  const [mediaTick, setMediaTick] = useState(0)
  const [focusId, setFocusId] = useState<NodeId | null>(null)
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, z: 1 })
  // obsidian: the outline column needs the stage width at layout time, so it is state, not only a ref.
  const [stageW, setStageW] = useState(0)
  const [bottomInset, setBottomInset] = useState(0)
  /** A phone, or a pane that narrow: the outline hugs the edges and the document panel takes the whole width. */
  const narrow = stageW > 0 && stageW < 600
  const [morphing, setMorphing] = useState(false)
  const [edgesHidden, setEdgesHidden] = useState(false)
  const [cameraAnimated, setCameraAnimated] = useState(false)
  const [hud, setHud] = useState<{ key: string; label: string } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [showKeys, setShowKeys] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  /** Stage size, kept current by the ResizeObserver below. Read this rather
   *  than calling getBoundingClientRect after a big commit — that one call
   *  forces a synchronous layout of every node that just changed. */
  const stageSize = useRef({ width: 0, height: 0 })
  const [historyTick, setHistoryTick] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])
  const camTimer = useRef<number>()

  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => {
    if (rootRef.current) applyTheme(rootRef.current, theme)
  }, [theme, rootRef, customThemeDef])
  useEffect(() => {
    if (rootRef.current) rootRef.current.dataset.nodeStyle = nodeStyle
  }, [nodeStyle, rootRef])
  // obsidian: a different file in the same view starts a fresh history and selection. The same map
  // reloaded from disk (a Sync pull, an edit in another pane) starts a fresh history too, but keeps
  // what is selected — pruned below, like any other change — and the node being typed into.
  // Before the pruning, which would otherwise end an edit on a node the file no longer has without a word.
  useLayoutEffect(() => {
    epochSeen.current = epoch
    const read = doc
    const was = reload(s, read, fileKey ?? read.id)
    setHistoryTick((t) => t + 1)
    if (was === 'other') {
      selectOne(null)
      setEdit(null)
      setDraftText(null)
      setFocusId(null)
      setOpened(s.opened)
    } else if (was === 'removed') {
      setEdit(null)
      setDraftText(null)
      flash('The node you were typing into was deleted on disk')
    } else if (was === 'changed') {
      settle(read)
      flash(`This node changed on disk while you were typing — ${chord('⌘Z')} brings back that version`)
    } else if (was === 'reopened') showDraft(true, false)
    // Deliberately not every value read here is a dependency.
  }, [epoch])

  // After an undo, a redo or a reload, what was selected, focused or being typed into may be gone.
  // Nothing is left pointing at a missing node: the arrows would go dead on it, and Tab or a letter would open an edit no one can see.
  const prunedFrom = useRef(doc)
  useLayoutEffect(() => {
    const prev = prunedFrom.current
    prunedFrom.current = doc
    if (prev === doc) return
    const v = pruneView(prev, doc, { selection, multi, focusId, editId: edit?.id ?? null })
    if (!v) return
    if (v.selection !== selection) setSelection(v.selection)
    if (v.multi !== multi) setMulti(v.multi)
    if (v.focusId !== focusId) setFocusId(v.focusId)
    if (edit && !v.editId) {
      setEdit(null)
      setDraftText(null)
    }
    // Only when the document changes.
  }, [doc])

  /* -------------------- doc plumbing -------------------- */

  const onDocRef = useRef(onDoc)
  onDocRef.current = onDoc
  const fileKeyRef = useRef(fileKey)
  fileKeyRef.current = fileKey
  const putDoc = useCallback((next: IODoc) => onDocRef.current(next), [])

  /** After a session command: the document to the host, the history buttons and the opened branches to the view. */
  const settle = useCallback(
    (before: IODoc) => {
      setOpened(s.opened)
      if (s.doc === before) return
      setHistoryTick((t) => t + 1)
      putDoc(s.doc)
    },
    [putDoc, s],
  )

  /** Consecutive commits sharing a `coalesce` key fold into one undo step — a colour slider's
   *  every pixel is one change to take back, not a hundred. Any other commit ends the run. */
  const commit = useCallback(
    (next: IODoc, coalesce?: string) => {
      const before = s.doc
      commitStep(s, next, coalesce)
      settle(before)
    },
    [s, settle],
  )

  /** Fold the in-progress text edit — and the branches Find opened — into a document before mutating further. */
  const withEdit = useCallback((d: IODoc): IODoc => unfold(withDraft(d, s.edit, s.draft), s.opened), [s])

  /** Leave edit mode, folding the draft into the document. With `discardEmpty`
   *  (Esc), a node that is still empty — no text, no media, no children — is
   *  taken back out (a node Tab or Enter just made, without an undo step), and the
   *  selection returns to where it came from: the sibling before it, else its parent. */
  const endEdit = useCallback(
    (discardEmpty = false) => {
      if (!s.edit) return
      const before = s.doc
      const back = leave(s, discardEmpty)
      settle(before)
      setEdit(null)
      setDraftText(null)
      if (back) selectOne(back)
    },
    [s, selectOne, setDraftText, setEdit, settle],
  )

  /** The draft changed from outside the label — a drop, an attachment that finished saving, the file. Media under the node
   *  follows it; with `relabel`, the label is drawn again from it (a dropped [[link]]), caret at the end. */
  const showDraft = useCallback(
    (relabel: boolean, space = true) => {
      editEmbeds.current = embedsOf(s.draft ?? '')
      setDraftText(s.draft)
      const el = relabel ? rootRef.current?.querySelector<HTMLElement>('.node-label[contenteditable="true"]') : null
      if (!el) return
      // A space after a new link, so what is typed next lands after it, not inside it; leaving the node trims it.
      renderInto(el, `${stripEmbeds(s.draft ?? '')}${space ? ' ' : ''}`)
      const range = el.ownerDocument.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = el.ownerDocument.defaultView?.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    },
    [rootRef, s, setDraftText],
  )

  /** Leaving an edit by tapping or clicking away. On a touch screen there is no Esc,
   *  so the empty-node rule applies here instead: tap away from a node you never
   *  filled in and it goes. */
  const leaveEdit = useCallback(() => {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    endEdit(coarse && prefs.discardEmptyOnEsc)
  }, [endEdit, prefs.discardEmptyOnEsc])

  // A map undo that lands while a node is being typed into commits the typing first (see session.ts):
  // it is taken back as a step of its own, never dropped. obsidian: ⌘Z inside the label is the label's.
  const undo = useCallback(() => {
    const before = s.doc
    const done = undoStep(s)
    settle(before)
    if (!done) return
    setEdit(null)
    setDraftText(null)
  }, [s, setDraftText, setEdit, settle])

  const redo = useCallback(() => {
    const before = s.doc
    const done = redoStep(s)
    settle(before)
    if (!done) return
    setEdit(null)
    setDraftText(null)
  }, [s, setDraftText, setEdit, settle])

  const setPrefs = useCallback((patch: Partial<Prefs>) => onPrefs(patch), [onPrefs])

  /* -------------------- layout -------------------- */

  // obsidian: the document as the view shows it — with the branches Find opened — before the draft and width preview.
  const openDoc = useMemo(() => unfold(doc, opened), [doc, opened])
  const viewDoc = useMemo(() => {
    let d = openDoc
    if (edit && draftText !== null && d.nodes[edit.id]) d = { ...d, nodes: { ...d.nodes, [edit.id]: { ...d.nodes[edit.id], text: draftText } } }
    if (widthPreview && d.nodes[widthPreview.id]) {
      const cur = d.nodes[widthPreview.id]
      d = { ...d, nodes: { ...d.nodes, [widthPreview.id]: { ...cur, width: widthPreview.width, x: cur.x + widthPreview.shift } } }
    }
    return d
  }, [openDoc, edit, draftText, widthPreview])

  // Outline geometry: a column wraps at MAX_ROW_TEXT_W; full width wraps at the window. Neither is wider than the
  // stage allows, so a phone or a narrow pane wraps the rows instead of clipping them.
  const outlineMargin = narrow ? 16 : 48
  /** Where the first row sits below the toolbar — and the last row above the bottom edge. */
  const OUTLINE_TOP = 64
  const columnW = ROW_LEAD + MAX_ROW_TEXT_W + 40
  const fitW = stageW ? Math.max(220, stageW - outlineMargin * 2) : columnW
  const outlineW = prefs.outlineWidth === 'full' && stageW ? fitW : Math.min(columnW, fitW)
  const kind: LayoutKind = kindFor(prefs.shape, mapLayout)
  const lastFrame = useRef<Frame | null>(null)
  const frame: Frame = useMemo(() => {
    if (prefs.shape === 'outline') setOutlineWidths(outlineW - ROW_LEAD - 40, outlineW)
    // A box that did not move is the same object as before, so only the nodes that moved draw again.
    const next = keepBoxes(lastFrame.current, applyFocus(viewDoc, layoutFor(viewDoc, prefs.shape, undefined, mapLayout), focusId))
    lastFrame.current = next
    return next
    // mediaTick: an image reported its real size, so the boxes change without the doc changing
  }, [viewDoc, prefs.shape, mapLayout, focusId, outlineW, mediaTick])

  /** Snap to grid: vertically the node's centre; horizontally the edge its alignment names (see snapX). */
  const onGrid = useCallback((v: number) => (snap ? Math.round(v / GRID) * GRID : v), [snap])
  const snapPos = useCallback(
    (d: IODoc, id: NodeId, x: number, y: number): [number, number] => (snap ? [snapX(d, id, frame.boxes[id]?.w ?? 0, x, GRID), onGrid(y)] : [x, y]),
    [frame, onGrid, snap],
  )
  /** The delta that takes a node from where it is to the nearest dot in the direction of `dx, dy`. */
  const snapDelta = useCallback(
    (d: IODoc, id: NodeId, dx: number, dy: number): [number, number] => {
      const n = d.nodes[id]
      if (!snap || !n) return [dx, dy]
      const [x, y] = snapPos(d, id, n.x + dx, n.y + dy)
      return [x - n.x, y - n.y]
    },
    [snap, snapPos],
  )
  /** Where the outline column sits: centred, or at the left margin when full width. */
  const outlineX = useCallback(
    (width: number) => (prefs.outlineWidth === 'full' ? outlineMargin : Math.max(outlineMargin, (width - outlineW) / 2)),
    [outlineW, outlineMargin, prefs.outlineWidth],
  )
  /** obsidian: the outline scrolls like a document — it stops with the first row at the
   *  top margin and the last row at the bottom one, and a short outline does not scroll at all. */
  const clampOutlineY = useCallback(
    (y: number) => {
      const h = stageSize.current.height
      const { minY, maxY } = frame.bounds
      const top = OUTLINE_TOP - minY
      const bottom = h - OUTLINE_TOP - maxY
      return !h || bottom >= top ? top : Math.min(top, Math.max(bottom, y))
    },
    [frame.bounds],
  )
  // Rows come and go (typing, folding): keep the outline within its document.
  useEffect(() => {
    if (prefs.shape !== 'outline') return
    setCamera((c) => (clampOutlineY(c.y) === c.y ? c : { ...c, y: clampOutlineY(c.y) }))
  }, [clampOutlineY, prefs.shape])

  const dimmed = useMemo(() => {
    if (!focusId || !doc.nodes[focusId]) return new Set<NodeId>()
    const inFocus = new Set(subtreeIds(doc, focusId))
    const out = new Set<NodeId>()
    for (const id of frame.order) if (!inFocus.has(id)) out.add(id)
    return out
  }, [doc, focusId, frame.order])

  /* -------------------- camera -------------------- */

  const animateCamera = useCallback((next: Camera, ms = 420) => {
    setCameraAnimated(true)
    setCamera(next)
    if (camTimer.current) window.clearTimeout(camTimer.current)
    camTimer.current = window.setTimeout(() => setCameraAnimated(false), ms)
  }, [])

  const fitCamera = useCallback(
    (f: Frame, shape: Shape, animate: boolean, only?: Set<NodeId>) => {
      if (!stageSize.current.width) {
        const r = stageRef.current?.getBoundingClientRect()
        if (r) stageSize.current = { width: r.width, height: r.height }
      }
      const rect = stageSize.current
      if (!rect.width || !f.order.length) return
      let { minX, minY, maxX, maxY } = f.bounds
      if (only?.size) {
        // Focus mode: frame the branch, not the whole document.
        minX = Infinity
        minY = Infinity
        maxX = -Infinity
        maxY = -Infinity
        for (const id of f.order) {
          if (!only.has(id)) continue
          const b = f.boxes[id]
          minX = Math.min(minX, leftOf(b, shape))
          maxX = Math.max(maxX, leftOf(b, shape) + b.w)
          minY = Math.min(minY, b.y - b.h / 2)
          maxY = Math.max(maxY, b.y + b.h / 2)
        }
        if (!Number.isFinite(minX)) return
      }
      let next: Camera
      if (shape === 'outline') {
        // The outline is a document column: 1:1, centred (or left-aligned at full
        // width), anchored to the top row. Only vertical movement is free — so the
        // column's x always comes from the whole document, never from a focused
        // branch, and y stops at the document's ends like any scroll.
        const top = OUTLINE_TOP - f.bounds.minY
        const bottom = rect.height - OUTLINE_TOP - f.bounds.maxY
        const y = OUTLINE_TOP - minY
        next = { z: 1, x: outlineX(rect.width) - f.bounds.minX, y: bottom >= top ? top : Math.min(top, Math.max(bottom, y)) }
      } else {
        // On a phone, fitting a wide map to the width lands at a zoom where no
        // node is readable. Fit down to 50% at most, and if the map still does
        // not fit, centre on the root — parents move first in `order`, so the
        // root is its first entry — and let pinch and pan do the rest. The Org
        // chart hangs from its root, so there the root sits near the top instead.
        const narrow = rect.width < 600
        const pad = only?.size ? (narrow ? 60 : 140) : narrow ? 20 : 72
        const floor = narrow ? 0.5 : 0.22
        const fit = Math.min((rect.width - pad * 2) / Math.max(1, maxX - minX), (rect.height - pad * 2) / Math.max(1, maxY - minY))
        const z = Math.min(1, Math.max(floor, fit))
        let cx = (minX + maxX) / 2
        let cy = (minY + maxY) / 2
        if (fit < floor && !only?.size) {
          const root = f.boxes[f.order[0]]
          if (root) {
            cx = leftOf(root, shape) + root.w / 2
            cy = f.shape === 'org' ? root.y - root.h / 2 + (rect.height / 2 - OUTLINE_TOP) / z : root.y
          }
        }
        next = { z, x: rect.width / 2 - cx * z, y: rect.height / 2 - cy * z }
      }
      if (animate) animateCamera(next)
      else setCamera(next)
    },
    [animateCamera, outlineX],
  )

  const focusSubtree = useMemo(
    () => (focusId && doc.nodes[focusId] ? new Set(subtreeIds(doc, focusId)) : undefined),
    [doc, focusId],
  )

  // Refit only when the *view* changes, never on ordinary edits.
  const viewKey = `${doc.id}|${prefs.shape}|${mapLayout}|${focusId ?? ''}`
  const lastViewKey = useRef<string>('')
  useLayoutEffect(() => {
    const first = lastViewKey.current === ''
    if (lastViewKey.current === viewKey) return
    const prev = lastViewKey.current
    lastViewKey.current = viewKey
    // In the outline, focus only dims the rest: the document neither slides nor
    // scrolls — the row you focused is already in view. Just keep the scroll legal.
    const sansFocus = (k: string) => k.replace(/\|[^|]*$/, '')
    if (!first && prefs.shape === 'outline' && sansFocus(prev) === sansFocus(viewKey)) {
      setCamera((c) => (clampOutlineY(c.y) === c.y ? c : { ...c, y: clampOutlineY(c.y) }))
      return
    }
    fitCamera(frame, prefs.shape, !first, focusSubtree)
    // frame is intentionally read fresh but not a dependency: refitting on every
    // keystroke would fight the user's own panning.
  }, [viewKey])

  // The stage resizes for reasons no window event reports — the rail opening or
  // closing, most of all. Hold the visual centre instead of refitting, so the
  // map doesn't jump and the viewer's own pan and zoom survive.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    let { width, height } = el.getBoundingClientRect()
    stageSize.current = { width, height }
    setStageW(width)
    setBottomInset(bottomInsetFor(el))
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box) return
      const dx = box.width - width
      const dy = box.height - height
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
      width = box.width
      height = box.height
      stageSize.current = { width, height }
      setStageW(width)
      setBottomInset(bottomInsetFor(el))
      setCamera((c) => ({ ...c, x: c.x + dx / 2, y: c.y + dy / 2 }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** Nudge the camera so a node is comfortably on screen. */
  const ensureVisible = useCallback(
    (id: NodeId) => {
      const rect = stageSize.current
      const b = frame.boxes[id]
      if (!rect.width || !b) return
      const pad = 90
      const sx = leftOf(b, prefs.shape) * camera.z + camera.x
      const sy = (b.y - b.h / 2) * camera.z + camera.y
      const sw = b.w * camera.z
      const sh = b.h * camera.z
      let dx = 0
      let dy = 0
      if (prefs.shape !== 'outline') {
        if (sx < pad) dx = pad - sx
        else if (sx + sw > rect.width - pad) dx = rect.width - pad - (sx + sw)
      }
      if (sy < pad) dy = pad - sy
      else if (sy + sh > rect.height - pad) dy = rect.height - pad - (sy + sh)
      if (!dx && !dy) return
      if (focusId && prefs.shape !== 'outline') {
        // Focus mode follows the keyboard: a node that left the comfortable
        // zone is brought to the centre, not merely nudged back over the edge.
        const cx = (leftOf(b, prefs.shape) + b.w / 2) * camera.z
        const cy = b.y * camera.z
        animateCamera({ ...camera, x: rect.width / 2 - cx, y: rect.height / 2 - cy }, 360)
        return
      }
      animateCamera({ ...camera, x: camera.x + dx, y: prefs.shape === 'outline' ? clampOutlineY(camera.y + dy) : camera.y + dy }, 260)
    },
    [clampOutlineY, animateCamera, camera, focusId, frame, prefs.shape],
  )

  /* -------------------- the Shift -------------------- */

  const shiftTo = useCallback(
    (shape: Shape) => {
      if (shape === prefs.shape) return
      timers.current.forEach(clearTimeout)
      timers.current = []
      const reduced = prefs.reduceMotion
      setMorphing(true)
      setEdgesHidden(true)
      setPrefs({ shape })
      setHud({ key: chord(`⌘${SHAPES.indexOf(shape) + 1}`), label: SHAPE_LABEL[shape] })
      timers.current.push(
        window.setTimeout(() => setEdgesHidden(false), reduced ? REDUCED_MS : EDGE_HIDE_MS),
        window.setTimeout(() => setMorphing(false), reduced ? REDUCED_MS + 40 : MORPH_MS + MORPH_TAIL),
        window.setTimeout(() => setHud(null), 900),
      )
    },
    [prefs.reduceMotion, prefs.shape, setPrefs],
  )

  /* -------------------- commands -------------------- */

  const [live, setLive] = useState('')
  const flash = useCallback((msg: string) => {
    setToast(msg)
    setLive(msg) // the same words reach a screen reader
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600)
  }, [])

  const createChild = useCallback(
    (parentId: NodeId, at?: number, pos?: { x: number; y: number }) => {
      const before = s.doc
      const id = createNode(s, (d) => {
        const [next, newId] = addChild(d, parentId, '', at)
        return [pos && next !== d ? moveTo(next, newId, pos.x, pos.y) : next, newId]
      })
      settle(before)
      if (!id) return
      selectOne(id)
      setEdit({ id, seed: '', selectAll: false, created: true })
      setDraftText('')
    },
    [s, selectOne, setDraftText, setEdit, settle],
  )

  const createSibling = useCallback(
    (id: NodeId) => {
      const before = s.doc
      const newId = createNode(s, (d) => addSibling(d, id))
      settle(before)
      if (!newId) return
      selectOne(newId)
      setEdit({ id: newId, seed: '', selectAll: false, created: true })
      setDraftText('')
    },
    [s, selectOne, setDraftText, setEdit, settle],
  )

  /** Tab and ⇧Tab in the Outline, and the bar's buttons for them: a row moves a level, typing or not. */
  const moveLevel = useCallback(
    (id: NodeId, out: boolean) => {
      const before = s.doc
      restructure(s, id, (d) => (out ? outdent(d, id) : indent(d, id)))
      settle(before)
    },
    [s, settle],
  )

  const deleteNode = useCallback(
    (id: NodeId) => {
      const ids = (multi.size > 1 ? [...multi] : [id]).filter((x) => x !== doc.rootId)
      if (!ids.length) return
      const parent = doc.nodes[id]?.parent ?? doc.rootId
      let d = withEdit(doc)
      for (const x of ids) if (d.nodes[x]) d = removeNode(d, x)
      if (focusId && !d.nodes[focusId]) setFocusId(null)
      commit(d)
      setEdit(null)
      setDraftText(null)
      selectOne(d.nodes[parent] ? parent : d.rootId)
    },
    [commit, doc, focusId, multi, selectOne, withEdit],
  )

  /** Empty one of the map's own colour slots; every main branch wearing it goes back to its theme colour. */
  const removeOwnColour = useCallback(
    (slot: number) => {
      let d = setPalette(withEdit(doc), slot, undefined)
      d.nodes[d.rootId].children.forEach((c, i) => {
        if (d.nodes[c]?.branch === 8 + slot) d = setBranchColor(d, c, i % 8)
      })
      commit(d)
    },
    [commit, doc, withEdit],
  )

  // The Stage's API is one object for the life of the map: a new one would reach every node and draw all of them
  // again on every keystroke. Each of its methods calls the implementation from the latest render.
  const stageImpl: StageApi = {
    select: (id) => {
      if (edit && edit.id !== id) leaveEdit()
      selectOne(id)
    },
    beginEdit: (id, seed, selectAll) => {
      if (s.edit?.id === id || !s.doc.nodes[id]) return
      if (s.edit) endEdit()
      if (!beginDraft(s, id, seed)) return
      selectOne(id)
      setEdit({ id, seed, selectAll })
      editEmbeds.current = embedsOf(s.doc.nodes[id].text)
      setDraftText(s.draft)
    },
    draft: (text) => setDraftText(withEmbeds(text, editEmbeds.current)),
    commitEdit: leaveEdit,
    indent: (id) => moveLevel(id, false),
    outdent: (id) => moveLevel(id, true),
    toggleCollapse: (id) => commit(toggleCollapse(withEdit(doc), id)),
    reparent: (id, parent, index, side) => {
      let d = reparent(withEdit(doc), id, parent, index)
      if (side && parent === d.rootId) d = setSide(d, id, side)
      commit(d)
    },
    moveNode: (id, x, y) => {
      const d = withEdit(doc)
      const [sx, sy] = snapPos(d, id, x, y)
      commit(moveTo(d, id, sx, sy))
    },
    moveBranch: (id, dx, dy) => {
      const d = withEdit(doc)
      const [sx, sy] = snapDelta(d, id, dx, dy)
      commit(moveBy(d, id, sx, sy))
    },
    setAlign: (id, align) => commit(setAlign(withEdit(doc), id, align)),
    setSize: (id, size) => commit(setSize(withEdit(doc), id, size)),
    setBranch: (id, branch) => commit(setBranchColor(withEdit(doc), id, branch)),
    createChild,
    linkNodes: (from, to) => {
      commit(addLink(withEdit(doc), from, to))
      flash('Free link added — it travels in .canvas, not in Markdown.')
    },
    setCamera: (c) => {
      if (camTimer.current) window.clearTimeout(camTimer.current)
      setCameraAnimated(false)
      setCamera(prefs.shape === 'outline' ? { z: 1, x: outlineX(stageSize.current.width) - frame.bounds.minX, y: clampOutlineY(c.y) } : c)
    },
    selectMany: (ids, primary) => {
      if (edit) endEdit()
      setMulti(new Set(ids))
      setSelection(primary ?? ids[ids.length - 1] ?? null)
    },
    toggleSelect: (id) => {
      setMulti((m) => {
        const next = new Set(m.size ? m : selection ? [selection] : [])
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      setSelection(id)
    },
    moveMany: (ids, dx, dy, alone) => {
      let d = withEdit(doc)
      const tops = alone ? ids : ids.filter((id) => !ids.some((o) => o !== id && isDescendant(d, id, o)))
      // One snapped delta for the whole selection, so what was dragged together stays together.
      const [sx, sy] = tops.length ? snapDelta(d, tops[0], dx, dy) : [dx, dy]
      for (const id of tops) d = alone ? moveTo(d, id, d.nodes[id].x + sx, d.nodes[id].y + sy) : moveBy(d, id, sx, sy)
      commit(d)
    },
    reparentMany: (ids, parent, index, side) => {
      let d = withEdit(doc)
      const tops = ids.filter((id) => !ids.some((o) => o !== id && isDescendant(d, id, o)))
      let at = index
      for (const id of tops) {
        const next = reparent(d, id, parent, at)
        if (next !== d) {
          d = next
          if (side && parent === d.rootId) d = setSide(d, id, side)
          at++
        }
      }
      commit(d)
    },
    openLink: (href, wiki) => onOpenLink?.(href, wiki),
    setWidth: (id, width, shift = 0) => {
      let d = setWidth(withEdit(doc), id, width)
      if (shift && d.nodes[id]) d = moveTo(d, id, d.nodes[id].x + shift, d.nodes[id].y)
      commit(d)
    },
    previewWidth: (id, width, shift = 0) => setWidthPreview(width == null ? null : { id, width, shift }),
    resolveEmbed: (file) => resolveEmbed?.(file) ?? null,
    mediaChanged: () => setMediaTick((t) => t + 1),
    removeEmbed: (id, index) => {
      if (edit?.id === id) {
        editEmbeds.current = editEmbeds.current.filter((_, i) => i !== index)
        setDraftText(withEmbeds(stripEmbeds(s.draft ?? ''), editEmbeds.current))
        return
      }
      const cur = doc.nodes[id]?.text ?? ''
      commit(setText(withEdit(doc), id, withEmbeds(stripEmbeds(cur), embedsOf(cur).filter((_, i) => i !== index))))
    },
    pasteFiles: (id, files) => void pasteFiles(id, files),
    contextMenu: (e, id) => onContextMenu?.(e, id),
    canDropExternal: (dt) => !!linksFromDrag && droppedLinks(linksFromDrag(dt)).length > 0,
    dropExternal: (id, world, dt) => {
      const links = droppedLinks(linksFromDrag?.(dt) ?? [])
      if (!links.length) return false
      if (id && s.doc.nodes[id]) {
        // onto a node: the links join its text; media embeds go under it — onto the node being typed into, they join what is typed
        const before = s.doc
        const into = addToNode(s, id, (text) => withLinks(text, links))
        settle(before)
        if (into === 'draft') showDraft(links.some((l) => !l.startsWith('![')))
        selectOne(id)
        flash(links.length === 1 ? `Linked ${linkName(links[0])}` : `Linked ${links.length} notes`)
        return true
      }
      // onto empty space: a new child of the selection (or the root), placed where it was dropped
      const base = withEdit(s.doc)
      const parent = selection && base.nodes[selection] ? selection : base.rootId
      let [next, newId] = addChild(base, parent, links.join(' '))
      if (mapLayout === 'free') next = moveTo(next, newId, world.x, world.y)
      commit(next)
      selectOne(newId)
      return true
    },
    hoverLink: (target, href, event) => onHoverLink?.(target, href, event),
    toggleTask: (id) => commit(toggleTaskDone(withEdit(doc), id)),
    setOrdered: (id, ordered) => commit(setOrdered(withEdit(doc), id, ordered)),
    setTask: (id, on) => commit(setTask(withEdit(doc), id, on ? ' ' : undefined)),
    openTag: (tag) => onOpenTag?.(tag),
    setPalette: (slot, hex) => commit(setPalette(withEdit(doc), slot, hex), `palette-${slot}`),
    addOwnColour: (id, slot, hex) => commit(setBranchColor(setPalette(withEdit(doc), slot, hex), id, 8 + slot)),
    removeOwnColour: (slot) => removeOwnColour(slot),
  }
  const stageImplRef = useRef(stageImpl)
  stageImplRef.current = stageImpl
  const stageApi = useMemo(() => forwarding(stageImplRef), [])
  // What a node draws from outside the document — an embed the host resolves, the custom theme's colours — can change
  // when the host renders the map again. The nodes are drawn again then, as they were when that gave them a new API.
  const outside = useMemo(() => ({}), [resolveEmbed, onOpenLink, onHoverLink, onOpenTag, customThemeDef])

  /* -------------------- media (obsidian) -------------------- */

  const pasteFiles = useCallback(
    async (id: NodeId, files: File[]) => {
      if (!onSaveAttachment) {
        flash('This host cannot save attachments.')
        return
      }
      const map = fileKeyRef.current
      const added: Embed[] = []
      for (const f of files) {
        const link = await onSaveAttachment(f)
        if (link) added.push({ file: link, kind: embedKind(link) === 'audio' ? 'audio' : 'image' })
      }
      // obsidian: the tab may have opened another file while these saved; they stay in the vault, unlinked.
      if (!added.length || fileKeyRef.current !== map) return
      // The map may have moved on while the files saved: build on what is there now.
      const before = s.doc
      const into = addToNode(s, id, (text) => withEmbeds(stripEmbeds(text), [...embedsOf(text), ...added]))
      settle(before)
      if (into === 'draft') showDraft(false)
      if (!into) flash(added.length === 1 ? `Saved ${added[0].file} — its node is gone` : `Saved ${added.length} files — their node is gone`)
      else flash(added.length === 1 ? `Attached ${added[0].file}` : `Attached ${added.length} files`)
    },
    [flash, onSaveAttachment, s, settle, showDraft],
  )

  /** The selected nodes with any selected descendants dropped, in tree order. */
  const topSelected = useCallback((): NodeId[] => {
    const ids = multi.size > 1 ? [...multi] : selection ? [selection] : []
    const tops = ids.filter((id) => doc.nodes[id] && !ids.some((o) => o !== id && isDescendant(doc, id, o)))
    const order = walk(doc, doc.rootId).map((w) => w.id)
    return tops.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  }, [doc, multi, selection])

  // Clipboard: branches travel as a nested Markdown list, so ⌘C ⌘V works
  // between maps and into any note; a list or lines pasted from anywhere
  // become children of the selected node. While a label is being edited the
  // browser's own text clipboard applies. What was last cut is `s.lastCut`.

  /** The selected branches as clipboard text; with `cut`, removes them too. Null when nothing is selected. */
  const takeSelection = useCallback(
    (cut: boolean): string | null => {
      const ids = topSelected()
      if (!ids.length) return null
      const text = toMarkdownList(doc, ids)
      if (!cut) {
        flash(ids.length === 1 ? 'Copied branch' : `Copied ${ids.length} branches`)
        return text
      }
      const gone = ids.filter((id) => id !== doc.rootId)
      if (!gone.length) {
        flash('Copied — the root stays')
        return text
      }
      s.lastCut = gone.length === ids.length ? { text, ids: gone.flatMap((id) => subtreeIds(doc, id)) } : null
      const parent = doc.nodes[gone[0]]?.parent ?? doc.rootId
      let d = withEdit(doc)
      for (const id of gone) if (d.nodes[id]) d = removeNode(d, id)
      if (focusId && !d.nodes[focusId]) setFocusId(null)
      commit(d)
      setEdit(null)
      setDraftText(null)
      selectOne(d.nodes[parent] ? parent : d.rootId)
      flash(gone.length === 1 ? 'Cut branch' : `Cut ${gone.length} branches`)
      return text
    },
    [commit, doc, flash, focusId, selectOne, topSelected, withEdit],
  )

  /** Clipboard text → nodes under the selected node (or the root). True when something was pasted. */
  const pasteText = useCallback(
    (text: string): boolean => {
      const clip = clipboardFragment(text)
      if (!clip) return false
      const target = selection ?? doc.rootId
      // Pasting what was just cut from this map is a move: the branch keeps its block ids, so links into it still land.
      const cut = s.lastCut
      const moved = cut && cut.text.replace(/\r\n?/g, '\n') === text.replace(/\r\n?/g, '\n') ? cut.ids : undefined
      const [d, ids] = graft(withEdit(doc), target, clip, undefined, moved)
      if (!ids.length) return false
      commit(d)
      if (ids.length > 1) {
        setMulti(new Set(ids))
        setSelection(ids[ids.length - 1])
      } else selectOne(ids[0])
      const total = ids.reduce((s, id) => s + subtreeIds(d, id).length, 0)
      flash(total === 1 ? 'Pasted 1 node' : `Pasted ${total} nodes`)
      return true
    },
    [commit, doc, flash, selectOne, selection, withEdit],
  )

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    // obsidian: the host element's own document — in a popped-out window the global one is the main window's.
    const root = el.ownerDocument
    const copyOrCut = (e: ClipboardEvent, cut: boolean) => {
      // Cutting text in Find, the title or a hex field cuts that text, not the selected branch.
      if (inTextField(e.target) || activeLabel(root) || !e.clipboardData) return
      const text = takeSelection(cut)
      if (text === null) return
      e.preventDefault()
      e.clipboardData.setData('text/plain', text)
    }
    const onCopy = (e: ClipboardEvent) => copyOrCut(e, false)
    const onCut = (e: ClipboardEvent) => copyOrCut(e, true)
    const onPaste = (e: ClipboardEvent) => {
      if (inTextField(e.target)) return
      if (activeLabel(root)) return // the label's own handler takes it
      if (!e.clipboardData) return
      const target = selection ?? doc.rootId
      const files = mediaFiles(e.clipboardData.files)
      if (files.length) {
        e.preventDefault()
        void pasteFiles(target, files)
        return
      }
      if (pasteText(e.clipboardData.getData('text/plain'))) e.preventDefault()
    }
    el.addEventListener('copy', onCopy)
    el.addEventListener('cut', onCut)
    el.addEventListener('paste', onPaste)
    return () => {
      el.removeEventListener('copy', onCopy)
      el.removeEventListener('cut', onCut)
      el.removeEventListener('paste', onPaste)
    }
  }, [doc.rootId, pasteFiles, pasteText, rootRef, selection, takeSelection])

  /* -------------------- find in map -------------------- */

  const [search, setSearch] = useState<string | null>(null) // null: the find bar is closed
  const [searchIx, setSearchIx] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => {
    const q = (search ?? '').trim().toLowerCase()
    if (!q) return [] as NodeId[]
    return walk(doc, doc.rootId)
      .map((w) => w.id)
      .filter((id) => plainText(doc.nodes[id]?.text ?? '').toLowerCase().includes(q))
  }, [doc, search])
  const [jump, setJump] = useState<{ id: NodeId; n: number } | null>(null)

  const centerOn = useCallback(
    (b: Box) => {
      const rect = stageSize.current
      if (!rect.width) return
      if (prefs.shape === 'outline') animateCamera({ ...camera, y: clampOutlineY(rect.height / 2 - b.y * camera.z) }, 300)
      else animateCamera({ ...camera, x: rect.width / 2 - (leftOf(b, prefs.shape) + b.w / 2) * camera.z, y: rect.height / 2 - b.y * camera.z }, 300)
    },
    [animateCamera, camera, clampOutlineY, prefs.shape],
  )

  const jumpTo = useCallback(
    (i: number) => {
      if (!matches.length) return
      const ix = ((i % matches.length) + matches.length) % matches.length
      setSearchIx(ix)
      const id = matches[ix]
      // A match inside a folded branch: open the way to it — on screen only, so searching writes nothing to the file or the history.
      if (openTo(s, id)) setOpened(s.opened)
      selectOne(id)
      setJump({ id, n: Date.now() })
    },
    [matches, s, selectOne],
  )

  // Centre the match once its box exists (it may have just been unfolded).
  useEffect(() => {
    if (!jump) return
    const b = frame.boxes[jump.id]
    if (!b) return
    centerOn(b)
    setJump(null)
    // Deliberately not every value read here is a dependency.
  }, [frame, jump])

  // Typing lands on the first match, as Obsidian's own find does.
  const matchKey = matches.join('|')
  useEffect(() => {
    if (search !== null && matches.length) jumpTo(0)
    // Deliberately not every value read here is a dependency.
  }, [matchKey])

  // Read by the key handler, which is not rebuilt for every keystroke in Find: Esc must see Find open.
  const searchOpen = useRef(false)
  searchOpen.current = search !== null

  /** Close the Shortcuts or Export sheet; the keys come back to the map. */
  const closeSheet = useCallback(() => {
    setShowKeys(false)
    setExporting(false)
    rootRef.current?.focus({ preventScroll: true })
  }, [rootRef])

  const closeSearch = useCallback(() => {
    setSearch(null)
    setSearchIx(0)
    rootRef.current?.focus()
  }, [rootRef])

  const openSearch = useCallback(() => {
    setSearch((s) => s ?? '')
    window.requestAnimationFrame(() => {
      searchRef.current?.focus()
      searchRef.current?.select()
    })
  }, [])

  /* -------------------- navigation -------------------- */

  /** ⇧-arrow: keep what is selected and add the next node. */
  const extendTo = useCallback(
    (id: NodeId) => {
      setMulti((m) => {
        const next = new Set(m.size ? m : selection ? [selection] : [])
        next.add(id)
        return next
      })
      setSelection(id)
    },
    [selection],
  )

  const navigate = useCallback(
    (dir: ArrowDir, extend = false) => {
      const move = arrowMove(openDoc, frame, selection ?? doc.rootId, dir, extend)
      if (!move) return
      if ('toggle' in move) commit(toggleCollapse(withEdit(doc), move.toggle))
      else if (extend) extendTo(move.select)
      else selectOne(move.select)
    },
    [commit, doc, extendTo, frame, openDoc, selection, selectOne, withEdit],
  )

  useEffect(() => {
    if (!selection) return
    // Focus follows the selection: stepping out of the focused branch — to a
    // sibling branch, or up to the parent — moves the focus there, and the
    // refit on focusId frames and centres the new branch. Inside the branch
    // the focus stays put and the camera only keeps the node in view.
    // Focus on the root is the whole map, undimmed, still in focus mode — so
    // arrowing back out to the root and into another branch keeps following.
    if (focusId && focusSubtree && (focusId === doc.rootId ? selection !== doc.rootId : !focusSubtree.has(selection))) {
      setFocusId(selection)
      // The map refits to the new branch on focusId; the outline never refits, so it
      // scrolls the row into view here instead, like a document would.
      if (prefs.shape !== 'outline') return
    }
    ensureVisible(selection)
    // Only when the selection itself changes.
  }, [selection])

  /* -------------------- keyboard -------------------- */

  const toggleFocus = useCallback(() => {
    if (focusId) {
      setFocusId(null)
      return
    }
    if (selection) setFocusId(selection)
  }, [focusId, selection])

  useEffect(() => {
    // obsidian: handled keys must not reach Obsidian's global hotkeys (⌘E, ⌘N, Esc…).
    const stop = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }
    const onKey = (e: KeyboardEvent) => {
      // An IME is composing (Chinese, Japanese, Korean…): Enter and Tab belong
      // to the composition, not to the map.
      if (e.isComposing) return
      if (inTextField(e.target)) return
      // A sheet is open, or a button or a panel has focus: Enter, Space, Tab and letters are theirs — Enter after
      // clicking Export must not make a node behind the scrim. Esc still reaches the map.
      const onControl = !!(e.target as Element | null)?.closest?.('button, [role="button"], [role="dialog"], select, a[href], .toolbar, .inspector, .node-toolbar')
      if ((showKeys || exporting || onControl) && e.key !== 'Escape') return
      const mod = e.metaKey || e.ctrlKey
      const editing = !!edit
      const sel = selection
      // The key that starts a composition. On a selected node it starts typing there (below); anywhere else it is the input method's.
      const composing = e.keyCode === 229
      if (composing && (editing || !sel)) return

      if (e.key === '?' && !editing) {
        stop(e)
        setShowKeys((v) => !v)
        return
      }
      if (e.key === 'Escape') {
        stop(e)
        if (showKeys || exporting) closeSheet()
        else if (searchOpen.current) closeSearch()
        else if (editing) endEdit(prefs.discardEmptyOnEsc)
        else if (focusId) setFocusId(null)
        else if (multi.size) setMulti(new Set())
        else selectOne(null)
        return
      }
      if (e.key === 'Tab') {
        stop(e)
        if (!sel) return
        // The outline is an outliner: Tab and ⇧Tab move the row a level in or out,
        // typing or not, so Enter then Tab makes a child the way it does everywhere
        // else. The edit stays open on the moved node — its id does not change.
        // In the Map, Tab still adds a child; ⇧Tab outdents there too, rather than nothing.
        if (e.shiftKey || prefs.shape === 'outline') moveLevel(sel, e.shiftKey)
        else createChild(sel)
        return
      }
      if (e.key === 'Enter' && !mod) {
        stop(e)
        if (!sel) return
        if (e.shiftKey) {
          // ⇧Enter breaks the line inside the node rather than leaving it.
          // Node text is Markdown, so a multi-line node is a legitimate node.
          // Not typing yet: open the node, caret at the end, and break the line the same way — a seed ending
          // in a newline shows no new line, and its media would be added to the draft twice.
          if (!editing) flushSync(() => stageApi.beginEdit(sel, null, false))
          if (s.edit?.id === sel) (rootRef.current?.ownerDocument ?? document).execCommand('insertText', false, '\n')
          return
        }
        createSibling(sel)
        return
      }
      if (editing) return

      if (e.key === 'Backspace' || e.key === 'Delete') {
        stop(e)
        if (sel) deleteNode(sel)
        return
      }
      if (e.key === 'F2' && sel) {
        stop(e)
        stageApi.beginEdit(sel, null, true)
        return
      }
      if (e.key.startsWith('Arrow')) {
        stop(e)
        const dir = e.key.slice(5).toLowerCase() as ArrowDir
        if (e.altKey && sel && prefs.shape === 'map' && mapLayout === 'free') {
          // ⌥-arrow nudges the branch: the keyboard's way to do what a drag does.
          const step = snap ? (e.shiftKey ? GRID * 4 : GRID) : e.shiftKey ? 32 : 8
          const d = withEdit(doc)
          const [sx, sy] = snapDelta(d, sel, dir === 'left' ? -step : dir === 'right' ? step : 0, dir === 'up' ? -step : dir === 'down' ? step : 0)
          commit(moveBy(d, sel, sx, sy))
        } else if (e.altKey && sel && (dir === 'up' || dir === 'down')) {
          commit(reorder(withEdit(doc), sel, dir === 'up' ? -1 : 1))
        } else navigate(dir, e.shiftKey)
        return
      }
      // Type to edit: no edit mode, the selection just starts taking text. The key is not consumed: the label
      // opens with its text selected, and the browser types the key over it. That is how an input method gets
      // its first keystroke into the label, and ⌥-typed characters (@ and [ on a German Mac) count as typing too.
      const printable = e.key.length === 1 && e.key !== ' ' && (!mod || e.getModifierState('AltGraph'))
      if (sel && (composing || printable)) {
        e.stopPropagation()
        flushSync(() => stageApi.beginEdit(sel, null, true))
      }
    }
    const el = rootRef.current
    if (!el) return
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [
    rootRef,
    animateCamera,
    camera,
    closeSheet,
    commit,
    createChild,
    createSibling,
    deleteNode,
    doc,
    edit,
    endEdit,
    exporting,
    fitCamera,
    focusId,
    focusSubtree,
    frame,
    moveLevel,
    multi,
    navigate,
    prefs.inspectorOpen,
    prefs.shape,
    redo,
    selection,
    setPrefs,
    shiftTo,
    showKeys,
    stageApi,
    toggleFocus,
    undo,
    withEdit,
  ])

  useEffect(() => {
    if (prefs.shape !== 'outline' || !stageW) return
    setCamera((c) => ({ z: 1, x: outlineX(stageW) - frame.bounds.minX, y: c.y }))
    // frame.bounds.minX is 0 in the outline; deliberately not a dependency
  }, [prefs.shape, prefs.outlineWidth, stageW])

  /* -------------------- map layout (obsidian) -------------------- */

  /** Where nodes go — Mind map, Org chart or Free — pinned in the map's file. Free entered from the arrangement its
   *  positions do not follow starts from this one's positions (see withLayout). */
  const setLayout = useCallback(
    (next: MapLayout) => {
      if (prefs.shape !== 'map') setPrefs({ shape: 'map' })
      commit(withLayout(withEdit(doc), mapLayout, next))
    },
    [commit, doc, mapLayout, prefs.shape, setPrefs, withEdit],
  )

  /** ⌘3: the next layout — Mind map, Org chart, Free — and the HUD names it. */
  const toggleLayout = useCallback(() => {
    const next = nextLayout(mapLayout)
    setLayout(next)
    setHud({ key: chord('⌘3'), label: LAYOUT_LABEL[next] })
    timers.current.push(window.setTimeout(() => setHud(null), 900))
  }, [mapLayout, setLayout])

  /** Bake the arrangement the map is in, or Free follows, into the stored positions (undoable). With several nodes selected only
   *  they move, each to its tidy place beside where its parent actually is, its branch coming
   *  along the way a drag brings it — the rest of the map stays as it was laid by hand. */
  const tidy = useCallback(() => {
    const f = frameFor(doc, arrangementKind(arrangement))
    const pos: Record<NodeId, { x: number; y: number }> = {}
    if (multi.size < 2) {
      commit(tidied(withEdit(doc), arrangement))
      flash(`Tidied as ${arrangement === 'org' ? 'an org chart' : 'a mind map'} — ${chord('⌘Z')} puts it back`)
      return
    }
    const cur: Record<NodeId, { x: number; y: number }> = {}
    for (const n of Object.values(doc.nodes)) cur[n.id] = { x: n.x, y: n.y }
    let moved = 0
    // Tree order, so a parent has settled before its selected children measure from it.
    for (const { id } of walk(doc, doc.rootId)) {
      const n = doc.nodes[id]
      if (!multi.has(id) || !n?.parent) continue
      const b = f.boxes[id]
      const pb = f.boxes[n.parent]
      if (!b || !pb) continue // folded away: nothing to see, nothing to move
      const dx = cur[n.parent].x + (b.x - pb.x) - cur[id].x
      const dy = cur[n.parent].y + (b.y - pb.y) - cur[id].y
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
      for (const s of subtreeIds(doc, id)) {
        cur[s] = { x: cur[s].x + dx, y: cur[s].y + dy }
        pos[s] = cur[s]
      }
      moved++
    }
    if (!moved) {
      flash('Those are already tidy')
      return
    }
    commit(bakePositions(withEdit(doc), pos))
    flash(`Tidied ${moved} ${moved === 1 ? 'node' : 'nodes'} — ${chord('⌘Z')} puts it back`)
  }, [arrangement, commit, doc, flash, multi, withEdit])

  /** Heading level for the selection (every selected node when several are). */
  const sizeSelection = useCallback(
    (level: 1 | 2 | 3 | undefined) => {
      const ids = multi.size > 1 ? [...multi] : selection ? [selection] : []
      if (!ids.length) return
      let d = withEdit(doc)
      for (const id of ids) d = setSize(d, id, level)
      commit(d)
    },
    [commit, doc, multi, selection, withEdit],
  )

  const format = useCallback(
    (f: Format) => {
      if (s.edit) applyFormat(f, rootRef.current?.ownerDocument)
    },
    [rootRef, s],
  )

  /** The nodes a selection-wide command applies to: every selected node, or the one. */
  const selectedIds = useCallback(() => (multi.size > 1 ? [...multi] : selection ? [selection] : []).filter((id) => id !== doc.rootId), [doc.rootId, multi, selection])

  const toggleTaskSelection = useCallback(() => {
    const ids = selectedIds()
    if (!ids.length) return
    let d = withEdit(doc)
    // Plain nodes get a box first; all-open ticks; all-done (or a mix) reopens — the three states in order.
    const plain = ids.some((id) => d.nodes[id]?.task == null)
    const allDone = !plain && ids.every((id) => d.nodes[id]?.task === 'x')
    for (const id of ids) d = setTask(d, id, plain ? ' ' : allDone ? ' ' : 'x')
    commit(d)
  }, [commit, doc, selectedIds, withEdit])

  const toggleOrderedSelection = useCallback(() => {
    const ids = selectedIds()
    if (!ids.length) return
    let d = withEdit(doc)
    const on = !ids.every((id) => d.nodes[id]?.ordered)
    for (const id of ids) d = setOrdered(d, id, on)
    commit(d)
  }, [commit, doc, selectedIds, withEdit])

  /** obsidian: arrive on a node from outside — a [[Note#^id]] link or a search hit. */
  const reveal = useCallback(
    (id: NodeId) => {
      if (!s.doc.nodes[id]) return
      if (openTo(s, id)) setOpened(s.opened)
      if (focusId && focusId !== id && !isDescendant(doc, id, focusId)) setFocusId(null)
      selectOne(id)
      setJump({ id, n: Date.now() })
    },
    [doc, focusId, s, selectOne],
  )

  /* -------------------- host commands (obsidian) -------------------- */

  const zoomBy = useCallback(
    (k: number) => {
      if (prefs.shape === 'outline') return
      const rect = stageSize.current
      const z = Math.min(2.5, Math.max(0.2, camera.z * k))
      if (!rect.width) return
      const px = rect.width / 2
      const py = rect.height / 2
      animateCamera({ z, x: px - (px - camera.x) * (z / camera.z), y: py - (py - camera.y) * (z / camera.z) }, 200)
    },
    [animateCamera, camera, prefs.shape],
  )

  useEffect(() => {
    if (!onApi) return
    onApi({
      undo,
      redo,
      shift: shiftTo,
      toggleInspector: () => setPrefs({ inspectorOpen: !prefs.inspectorOpen }),
      align: (a) => { if (selection) commit(setAlign(withEdit(doc), selection, a)) },
      toggleFocus,
      toggleCollapse: () => { if (selection) commit(toggleCollapse(withEdit(doc), selection)) },
      reorder: (delta) => { if (selection) commit(reorder(withEdit(doc), selection, delta)) },
      zoomBy,
      fit: () => fitCamera(frame, prefs.shape, true, focusSubtree),
      export: () => setExporting(true),
      toggleLayout,
      tidy,
      format,
      size: sizeSelection,
      search: openSearch,
      selectAll: () => {
        if (edit) {
          (rootRef.current?.ownerDocument ?? document).execCommand('selectAll')
          return
        }
        // Every node on show; in focus, the branch's, not the dimmed rest.
        setMulti(new Set(focusSubtree ? frame.order.filter((id) => focusSubtree.has(id)) : frame.order))
        if (!selection) setSelection(focusId ?? doc.rootId)
      },
      toggleEdit: () => {
        if (edit) endEdit()
        else if (selection) stageApi.beginEdit(selection, null, false)
      },
      editAll: () => {
        if (s.edit) (rootRef.current?.ownerDocument ?? document).execCommand('selectAll')
        else if (selection) stageApi.beginEdit(selection, null, true)
      },
      addChild: () => createChild(selection ?? doc.rootId),
      addSibling: () => { if (selection && selection !== doc.rootId) createSibling(selection); else createChild(doc.rootId) },
      deleteSelection: () => { if (selection) deleteNode(selection) },
      copy: async (cut) => {
        const text = takeSelection(cut)
        if (text === null) return
        try { await navigator.clipboard.writeText(text) } catch { flash('Could not reach the clipboard') }
      },
      paste: async () => {
        let text = ''
        try { text = await navigator.clipboard.readText() } catch { flash('Could not read the clipboard'); return }
        if (!pasteText(text)) flash('Nothing to paste as nodes')
      },
      nudge: (dx, dy) => {
        if (!selection) return
        const d = withEdit(doc)
        const [sx, sy] = snapDelta(d, selection, dx, dy)
        commit(moveBy(d, selection, sx, sy))
      },
      toggleTask: toggleTaskSelection,
      toggleOrdered: toggleOrderedSelection,
      reveal,
      typed: () => typed(s),
      flushEdit: () => {
        const before = s.doc
        if (flushDraft(s) === before) return
        setHistoryTick((t) => t + 1)
        putDoc(s.doc)
      },
    })
  }, [endEdit, stageApi, commit, createChild, createSibling, deleteNode, doc, edit, fitCamera, flash, focusId, focusSubtree, format, frame, onApi, openSearch, pasteText, prefs.inspectorOpen, prefs.shape, putDoc, redo, reveal, rootRef, s, selection, setPrefs, shiftTo, sizeSelection, takeSelection, tidy, toggleFocus, toggleLayout, toggleOrderedSelection, toggleTaskSelection, undo, withEdit, zoomBy])
  useEffect(() => () => onApi?.(null), [onApi])

  /* -------------------- import -------------------- */

  const importFile = useCallback(
    async (file: File) => {
      try {
        const into = fileKeyRef.current
        const text = await file.text()
        // obsidian: the tab may have opened another file while this one was read; it joins the map it was dropped on or none.
        if (fileKeyRef.current !== into) return
        const { fragment, count } = mapFileFragment(file.name, text)
        // The dropped map joins this one as a branch under the selection (or the root). Swapping the whole map
        // for it would lose this one — and the note's frontmatter and the text around its list with it.
        const base = withEdit(s.doc)
        const [next, ids] = graft(base, selection && base.nodes[selection] ? selection : base.rootId, fragment)
        if (!ids.length) return
        commit(next)
        selectOne(ids[0])
        flash(`Imported ${count} nodes from ${file.name}`)
      } catch (err) {
        flash(err instanceof Error ? err.message : 'That file could not be read as JSON Canvas or OPML.')
      }
    },
    [commit, flash, s, selectOne, selection, withEdit],
  )

  /* -------------------- render -------------------- */

  const crumbs = focusId ? [...ancestors(doc, focusId), focusId] : []

  return (
    <div
      className={`app${prefs.inspectorOpen ? ' inspector-open' : ''}${narrow ? ' is-narrow' : ''}`}
      style={{ '--io-bottom-inset': `${bottomInset}px` } as React.CSSProperties}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const f = e.dataTransfer.files[0]
        if (!f || !isMapFile(f.name)) return
        e.preventDefault()
        void importFile(f)
      }}
    >
      <main className="main">
        <Toolbar
          shape={prefs.shape}
          focusActive={!!focusId}
          canFocus={!!selection}
          tidyScope={multi.size > 1 ? multi.size : 0}
          onShape={shiftTo}
          onToggleFocus={toggleFocus}
          onExport={() => setExporting(true)}
          outlineWidth={prefs.outlineWidth}
          onOutlineWidth={(outlineWidth) => setPrefs({ outlineWidth })}
          mapLayout={mapLayout}
          arrangement={arrangement}
          onMapLayout={setLayout}
          onTidy={tidy}
          inspectorOpen={prefs.inspectorOpen}
          onToggleInspector={() => setPrefs({ inspectorOpen: !prefs.inspectorOpen })}
        />

        <div className={`canvas-wrap${focusId ? ' is-focused' : ''}`}>
          {!focusId && (
            <DocTitle
              name={fileName ?? doc.name}
              onRename={async (name) => {
                if (onRenameFile) { if (!(await onRenameFile(name))) flash('Could not rename the note') }
                else commit(rename(withEdit(doc), name))
              }}
            />
          )}
          <Stage
            doc={viewDoc}
            shape={prefs.shape}
            palette={palette}
            dots={dots}
            snap={snap}
            themeId={theme}
            frame={frame}
            camera={camera}
            selection={selection}
            selected={multi}
            matches={search !== null && search.trim() ? new Set(matches) : undefined}
            editId={edit?.id ?? null}
            editSeed={edit ? { text: edit.seed, selectAll: edit.selectAll } : null}
            focusId={focusId}
            dimmed={dimmed}
            morphing={morphing}
            edgesHidden={edgesHidden}
            cameraAnimated={cameraAnimated}
            reduceMotion={prefs.reduceMotion}
            api={stageApi}
            outside={outside}
            stageRef={stageRef}
            hostRef={rootRef}
          />

          {search !== null && (
            <div className="find" role="search">
              <input
                ref={searchRef}
                className="find-input"
                type="search"
                placeholder="Find in map"
                aria-label="Find in map"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  // Enter confirming an input method's word is not a step to the next match.
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key === 'g')) {
                    e.preventDefault()
                    jumpTo(searchIx + (e.shiftKey ? -1 : 1))
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    closeSearch()
                  }
                }}
              />
              <span className="find-count" aria-live="polite">
                {search.trim() ? (matches.length ? `${searchIx + 1} of ${matches.length}` : 'No matches') : ''}
              </span>
              <button type="button" className="find-btn prev" aria-label="Previous match" disabled={!matches.length} onClick={() => jumpTo(searchIx - 1)}>
                <IconChevron size={14} />
              </button>
              <button type="button" className="find-btn" aria-label="Next match" disabled={!matches.length} onClick={() => jumpTo(searchIx + 1)}>
                <IconChevron size={14} />
              </button>
              <button type="button" className="find-btn" aria-label="Close find" onClick={closeSearch}>
                <IconClose size={14} />
              </button>
            </div>
          )}

          {focusId && (
            <>
              <div className="crumb">
                {crumbs.map((id, i) => (
                  <span key={id}>
                    {i > 0 && <span className="crumb-sep">›</span>}
                    <button
                      className={i === crumbs.length - 1 ? 'is-current' : ''}
                      onClick={() => setFocusId(id)}
                    >
                      {crumbText(doc.nodes[id]?.text)}
                    </button>
                  </span>
                ))}
              </div>
              <button type="button" className="esc" onClick={() => setFocusId(null)} aria-label="Exit focus — Esc">
                <kbd>Esc</kbd> to exit · <kbd>{chord('⌥⌘F')}</kbd>
              </button>
            </>
          )}

          {/* View and history controls share the bottom-left corner: where the hand
              rests on a trackpad, and where a thumb reaches on a phone. */}
          <div className="corner-left">
            {/* The Outline stays at 100%, so it has nothing to zoom. */}
            {prefs.shape === 'map' && (
              <div className="zoom">
                <button onClick={() => animateCamera({ ...camera, z: Math.max(0.2, camera.z / 1.2) }, 180)} title={`Zoom out — ${chord('⌥⌘-')}`}>
                  −
                </button>
                <button className="zoom-val" onClick={() => fitCamera(frame, prefs.shape, true, focusSubtree)} title={`Fit — ${chord('⇧⌘0')}`}>
                  {Math.round(camera.z * 100)}%
                </button>
                <button onClick={() => animateCamera({ ...camera, z: Math.min(2.5, camera.z * 1.2) }, 180)} title={`Zoom in — ${chord('⌥⌘=')}`}>
                  +
                </button>
              </div>
            )}
            {/* Pressing Undo or Redo leaves the focus where it is. Taken from the label, it would first leave the node being
                typed into — on a touch screen, taking back an empty node Enter just made — and the undo would then take back
                the change before it. */}
            <div className="history" role="group" aria-label="History" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}>
              <button onClick={undo} disabled={!(s.history.past.length > 0 && historyTick >= 0)} aria-label={`Undo — ${chord('⌘Z')}`}>
                <IconUndo size={15} />
              </button>
              <button onClick={redo} disabled={!(s.history.future.length > 0 && historyTick >= 0)} aria-label={`Redo — ${chord('⇧⌘Z')}`}>
                <IconRedo size={15} />
              </button>
            </div>
            <button className="help" onClick={() => setShowKeys(true)} title="Shortcuts — ?">
              ?
            </button>
          </div>

          {hud && (
            <div className="hud" key={hud.key + hud.label}>
              <b>{hud.key}</b>
              <span>{hud.label}</span>
            </div>
          )}

          {toast && <div className="toast">{toast}</div>}
          <div className="sr-only" role="status" aria-live="polite">{live}</div>
        </div>
      </main>

      {prefs.inspectorOpen && (
        <Inspector
          themeId={theme}
          themePinned={!!doc.look?.theme}
          defaultThemeId={prefs.theme}
          nodeStyle={nodeStyle}
          shape={prefs.shape}
          palette={palette}
          customTheme={customThemeDef}
          noteDismissed={!!prefs.inspectorNoteDismissed}
          dots={dots}
          snap={!!doc.look?.snap}
          onDots={(on) => commit(setLook(withEdit(doc), { dots: on ? undefined : false }))}
          onSnap={(on) => commit(setLook(withEdit(doc), { snap: on ? true : undefined }))}
          onTheme={(t) => commit(setLook(withEdit(doc), { theme: t }))}
          onNodeStyle={(style) => commit(setLook(withEdit(doc), { nodeStyle: style }))}
          onPalette={(slot, hex) => commit(setPalette(withEdit(doc), slot, hex), `palette-${slot}`)}
          onRemovePalette={removeOwnColour}
          onCustomTheme={(def) => onCustomTheme?.(def)}
          onDismissNote={() => setPrefs({ inspectorNoteDismissed: true })}
          onClose={() => setPrefs({ inspectorOpen: false })}
        />
      )}

      {exporting && <ExportSheet
          doc={doc}
          kind={kind}
          resolveEmbed={resolveEmbed}
          themeId={theme}
          nodeStyle={nodeStyle}
          palette={palette}
          onClose={closeSheet}
        />}
      {showKeys && <ShortcutsSheet onClose={closeSheet} onTour={onTour} mac={mac} />}
    </div>
  )
}

/** An object with the same methods as `ref.current`, each calling whatever `ref.current` holds when it is called. */
function forwarding<T extends object>(ref: { readonly current: T }): T {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(ref.current)) out[key] = (...args: unknown[]) => (ref.current as Record<string, (...a: unknown[]) => unknown>)[key](...args)
  return out as T
}

/** A text field of the map's own (Find, the note's title, a hex field): its keys and its clipboard are its own.
 *  A node label being typed into is not one — Enter, Tab and Esc still belong to the map there. */
function inTextField(target: EventTarget | null): boolean {
  const el = target as Element | null
  return el?.nodeType === 1 && !!el.closest('input, textarea') && !el.closest('.node-label')
}

/** A breadcrumb's text: the first line, markup read out, cut to a fixed length. */
const CRUMB_CHARS = 28
function crumbText(text: string | undefined): string {
  const t = plainText((text || 'Untitled').split('\n')[0]).trim() || 'Untitled'
  return t.length > CRUMB_CHARS ? t.slice(0, CRUMB_CHARS - 1).trimEnd() + '…' : t
}

/** obsidian: the note's name in the canvas's top-left corner, like Obsidian's inline title; click to rename. */
function DocTitle({ name, onRename }: { name: string; onRename: (name: string) => void | Promise<void> }) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="doc-name">
      {editing ? (
        <input
          autoFocus
          className="doc-name-input"
          defaultValue={name}
          onBlur={(e) => {
            const next = e.currentTarget.value.trim()
            if (next && next !== name) void onRename(next)
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setEditing(false)
            e.stopPropagation()
          }}
        />
      ) : (
        <button className="doc-name-btn" onClick={() => setEditing(true)} aria-label="Rename the note">
          {name}
        </button>
      )}
    </div>
  )
}
