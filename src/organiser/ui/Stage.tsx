import type * as React from 'react'
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Align, IODoc, IONode, LayoutKind, NodeId, NodeType, Shape } from '../model/types'
import { applyFormat, insertLineBreak } from './format'
import { NodeBar } from './NodeBar'
import { RichLabel } from './RichLabel'
import { domToMarkdown, dropText, pasteText, renderInto } from './wysiwyg'
import type { Box, Frame } from '../layout'
import { leftOf, linkPath, snapX, treePath } from '../layout'
import { dropTargetFor, hitTest, type DropTarget } from '../layout/drop'
import { MAX_PILL_W, MAX_ROOT_TEXT_W, MAX_TEXT_W, MIN_PILL_W, ROW_LEAD, ROW_PAD, metricsFor, nodeMetrics, outlineTextAvailable, setMediaSize } from '../layout/measure'
import { stripEmbeds } from '../model/inline'
import { branchColor, readableOn, themeById } from '../theme'
import { isDescendant, nodeTypeOf, ordinalOf, subtreeIds } from '../model/doc'
import { mediaFiles } from '../model/ingest'
import { outlineSwipeAction } from './mobile'

export interface Camera {
  x: number
  y: number
  z: number
}

export interface StageApi {
  select(id: NodeId | null): void
  beginEdit(id: NodeId, seed: string | null, selectAll: boolean): void
  draft(text: string): void
  commitEdit(): void
  toggleCollapse(id: NodeId): void
  reparent(id: NodeId, parent: NodeId, index: number, side?: -1 | 1): void
  moveNode(id: NodeId, x: number, y: number): void
  moveBranch(id: NodeId, dx: number, dy: number): void
  setAlign(id: NodeId, align: Align): void
  setNodeType(id: NodeId, type: NodeType): void
  setBranch(id: NodeId, branch: number): void
  /** Outline rows a level in or out — the bar's buttons for Tab and ⇧Tab on touch. */
  indent(id: NodeId): void
  outdent(id: NodeId): void
  reorder(id: NodeId, delta: number): void
  createChild(parent: NodeId, at?: number, pos?: { x: number; y: number }): void
  linkNodes(from: NodeId, to: NodeId): void
  setCamera(c: Camera): void
  // obsidian: multi-selection and links
  selectMany(ids: NodeId[], primary: NodeId | null): void
  toggleSelect(id: NodeId): void
  moveMany(ids: NodeId[], dx: number, dy: number, alone: boolean): void
  reparentMany(ids: NodeId[], parent: NodeId, index: number, side?: -1 | 1): void
  openLink: (href: string, wiki: boolean) => void
  /** `shift` moves the node so the edge opposite the drag stays put (free layout). */
  setWidth(id: NodeId, width: number | undefined, shift?: number): void
  /** Live width while the edge is being dragged; null when the drag ends. */
  previewWidth(id: NodeId, width: number | null, shift?: number): void
  // obsidian: media in nodes
  resolveEmbed: (file: string) => { url: string; kind: 'image' | 'audio' } | null
  mediaChanged(): void
  removeEmbed(id: NodeId, index: number): void
  pasteFiles(id: NodeId, files: File[]): void
  // obsidian: notes dragged in from the file explorer, and hover previews on [[links]]
  /** Secondary click on a node (id) or on empty canvas (null); the host shows its menu. */
  contextMenu(e: MouseEvent, id: NodeId | null): void
  /** Returns true when the host recognised the drag as notes and handled it. */
  dropExternal(id: NodeId | null, world: { x: number; y: number }, dt: DataTransfer): boolean
  canDropExternal(dt: DataTransfer): boolean
  hoverLink: (target: HTMLElement, href: string, event: MouseEvent) => void
  // obsidian: list kinds — `1.` items and `- [ ]` tasks, as the file has them
  /** Tick or untick a task's box. */
  toggleTask(id: NodeId): void
  /** A #tag chip was clicked: the host searches the vault. */
  openTag: (tag: string) => void
  /** One of the map's own colour slots (branch index 8 + slot). */
  setPalette(slot: number, hex: string): void
  /** Fill a slot and give the node's branch that colour, as one change. */
  addOwnColour(id: NodeId, slot: number, hex: string): void
  /** Empty a slot; branches wearing it go back to their theme colour. */
  removeOwnColour(slot: number): void
}

interface Props {
  doc: IODoc
  shape: Shape
  themeId: string
  /** The map's own branch colours, by slot; branch indices 8 and up. */
  palette: string[]
  /** The dot grid behind the map. */
  dots: boolean
  /** Free-layout moves land on the grid: the dragged node magnetises to it as it goes. */
  snap: boolean
  frame: Frame
  camera: Camera
  selection: NodeId | null
  /** Every selected node (the primary included) when more than one is selected. */
  selected: Set<NodeId>
  /** Find in map: the nodes that match; undefined when the find bar is closed. */
  matches?: Set<NodeId>
  editId: NodeId | null
  editSeed: { text: string | null; selectAll: boolean } | null
  focusId: NodeId | null
  dimmed: Set<NodeId>
  morphing: boolean
  edgesHidden: boolean
  cameraAnimated: boolean
  reduceMotion: boolean
  api: StageApi
  /** A new object when what nodes draw from outside the document may have changed (see MapApp). */
  outside: object
  stageRef: React.RefObject<HTMLDivElement>
  /** The view's host: where the key handler listens, and the boundary inside which focus is ours to keep. */
  hostRef: React.RefObject<HTMLDivElement>
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number; moved: boolean }
  | {
      kind: 'node'
      id: NodeId
      sx: number
      sy: number
      moved: boolean
      dx: number
      dy: number
      wx: number
      wy: number
      /** ⌥ held: move this node only, leaving its branch behind. */
      alone: boolean
      /** Already selected when the press began — a tap then means "edit". */
      wasSelected: boolean
      /** Touch outlines reserve a horizontal swipe for indent/outdent. */
      touch: boolean
      /** Part of a multi-selection: the whole selection travels. */
      multi: boolean
      target: DropTarget | null
    }
  /** Drag on empty space: a selection rectangle, in client coordinates. */
  | { kind: 'marquee'; sx: number; sy: number; ex: number; ey: number; moved: boolean; additive: boolean; base: NodeId[] }
  | { kind: 'handle'; id: NodeId; sx: number; sy: number; moved: boolean; wx: number; wy: number; over: NodeId | null }
  /** Dragging a pill's right edge: live width until release. */
  | { kind: 'resize'; id: NodeId; sx: number; w0: number; w: number; side: -1 | 1; factor: 1 | 2; shift: boolean }
  /** Two fingers: zoom about the midpoint, pan with it. */
  | { kind: 'pinch'; d0: number; mid0: { x: number; y: number }; cam0: Camera }
  | null

const STAGGER_MS = 14
const STAGGER_CAP = 210
/** How long the map has to sit still before the + and − knobs fade. */
const QUIET_AFTER_MS = 5000
/** The dot grid's spacing, in world units — what Snap to grid rounds to (see MapApp). */
export const GRID = 24

