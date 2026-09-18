import type * as React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Align, NodeType, NodeTypeState } from '../model/types'
import { FORMAT_LABEL, type Format } from './format'
import { chord } from './keys'
import { IconAlign, IconCheck, IconCheckbox, IconChevron, IconIndent, IconMore, IconNewLine, IconNumbered, IconOutdent, IconPlus, IconTrash } from './Icons'
import { ColourPicker } from './ColourPicker'
import { hueOf as hueOfHex, sortByHue, toneOf, withHue } from '../colour'
import { CUSTOM_SLOTS } from '../theme'
import { dockFit, formatsForNode, isPhoneTouch } from './mobile'
import { useCoarsePointer } from './useCoarsePointer'

interface NodeState {
  isRoot: boolean
  align: Align
  type: NodeTypeState
  /** Lines as laid out — alignment only means something from the second one. */
  lines: number
  branch: number | null
}

interface Props {
  /** The node being typed: a different one closes any menu and tip; a pan or zoom does not. */
  nodeId: string
  /** The node's top centre and bottom centre, in stage pixels. */
  x: number
  top: number
  bottom: number
  stageWidth: number
  node: NodeState
  /** The theme's eight branch colours, by index. */
  branches: string[]
  /** The map's own colours, by slot ('' = empty); branch index 8 + slot. */
  palette: string[]
  onFormat: (f: Format) => void
  onAlign: (a: Align) => void
  onType: (type: NodeType) => void
  onBranch: (i: number) => void
  /** Change one of the map's own colour slots (the picker, as it moves). */
  onPalette: (slot: number, hex: string) => void
  /** Fill an empty slot with a first colour and give this node's branch that colour. */
  onNewColour: (slot: number, hex: string) => void
  /** Empty a slot; branches wearing it go back to the theme. */
  onRemoveColour: (slot: number) => void
  /** Outline rows can move a level in or out from the bar — for touch, where Tab does not exist. */
  outline: boolean
  canDelete: boolean
  onDelete: () => void
  canIndent: boolean
  canOutdent: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onIndent: () => void
  onOutdent: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  /** A soft keyboard has no Shift key: expose Shift+Enter under More without changing what Return means. */
  onNewLine: () => void
  /** Leave the node — for touch, where Esc and ⌘E do not exist. */
  onDone: () => void
}

const FORMATS: Format[] = ['bold', 'italic', 'underline', 'strike', 'highlight', 'code', 'link']
/** On a touch screen the bar is wider and the screen narrower: the everyday formats stay, the rest fold into a menu. */
const TOUCH_FORMATS: Format[] = ['bold', 'italic', 'underline', 'link']
const TOUCH_MORE: Format[] = ['strike', 'highlight', 'code']
const PHONE_FORMATS: Format[] = ['bold']
const PHONE_MORE: Format[] = ['italic', 'underline', 'link', 'strike', 'highlight', 'code']
const TYPES: [NodeType, string, string, string][] = [
  ['text', 'Aa', 'Text', '⌥⌘0'],
  ['h1', 'H1', 'Heading 1', '⌥⌘1'],
  ['h2', 'H2', 'Heading 2', '⌥⌘2'],
  ['h3', 'H3', 'Heading 3', '⌥⌘3'],
  ['numbered', '', 'Numbered', '⇧⌘7'],
  ['checklist', '', 'Checklist', '⌘Enter'],
]
const ALIGNS: [Align, string, string][] = [
  ['left', 'Align left', '⇧⌘L'],
  ['center', 'Align centre', '⇧⌘E'],
  ['right', 'Align right', '⇧⌘R'],
]
/** The gaps the stylesheet leaves between the node and the bar, and between the bar and its tip. */
const BAR_GAP = 10
const TIP_GAP = 6
/** The bar's and a tip's heights until they have been measured. */
const BAR_H = 34
const TIP_H = 28
/** How long the pointer rests on a control before its tip shows — long enough that passing over the bar shows nothing. */
const TIP_DELAY = 2000
/** After a tip hides, how long its neighbours answer at once: reading along the bar is one hover, not one wait each. */
const TIP_WARM = 800

