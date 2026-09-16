import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type FocusEvent as ReactFocusEvent, type ReactElement } from 'react'
import type { Arrangement, MapLayout, Shape } from '../model/types'
import { LAYOUT_LABEL, MAP_LAYOUTS, SHAPES, SHAPE_LABEL } from '../model/types'
import type { OutlineWidth } from '../model/store'
import { chord } from './keys'
import { IconAuto, IconCheck, IconColumn, IconExport, IconFit, IconFocus, IconFree, IconFull, IconMore, IconOrg, IconSliders, IconTidy } from './Icons'

interface Props {
  shape: Shape
  focusActive: boolean
  canFocus: boolean
  /** How many nodes Tidy would move — the selection when several are selected, 0 for the whole map. */
  tidyScope: number
  onShape: (s: Shape) => void
  onToggleFocus: () => void
  onExport: () => void
  inspectorOpen: boolean
  onToggleInspector: () => void
  outlineWidth: OutlineWidth
  onOutlineWidth: (w: OutlineWidth) => void
  mapLayout: MapLayout
  /** The arrangement the map is in, or the one Free follows: what Tidy lays out. */
  arrangement: Arrangement
  onMapLayout: (m: MapLayout) => void
  onTidy: () => void
  onFit: () => void
}

type Icon = (p: { size?: number }) => ReactElement

/** A segmented toggle drawn as icons; the tooltip carries the words. */
const LAYOUT_ICON: Record<MapLayout, Icon> = { auto: IconAuto, org: IconOrg, free: IconFree }
const LAYOUT_MENU_LABEL: Record<MapLayout, string> = { auto: 'Auto layout', org: 'Org chart layout', free: 'Free layout' }

/** One row of the phone's menu: an icon, the words, and a tick when the row is the current choice.
 *  `exclusive` marks the rows that are one choice out of several — the layouts, the outline's width — so a screen
 *  reader says "one of three" rather than offering each as its own tick box. */
function MenuItem({ icon: Ic, label, checked, exclusive, disabled, onPick }: { icon: Icon; label: string; checked?: boolean; exclusive?: boolean; disabled?: boolean; onPick: () => void }) {
  const toggles = checked !== undefined
  return (
    <button
      role={toggles ? (exclusive ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem'}
      aria-checked={toggles ? checked : undefined}
      className={checked ? 'is-on' : ''}
      tabIndex={-1}
      disabled={disabled}
      onClick={onPick}
    >
      <span className="tm-icon"><Ic size={16} /></span>
      <span className="tm-label">{label}</span>
      {checked && <span className="tm-check"><IconCheck size={14} /></span>}
    </button>
  )
}

function MiniSeg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string, Icon][]; onChange: (v: T) => void; label: string }) {
  const index = Math.max(0, options.findIndex(([v]) => v === value))
  return (
    <div className="seg seg-mini" style={{ ['--seg-index' as string]: index, ['--seg-count' as string]: options.length }} role="group" aria-label={label}>
      <span className="seg-thumb" />
      {options.map(([v, title, Glyph]) => (
        <button key={v} className={`seg-btn${v === value ? ' is-on' : ''}`} onClick={() => onChange(v)} aria-label={title} aria-pressed={v === value}>
          <Glyph size={15} />
        </button>
      ))}
    </div>
  )
}