export function Stage({
  doc,
  shape,
  themeId,
  palette,
  dots,
  snap,
  frame,
  camera,
  selection,
  selected,
  matches,
  editId,
  editSeed,
  focusId,
  dimmed,
  morphing,
  edgesHidden,
  cameraAnimated,
  reduceMotion,
  api,
  outside,
  stageRef,
  hostRef,
}: Props) {
  // One id per mounted map: two maps open side by side must not share the tree's label id.
  const treeLabelId = useId()
  const [drag, setDrag] = useState<Drag>(null)
  const [hover, setHover] = useState<NodeId | null>(null)
  /** Node under an external drag (a note from the explorer). */
  const [dropOver, setDropOver] = useState<NodeId | null>(null)
  // obsidian: the + and − knobs fade after a few still seconds, so the map is just the map
  // while you read it. Any movement, key or change of selection brings them back.
  const [quiet, setQuiet] = useState(false)
  const wakeRef = useRef<() => void>(() => {})
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // obsidian: the host's own window, which is not the main one when the map is in a popout.
    const win = host.ownerDocument.defaultView ?? window
    let timer = 0
    const wake = () => {
      setQuiet(false)
      win.clearTimeout(timer)
      timer = win.setTimeout(() => setQuiet(true), QUIET_AFTER_MS)
    }
    wakeRef.current = wake
    wake()
    const events: (keyof HTMLElementEventMap)[] = ['pointermove', 'pointerdown', 'keydown', 'wheel']
    for (const ev of events) host.addEventListener(ev, wake, { passive: true, capture: true })
    return () => {
      win.clearTimeout(timer)
      for (const ev of events) host.removeEventListener(ev, wake, { capture: true })
    }
  }, [hostRef])
  useEffect(() => wakeRef.current(), [selection, editId, doc])

  const dragRef = useRef<Drag>(null)
  dragRef.current = drag

  // The node elements themselves, so the connectors can be drawn from where a
  // node actually *is* mid-transition rather than where it is headed.
  const nodeEls = useRef<Map<NodeId, HTMLDivElement>>(new Map())
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  // Keyboard focus follows the selection while focus is already in the canvas,
  // so VoiceOver and Full Keyboard Access land on the node the arrows chose.
  // Never while a label is being edited or a field elsewhere has focus.
  //
  // It also comes back when the element that held it is gone: a label leaving
  // edit mode (Esc remounts the span), a node just deleted. The browser then
  // parks focus on <body> without a blur, the key handler on the host stops
  // hearing keys, and arrows, Enter and Delete go dead until the next click.
  // `lastFocus` is the element that last took focus inside the host; if it is no
  // longer in the document while <body> is active, focus was dropped, not moved.
  const lastFocus = useRef<Element | null>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onIn = (e: FocusEvent) => {
      lastFocus.current = e.target as Element | null
    }
    const onOut = (e: FocusEvent) => {
      // Focus moved somewhere else on purpose. A removed element never gets here.
      const to = e.relatedTarget as Node | null
      if (to && !host.contains(to)) lastFocus.current = null
    }
    host.addEventListener('focusin', onIn)
    host.addEventListener('focusout', onOut)
    return () => {
      host.removeEventListener('focusin', onIn)
      host.removeEventListener('focusout', onOut)
    }
  }, [hostRef])
  useEffect(() => {
    const host = hostRef.current
    const root = host?.ownerDocument ?? document
    const active = root.activeElement as HTMLElement | null
    const dropped = (!active || active === root.body) && !!lastFocus.current && !lastFocus.current.isConnected
    const el = selection ? nodeEls.current.get(selection) : undefined
    if (!el) {
      if (dropped) host?.focus({ preventScroll: true })
      return
    }
    if (active === el || active?.isContentEditable) return
    if (dropped || active?.closest('.stage') || active === host) el.focus({ preventScroll: true })
  }, [selection, editId, hostRef])
  // obsidian: the frame says how it was laid out; 'canvas' is the Map's free layout, 'org' its Org chart.
  const kind: LayoutKind = frame.shape
  const manual = kind === 'canvas'

  // obsidian: what the dragged nodes show while in hand. With Snap to grid on (free layout), the
  // node in hand lands on the nearest dot as it moves, so the drop is where it looked.
  const dragOffset = (() => {
    if (drag?.kind !== 'node') return { x: 0, y: 0 }
    if (!snap || !manual) return { x: drag.dx, y: drag.dy }
    const b = frame.boxes[drag.id]
    if (!b) return { x: drag.dx, y: drag.dy }
    return { x: snapX(doc, drag.id, b.w, b.x + drag.dx, GRID) - b.x, y: Math.round((b.y + drag.dy) / GRID) * GRID - b.y }
  })()
  // Space held turns a background drag into a pan (so does ⌥ or the middle button).
  const spaceRef = useRef(false)
  useEffect(() => {
    // obsidian: listen where the map is — a popped-out window has its own document. Elements from
    // another window fail `instanceof`, so the node type is checked instead.
    const doc = hostRef.current?.ownerDocument ?? document
    const win = doc.defaultView ?? window
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return el?.nodeType === 1 && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
    }
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e.target)) spaceRef.current = true
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false
    }
    // A Space released while the window was in the background never sends its keyup.
    const reset = () => {
      spaceRef.current = false
    }
    doc.addEventListener('keydown', down)
    doc.addEventListener('keyup', up)
    doc.addEventListener('visibilitychange', reset)
    win.addEventListener('blur', reset)
    return () => {
      doc.removeEventListener('keydown', down)
      doc.removeEventListener('keyup', up)
      doc.removeEventListener('visibilitychange', reset)
      win.removeEventListener('blur', reset)
    }
  }, [hostRef])
  // Bumped whenever something starts nodes moving that isn't a layout change —
  // releasing a drag, most of all, when the node eases back on its own.
  const [settleKey, setSettleKey] = useState(0)

  // Every pointer currently down, by id. Two of them is a pinch.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())

  const pinchFrom = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    d: Math.hypot(a.x - b.x, a.y - b.y),
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  })

  /** Called from either pointer-down handler once a second finger lands. */
  // Capture can throw for a pointer the browser no longer knows about (a finger
  // already lifted, or a synthetic event); losing capture is harmless, so don't
  // let it abort the gesture.
  const capture = (target: HTMLElement, pointerId: number) => {
    try {
      target.setPointerCapture(pointerId)
    } catch {
      /* ignore */
    }
  }

  const beginPinch = (target: HTMLElement, pointerId: number) => {
    capture(target, pointerId)
    const [a, b] = [...pointers.current.values()]
    const { d, mid } = pinchFrom(a, b)
    const rect = stageRef.current?.getBoundingClientRect()
    const mid0 = rect ? { x: mid.x - rect.left, y: mid.y - rect.top } : mid
    setDrag({ kind: 'pinch', d0: Math.max(1, d), mid0, cam0: cameraRef.current })
  }

  // Reads the camera through the ref so the function is stable across pans —
  // otherwise every wheel tick would hand all thousand nodes a new handler
  // and re-render them for nothing.
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = stageRef.current?.getBoundingClientRect()
      const cam = cameraRef.current
      if (!rect) return { x: 0, y: 0 }
      return { x: (clientX - rect.left - cam.x) / cam.z, y: (clientY - rect.top - cam.y) / cam.z }
    },
    [stageRef],
  )

  /* -------------------- pointer plumbing -------------------- */

  const onPointerDownStage = (e: React.PointerEvent) => {
    if (e.button === 2) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2) {
      beginPinch(e.currentTarget as HTMLElement, e.pointerId)
      return
    }
    const el = e.target as HTMLElement
    if (el.closest('.node') || el.closest('.node-toolbar')) return
    capture(e.currentTarget as HTMLElement, e.pointerId)
    // obsidian: a plain drag on empty space selects; panning is scroll, pinch, ⌥/Space-drag or the middle button.
    if (e.button === 1 || e.altKey || spaceRef.current || e.pointerType === 'touch') {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, cx: camera.x, cy: camera.y, moved: false })
      return
    }
    setDrag({ kind: 'marquee', sx: e.clientX, sy: e.clientY, ex: e.clientX, ey: e.clientY, moved: false, additive: e.shiftKey, base: e.shiftKey ? [...selectedRef.current] : [] })
  }

  // Read by the press handler below, which stays one function for the life of the stage: a new one would reach every
  // node and draw all of them again whenever the layout changed.
  const pressRef = useRef({ frame, rootId: doc.rootId, editId, manual })
  pressRef.current = { frame, rootId: doc.rootId, editId, manual }
  const onPointerDownNode = useCallback((e: React.PointerEvent, id: NodeId) => {
    const { frame, rootId, editId, manual } = pressRef.current
    if (e.button === 2) return
    e.stopPropagation()
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2) {
      // Second finger landed on a node: it's a pinch, not a drag.
      beginPinch(stageRef.current as HTMLElement, e.pointerId)
      return
    }
    const el = e.target as HTMLElement
    if (el.closest('.node-disc')) return
    const w = toWorld(e.clientX, e.clientY)
    capture(e.currentTarget as HTMLElement, e.pointerId)

    if (el.closest('.node-knob')) {
      setDrag({ kind: 'handle', id, sx: e.clientX, sy: e.clientY, moved: false, wx: w.x, wy: w.y, over: null })
      return
    }
    if (el.closest('.node-resize')) {
      const b = frame.boxes[id]
      const side = (el.closest('.node-resize') as HTMLElement).dataset.side === 'left' ? -1 : 1
      // The dragged edge follows the cursor 1:1. The Mind map pins a node's inner edge, so width
      // changes by the cursor's travel; the root is centred, and so is every node of the Org chart,
      // so those grow both ways at once. Free layout keeps the far edge put by shifting the node half the change.
      const centred = id === rootId || frame.shape === 'org'
      setDrag({ kind: 'resize', id, sx: e.clientX, w0: b?.w ?? 200, w: b?.w ?? 200, side, factor: !manual && centred ? 2 : 1, shift: manual })
      return
    }
    if (editId === id) return
    if (e.shiftKey) {
      api.toggleSelect(id)
      return
    }
    const wasSelected = selectionRef.current === id
    const multi = selectedRef.current.size > 1 && selectedRef.current.has(id)
    if (!multi) api.select(id)
    setDrag({ kind: 'node', id, sx: e.clientX, sy: e.clientY, moved: false, dx: 0, dy: 0, wx: w.x, wy: w.y, alone: e.altKey, wasSelected, touch: e.pointerType === 'touch', multi, target: null })
    // Deliberately not every value read here is a dependency.
  }, [api, toWorld])

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    // Pressed when the gesture began, released without a pointerup reaching us: the gesture is over.
    if (d && d.kind !== 'pinch' && e.buttons === 0 && pointers.current.has(e.pointerId)) {
      cancelGesture(e.pointerId)
      return
    }
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (!d) return
    if (d.kind === 'pinch') {
      if (pointers.current.size < 2) return
      const [a, b] = [...pointers.current.values()]
      const { d: dist, mid } = pinchFrom(a, b)
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect) return
      const m = { x: mid.x - rect.left, y: mid.y - rect.top }
      const z = Math.min(2.5, Math.max(0.2, d.cam0.z * (dist / d.d0)))
      const k = z / d.cam0.z
      // Keep the world point that was under the first midpoint under the
      // current midpoint — so the map zooms about the fingers and pans with them.
      api.setCamera({ z, x: m.x - (d.mid0.x - d.cam0.x) * k, y: m.y - (d.mid0.y - d.cam0.y) * k })
      return
    }
    if (d.kind === 'pan') {
      const dx = e.clientX - d.sx
      const dy = e.clientY - d.sy
      if (!d.moved && Math.hypot(dx, dy) < 3) return
      setDrag({ ...d, moved: true })
      api.setCamera({ ...camera, x: d.cx + dx, y: d.cy + dy })
      return
    }
    if (d.kind === 'resize') {
      const w = Math.round(Math.max(MIN_PILL_W, Math.min(MAX_PILL_W, d.w0 + (d.side * (e.clientX - d.sx) * d.factor) / camera.z)))
      if (w !== d.w) {
        setDrag({ ...d, w })
        api.previewWidth(d.id, w, d.shift ? (d.side * (w - d.w0)) / 2 : 0)
      }
      return
    }
    if (d.kind === 'marquee') {
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return
      const a = toWorld(Math.min(d.sx, e.clientX), Math.min(d.sy, e.clientY))
      const b = toWorld(Math.max(d.sx, e.clientX), Math.max(d.sy, e.clientY))
      const hits: NodeId[] = []
      for (const id of frame.order) {
        const bx = frame.boxes[id]
        if (!bx) continue
        const l = leftOf(bx, kind)
        if (l < b.x && l + bx.w > a.x && bx.y - bx.h / 2 < b.y && bx.y + bx.h / 2 > a.y) hits.push(id)
      }
      const ids = d.additive ? [...new Set([...d.base, ...hits])] : hits
      const primary = hits[hits.length - 1] ?? ids[ids.length - 1] ?? null
      // The rectangle grew or shrank without catching or losing a node: the selection already is this one.
      const cur = [...selectedRef.current]
      const same = !editId && selectionRef.current === primary && cur.length === ids.length && ids.every((id, i) => cur[i] === id)
      if (!same) api.selectMany(ids, primary)
      setDrag({ ...d, ex: e.clientX, ey: e.clientY, moved: true })
      return
    }
    const w = toWorld(e.clientX, e.clientY)
    if (d.kind === 'handle') {
      const over = hitTest(frame, w.x, w.y, new Set([d.id]))
      setDrag({ ...d, moved: d.moved || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4, wx: w.x, wy: w.y, over })
      return
    }
    const dx = (e.clientX - d.sx) / camera.z
    const dy = (e.clientY - d.sy) / camera.z
    const moved = d.moved || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4
    if (!moved) return
    const target = manual ? null : dropTargetFor(doc, frame, w.x, w.y, d.multi ? [...selectedRef.current] : [d.id])
    setDrag({ ...d, moved: true, dx, dy, wx: w.x, wy: w.y, alone: e.altKey, target })
  }

  /** The system took the pointer back (a palm, an edge swipe) or it was lost: drop the gesture
   *  where it is and commit nothing — no fold, no new child, no move, no width. */
  const cancelGesture = (pointerId: number) => {
    pointers.current.delete(pointerId)
    const d = dragRef.current
    if (!d || (d.kind === 'pinch' && pointers.current.size)) return
    dragRef.current = null
    setDrag(null)
    if (d.kind === 'resize') api.previewWidth(d.id, null)
    if (d.kind === 'node' && d.moved) setSettleKey((k) => k + 1)
  }

  // A finger that lifts over something that has since been removed never delivers its pointerup to the element the
  // gesture began on — and a pinch removes things constantly, since every zoom step re-renders the map. The map
  // would go on believing that finger is down, and the next one-finger drag would count two pointers and read as a
  // pinch: the map zooms while a thumb tries to pan it. The document hears every lift, whatever became of the
  // element underneath, so the count is kept there rather than inferred from the handlers that happen to fire.
  useEffect(() => {
    const doc = hostRef.current?.ownerDocument ?? document
    const forget = (e: PointerEvent) => {
      if (!pointers.current.delete(e.pointerId)) return
      const d = dragRef.current
      if (d?.kind === 'pinch' && pointers.current.size === 0) {
        dragRef.current = null
        setDrag(null)
      }
    }
    doc.addEventListener('pointerup', forget, true)
    doc.addEventListener('pointercancel', forget, true)
    return () => {
      doc.removeEventListener('pointerup', forget, true)
      doc.removeEventListener('pointercancel', forget, true)
    }
  }, [hostRef])

  // Escape takes a gesture back the way a lost pointer does: a dragged node eases home, a resize or a branch being
  // pulled out commits nothing, a selection box or a pan stops where it is. Caught before the map's own Escape,
  // which would otherwise clear the selection while the drag carried on under the pointer.
  const cancelGestureRef = useRef(cancelGesture)
  cancelGestureRef.current = cancelGesture
  useEffect(() => {
    const doc = hostRef.current?.ownerDocument ?? document
    const onKey = (e: KeyboardEvent) => {
      const d = dragRef.current
      if (e.key !== 'Escape' || !d || d.kind === 'pinch') return
      e.preventDefault()
      e.stopPropagation()
      cancelGestureRef.current(-1)
    }
    doc.addEventListener('keydown', onKey, true)
    return () => doc.removeEventListener('keydown', onKey, true)
  }, [hostRef])

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const d = dragRef.current
    if (d?.kind === 'pinch') {
      // The pinch ends when either finger lifts; the other finger does not
      // silently become a pan or a drag.
      if (pointers.current.size === 0) {
        dragRef.current = null
        setDrag(null)
      }
      return
    }
    // Cleared now, not on the next render: the lostpointercapture that follows must find no gesture.
    dragRef.current = null
    setDrag(null)
    if (d?.kind === 'node' && d.moved) setSettleKey((k) => k + 1)
    if (!d) return
    // The node went away mid-gesture (a reload from disk): nothing to commit it to.
    if (d.kind !== 'pan' && d.kind !== 'marquee' && !doc.nodes[d.id]) {
      if (d.kind === 'resize') api.previewWidth(d.id, null)
      return
    }
    if (d.kind === 'pan' || d.kind === 'marquee') {
      // A plain click on empty canvas clears the selection; a ⇧-click there keeps it.
      if (!d.moved && !(d.kind === 'marquee' && d.additive)) api.select(null)
      return
    }
    if (d.kind === 'resize') {
      api.previewWidth(d.id, null)
      if (Math.abs(d.w - d.w0) >= 2) api.setWidth(d.id, d.w, d.shift ? (d.side * (d.w - d.w0)) / 2 : 0)
      return
    }
    const w = toWorld(e.clientX, e.clientY)
    if (d.kind === 'handle') {
      // A click on the knob folds the branch away; a drag pulls out a new idea.
      if (!d.moved) {
        if (doc.nodes[d.id]?.children.length) api.toggleCollapse(d.id)
        else api.createChild(d.id)
        return
      }
      const over = hitTest(frame, w.x, w.y, new Set([d.id]))
      if (over && over !== d.id) {
        // Releasing on a node re-parents it in the tree shapes; on the Canvas,
        // where free links live, it draws one instead.
        if (manual) api.linkNodes(d.id, over)
        else if (!isDescendant(doc, over, d.id) && over !== doc.rootId) api.reparent(over, d.id, doc.nodes[d.id].children.length)
      } else {
        api.createChild(d.id, undefined, manual ? { x: w.x, y: w.y } : undefined)
      }
      return
    }
    if (!d.moved) {
      // A tap on the node that was already selected starts editing — on a
      // phone this is the only thing that summons the keyboard.
      if (d.wasSelected && editId !== d.id) api.beginEdit(d.id, null, false)
      return
    }
    const ids = d.multi ? [d.id, ...[...selectedRef.current].filter((x) => x !== d.id)] : [d.id]
    if (kind === 'outline' && d.touch && !d.multi) {
      const action = outlineSwipeAction(e.clientX - d.sx, e.clientY - d.sy)
      if (action) {
        if (action === 'indent') api.indent(d.id)
        else api.outdent(d.id)
        return
      }
    }
    if (manual) {
      // The branch moves with its parent, which is what the drag already showed.
      // ⌥ detaches a single node from its branch.
      if (ids.length > 1) api.moveMany(ids, d.dx, d.dy, d.alone)
      else if (d.alone) {
        const b = frame.boxes[d.id]
        if (b) api.moveNode(d.id, b.x + d.dx, b.y + d.dy)
      } else {
        api.moveBranch(d.id, d.dx, d.dy)
      }
      return
    }
    if (d.target) {
      if (ids.length > 1) api.reparentMany(ids, d.target.parent, d.target.index, d.target.side)
      else api.reparent(d.id, d.target.parent, d.target.index, d.target.side)
    }
  }

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault()
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect) return
      if (e.ctrlKey || e.metaKey) {
        const px = e.clientX - rect.left
        const py = e.clientY - rect.top
        const next = Math.min(2.5, Math.max(0.2, camera.z * Math.exp(-e.deltaY * 0.0025)))
        const k = next / camera.z
        api.setCamera({ z: next, x: px - (px - camera.x) * k, y: py - (py - camera.y) * k })
      } else {
        api.setCamera({ ...camera, x: camera.x - e.deltaX, y: camera.y - e.deltaY })
      }
    },
    [api, camera, stageRef],
  )

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel, stageRef])

  /* -------------------- rendering -------------------- */

  const draggingId = drag?.kind === 'node' && drag.moved ? drag.id : null
  const dragIds = draggingId && drag?.kind === 'node' ? (drag.multi ? [...selected] : [draggingId]) : []
  const draggedSet = new Set<NodeId>(drag?.kind === 'node' && drag.alone ? dragIds : dragIds.flatMap((id) => subtreeIds(doc, id)))

  // Connectors are drawn from the node's *live* position, so they stay attached
  // while a node is being dragged rather than snapping at the end.
  const liveBoxes =
    draggingId && drag?.kind === 'node'
      ? Object.fromEntries(
          Object.entries(frame.boxes).map(([id, b]) =>
            draggedSet.has(id) ? [id, { ...b, x: b.x + drag.dx, y: b.y + drag.dy }] : [id, b],
          ),
        )
      : frame.boxes

  // What each node needs of the document besides itself, so a node whose own data did not change is not drawn again.
  const linkCounts = useMemo(() => {
    const out = new Map<NodeId, number>()
    for (const l of doc.links) for (const end of l.from === l.to ? [l.from] : [l.from, l.to]) out.set(end, (out.get(end) ?? 0) + 1)
    return out
  }, [doc.links])

  const pad = 4000
  const vb = `${frame.bounds.minX - pad} ${frame.bounds.minY - pad} ${
    frame.bounds.maxX - frame.bounds.minX + pad * 2
  } ${frame.bounds.maxY - frame.bounds.minY + pad * 2}`

  return (
    <div
      ref={stageRef}
      className={`stage shape-${kind === 'canvas' || kind === 'org' ? 'map' : kind}${manual ? ' is-free' : ''}${kind === 'org' ? ' is-org' : ''}${drag?.kind === 'pan' && drag.moved ? ' panning' : ''}${quiet ? ' is-quiet' : ''}${snap && manual ? ' is-snap' : ''}`}
      data-large={frame.order.length > 400 ? '' : undefined}
      style={{
        backgroundSize: `${GRID * camera.z}px ${GRID * camera.z}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
        ...(dots ? {} : { backgroundImage: 'none' }),
      }}
      onPointerDown={onPointerDownStage}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('.node, .node-toolbar, input, button')) return
        e.preventDefault()
        api.contextMenu(e.nativeEvent, null)
      }}
      // The stage is overflow:hidden, but a browser will still scroll it to
      // reveal a focused element — iOS does when the keyboard opens on a node
      // being edited. The camera is the only thing allowed to move the world.
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0
        e.currentTarget.scrollLeft = 0
      }}
      onDragOver={(e) => {
        if (!api.canDropExternal(e.dataTransfer)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'link'
        const w = toWorld(e.clientX, e.clientY)
        const over = hitTest(frame, w.x, w.y, new Set())
        if (over !== dropOver) setDropOver(over)
      }}
      onDragLeave={(e) => {
        const to = e.relatedTarget as Node | null
        if (!to?.nodeType || !e.currentTarget.contains(to)) setDropOver(null)
      }}
      onDrop={(e) => {
        const w = toWorld(e.clientX, e.clientY)
        const over = hitTest(frame, w.x, w.y, new Set())
        setDropOver(null)
        if (api.dropExternal(over, w, e.dataTransfer)) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => cancelGesture(e.pointerId)}
      onLostPointerCapture={(e) => cancelGesture(e.pointerId)}
    >
      <div
        className={`world${cameraAnimated ? ' animated' : ''}${reduceMotion && morphing ? ' crossfade' : ''}`}
        style={{ transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.z})` }}
      >
        <svg className={`edges${edgesHidden ? ' hidden' : ''}`} aria-hidden="true" viewBox={vb} style={{ left: frame.bounds.minX - pad, top: frame.bounds.minY - pad, width: frame.bounds.maxX - frame.bounds.minX + pad * 2, height: frame.bounds.maxY - frame.bounds.minY + pad * 2 }}>
          <TreeEdges
            doc={doc}
            frame={frame}
            kind={kind}
            liveBoxes={liveBoxes}
            dragging={!!draggingId}
            settleKey={settleKey}
            nodeEls={nodeEls}
            cameraRef={cameraRef}
            stageRef={stageRef}
            cameraAnimated={cameraAnimated}
            hidden={edgesHidden}
            focusId={focusId}
            dimmed={dimmed}
          />

          {drag?.kind === 'handle' && drag.moved && (
            <path className="edge draft" d={draftPath(frame.boxes[drag.id], drag.wx, drag.wy, kind)} />
          )}
          {drag?.kind === 'node' && drag.target && (
            <line
              className={`slot${drag.target.between ? ' is-between' : ''}`}
              x1={drag.target.x}
              y1={drag.target.y}
              x2={drag.target.down ? drag.target.x : drag.target.x + drag.target.w}
              y2={drag.target.down ? drag.target.y + drag.target.w : drag.target.y}
            />
          )}
        </svg>

        {/* obsidian: named through a hidden element — an aria-label here would be a tooltip over the whole canvas */}
        <span id={treeLabelId} hidden>{kind === 'outline' ? 'Outline' : 'Map'}</span>
        <div className={`nodes${morphing && !reduceMotion ? ' morphing' : ''}`} role="tree" aria-labelledby={treeLabelId}>
          {frame.order.map((id, i) => {
            const box = frame.boxes[id]
            const n = doc.nodes[id]
            if (!box || !n) return null
            const isDragged = draggedSet.has(id)
            const offsetX = isDragged ? dragOffset.x : 0
            const offsetY = isDragged ? dragOffset.y : 0
            return (
              <NodeView
                key={id}
                id={id}
                node={n}
                isRoot={id === doc.rootId}
                ordinal={ordinalOf(doc, id)}
                links={linkCounts.get(id) ?? 0}
                kind={kind}
                themeId={themeId}
                palette={palette}
                box={box}
                offsetX={offsetX}
                offsetY={offsetY}
                stagger={Math.min(i, STAGGER_CAP / STAGGER_MS)}
                selected={selection === id || selected.has(id)}
                match={matches ? (matches.has(id) ? 'hit' : 'miss') : undefined}
                editing={editId === id}
                editSeed={editId === id ? editSeed : null}
                dim={dimmed.has(id)}
                dragging={isDragged && !!draggingId}
                dropTarget={(drag?.kind === 'node' && drag.target?.parent === id && !drag.target.between) || dropOver === id}
                linkTarget={drag?.kind === 'handle' && drag.over === id}
                hovered={hover === id}
                resizing={drag?.kind === 'resize' && drag.id === id}
                nodeEls={nodeEls}
                onHover={setHover}
                onPointerDown={onPointerDownNode}
                api={api}
                outside={outside}
              />
            )
          })}

          {drag?.kind === 'handle' && drag.moved && !drag.over && (
            <div className="node ghost" style={{ transform: `translate3d(${drag.wx}px, ${drag.wy}px, 0) translate(-50%, -50%)` }}>
              <span className="node-label">New idea</span>
            </div>
          )}
        </div>
      </div>

      {drag?.kind === 'marquee' && drag.moved && stageRef.current && (
        <div
          className="marquee"
          style={{
            left: Math.min(drag.sx, drag.ex) - stageRef.current.getBoundingClientRect().left,
            top: Math.min(drag.sy, drag.ey) - stageRef.current.getBoundingClientRect().top,
            width: Math.abs(drag.ex - drag.sx),
            height: Math.abs(drag.ey - drag.sy),
          }}
        />
      )}
      {(() => {
        // obsidian: the bar above the node being typed — inline formats, text size and
        // branch colour. Only while editing, so the map stays clean while you move around.
        const barId = editId
        const box = barId ? frame.boxes[barId] : undefined
        const n = barId ? doc.nodes[barId] : undefined
        const rect = stageRef.current?.getBoundingClientRect()
        const stageW = rect?.width ?? 0
        const stageH = rect?.height ?? 0
        if (!barId || !box || !n) return null
        const parent = n.parent ? doc.nodes[n.parent] : undefined
        const siblingIndex = parent?.children.indexOf(barId) ?? -1
        const cx = (kind === 'outline' ? box.x + box.w / 2 : box.x) * camera.z + camera.x
        const top = (box.y - box.h / 2) * camera.z + camera.y
        const bottom = (box.y + box.h / 2) * camera.z + camera.y
        if (stageW && (cx < 0 || cx > stageW || bottom < 0 || top > stageH)) return null
        return (
          <NodeBar
            nodeId={barId}
            x={cx}
            top={top}
            bottom={bottom}
            stageWidth={stageW}
            node={{ isRoot: barId === doc.rootId, align: n.align ?? 'center', type: nodeTypeOf(n), lines: metricsFor(doc, barId, kind, box.depth).lines.length, branch: n.branch ?? null }}
            branches={themeById(themeId).branches}
            palette={palette}
            onFormat={(f) => void applyFormat(f, stageRef.current?.ownerDocument)}
            onAlign={(a) => api.setAlign(barId, a)}
            onType={(type) => api.setNodeType(barId, type)}
            onBranch={(i) => api.setBranch(barId, i)}
            onPalette={(slot, hex) => api.setPalette(slot, hex)}
            onNewColour={(slot, hex) => api.addOwnColour(barId, slot, hex)}
            onRemoveColour={(slot) => api.removeOwnColour(slot)}
            outline={kind === 'outline'}
            canIndent={barId !== doc.rootId && siblingIndex > 0}
            canOutdent={barId !== doc.rootId && !!parent?.parent}
            canMoveUp={barId !== doc.rootId && siblingIndex > 0}
            canMoveDown={barId !== doc.rootId && !!parent && siblingIndex >= 0 && siblingIndex < parent.children.length - 1}
            onIndent={() => api.indent(barId)}
            onOutdent={() => api.outdent(barId)}
            onMoveUp={() => api.reorder(barId, -1)}
            onMoveDown={() => api.reorder(barId, 1)}
            onNewLine={() => void insertLineBreak(stageRef.current?.ownerDocument)}
            onDone={() => api.commitEdit()}
          />
        )
      })()}
    </div>
  )
}