interface Tip {
  label: string
  keys?: string
  /** The control's centre, from the bar's left edge. */
  left: number
}

type Menu = null | 'type' | 'colour' | 'align' | 'more'


function FormatIcon({ f }: { f: Format }) {
  const p = { className: 'io-icon', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (f) {
    case 'bold':
      return (
        <svg width="15" height="15" viewBox="0 0 16 16" {...p}>
          <path d="M4.5 2.5h4a2.5 2.5 0 0 1 0 5h-4zM4.5 7.5h4.6a2.75 2.75 0 0 1 0 5.5H4.5z" />
          <path d="M4.5 2.5v10.5" />
        </svg>
      )
    case 'italic':
      return (
        <svg width="15" height="15" viewBox="0 0 16 16" {...p}>
          <path d="M6.5 2.5h5M4.5 13.5h5M9.5 2.5l-3 11" />
        </svg>
      )
    case 'underline':
      return (
        <svg width="15" height="15" viewBox="0 0 16 16" {...p}>
          <path d="M4.5 2.5v5a3.5 3.5 0 0 0 7 0v-5M3.5 14h9" />
        </svg>
      )
    case 'strike':
      return (
        <svg width="15" height="15" viewBox="0 0 16 16" {...p}>
          <path d="M3 8.5h10M11 5.2c-.5-1.5-1.8-2.3-3.2-2.3-1.9 0-3.1 1-3.1 2.4 0 1 .6 1.7 1.8 2.1M4.6 11c.5 1.5 1.9 2.3 3.5 2.3 1.9 0 3.2-1 3.2-2.5 0-.6-.2-1-.5-1.4" />
        </svg>
      )
    case 'highlight':
      return (
        <svg width="15" height="15" viewBox="0 0 16 16" {...p}>
          <path d="M9.5 2.5l4 4-6 6H5l-1.5-1.5v-2.5zM3 14h10" />
          <path d="M7.5 4.5l4 4" />
        </svg>
      )
    case 'code':
      return (
        <svg width="15" height="15" viewBox="0 0 16 16" {...p}>
          <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9.2 3l-2.4 10" />
        </svg>
      )
    case 'link':
      return (
        <svg width="15" height="15" viewBox="0 0 16 16" {...p}>
          <path d="M6.8 9.2a3 3 0 0 0 4.2 0l1.8-1.8a3 3 0 0 0-4.2-4.2l-.9.9M9.2 6.8a3 3 0 0 0-4.2 0L3.2 8.6a3 3 0 0 0 4.2 4.2l.9-.9" />
        </svg>
      )
  }
}

const Chevron = () => (
  <svg className="nt-chev" viewBox="0 0 8 8" aria-hidden="true">
    <path d="M1.5 3l2.5 2.5L6.5 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const TypeMark = ({ type, fallback }: { type: NodeTypeState; fallback: string }) => {
  if (type === 'numbered') return <IconNumbered />
  if (type === 'checklist') return <IconCheckbox />
  return <span>{fallback}</span>
}

/** obsidian: the floating bar above the node being typed. One row: the inline formats,
 *  then two dropdowns — canonical node type and branch colour — and alignment once the text wraps.
 *  Only while editing: the map stays clean while you move around, and there is never a
 *  question of what a style change means for several selected nodes. Pointer-down is
 *  swallowed so the node keeps its focus and text selection; the click then applies. */
export function NodeBar({ nodeId, x, top, bottom, stageWidth, node, branches, palette, onFormat, onAlign, onType, onBranch, onPalette, onNewColour, onRemoveColour, outline, canDelete, onDelete, canIndent, canOutdent, canMoveUp, canMoveDown, onIndent, onOutdent, onMoveUp, onMoveDown, onNewLine, onDone }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const coarse = useCoarsePointer()
  const phoneDevice = typeof document !== 'undefined' && document.body.classList.contains('is-phone')
  const docked = isPhoneTouch(coarse, stageWidth, phoneDevice)
  const [menu, setMenu] = useState<Menu>(null)
  // A tablet gets the dock — Obsidian calls it a phone — but not a phone's width. What a phone folds under More
  // stands in the row there, because the room is sitting empty either side of it; a wide one takes every key.
  const fit = dockFit(docked, stageWidth)
  const roomy = fit !== 'phone'
  const full = fit === 'full'
  const inRow = !docked ? (coarse ? TOUCH_FORMATS : FORMATS) : full ? FORMATS : roomy ? TOUCH_FORMATS : PHONE_FORMATS
  const underMore = !docked ? TOUCH_MORE : full ? [] : roomy ? TOUCH_MORE : PHONE_MORE
  const primaryFormats = formatsForNode(inRow, node.isRoot) as Format[]
  const moreFormats = formatsForNode(underMore, node.isRoot) as Format[]
  // The slot whose colour is being picked, when the colour menu shows the picker.
  const [picking, setPicking] = useState<number | null>(null)
  const [dx, setDx] = useState(0)
  // The bar flips under the node when the room above can't hold the bar and, on a pointer that
  // hovers, the tip over it — both measured, since the stage clips whatever sticks out.
  const [room, setRoom] = useState(BAR_H + BAR_GAP + TIP_H + TIP_GAP)
  const tipH = useRef(TIP_H)
  // Room for the open type menu above the node: its rows are 27px, or 38px on a touch screen (styles.css, pointer: coarse).
  const typeMenuRoom = BAR_H + BAR_GAP + (node.isRoot ? 4 : 6) * (coarse ? 38 : 27) + 10
  const below = !docked && top < (menu === 'type' ? typeMenuRoom : room)
  const type = TYPES.find(([value]) => value === node.type)
  const typeMark = type?.[1] ?? (docked ? 'Mix' : 'Mixed')
  const typeLabel = type?.[2] ?? 'Mixed Markdown'
  const tone = toneOf(branches)
  const byHue = sortByHue(branches)
  const current = node.branch
  const currentColour = current == null ? 'var(--ink-3)' : current >= 8 ? palette[current - 8] || branches[current % branches.length] : branches[current % branches.length]
  const openPicker = (slot: number) => {
    // An empty slot starts from a hue no theme colour is near, in the theme's tone — one change
    // that fills the slot and colours this branch with it.
    if (!palette[slot]) onNewColour(slot, withHue(freeHue(branches, palette), tone))
    setPicking(slot)
  }
  // Keep the whole bar inside the stage: measure, then nudge sideways as little as needed.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !stageWidth || docked) return
    const half = el.offsetWidth / 2 + 6
    const want = Math.min(Math.max(x, half), Math.max(half, stageWidth - half))
    setDx(Math.round(want - x))
  }, [x, stageWidth, menu, picking, node.lines, node.isRoot, coarse, docked, outline])
  // The tip: a control's name and keys, once the pointer has rested on it. One at a time, never while a menu is open.
  const [tip, setTip] = useState<Tip | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const tipTimer = useRef(0)
  /** obsidian: the window the timer was set in — a popped-out window keeps its own timers. */
  const tipWin = useRef<Window>(window)
  const tipShown = useRef(false)
  const warmUntil = useRef(0)
  // The button under the pointer. A click keeps it here, so the same button does not tip again until the pointer leaves it.
  const hovered = useRef<HTMLButtonElement | null>(null)
  const hideTip = (warm: boolean) => {
    tipWin.current.clearTimeout(tipTimer.current)
    if (tipShown.current) warmUntil.current = warm ? performance.now() + TIP_WARM : 0
    tipShown.current = false
    setTip(null)
  }
  useEffect(() => () => tipWin.current.clearTimeout(tipTimer.current), [])
  useLayoutEffect(() => {
    const bar = ref.current
    if (!bar || menu || picking != null) return
    if (tipRef.current?.offsetHeight) tipH.current = tipRef.current.offsetHeight
    const next = bar.offsetHeight + BAR_GAP + (coarse ? 0 : tipH.current + TIP_GAP)
    if (next !== room) setRoom(next)
  })
  // Keep the tip inside the bar's width when it names a control near either end.
  useLayoutEffect(() => {
    const el = tipRef.current
    const bar = ref.current
    if (!el || !bar || !tip) return
    const half = el.offsetWidth / 2
    const left = Math.min(Math.max(tip.left, half), Math.max(half, bar.clientWidth - half))
    if (Math.abs(left - tip.left) > 0.5) setTip({ ...tip, left })
  }, [tip])

  // A different node closes any menu.
  useLayoutEffect(() => {
    setMenu(null)
    setPicking(null)
    hovered.current = null
    hideTip(false)
  }, [nodeId])
  // WCAG 1.4.13: a tip can be put away without moving the pointer. The first Esc hides it and
  // stops there; the next one ends the edit as usual.
  useEffect(() => {
    if (!tip) return
    const doc = ref.current?.ownerDocument ?? document
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      e.preventDefault()
      e.stopPropagation()
      hideTip(false)
    }
    doc.addEventListener('keydown', onKey, true)
    return () => doc.removeEventListener('keydown', onKey, true)
    // Deliberately not every value read here is a dependency.
  }, [tip])

  const swallow = (e: React.SyntheticEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const toggle = (m: Exclude<Menu, null>) => setMenu((cur) => (cur === m ? null : m))
  const onPointerOver = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return
    const btn = (e.target as HTMLElement).closest('button')
    if (btn === hovered.current) return
    hideTip(true)
    hovered.current = btn
    const name = menu ? null : btn?.querySelector<HTMLElement>(':scope > [data-tip]')
    const bar = ref.current
    if (!btn || !name?.dataset.tip || !bar) return
    const show = () => {
      // The row re-rendered during the wait: that control is gone, so is its tip.
      if (!btn.isConnected) return
      const b = btn.getBoundingClientRect()
      tipShown.current = true
      setTip({ label: name.dataset.tip!, keys: name.dataset.keys, left: b.left + b.width / 2 - bar.getBoundingClientRect().left })
    }
    if (performance.now() < warmUntil.current) show()
    else {
      tipWin.current = bar.ownerDocument.defaultView ?? window
      tipTimer.current = tipWin.current.setTimeout(show, TIP_DELAY)
    }
  }

  return (
    <div
      ref={ref}
      className={`node-toolbar${docked ? ' is-docked' : below ? ' is-below' : ''}`}
      style={docked ? undefined : { left: x + dx, top: below ? bottom : top }}
      role="toolbar"
      onPointerDown={(e) => {
        swallow(e)
        hideTip(false)
      }}
      onMouseDown={swallow}
      onPointerOver={onPointerOver}
      onPointerLeave={() => {
        hovered.current = null
        hideTip(true)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {tip && (
        <div ref={tipRef} className={`nt-tip${tip.keys ? '' : ' no-keys'}`} style={{ left: tip.left }} aria-hidden="true">
          <span>{tip.label}</span>
          {tip.keys && <kbd>{chord(tip.keys)}</kbd>}
        </div>
      )}
      {/* The open menu sits on the far side of the bar from the node, so it never covers the text. */}
      {menu === 'type' && (
        <div className={`nt-menu nt-type-menu${docked ? ' is-phone' : ''}`} role="menu" aria-label="Node type">
          {TYPES.filter(([value]) => !node.isRoot || (value !== 'numbered' && value !== 'checklist')).map(([value, mark, label, keys]) => (
            <button key={value} type="button" tabIndex={-1} role="menuitemradio" className={node.type === value ? 'is-on' : ''} aria-checked={node.type === value} onClick={() => { onType(value); setMenu(null) }}>
              <span className="nt-type-choice"><TypeMark type={value} fallback={mark} /><span>{label}</span></span>
              <span className="nt-hint">{chord(keys)}</span>
            </button>
          ))}
        </div>
      )}
      {menu === 'more' && docked && (
        <div className="nt-phone-more" role="menu" aria-label="More editing options">
          <div className="nt-phone-group nt-phone-format" role="group" aria-label="Formatting">
            {moreFormats.map((f) => (
              <button key={f} type="button" tabIndex={-1} role="menuitem" className={`fmt fmt-${f}`} onClick={() => { onFormat(f); setMenu(null) }}>
                <FormatIcon f={f} />
                <Name>{FORMAT_LABEL[f].title}</Name>
              </button>
            ))}
          </div>
          {!roomy && (
            <div className="nt-phone-group nt-phone-align" role="group" aria-label="Alignment">
              {ALIGNS.map(([a, label]) => (
                <button key={a} type="button" tabIndex={-1} role="menuitemradio" className={node.align === a ? 'is-on' : ''} aria-checked={node.align === a} onClick={() => { onAlign(a); setMenu(null) }}>
                  <IconAlign align={a} />
                  <Name>{label}</Name>
                </button>
              ))}
            </div>
          )}
          {outline && (
            <div className="nt-phone-group nt-phone-arrange" role="group" aria-label="Arrange node">
              <button type="button" tabIndex={-1} role="menuitem" className="nt-move-up" disabled={!canMoveUp} onClick={() => { onMoveUp(); setMenu(null) }}>
                <IconChevron />
                <Name>Move up</Name>
              </button>
              <button type="button" tabIndex={-1} role="menuitem" className="nt-move-down" disabled={!canMoveDown} onClick={() => { onMoveDown(); setMenu(null) }}>
                <IconChevron />
                <Name>Move down</Name>
              </button>
            </div>
          )}
          {/* Last, and on its own: a phone has no Backspace to delete a node with, and no menu bar to find one in.
              A wide bar carries it in the row instead, away from everything else. */}
          {!roomy && (
            <div className="nt-phone-group nt-phone-danger" role="group" aria-label="Delete node">
              <button type="button" tabIndex={-1} role="menuitem" className="nt-delete" disabled={!canDelete} onClick={() => { onDelete(); setMenu(null) }}>
                <IconTrash />
                <Name>Delete this node and everything under it</Name>
              </button>
            </div>
          )}
        </div>
      )}
      {menu === 'more' && !docked && (
        <div className="nt-row nt-palette" role="menu">
          {coarse && (
            <button type="button" tabIndex={-1} role="menuitem" onClick={() => { onNewLine(); setMenu(null) }}>
              <IconNewLine />
              <Name>New line</Name>
            </button>
          )}
          {moreFormats.map((f) => (
            <button key={f} type="button" tabIndex={-1} role="menuitem" className={`fmt fmt-${f}`} onClick={() => { onFormat(f); setMenu(null) }}>
              <FormatIcon f={f} />
              <Name>{FORMAT_LABEL[f].title}</Name>
            </button>
          ))}
        </div>
      )}
      {menu === 'colour' && !node.isRoot && picking != null && (
        // Editing a colour: the bar is that one small view and nothing else.
        <div className="nt-editor">
          <ColourPicker
            value={palette[picking] || withHue(freeHue(branches, palette), tone)}
            tone={tone}
            onChange={(hex) => onPalette(picking, hex)}
            onBack={() => setPicking(null)}
            onRemove={() => { onRemoveColour(picking); setPicking(null); refocusLabel(ref.current) }}
            onDone={() => { setPicking(null); setMenu(null); refocusLabel(ref.current) }}
          />
        </div>
      )}
      {menu === 'colour' && !node.isRoot && picking == null && (
        <div className="nt-col" role="menu">
          <div className="nt-row nt-palette">
            {/* The theme's eight, around the hue wheel; then the map's own slots. */}
            {byHue.map((i) => (
              <button key={i} type="button" tabIndex={-1} role="menuitemradio" className={current === i ? 'is-on' : ''} aria-checked={current === i} onClick={() => { onBranch(i); setMenu(null); setPicking(null); refocusLabel(ref.current) }}>
                <i className="nt-dot" style={{ background: branches[i] }} />
                <Name>{`Branch colour ${i + 1}`}</Name>
              </button>
            ))}
            <span className="nt-sep" />
            {Array.from({ length: CUSTOM_SLOTS }, (_, slot) => {
              const hex = palette[slot]
              const idx = 8 + slot
              const on = current === idx
              return hex ? (
                <button
                  key={slot}
                  type="button"
                  tabIndex={-1}
                  role="menuitemradio"
                  className={`${on ? 'is-on' : ''}${picking === slot ? ' is-picking' : ''}`}
                  aria-checked={on}
                  onClick={() => {
                    // Already this colour: a second click opens it for editing.
                    if (on) setPicking((p) => (p === slot ? null : slot))
                    else { onBranch(idx); setMenu(null); setPicking(null); refocusLabel(ref.current) }
                  }}
                >
                  <i className="nt-dot" style={{ background: hex }} />
                  <Name>{on ? `Own colour ${slot + 1} — choose again to change it` : `Own colour ${slot + 1}`}</Name>
                </button>
              ) : (
                <button key={slot} type="button" tabIndex={-1} role="menuitem" className={`nt-empty${picking === slot ? ' is-picking' : ''}`} onClick={() => openPicker(slot)}>
                  <IconPlus size={12} />
                  <Name>Add a colour of your own</Name>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {/* While a colour is being picked the bar is just that: the swatches and the slider. */}
      {picking == null && (
      <div className="nt-row nt-main">
        {/* The node's one canonical Markdown role, and its independent branch colour. */}
        <button type="button" tabIndex={-1} className={`nt-drop nt-type-drop${menu === 'type' ? ' is-on' : ''}`} aria-haspopup="menu" aria-expanded={menu === 'type'} onClick={() => toggle('type')}>
          <TypeMark type={node.type} fallback={typeMark} />
          <Name tip="Node type" keys="⌥⌘0–3">{`Node type: ${typeLabel}`}</Name>
          <Chevron />
        </button>
        {!node.isRoot && (
          <button type="button" tabIndex={-1} className={`nt-drop${menu === 'colour' ? ' is-on' : ''}`} aria-haspopup="menu" aria-expanded={menu === 'colour'} onClick={() => toggle('colour')}>
            <i className="nt-dot" style={{ background: currentColour }} />
            <Name tip="Branch colour">Branch colour</Name>
            <Chevron />
          </button>
        )}
        <span className="nt-sep" />
        {/* Inline formatting of the selected text. */}
        {primaryFormats.map((f) => (
          <button key={f} type="button" tabIndex={-1} className={`fmt fmt-${f}`} onClick={() => onFormat(f)}>
            <FormatIcon f={f} />
            <Name tip={FORMAT_LABEL[f].title} keys={FORMAT_LABEL[f].keys}>
              {FORMAT_LABEL[f].keys ? `${FORMAT_LABEL[f].title} — ${chord(FORMAT_LABEL[f].keys)}` : FORMAT_LABEL[f].title}
            </Name>
          </button>
        ))}
        {coarse && (
          <button type="button" tabIndex={-1} className={menu === 'more' ? 'is-on' : ''} aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => toggle('more')}>
            <IconMore />
            <Name>{docked ? 'More editing options' : 'More formatting'}</Name>
          </button>
        )}
        {/* Moving a row in or out a level is what an outline is for, and a soft keyboard has no Tab to do it with:
            on the dock it stands in the row itself rather than under More. */}
        {docked && outline && (
          <>
            <button type="button" tabIndex={-1} disabled={!canOutdent} onClick={onOutdent}>
              <IconOutdent />
              <Name>Move out a level</Name>
            </button>
            <button type="button" tabIndex={-1} disabled={!canIndent} onClick={onIndent}>
              <IconIndent />
              <Name>Move in a level</Name>
            </button>
          </>
        )}
        {docked && (
          <button type="button" tabIndex={-1} onClick={() => { onNewLine(); setMenu(null) }}>
            <IconNewLine />
            <Name>New line</Name>
          </button>
        )}
        {(!docked || roomy) && <span className="nt-sep" />}
        {/* How the text sits in the node. Three keys in a row for something almost never changed, so it folds into
            one that wears the current alignment — the two places it frees go to things reached far more often. */}
        {(!docked || roomy) && (
          <span className="nt-anchor">
            <button type="button" tabIndex={-1} className={`nt-drop nt-align-drop${menu === 'align' ? ' is-on' : ''}`} aria-haspopup="menu" aria-expanded={menu === 'align'} onClick={() => toggle('align')}>
              <IconAlign align={node.align ?? 'left'} />
              <Name tip="How the text sits" keys="⇧⌘L">{`Alignment: ${ALIGNS.find(([a]) => a === (node.align ?? 'left'))?.[1] ?? 'Align left'}`}</Name>
              <Chevron />
            </button>
            {/* Over the key that opened it, not over the middle of the bar: a menu belongs to its own button. */}
            {menu === 'align' && (
              <span className="nt-pop nt-aligns" role="menu">
                {ALIGNS.map(([a, label, keys]) => (
                  <button key={a} type="button" tabIndex={-1} role="menuitemradio" className={(node.align ?? 'left') === a ? 'is-on' : ''} aria-checked={(node.align ?? 'left') === a} onClick={() => { onAlign(a); setMenu(null); refocusLabel(ref.current) }}>
                    <IconAlign align={a} />
                    <Name tip={label} keys={keys}>{`${label} — ${chord(keys)}`}</Name>
                  </button>
                ))}
              </span>
            )}
          </span>
        )}
        {coarse && !docked && outline && (
          <>
            <span className="nt-sep" />
            <button type="button" tabIndex={-1} onClick={onOutdent}>
              <IconOutdent />
              <Name>Move out a level</Name>
            </button>
            <button type="button" tabIndex={-1} onClick={onIndent}>
              <IconIndent />
              <Name>Move in a level</Name>
            </button>
          </>
        )}
        {coarse && (
          // On a bar with room, the two keys that end an edit go to the far right, where a thumb expects to finish,
          // and away from the keys that change the text. Delete sits before Done with a gap between them: the one
          // is destructive and the other is the one pressed every time, and they must not be neighbours.
          <span className={roomy ? 'nt-tail' : 'nt-tail is-tight'}>
            {!roomy && <span className="nt-sep" />}
            {roomy && (
              <button type="button" tabIndex={-1} className="nt-delete" disabled={!canDelete} onClick={onDelete}>
                <IconTrash />
                <Name>Delete this node and everything under it</Name>
              </button>
            )}
            <button type="button" tabIndex={-1} className="nt-done" onClick={onDone}>
              <IconCheck />
              <Name>Done</Name>
            </button>
          </span>
        )}
      </div>
      )}
    </div>
  )
}

/** A control's name for assistive tech — not an aria-label, which Obsidian would show as its own tooltip at once.
 *  With `tip`, the bar shows the name and `keys` in its own tip after the pointer rests on the control. */
const Name = ({ children, tip, keys }: { children: React.ReactNode; tip?: string; keys?: string }) => (
  <span className="sr-only" data-tip={tip} data-keys={keys}>
    {children}
  </span>
)

/** obsidian: the slider and the hex field take focus from the label being edited; when the
 *  picker closes, the caret goes back to the end of the text so typing carries on. Only this
 *  map's label — another map open beside it may be editing a node of its own. */
function refocusLabel(bar: HTMLElement | null) {
  const el = bar?.closest('.io-root')?.querySelector<HTMLElement>('.node-label[contenteditable="true"]')
  if (!el || el.ownerDocument.activeElement === el) return
  el.focus({ preventScroll: true })
  const range = el.ownerDocument.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = el.ownerDocument.defaultView?.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/** A hue as far as possible from every colour already in use — where a new colour stands out. */
function freeHue(branches: string[], palette: string[]): number {
  const used = [...branches, ...palette.filter(Boolean)].map((c) => hueOfHex(c)).sort((a, b) => a - b)
  if (!used.length) return 210
  let best = 0
  let bestGap = -1
  for (let i = 0; i < used.length; i++) {
    const a = used[i]
    const b = i + 1 < used.length ? used[i + 1] : used[0] + 360
    if (b - a > bestGap) {
      bestGap = b - a
      best = (a + (b - a) / 2) % 360
    }
  }
  return Math.round(best)
}
