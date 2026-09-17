import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IconClose } from './Icons'
import { ESSENTIALS, GROUPS, SEARCHABLE, capLabel, filterGroups, isCap, macKeys, platformCaps, type Shortcut } from './keys'

interface Props {
  onClose: () => void
  onTour?: () => void
  mac?: boolean
}

// Only a fallback: the view passes `mac` from Platform.isMacOS. The plugin's lint forbids navigator.platform and
// userAgent, and the organiser imports nothing from Obsidian, so this reads the platform class Obsidian puts on <body>.
/** A row's keys: one cap per key, alternatives joined by a muted "or", gestures and typed text as plain words. */
function Keys({ row, mac }: { row: Shortcut; mac: boolean }) {
  return (
    <>
      {row.keys.map((alt, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="sk-or">or</span>}
          {platformCaps(alt, mac).map((token, j) =>
            isCap(token, row.mouse) ? (
              <kbd className="sk-cap" key={j}>
                {capLabel(token, mac)}
              </kbd>
            ) : (
              <span className="sk-word" key={j}>
                {token}
              </span>
            ),
          )}
        </Fragment>
      ))}
    </>
  )
}

export function ShortcutsSheet({ onClose, onTour, mac: macProp }: Props) {
  const mac = macProp ?? macKeys()
  const [query, setQuery] = useState('')
  const filtering = query.trim() !== ''
  const groups = useMemo(() => (filtering ? filterGroups(SEARCHABLE, query) : GROUPS), [filtering, query])
  const columns = useMemo(() => {
    const size = Math.ceil(groups.length / 3)
    return size ? [groups.slice(0, size), groups.slice(size, size * 2), groups.slice(size * 2)] : []
  }, [groups])

  // Keys go to the sheet while it is open, not to the map behind the scrim; the filter takes them first.
  const dialog = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  /** Whatever held the keyboard when the sheet opened, read before the filter takes it. */
  const opener = useRef<Element | null>(null)
  useEffect(() => {
    opener.current = dialog.current?.ownerDocument.activeElement ?? null
    field.current?.focus({ preventScroll: true })
  }, [])

  // A dialog keeps Tab to itself: without this, Shift+Tab walks out behind the scrim and presses buttons on the
  // map nobody can see. Whatever had focus before gets it back when the sheet closes.
  useEffect(() => {
    const el = dialog.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const stops = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
        (n) => n.offsetParent !== null || n === el.ownerDocument.activeElement,
      )
      if (!stops.length) return
      const first = stops[0]
      const last = stops[stops.length - 1]
      const here = el.ownerDocument.activeElement
      if (e.shiftKey && (here === first || !el.contains(here))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && here === last) {
        e.preventDefault()
        first.focus()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('keydown', onKey)
      const back = opener.current
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true })
    }
  }, [])

  // The sheet keeps its opening height while filtering: centred in the scrim, a sheet that shrank with every
  // keystroke would move the field being typed into. min() lets a window made smaller still win.
  const [openHeight, setOpenHeight] = useState<number>()
  useLayoutEffect(() => {
    setOpenHeight(dialog.current?.offsetHeight)
  }, [])

  // Esc clears the filter before it closes the sheet. MapApp closes sheets from a bubbling listener on the view
  // root and ignores keys typed in a field, so this listens in capture, ahead of it: with text, Esc stops here;
  // with an empty field it closes from here; from anywhere else in the sheet it carries on to MapApp.
  useEffect(() => {
    const el = dialog.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      const inField = e.target === field.current
      if (!query && !inField) return
      e.preventDefault()
      e.stopPropagation()
      if (query) {
        setQuery('')
        field.current?.focus({ preventScroll: true })
      } else onClose()
    }
    el.addEventListener('keydown', onKey, true)
    return () => el.removeEventListener('keydown', onKey, true)
  }, [query, onClose])

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        ref={dialog}
        tabIndex={-1}
        style={{ outline: 'none', minHeight: openHeight ? `min(${openHeight}px, 100%)` : undefined }}
        className={`sheet wide sk-sheet${mac ? ' is-mac' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className="sheet-head">
          <h2>Shortcuts</h2>
          <input
            ref={field}
            className="sk-filter"
            type="search"
            placeholder="Filter shortcuts"
            aria-label="Filter shortcuts"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        {!filtering && (
          <ul className="sk-essentials" aria-label="Essentials">
            {ESSENTIALS.map((row) => (
              <li key={row.label}>
                <span className="sk-keys">
                  <Keys row={row} mac={mac} />
                </span>
                {row.label}
              </li>
            ))}
          </ul>
        )}

        <div className="sk-body">
          {groups.length ? (
            <div className="sk-cols">
              {columns.map((column, index) => (
                <div className="sk-col" key={index}>
                  {column.map((g) => (
                    <section key={g.title}>
                      <h3>{g.title}</h3>
                      <dl>
                        {g.rows.map((row) => (
                          <Fragment key={row.label}>
                            <dt>
                              <Keys row={row} mac={mac} />
                            </dt>
                            <dd>{row.label}</dd>
                          </Fragment>
                        ))}
                      </dl>
                    </section>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p className="sk-empty">No shortcut matches “{query.trim()}”</p>
          )}
        </div>

        <p className="sheet-note sk-note">
          <span>Commands can be given your own keys in Settings → Hotkeys.</span>
          {onTour && (
            <button
              className="sk-link"
              onClick={() => {
                onTour()
                onClose()
              }}
            >
              Take the tour
            </button>
          )}
        </p>
      </div>
    </div>
  )
}