/** How long to keep measuring after something starts moving: the morph, plus
 *  the longest stagger delay, plus a little slack. */
const SETTLE_MS = 800

/**
 * The connectors.
 *
 * Nodes are moved by CSS transitions, which is what gives the Shift its stagger
 * and its easing for free — but an SVG path cannot be transitioned the same way,
 * so drawing edges from the *target* layout left them detached for the whole
 * 450ms a node was in flight. Instead, while anything is moving, this measures
 * where each node actually is on screen each frame and draws from that. CSS
 * stays the animation engine; the lines simply follow it.
 */
const TreeEdges = memo(function TreeEdges({
  doc,
  frame,
  kind,
  liveBoxes,
  dragging,
  settleKey,
  nodeEls,
  cameraRef,
  stageRef,
  cameraAnimated,
  hidden,
  focusId,
  dimmed,
}: {
  doc: IODoc
  frame: Frame
  kind: LayoutKind
  liveBoxes: Record<NodeId, Box>
  dragging: boolean
  settleKey: number
  nodeEls: React.MutableRefObject<Map<NodeId, HTMLDivElement>>
  cameraRef: React.MutableRefObject<Camera>
  stageRef: React.RefObject<HTMLDivElement>
  cameraAnimated: boolean
  hidden: boolean
  focusId: NodeId | null
  dimmed: Set<NodeId>
}) {
  const [measured, setMeasured] = useState<Record<NodeId, Box> | null>(null)
  const raf = useRef<number>()
  const until = useRef(0)
  // Bumped when a node was added, removed or moved. A new frame whose boxes are all the ones before (a keystroke that
  // left every width alone, a colour change) starts nothing moving, so it does not start the measuring over.
  const seen = useRef<Frame | null>(null)
  const moves = useRef(0)
  if (seen.current !== frame) {
    const prev = seen.current
    if (!prev || prev.order !== frame.order || frame.order.some((id) => prev.boxes[id] !== frame.boxes[id])) moves.current++
    seen.current = frame
  }
  const moved = moves.current

  useEffect(() => {
    // While dragging, the offset is already exact and the node has no
    // transition. While the camera is animating, screen positions cannot be
    // converted back to world coordinates, so don't try.
    // Nothing to keep attached while the edges are hidden (the Shift), and
    // measuring a thousand rects a frame is exactly what would make it slow.
    if (kind === 'outline' || dragging || cameraAnimated || hidden) {
      setMeasured(null)
      return
    }
    until.current = performance.now() + SETTLE_MS
    // Big maps measure every other frame — still attached to the eye, half
    // the layout work.
    if (frame.order.length > 800) return // a thousand rects a frame is the cost itself
    const stride = frame.order.length > 400 ? 2 : 1
    let n = 0
    // obsidian: frames from the map's own window; a hidden main window would throttle its frames.
    const win = stageRef.current?.ownerDocument.defaultView ?? window

    const tick = () => {
      if (stride > 1 && n++ % stride) {
        raf.current = win.requestAnimationFrame(tick)
        return
      }
      const stage = stageRef.current
      if (!stage) return
      const sr = stage.getBoundingClientRect()
      const cam = cameraRef.current
      const out: Record<NodeId, Box> = {}
      for (const id of frame.order) {
        const base = frame.boxes[id]
        const el = nodeEls.current.get(id)
        if (!base || !el) continue
        const r = el.getBoundingClientRect()
        out[id] = {
          ...base,
          x: (r.left + r.width / 2 - sr.left - cam.x) / cam.z,
          y: (r.top + r.height / 2 - sr.top - cam.y) / cam.z,
          w: r.width / cam.z,
          h: r.height / cam.z,
        }
      }
      setMeasured(out)
      if (performance.now() < until.current) raf.current = win.requestAnimationFrame(tick)
      else {
        raf.current = undefined
        setMeasured(null)
      }
    }

    if (raf.current) win.cancelAnimationFrame(raf.current)
    raf.current = win.requestAnimationFrame(tick)
    return () => {
      if (raf.current) win.cancelAnimationFrame(raf.current)
      raf.current = undefined
    }
    // frame is read fresh but not a dependency: `moved` says when its boxes changed.
  }, [settleKey, kind, dragging, cameraAnimated, hidden, moved, nodeEls, cameraRef, stageRef])

  if (kind === 'outline') return null
  const boxes = dragging ? liveBoxes : measured ?? frame.boxes

  const paths: { key: string; d: string; free: boolean; from: NodeId; to: NodeId }[] = []
  for (const id of frame.order) {
    const n = doc.nodes[id]
    if (!n || n.collapsed) continue
    const pb = boxes[id]
    if (!pb) continue
    const elbows: string[] = []
    for (const cid of n.children) {
      const cb = boxes[cid]
      if (!cb) continue
      if (kind === 'org' || cb.stack) elbows.push(treePath(pb, cb, kind))
      else paths.push({ key: `${id}>${cid}`, d: treePath(pb, cb, kind), free: false, from: id, to: cid })
    }
    // Org chart, and a stack of leaves anywhere: a node's lines share their stem, so they are one path — a translucent
    // line is painted once where they overlap. Focus dims all of a node's lines or none of them, so one path does for all.
    if (elbows.length) paths.push({ key: `${id}>`, d: elbows.join(' '), free: false, from: id, to: n.children[0] })
  }
  {
    for (const l of doc.links) {
      const a = boxes[l.from]
      const b = boxes[l.to]
      if (a && b) paths.push({ key: l.id, d: linkPath(a, b), free: true, from: l.from, to: l.to })
    }
  }

  return (
    <>
      {paths.map((e) => (
        <path
          key={e.key}
          d={e.d}
          className={`edge${e.free ? ' free' : ''}${
            focusId && (dimmed.has(e.from) || dimmed.has(e.to)) ? ' dim' : ''
          }`}
        />
      ))}
    </>
  )
})