export function Toolbar({
  shape,
  focusActive,
  canFocus,
  tidyScope,
  onShape,
  onToggleFocus,
  onExport,
  inspectorOpen,
  onToggleInspector,
  outlineWidth,
  onOutlineWidth,
  mapLayout,
  arrangement,
  onMapLayout,
  onTidy,
  onFit,
}: Props) {
  // Phones fold Document and Export into one button; the menu closes on any press outside it.
  const [more, setMore] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const moreBtn = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!more) return
    const close = (e: PointerEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMore(false)
    }
    // obsidian: the toolbar's own document — a popped-out window has its own.
    const doc = moreRef.current?.ownerDocument ?? document
    doc.addEventListener('pointerdown', close, true)
    return () => doc.removeEventListener('pointerdown', close, true)
  }, [more])

  /** Close the menu the way Escape does: the button that opened it takes the keyboard back. */
  const closeMenu = () => {
    setMore(false)
    moreBtn.current?.focus()
  }

  // An open menu takes the keyboard: the first row has focus, the arrows and Home and End walk the rows, Tab
  // leaves the menu rather than walking every command in it, and Esc hands focus back to the button that opened it.
  useEffect(() => {
    if (!more) return
    const el = menuRef.current
    if (!el) return
    const rows = () => [...el.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
    rows()[0]?.focus()
    const onKey = (e: KeyboardEvent) => {
      const items = rows()
      if (!items.length) return
      const here = items.indexOf(el.ownerDocument.activeElement as HTMLButtonElement)
      const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length]?.focus() }
      if (e.key === 'ArrowDown') go(here < 0 ? 0 : here + 1)
      else if (e.key === 'ArrowUp') go(here < 0 ? items.length - 1 : here - 1)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(items.length - 1)
      else if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        setMore(false)
        moreBtn.current?.focus()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [more])

  // A toolbar is one stop on the way round, not a dozen: Tab reaches it once and the arrows walk its controls.
  // The rows of an open menu are left out — the menu has its own keys — and a key handled here is kept from the
  // map behind, which reads the arrows as "move the selection".
  const barRef = useRef<HTMLElement>(null)
  /** The control that holds the toolbar's tab stop, kept as the element rather than its place in the row: the row
   *  itself changes with the pane's width, and an index would then point at something else, or at nothing. */
  const stop = useRef<HTMLButtonElement | null>(null)
  const barButtons = () => [...(barRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])].filter((b) => !b.closest('.toolbar-menu'))
  // Hidden is not the same as disabled: the ... button is display:none until the pane is tight, and the wide
  // toolbar's own actions go the other way. Neither can hold the keyboard while it is not drawn.
  const barItems = () => barButtons().filter((b) => !b.disabled && b.offsetParent !== null)

  const setStop = (btn: HTMLButtonElement | null) => {
    stop.current = btn
    // Every button is set, not only the ones in the walk: a disabled or hidden one that comes back would
    // otherwise still be carrying the tab stop it was born with.
    barButtons().forEach((b) => { b.tabIndex = b === btn ? 0 : -1 })
  }

  /** Keep the stop on the control that has it, or move it to the first one still there. */
  const syncStop = () => {
    const items = barItems()
    if (!items.length) return
    const held = stop.current
    setStop(held && items.includes(held) ? held : items[0])
  }

  // What the toolbar holds changes with the shape, with what is on or off, and with the width of the pane, which
  // is a class on a parent rather than a prop: the width is watched instead of guessed.
  useEffect(syncStop, [shape, mapLayout, outlineWidth, focusActive, canFocus, inspectorOpen, tidyScope, more])
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const ro = new ResizeObserver(() => syncStop())
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onBarKey = (e: ReactKeyboardEvent) => {
    if (more) return
    const items = barItems()
    const here = items.indexOf(e.target as HTMLButtonElement)
    if (here < 0) return
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(e.key)) return
    e.preventDefault()
    e.stopPropagation()
    const to = e.key === 'ArrowRight' ? here + 1 : e.key === 'ArrowLeft' ? here - 1 : e.key === 'Home' ? 0 : items.length - 1
    const next = items[(to + items.length) % items.length]
    setStop(next)
    next.focus()
  }

  const index = SHAPES.indexOf(shape)

  return (
    <header
      className="toolbar"
      role="toolbar"
      aria-orientation="horizontal"
      aria-label="Map controls"
      ref={barRef}
      onKeyDown={onBarKey}
      onFocus={(e: ReactFocusEvent) => {
        const btn = e.target as HTMLButtonElement
        if (barItems().includes(btn)) setStop(btn)
      }}
    >
      {/* Left: the shape. The map's name lives in the canvas's corner, not here. */}
      <div className="seg seg-shape" style={{ ['--seg-index' as string]: index, ['--seg-count' as string]: SHAPES.length }} role="group" aria-label="View">
        <span className="seg-thumb" />
        {SHAPES.map((s, i) => (
          <button key={s} className={`seg-btn${s === shape ? ' is-on' : ''}`} onClick={() => onShape(s)} aria-pressed={s === shape} aria-label={`${SHAPE_LABEL[s]} — ${chord(`⌘${i + 1}`)}`}>
            {SHAPE_LABEL[s]}
          </button>
        ))}
      </div>

      {/* Centre: the shape's own toggle — where the Map's nodes go, or how wide the Outline is — with Focus and Tidy at its side. */}
      <div className="toolbar-centre">
        {shape === 'map' && (
          <MiniSeg
            label="Map layout"
            value={mapLayout}
            options={(
              [
                ['auto', `${LAYOUT_LABEL.auto} — branches either side of the root · ${chord('⌘3')}`, IconAuto],
                ['org', `${LAYOUT_LABEL.org} — the root at the top, a row for each level · ${chord('⌘3')}`, IconOrg],
                ['free', `${LAYOUT_LABEL.free} — the positions you give nodes · ${chord('⌘3')}`, IconFree],
              ] as [MapLayout, string, Icon][]
            ).filter(([l]) => MAP_LAYOUTS.includes(l))}
            onChange={onMapLayout}
          />
        )}
        {shape === 'outline' && (
          <MiniSeg
            label="Outline width"
            value={outlineWidth}
            options={[
              ['column', 'Centred column', IconColumn],
              ['full', 'Full width', IconFull],
            ]}
            onChange={onOutlineWidth}
          />
        )}
        {/* Focus and Tidy are ways of arranging the view, like the layout: they sit beside the toggle,
            in a track as wide as the empty one before it, so the toggle stays on the toolbar's centre line. */}
        <div className="toolbar-centre-side">
          <button
            className={`icon-btn${focusActive ? ' is-on' : ''}`}
            onClick={onToggleFocus}
            disabled={!canFocus && !focusActive}
            aria-pressed={focusActive}
            aria-label={`${focusActive ? 'Show the whole map' : 'Focus on the selected branch'} — ${chord('⌥⌘F')}`}
          >
            <IconFocus />
          </button>
          {shape === 'map' && (
            // Tidy stays put like Undo: disabled when there is nothing to tidy.
            <button
              className="icon-btn"
              onClick={onTidy}
              disabled={mapLayout !== 'free'}
              aria-label={
                mapLayout !== 'free'
                  ? 'Tidy — available in the Free layout'
                  : `Tidy as ${arrangement === 'org' ? 'an org chart' : 'a mind map'} — ${tidyScope ? `the ${tidyScope} selected nodes` : 'the whole map, or the nodes you select'}`
              }
            >
              <IconTidy />
            </button>
          )}
        </div>
      </div>

      {/* Right: the actions, at the far edge. The centre's cell is fixed by the grid, so nothing here can move it. */}
      <div className="toolbar-side">
        <div className="toolbar-right">
          <button className={`icon-btn only-wide${inspectorOpen ? ' is-on' : ''}`} onClick={onToggleInspector} aria-pressed={inspectorOpen} aria-label={`${inspectorOpen ? 'Hide the document panel' : 'Document panel'} — ${chord('⌘/')}`}>
            <IconSliders />
          </button>
          <button className="icon-btn only-wide" onClick={onExport} aria-label="Export">
            <IconExport />
          </button>
          <div className="toolbar-more" ref={moreRef}>
            <button ref={moreBtn} className={`icon-btn${more ? ' is-on' : ''}`} onClick={() => setMore((v) => !v)} aria-label="More" aria-haspopup="menu" aria-expanded={more}>
              <IconMore />
            </button>
            {more && (
              <div className="toolbar-menu" role="menu" aria-orientation="vertical" aria-label="More" ref={menuRef}>
                {/* A phone's menu: the toolbar's centre folds in here, then the actions the wide toolbar keeps at its right. */}
                {shape === 'map' &&
                  MAP_LAYOUTS.map((l) => (
                    <MenuItem key={l} icon={LAYOUT_ICON[l]} label={LAYOUT_MENU_LABEL[l]} checked={mapLayout === l} exclusive onPick={() => { onMapLayout(l); closeMenu() }} />
                  ))}
                {shape === 'outline' && (
                  <>
                    <MenuItem icon={IconColumn} label="Centred column" checked={outlineWidth === 'column'} exclusive onPick={() => { onOutlineWidth('column'); closeMenu() }} />
                    <MenuItem icon={IconFull} label="Full width" checked={outlineWidth === 'full'} exclusive onPick={() => { onOutlineWidth('full'); closeMenu() }} />
                  </>
                )}
                <MenuItem icon={IconFocus} label="Focus mode" checked={focusActive} disabled={!canFocus && !focusActive} onPick={() => { onToggleFocus(); closeMenu() }} />
                {shape === 'map' && (
                  <MenuItem icon={IconTidy} label={mapLayout === 'free' ? 'Tidy' : 'Tidy (Free layout only)'} disabled={mapLayout !== 'free'} onPick={() => { onTidy(); closeMenu() }} />
                )}
                {shape === 'map' && <MenuItem icon={IconFit} label="Fit map" onPick={() => { onFit(); closeMenu() }} />}
                <div className="toolbar-menu-sep" role="separator" />
                <MenuItem icon={IconSliders} label="Document settings" checked={inspectorOpen} onPick={() => { onToggleInspector(); closeMenu() }} />
                <MenuItem icon={IconExport} label="Export" onPick={() => { onExport(); closeMenu() }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
