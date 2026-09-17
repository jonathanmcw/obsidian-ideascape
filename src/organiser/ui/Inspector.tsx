import { useState } from 'react'
import type { NodeStyle, Shape } from '../model/types'
import { CUSTOM_SLOTS, CUSTOM_THEME_ID, HOST_THEME_ID, THEMES, allThemes, themeById, type CustomThemeDef } from '../theme'
import { toneOf, withHue } from '../colour'
import { ColourPopover } from './ColourPopover'
import { PLUGIN_NAME } from '../../brand'
import { IconBack, IconClose, IconPlus } from './Icons'
import { chord } from './keys'

interface Props {
  /** The theme in effect: the map's own, or the plugin's default. */
  themeId: string
  /** True when this map pins its own theme instead of following the default. */
  themePinned: boolean
  /** The theme maps use until they pin one: choosing its card follows the default again instead of pinning it. */
  defaultThemeId: string
  nodeStyle: NodeStyle
  /** Node styles are a Map thing; the Outline shows its bar on every row regardless. */
  shape: Shape
  /** The map's own branch colours, by slot ('' = empty). */
  palette: string[]
  /** obsidian: the one theme the person defines, shared by every map that pins it. */
  customTheme: CustomThemeDef
  noteDismissed: boolean
  /** The dot grid behind the map, and whether free-layout moves land on it. */
  dots: boolean
  snap: boolean
  /** undefined: follow the default again. */
  onTheme: (id: string | undefined) => void
  onNodeStyle: (style: NodeStyle) => void
  onPalette: (slot: number, hex: string) => void
  onRemovePalette: (slot: number) => void
  onCustomTheme: (def: CustomThemeDef) => void
  onDots: (on: boolean) => void
  onSnap: (on: boolean) => void
  onDismissNote: () => void
  onClose: () => void
}

const IconPencil = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.5 2.5l3 3L6 13H3v-3z" />
    <path d="M9 4l3 3" />
  </svg>
)

/** Filled first: the look most people start from, then lighter, then lightest. */
const STYLES: { value: NodeStyle; label: string }[] = [
  { value: 'filled', label: 'Filled' },
  { value: 'outline', label: 'Outline' },
  { value: 'bar', label: 'Bar' },
]

const IconInfo = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 7.2v4M8 4.8v.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)


/** A labelled on/off switch, the panel's one row type. */
function Switch({ label, on, disabled, onChange }: { label: string; on: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className={`inspector-row${disabled ? ' is-disabled' : ''}`}>
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={`sw${on ? ' is-on' : ''}`} disabled={disabled} onClick={() => onChange(!on)}>
        <span className="sw-knob" />
      </button>
    </div>
  )
}