function draftPath(from: Box | undefined, wx: number, wy: number, shape: LayoutKind): string {
  if (!from) return ''
  if (shape === 'outline') {
    const x1 = from.x + from.w
    const mx = (x1 + wx) / 2
    return `M${x1} ${from.y} C${mx} ${from.y} ${mx} ${wy} ${wx} ${wy}`
  }
  // Org chart: children hang below, so a new one is pulled from the bottom edge.
  if (shape === 'org' && wy > from.y + from.h / 2) {
    const y1 = from.y + from.h / 2
    const my = (y1 + wy) / 2
    return `M${from.x} ${y1} C${from.x} ${my} ${wx} ${my} ${wx} ${wy}`
  }
  // Same anchoring rule as treePath: side edge when the pointer is beside the
  // node, top or bottom edge when it is above or below it.
  const stored = shape === 'map' ? from.dir : 0
  if (stored === 0 && Math.abs(wx - from.x) < from.w / 2) {
    const down = wy >= from.y ? 1 : -1
    const y1 = from.y + (down * from.h) / 2
    const my = (y1 + wy) / 2
    return `M${from.x} ${y1} C${from.x} ${my} ${wx} ${my} ${wx} ${wy}`
  }
  const dir = stored === 0 ? (wx >= from.x ? 1 : -1) : stored
  const x1 = from.x + (dir * from.w) / 2
  const mx = (x1 + wx) / 2
  return `M${x1} ${from.y} C${mx} ${from.y} ${mx} ${wy} ${wx} ${wy}`
}

