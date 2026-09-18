// The real node bar, mounted in the harness page.
//
// The bar is the one piece of chrome whose shape is decided at runtime rather than by the stylesheet: NodeBar asks
// dockFit how much of itself a screen can hold, and a tablet Obsidian labels `is-phone` gets the dock with a
// tablet's room around it. Hand-written markup cannot check that — it can only repeat whatever the author believed
// the component draws, and a fixture that agrees with a wrong belief passes on a broken layout. So this mounts the
// component itself, measures its own container for the stage width, and lets the shell decide the rest.
//
// scripts/ui-check.mjs bundles this to test/ui/fixture.js before it opens the page; harness.html loads that file.
import { useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NodeBar } from '../../src/organiser/ui/NodeBar'
import { RichLabel } from '../../src/organiser/ui/RichLabel'
import { nodeMetrics } from '../../src/organiser/layout/measure'
import { themeById } from '../../src/organiser/theme'
import type { Align, IONode, NodeType } from '../../src/organiser/model/types'

// Obsidian adds `win` to Document, and `createEl` to it; measure.ts makes its measuring canvas through them, and
// outside Obsidian they are not there. The shim supplies that one call with a real canvas, so the widths the layout
// works from here are the browser's own — which is the whole point of comparing them with what is drawn.
const doc = document as unknown as { win?: { createEl: (tag: string) => HTMLElement } }
doc.win ??= { createEl: (tag: string) => document.createElement(tag) }

const noop = () => {}

/** One bar, sized by the stage it is standing in — the same measurement MapApp passes it. */
function Live({ more }: { more: boolean }) {
  const host = useRef<HTMLSpanElement>(null)
  const [stageWidth, setStageWidth] = useState(0)
  const [align, setAlign] = useState<Align>('left')
  const [type, setType] = useState<NodeType>('text')
  useLayoutEffect(() => {
    const stage = host.current?.parentElement
    if (stage) setStageWidth(stage.clientWidth)
  }, [])
  return (
    <>
      <span ref={host} hidden />
      {stageWidth > 0 && (
        <NodeBar
          nodeId={more ? 'more' : 'plain'}
          x={Math.round(stageWidth / 2)}
          top={110}
          bottom={150}
          stageWidth={stageWidth}
          node={{ isRoot: false, align, type, lines: 2, branch: 2 }}
          branches={themeById('paper').branches}
          palette={['', '', '', '']}
          onFormat={noop}
          onAlign={setAlign}
          onType={setType}
          onBranch={noop}
          onPalette={noop}
          onNewColour={noop}
          onRemoveColour={noop}
          outline
          canDelete
          onDelete={noop}
          canIndent
          canOutdent
          canMoveUp
          canMoveDown
          onIndent={noop}
          onOutdent={noop}
          onMoveUp={noop}
          onMoveDown={noop}
          onNewLine={noop}
          onDone={noop}
        />
      )}
    </>
  )
}

/** A row of text with one of everything in it, drawn at the width the layout measured for it.
 *
 *  The Android checkbox was a theme reaching the plugin's drawing by element name and changing its size. What made
 *  that a bug rather than a blemish is that the layout had already committed: measure.ts reserves CHECK_W + a gap
 *  for the box, and pads a #tag by TAG_PAD, from a canvas measurement no stylesheet can reach. So the rule the
 *  checkbox taught is general — what the layout reserved must be what the sheet draws — and it is checkable by
 *  drawing a row and comparing the two. scripts/ui-check.mjs reads the reserved numbers off `window.__row`. */
const TEXT = 'Plain **bold** *it* <u>un</u> ~~st~~ ==high== `code` #tag [[Note]]'
function Row() {
  const node: IONode = { id: 'r', text: TEXT, parent: null, children: [], collapsed: false, x: 0, y: 0, branch: 1, task: ' ' }
  const m = nodeMetrics(node, { isRoot: false, ordinal: 3, linked: false }, 'map')
  ;(window as unknown as { __row: unknown }).__row = { leadW: m.lead.w, textW: m.textW, lineH: m.lineH, fontSize: m.fontSize, fontWeight: m.fontWeight }
  // Inside `.nodes`, which is where the font stack measure.ts measures against is stated.
  return (
    <div className="nodes" style={{ position: 'static' }}><div className="node as-pill" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: m.w, height: m.h, ['--branch' as string]: 'var(--branch-1)', ['--node-radius' as string]: '15px' }}>
      <span className="node-lead" style={{ position: 'static', height: m.lineH, fontSize: m.fontSize, fontWeight: m.fontWeight }}>
        <span className="node-num">{`${3}.`}</span>
        <span tabIndex={-1} role="checkbox" aria-checked={false} className="node-check" data-task=" " />
      </span>
      <span className="node-label" style={{ fontSize: m.fontSize, lineHeight: `${m.lineH}px`, fontWeight: m.fontWeight }}>
        <RichLabel text={TEXT} lines={m.lines} onOpenLink={noop} />
      </span>
    </div></div>
  )
}

for (const host of document.querySelectorAll<HTMLElement>('[data-live-row]')) createRoot(host).render(<Row />)

for (const stage of document.querySelectorAll<HTMLElement>('[data-live-bar]')) {
  createRoot(stage).render(<Live more={stage.dataset.liveBar === 'more'} />)
}

// More is a menu, so it opens the way a person opens it — after React has committed the row, which takes a second
// pass: the bar is only drawn once the stage has been measured. On a screen with no coarse pointer there is no More
// key and nothing to open, and the poll simply runs out; the bar there already shows everything it has.
let tries = 20
const openMore = () => {
  const closed = document.querySelectorAll<HTMLButtonElement>('[data-live-bar="more"] .nt-main button[aria-haspopup="menu"][aria-expanded="false"]:not(.nt-drop)')
  for (const btn of closed) btn.click()
  if (!closed.length && tries-- > 0) requestAnimationFrame(openMore)
}
requestAnimationFrame(openMore)
