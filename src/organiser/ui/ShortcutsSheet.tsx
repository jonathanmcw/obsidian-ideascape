import { useEffect, useRef } from 'react'
import { IconClose } from './Icons'
import { ORG_CHART } from '../model/types'

interface Props {
  onClose: () => void
}

type Group = { title: string; rows: [string, string][] }

// Two columns, balanced by hand: 18 rows under two headings against 17 under three. A row-major
// grid paired the tallest section with the shortest and left a hole under Shapes.
const COLUMNS: Group[][] = [
  [

  {
    title: 'Build the map',
    rows: [
      ['Tab', 'Add a child · in the Outline, move the row in under the one above'],
      ['Enter', 'Add a sibling'],
      ['any letter', 'Type straight into the selection — the new text replaces the old'],
      ['⌘E', 'Edit the text in place, caret at the end · ⌘E or Esc leaves · F2 selects it all'],
      ['Esc', 'Leave the node — if it is still empty, it goes away'],
      ['⇧Enter', 'New line inside the same node'],
      ['⇧Tab', 'Move the row out a level'],
      ['⌘Enter', 'Checkbox: add one · tick it · untick it — the file gets - [ ] and - [x]'],
      ['⇧⌘7', 'Numbered item — numbers follow the order, the file gets 1. 2. 3.'],
      ['⌫', 'Delete the selection and everything under it'],
      ['⌘Z / ⇧⌘Z', 'Undo · redo — while typing, the typing first'],
    ],
  },
  {
    title: 'With the mouse',
    rows: [
      ['double-click', 'Edit a node, all its text selected · on a node’s edge, go back to its natural width'],
      ['while typing', 'The bar above the node: formatting, text size and branch colour'],
      ['drag empty space', 'Select several nodes · ⇧-click adds one · Esc clears'],
      ['scroll · ⌘-scroll', 'Pan · zoom the Map — or drag with ⌥, Space or the middle button · the Outline scrolls'],
      ['drag the +', 'Pull a new idea out of a node — click it to fold the branch'],
      ['drag a node', `${ORG_CHART ? 'Mind map and Org chart' : 'Mind map'}: drop it on another to re-parent, or between siblings to reorder · Free layout: move it, branch and all`],
      ['⌥ drag', 'Free layout: move one node out of its branch'],
    ],
  },
  ],
  [
  {
    title: 'While typing',
    rows: [
      ['⌘B ⌘I ⌘U', 'Bold · italic · underline — the bar above the node has strike, highlight, code and [[link]]'],
      ['#tag', 'Node text is Markdown, so the file reads the same in Obsidian · type #tag to tag a node, click a tag to search it'],
      ['⇧⌘V', 'Paste as plain text — ⌘V keeps pasted [[links]] and **bold** as Markdown'],
    ],
  },
  {
    title: 'Move around',
    rows: [
      ['↑ ↓ ← →', 'Move the selection — ⇧ keeps what is selected and adds the next node'],
      ['⌘F', 'Find in the map · Enter or ⌘G goes to the next match, with ⇧ the one before · Esc closes'],
      ['⌘A', 'Select every node on show — in focus, the branch’s'],
      ['⌘C ⌘X ⌘V', 'Copy, cut, paste branches — as a Markdown list, so they paste into notes too'],
      ['⌘↑ / ⌘↓', 'Reorder among siblings — ⌥↑ ⌥↓ too, except in Free layout'],
      ['⌥ arrows', 'Free layout: nudge the branch · with ⇧, further'],
      ['⌘. ', 'Collapse or expand — children become a count, not a deletion'],
      ['⌥⌘F', 'Focus the selected branch · Esc leaves'],
      ['⇧⌘0 ⌥⌘= ⌥⌘-', 'Fit · zoom in · zoom out — the Outline stays at 100%'],
    ],
  },
  {
    title: 'Shapes',
    rows: [
      ['⌘1 ⌘2', 'Map · Outline'],
      ['⌘3', ORG_CHART
        ? 'Map layout: Mind map, Org chart, Free in turn — Free starts from the arrangement you came from, and Tidy puts it back in that order, or just the nodes you have selected'
        : 'Map layout: Mind map or Free — Tidy puts Free back in mind-map order, or just the nodes you have selected'],
      ['⌘/', 'Document panel — theme and node style, saved with the map'],
      ['⇧⌘L E R', 'Align the node’s text left, centre, right'],
      ['⌥⌘1 2 3', 'Heading 1, 2, 3 for the selection · ⌥⌘0 back to body text'],
    ],
  },
  ],
]

export function ShortcutsSheet({ onClose }: Props) {
  // Keys go to the sheet while it is open, not to the map behind the scrim.
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    dialog.current?.focus({ preventScroll: true })
  }, [])
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div ref={dialog} tabIndex={-1} style={{ outline: 'none' }} className="sheet wide" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <div className="sheet-head">
          <h2>Shortcuts</h2>
          <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">
            <IconClose />
          </button>
        </div>

        <div className="keys">
          {COLUMNS.map((col, i) => (
            <div className="keys-col" key={i}>
              {col.map((g) => (
                <section key={g.title}>
                  <h3>{g.title}</h3>
                  <dl>
                    {g.rows.map(([key, what]) => (
                      <div key={key}>
                        <dt>
                          <kbd>{key.trim()}</kbd>
                        </dt>
                        <dd>{what}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          ))}
        </div>

        <p className="sheet-note">
          The map is meant to be built without touching the mouse. Tab and Enter alone will get you a long way.
        </p>
      </div>
    </div>
  )
}