/* ------------------------------------------------------------------ */

interface NodeProps {
  id: NodeId
  node: IONode
  isRoot: boolean
  /** Its number in a run of numbered siblings; null when it is not numbered. */
  ordinal: number | null
  /** How many free links touch it. */
  links: number
  kind: LayoutKind
  themeId: string
  palette: string[]
  box: Box
  offsetX: number
  offsetY: number
  /** Stagger slot for the Shift, 0–15. Applied only while `.nodes.morphing`. */
  stagger: number
  selected: boolean
  match?: 'hit' | 'miss'
  editing: boolean
  editSeed: { text: string | null; selectAll: boolean } | null
  dim: boolean
  dragging: boolean
  dropTarget: boolean
  linkTarget: boolean
  hovered: boolean
  /** Its edge is being dragged: no width transition, so it follows the pointer. */
  resizing?: boolean
  nodeEls: React.MutableRefObject<Map<NodeId, HTMLDivElement>>
  onHover: React.Dispatch<React.SetStateAction<NodeId | null>>
  onPointerDown: (e: React.PointerEvent, id: NodeId) => void
  api: StageApi
  /** Not read: a new one draws the node again (embeds, custom theme colours). */
  outside: object
}

const NodeView = memo(function NodeView({
  id,
  node: n,
  isRoot,
  ordinal,
  links,
  kind,
  themeId,
  palette,
  box,
  offsetX,
  offsetY,
  stagger,
  selected,
  match,
  editing,
  editSeed,
  dim,
  dragging,
  dropTarget,
  linkTarget,
  hovered,
  resizing,
  nodeEls,
  onHover,
  onPointerDown,
  api,
}: NodeProps) {
  const outline = kind === 'outline'
  const m = nodeMetrics(n, { isRoot, ordinal, linked: links > 0, depth: box.depth }, kind)
  const align: Align = outline ? 'left' : n.align ?? 'center'
  const padX = isRoot ? 22 : 16
  const padY = isRoot ? 12 : 8
  // obsidian: a number or a checkbox sits ahead of the text block, inside its alignment,
  // so a centred "3. Lisbon" is centred as a whole.
  const lead = m.lead
  const contentStart = outline
    ? ROW_LEAD
    : align === 'left'
      ? padX
      : align === 'right'
        ? Math.max(padX, box.w - m.textW - lead.w - padX)
        : Math.max(10, (box.w - m.textW - lead.w) / 2)
  const leadLeft = m.media.length ? (outline ? ROW_LEAD : padX) : contentStart
  const padLeft = leadLeft + lead.w
  const leadCentred = m.lines.length === 1 && !m.media.length
  const done = n.task === 'x'
  // Stadium while it's one line; a rounded rectangle once the text wraps.
  const radius = outline ? 8 : Math.min(17, box.h / 2)
  const labelRef = useRef<HTMLSpanElement>(null)
  /** ⇧⌘V came just before this paste: the characters go in as they are, not as Markdown. */
  const pasteLiteral = useRef(false)
  /** Text is being dragged out of this label: the browser moves it within the label itself. */
  const dragOut = useRef(false)
  const hiddenChildren = n.collapsed ? n.children.length : 0

  useLayoutEffect(() => {
    if (!editing) return
    const el = labelRef.current
    if (!el) return
    renderInto(el, stripEmbeds(editSeed?.text ?? n.text))
    el.focus({ preventScroll: true })
    const range = el.ownerDocument.createRange()
    if (editSeed?.selectAll) range.selectNodeContents(el)
    else {
      range.selectNodeContents(el)
      range.collapse(false)
    }
    const sel = el.ownerDocument.defaultView?.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    // Deliberately runs only when editing starts — re-running would fight the caret.
  }, [editing])

  // The one depth flourish from the wireframes: a selected pill lifts 2px.
  // Drag adds a slight tilt so the node reads as picked up, not slid.
  const anchor =
    (outline ? 'translate(0, -50%)' : 'translate(-50%, -50%)') +
    (selected && !outline && !dragging ? ' translateY(-2px)' : '') +
    (dragging ? ' rotate(-1.6deg)' : '')
  const cls = [
    'node',
    outline ? 'as-row' : 'as-pill',
    isRoot && 'is-root',
    selected && 'is-selected',
    match === 'hit' && 'is-hit',
    match === 'miss' && 'is-miss',
    editing && 'is-editing',
    dim && 'is-dim',
    dragging && 'is-dragging',
    dropTarget && 'is-droptarget',
    linkTarget && 'is-linktarget',
    resizing && 'is-resizing',
    m.media.length > 0 && 'has-media',
    done && 'is-done',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={(el) => {
        if (el) nodeEls.current.set(id, el)
        else nodeEls.current.delete(id)
      }}
      className={cls}
      // Assistive tech: a node is a tree item with a name, a level and a folded state.
      // Roving tabindex: the selected node is the one real tab stop inside the canvas.
      role="treeitem"
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      aria-level={box.depth + 1}
      aria-expanded={n.children.length ? !n.collapsed : undefined}
      // obsidian: the name comes from the label itself. An aria-label here would also become
      // Obsidian's hover tooltip on every node, repeating text that is already fully visible.
      aria-labelledby={`io-label-${id}`}
      aria-description={n.children.length ? `${n.children.length} ${n.children.length === 1 ? 'child' : 'children'}` : undefined}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!selected) api.select(id)
        api.contextMenu(e.nativeEvent, id)
      }}
      style={{
        transform: `translate3d(${box.x + offsetX}px, ${box.y + offsetY}px, 0) ${anchor}`,
        width: box.w,
        height: box.h,
        paddingLeft: padLeft,
        paddingRight: m.media.length && !outline ? padX : undefined,
        ['--node-radius' as string]: `${radius}px`,
        ['--i' as string]: stagger,
        ['--branch' as string]: branchColor(themeId, n.branch, palette),
        ...(n.task != null ? { ['--branch-ink' as string]: readableOn(branchColor(themeId, n.branch, palette)) } : {}),
        ['--align' as string]: align,
        ['--depth' as string]: box.depth,
        ['--dir' as string]: box.dir,
        zIndex: dragging ? 40 : selected ? 20 : 1,
      }}
      onPointerDown={(e) => onPointerDown(e, id)}
      onPointerEnter={() => onHover(id)}
      onPointerLeave={() => onHover((cur) => (cur === id ? null : cur))}
      onDoubleClick={(e) => {
        e.stopPropagation()
        // Already typing here: the double-click selects a word, it doesn't start the edit over.
        if (!editing) api.beginEdit(id, null, true)
      }}
    >
      {n.children.length > 0 && (
        <span
          className="node-disc"
          onPointerDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            api.toggleCollapse(id)
          }}
          aria-label={n.collapsed ? 'Expand' : 'Collapse'}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: n.collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>
            <path d="M3.5 2l3.2 3-3.2 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
      {/* The bar is clipped by a wrapper that inherits the pill's exact radius,
          so its outer edge follows the curve instead of approximating it. */}
      <span className="node-clip">
        <span className="node-bar" />
      </span>
      <span className="node-dot" />
      {lead.w > 0 && (
        <span
          className={`node-lead${leadCentred ? ' is-centred' : ''}`}
          style={{ left: leadLeft, top: leadCentred ? undefined : (outline ? ROW_PAD : padY) - 1, height: m.lineH, fontSize: m.fontSize, fontWeight: m.fontWeight }}
        >
          {lead.num && <span className="node-num">{lead.num}</span>}
          {lead.task != null && (
            <button
              type="button"
              tabIndex={-1}
              role="checkbox"
              aria-checked={done}
              aria-label={done ? 'Mark open' : 'Mark done'}
              className={`node-check${done ? ' is-done' : ''}`}
              data-task={lead.task}
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                api.toggleTask(id)
              }}
            >
              {done ? (
                <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
                  <path d="M2 5.8l2.4 2.4L9 3.4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : lead.task !== ' ' ? (
                lead.task
              ) : null}
            </button>
          )}
        </span>
      )}
      <span
        // obsidian: a fresh span per mode. While editing, the text belongs to the contenteditable,
        // not to React; remounting on the way out is what stops the typed text and the rendered
        // label from both ending up in the DOM.
        key={editing ? 'editing' : 'view'}
        ref={labelRef}
        id={`io-label-${id}`}
        className="node-label"
        style={{
          fontSize: m.fontSize,
          lineHeight: `${m.lineH}px`,
          fontWeight: m.fontWeight,
          ...(editing ? { whiteSpace: 'pre-wrap' as const, maxWidth: outline ? Math.max(40, outlineTextAvailable(box.x) - lead.w) : n.width ? Math.max(40, n.width - padX * 2 - lead.w) : Math.round((isRoot ? MAX_ROOT_TEXT_W : MAX_TEXT_W) * (m.fontSize / 14)) } : {}),
        }}
        contentEditable={editing}
        suppressContentEditableWarning
        spellCheck={false}
        // The label read back as Markdown: its formatting, links and line breaks (see wysiwyg.ts). The media
        // under the node is not in the label; the draft adds it back.
        onInput={(e) => api.draft(domToMarkdown(e.currentTarget))}
        onKeyDown={(e) => {
          pasteLiteral.current = (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'v'
        }}
        onPaste={(e) => {
          e.preventDefault()
          const files = mediaFiles(e.clipboardData.files)
          if (files.length) {
            api.pasteFiles(id, files)
            return
          }
          // obsidian: the clipboard's text, never its HTML (styles the file cannot hold). Read as
          // Markdown, so a pasted [[link]] stays a link; ⇧⌘V pastes the characters as they are.
          pasteText(e.currentTarget, e.clipboardData.getData('text/plain'), pasteLiteral.current)
          pasteLiteral.current = false
        }}
        // obsidian: notes and links dropped on the label still link through the stage. Anything else —
        // a selection dragged from a web page — goes in as plain text, like a paste: never the page's
        // markup, which would bring styles, links and remote images the file cannot hold.
        onDragStart={() => (dragOut.current = true)}
        onDragEnd={() => (dragOut.current = false)}
        onDragOver={(e) => {
          if (!editing || dragOut.current || api.canDropExternal(e.dataTransfer)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          if (!editing || dragOut.current || api.canDropExternal(e.dataTransfer)) return
          const files = e.dataTransfer.files
          const media = mediaFiles(files)
          if (files.length && !media.length) return // a map file: the app imports it
          e.preventDefault()
          e.stopPropagation()
          if (media.length) api.pasteFiles(id, media)
          else dropText(e.currentTarget, e.clientX, e.clientY, e.dataTransfer.getData('text/plain'))
        }}
        // obsidian: focus moving into the bar (the colour slider, the hex field) is not leaving
        // the node; the bar hands focus back when its picker closes.
        onBlur={(e) => editing && !((e.relatedTarget)?.nodeType === 1 && (e.relatedTarget).closest('.node-toolbar')) && api.commitEdit()}
      >
        {editing ? null : n.text ? <RichLabel text={n.text} lines={m.lines} onOpenLink={api.openLink} onHoverLink={api.hoverLink} onOpenTag={api.openTag} /> : <em className="node-empty">Untitled</em>}
      </span>
      {m.media.length > 0 && (
        <span className="node-media">
          {m.media.map((mb, i) => {
            const res = api.resolveEmbed(mb.embed.file)
            return (
              <span key={`${mb.embed.file}-${i}`} className={`media media-${mb.embed.kind}`} style={{ width: mb.w, height: mb.h }}>
                {res && mb.embed.kind === 'image' && (
                  <img
                    src={res.url}
                    alt={mb.embed.alias ?? mb.embed.file}
                    draggable={false}
                    onLoad={(e) => {
                      const img = e.currentTarget
                      if (img.naturalWidth && setMediaSize(mb.embed.file, img.naturalWidth, img.naturalHeight)) api.mediaChanged()
                    }}
                  />
                )}
                {res && mb.embed.kind === 'audio' && <audio src={res.url} controls preload="metadata" onPointerDown={(e) => e.stopPropagation()} />}
                {!res && <span className="media-missing">{mb.embed.file}</span>}
                {(selected || hovered) && !dragging && (
                  <button
                    className="media-remove"
                    aria-label="Remove from node"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      api.removeEmbed(id, i)
                    }}
                  >
                    ×
                  </button>
                )}
              </span>
            )
          })}
        </span>
      )}
      {!outline && !editing && (
        <>
          {(kind === 'canvas' || kind === 'org' || isRoot || box.dir >= 0) && (
            <span className="node-resize" data-side="right" aria-label="Drag to set the width · double-click to reset" onDoubleClick={(e) => { e.stopPropagation(); api.setWidth(id, undefined) }} />
          )}
          {(kind === 'canvas' || kind === 'org' || isRoot || box.dir < 0) && (
            <span className="node-resize" data-side="left" aria-label="Drag to set the width · double-click to reset" onDoubleClick={(e) => { e.stopPropagation(); api.setWidth(id, undefined) }} />
          )}
        </>
      )}
      {links > 0 && outline && <span className="node-linkchip">↗ {links}</span>}
      {!outline && (hovered || selected || n.collapsed || n.children.length > 0) && !editing && !dragging && (
        <span
          className={`node-knob${hovered || selected || n.collapsed ? ' is-lit' : ''}${n.collapsed ? ' is-count' : ''}`}
          aria-label={
            n.children.length
              ? `${n.collapsed ? 'Expand' : 'Collapse'} — or drag out a new idea`
              : 'Add a child — or drag to place it'
          }
          // Sits on the branch's outer edge. On left-fanning nodes that's the
          // same side as the colour bar, so it clears it by a few pixels. In the
          // Org chart the children hang below, and the stylesheet puts it there.
          style={kind === 'org' ? undefined : outline || box.dir >= 0 ? { right: -26 } : { left: -26 }}
        >
          {n.collapsed ? (
            hiddenChildren
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1.5 5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              {!n.children.length && <path d="M5 1.5v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
            </svg>
          )}
        </span>
      )}
    </div>
  )
})
