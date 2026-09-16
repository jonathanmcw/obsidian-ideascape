import { useEffect, useRef, useState, type ReactElement } from 'react'
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

/** One row of the phone's menu: an icon, the words, and a tick when the row is the current choice. */
function MenuItem({ icon: Ic, label, checked, disabled, onPick }: { icon: Icon; label: string; checked?: boolean; disabled?: boolean; onPick: () => void }) {
  const toggles = checked !== undefined
  return (
    <button role={toggles ? 'menuitemcheckbox' : 'menuitem'} aria-checked={toggles ? checked : undefined} className={checked ? 'is-on' : ''} disabled={disabled} onClick={onPick}>
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

  const index = SHAPES.indexOf(shape)

  return (
    <header className="toolbar">
      {/* Left: the shape. The map's name lives in the canvas's corner, not here. */}
      <div className="seg seg-shape" style={{ ['--seg-index' as string]: index, ['--seg-count' as string]: SHAPES.length }}>
        <span className="seg-thumb" />
        {SHAPES.map((s, i) => (
          <button key={s} className={`seg-btn${s === shape ? ' is-on' : ''}`} onClick={() => onShape(s)} aria-label={`${SHAPE_LABEL[s]} — ${chord(`⌘${i + 1}`)}`}>
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
            aria-label={`Focus on the selected branch — ${chord('⌥⌘F')}`}
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
          <button className={`icon-btn only-wide${inspectorOpen ? ' is-on' : ''}`} onClick={onToggleInspector} aria-label={`Document — ${chord('⌘/')}`}>
            <IconSliders />
          </button>
          <button className="icon-btn only-wide" onClick={onExport} aria-label="Export">
            <IconExport />
          </button>
          <div className="toolbar-more" ref={moreRef}>
            <button className={`icon-btn${more ? ' is-on' : ''}`} onClick={() => setMore((v) => !v)} aria-label="More" aria-haspopup="menu" aria-expanded={more}>
              <IconMore />
            </button>
            {more && (
              <div className="toolbar-menu" role="menu">
                {/* A phone's menu: the toolbar's centre folds in here, then the actions the wide toolbar keeps at its right. */}
                {shape === 'map' &&
                  MAP_LAYOUTS.map((l) => (
                    <MenuItem key={l} icon={LAYOUT_ICON[l]} label={LAYOUT_MENU_LABEL[l]} checked={mapLayout === l} onPick={() => { onMapLayout(l); setMore(false) }} />
                  ))}
                {shape === 'outline' && (
                  <>
                    <MenuItem icon={IconColumn} label="Centred column" checked={outlineWidth === 'column'} onPick={() => { onOutlineWidth('column'); setMore(false) }} />
                    <MenuItem icon={IconFull} label="Full width" checked={outlineWidth === 'full'} onPick={() => { onOutlineWidth('full'); setMore(false) }} />
                  </>
                )}
                <MenuItem icon={IconFocus} label="Focus mode" checked={focusActive} disabled={!canFocus && !focusActive} onPick={() => { onToggleFocus(); setMore(false) }} />
                {shape === 'map' && (
                  <MenuItem icon={IconTidy} label={mapLayout === 'free' ? 'Tidy' : 'Tidy (Free layout only)'} disabled={mapLayout !== 'free'} onPick={() => { onTidy(); setMore(false) }} />
                )}
                {shape === 'map' && <MenuItem icon={IconFit} label="Fit map" onPick={() => { onFit(); setMore(false) }} />}
                <div className="toolbar-menu-sep" role="separator" />
                <MenuItem icon={IconSliders} label="Document settings" checked={inspectorOpen} onPick={() => { onToggleInspector(); setMore(false) }} />
                <MenuItem icon={IconExport} label="Export" onPick={() => { onExport(); setMore(false) }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