/** A segmented control with a sliding thumb, the toolbar's; here full width. */
function Seg<T extends string>({ value, options, disabled, onChange }: { value: T; options: { value: T; label: string }[]; disabled?: boolean; onChange: (v: T) => void }) {
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div className={`seg seg-full${disabled ? ' is-disabled' : ''}`} role="group" style={{ ['--seg-index' as string]: index, ['--seg-count' as string]: options.length }}>
      <span className="seg-thumb" />
      {options.map((o) => (
        <button key={o.value} type="button" className={`seg-btn${o.value === value ? ' is-on' : ''}`} disabled={disabled} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** obsidian: the Document panel — what the whole map looks like, saved in the file.
 *  Per-node styling lives on the bar above the node being typed. */
export function Inspector({ themeId, themePinned, defaultThemeId, nodeStyle, shape, palette, customTheme, noteDismissed, dots, snap, onTheme, onNodeStyle, onPalette, onRemovePalette, onCustomTheme, onDots, onSnap, onDismissNote, onClose }: Props) {
  // Which of the map's own colour slots has its popover open, and whether the custom theme editor is open.
  const [slot, setSlot] = useState<{ i: number; el: HTMLElement } | null>(null)
  const [editingTheme, setEditingTheme] = useState(false)
  const theme = themeById(themeId)
  const tone = toneOf(theme.branches)
  const inOutline = shape === 'outline'

  if (editingTheme) {
    return (
      <aside className="inspector">
        <div className="inspector-head">
          <button className="icon-btn sm" onClick={() => setEditingTheme(false)} aria-label="Back to the document panel">
            <IconBack size={14} />
          </button>
          <span className="inspector-title">Custom theme</span>
          <button className="icon-btn sm" onClick={onClose} aria-label={`Close — ${chord('⌘/')}`}>
            <IconClose size={14} />
          </button>
        </div>
        <CustomThemeEditor def={customTheme} onChange={onCustomTheme} />
      </aside>
    )
  }

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span className="inspector-title">Document</span>
        <button className="icon-btn sm" onClick={onClose} aria-label={`Close — ${chord('⌘/')}`}>
          <IconClose size={14} />
        </button>
      </div>

      <div className="inspector-body">
        {!noteDismissed && (
          <div className="inspector-info" role="note">
            <IconInfo />
            <span>Saved with this map. Defaults for new maps, motion and other behaviour: Settings → {PLUGIN_NAME}.</span>
            <button type="button" className="icon-btn sm" onClick={onDismissNote} aria-label="Dismiss">
              <IconClose size={12} />
            </button>
          </div>
        )}

        <section>
          <h3>Theme</h3>
          <div className="theme-grid" role="group">
            {allThemes().map((t) => {
              const current = t.id === themeId
              const custom = t.id === CUSTOM_THEME_ID
              const label = custom ? `${t.name} — your own theme` : t.id === HOST_THEME_ID ? `${t.name} — the app's own colours, light or dark as it is` : t.name
              return (
                <div key={t.id} className="theme-card-wrap">
                  <button
                    className={`theme-card${current && themePinned ? ' is-on' : ''}${current && !themePinned ? ' is-auto' : ''}`}
                    onClick={() => onTheme(t.id === defaultThemeId ? undefined : t.id)}
                    aria-pressed={current && themePinned}
                    aria-label={label}
                  >
                    <span className="theme-preview" style={{ background: t.vars['--stage'], borderColor: t.vars['--line-strong'] }}>
                      {t.branches.slice(0, 4).map((c, i) => (
                        <i key={i} style={{ background: c }} />
                      ))}
                    </span>
                    <span className="theme-name" style={{ color: 'inherit' }}>{t.name}</span>
                  </button>
                  {/* The custom theme is the one you can change: its editor opens from the card itself. */}
                  {custom && (
                    <button type="button" className="theme-edit" onClick={() => setEditingTheme(true)} aria-label="Edit the custom theme">
                      <IconPencil />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <p className="inspector-note">
            {themePinned ? (
              <>Pinned to this map. Choose {themeById(defaultThemeId).name}, the default from Settings, to follow it again.</>
            ) : (
              <>Following the default from Settings.</>
            )}
          </p>
          {/* The map's own colours, beside the theme's eight; the bar above a node offers them too. */}
          <div className="palette-slots" role="group" aria-label="The map’s own colours">
            {Array.from({ length: CUSTOM_SLOTS }, (_, i) => {
              const hex = palette[i]
              const open = slot?.i === i
              return hex ? (
                <button key={i} type="button" className={`palette-slot${open ? ' is-open' : ''}`} style={{ background: hex }} onClick={(e) => setSlot(open ? null : { i, el: e.currentTarget })} aria-label={`Own colour ${i + 1}: ${hex}`} aria-expanded={open} />
              ) : (
                <button
                  key={i}
                  type="button"
                  className="palette-slot is-empty"
                  onClick={(e) => {
                    onPalette(i, withHue((210 + i * 90) % 360, tone))
                    setSlot({ i, el: e.currentTarget })
                  }}
                  aria-label="Add a colour of your own"
                >
                  <IconPlus size={13} />
                </button>
              )
            })}
          </div>
          {slot && palette[slot.i] && (
            <ColourPopover
              anchor={slot.el}
              value={palette[slot.i]}
              tone={tone}
              onChange={(hex) => onPalette(slot.i, hex)}
              onRemove={() => {
                onRemovePalette(slot.i)
                setSlot(null)
              }}
              onClose={() => setSlot(null)}
            />
          )}
        </section>

        <section>
          <h3>Node style</h3>
          <Seg value={nodeStyle} options={STYLES} disabled={inOutline} onChange={onNodeStyle} />
          {inOutline && <p className="inspector-note">For the Map. The Outline marks every row with its branch colour.</p>}
        </section>

        <section>
          <h3>Background</h3>
          <Switch label="Dot grid" on={dots} onChange={onDots} />
          <Switch label="Snap to grid" on={snap && dots} disabled={!dots} onChange={onSnap} />
        </section>
      </div>
    </aside>
  )
}

/** obsidian: the custom theme — a built-in theme to start from, then the stage, the accent and
 *  the eight branch colours. Changes apply as you drag; the theme lives in the plugin's settings. */
function CustomThemeEditor({ def, onChange }: { def: CustomThemeDef; onChange: (def: CustomThemeDef) => void }) {
  const [which, setWhich] = useState<{ key: 'stage' | 'accent' | number; el: HTMLElement } | null>(null)
  const base = THEMES.find((t) => t.id === def.base) ?? THEMES[0]
  const tone = toneOf(base.branches)
  const stage = def.stage || base.vars['--stage']
  const accent = def.accent || base.vars['--accent']
  const branches = base.branches.map((c, i) => def.branches[i] || c)
  const key = which?.key
  const value = key === 'stage' ? stage : key === 'accent' ? accent : key != null ? branches[key] : ''
  const set = (hex: string) => {
    if (key === 'stage') onChange({ ...def, stage: hex })
    else if (key === 'accent') onChange({ ...def, accent: hex })
    else if (key != null) {
      const next = [...branches]
      next[key] = hex
      onChange({ ...def, branches: next })
    }
  }
  const reset = () => {
    if (key === 'stage') onChange({ ...def, stage: undefined })
    else if (key === 'accent') onChange({ ...def, accent: undefined })
    else if (key != null) {
      const next = [...branches]
      next[key] = base.branches[key]
      onChange({ ...def, branches: next })
    }
  }
  const toggle = (k: 'stage' | 'accent' | number, el: HTMLElement) => setWhich(which?.key === k ? null : { key: k, el })
  return (
    <div className="inspector-body">
      <section>
        <h3>Name</h3>
        <input className="inspector-input" type="text" value={def.name} onChange={(e) => onChange({ ...def, name: e.currentTarget.value })} onKeyDown={(e) => e.stopPropagation()} aria-label="Theme name" />
      </section>
      <section>
        <h3>Start from</h3>
        <div className="seg-tiles wide grid-2" role="group">
          {THEMES.map((t) => (
            <button key={t.id} className={def.base === t.id ? 'is-on' : ''} onClick={() => onChange({ ...def, base: t.id })} aria-pressed={def.base === t.id}>
              {t.name}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3>Colours</h3>
        <div className="palette-slots" role="group">
          <button type="button" className={`palette-slot is-labelled${key === 'stage' ? ' is-open' : ''}`} style={{ background: stage }} onClick={(e) => toggle('stage', e.currentTarget)} aria-label={`Stage: ${stage}`}>
            <span>Stage</span>
          </button>
          <button type="button" className={`palette-slot is-labelled${key === 'accent' ? ' is-open' : ''}`} style={{ background: accent }} onClick={(e) => toggle('accent', e.currentTarget)} aria-label={`Accent: ${accent}`}>
            <span>Accent</span>
          </button>
        </div>
        <div className="palette-slots" role="group" aria-label="Branch colours">
          {branches.map((c, i) => (
            <button key={i} type="button" className={`palette-slot${key === i ? ' is-open' : ''}`} style={{ background: c }} onClick={(e) => toggle(i, e.currentTarget)} aria-label={`Branch colour ${i + 1}: ${c}`} />
          ))}
        </div>
        {which && <ColourPopover anchor={which.el} value={value} tone={tone} onChange={set} onRemove={reset} removeName="Reset" destructive={false} onClose={() => setWhich(null)} />}
      </section>
    </div>
  )
}
