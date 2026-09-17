import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { IODoc, LayoutKind } from '../model/types'
import { download, droppedLinkCount, slug, toMarkdown, toOPML, toPNG } from '../model/exporters'
import { toJSONCanvas } from '../model/jsoncanvas'
import { IconClose } from './Icons'

interface Props {
  doc: IODoc
  kind: LayoutKind
  themeId: string
  nodeStyle: 'bar' | 'outline' | 'filled'
  /** obsidian: the map's own branch colours (branch indices 8 and up) */
  palette?: string[]
  resolveEmbed?: (file: string) => { url: string; kind: 'image' | 'audio' } | null
  onClose: () => void
}

/** One format to export. The row's action is a real button filling the row. */
function Row({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  const [interaction, setInteraction] = useState<'hovered' | 'active' | null>(null)
  return (
    <div className={`export-row${disabled ? ' is-disabled' : interaction ? ` is-${interaction}` : ''}`}>
      <button
        className="export-hit"
        disabled={disabled}
        onClick={onClick}
        onPointerEnter={(event) => setInteraction(event.pointerType === 'touch' ? null : 'hovered')}
        onPointerLeave={() => setInteraction(null)}
        onPointerDown={() => setInteraction('active')}
        onPointerUp={(event) => setInteraction(event.pointerType === 'touch' ? null : 'hovered')}
        onPointerCancel={() => setInteraction(null)}
      >
        {children}
      </button>
    </div>
  )
}

export function ExportSheet({ doc, kind, themeId, nodeStyle, palette, resolveEmbed, onClose }: Props) {
  const shape = kind === 'canvas' ? 'map-free' : kind === 'org' ? 'map-org' : kind
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const name = slug(doc.name)
  const dropped = droppedLinkCount(doc)
  // Keys go to the sheet while it is open: Enter presses the row it is on, not a node behind the scrim.
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    dialog.current?.focus({ preventScroll: true })
  }, [])

  const save = (filename: string, data: string, mime: string) => {
    setProblem(null)
    void download(filename, data, mime).then(setProblem)
  }

  const png = async () => {
    setBusy('png')
    setProblem(null)
    try {
      setProblem(await download(`${name}-${shape}.png`, await toPNG(doc, kind, themeId, nodeStyle, 2, resolveEmbed, palette)))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div ref={dialog} tabIndex={-1} style={{ outline: 'none' }} className="sheet" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Export">
        <div className="sheet-head">
          <h2>Export “{doc.name}”</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        <div className="sheet-body">
          <Row onClick={() => save(`${name}.canvas`, toJSONCanvas(doc), 'application/json')}>
            <span className="export-ext">.canvas</span>
            <span>
              <b>JSON Canvas</b>
              <small>The open format (jsoncanvas.org). Opens in Obsidian; the tree survives as edge and order metadata other apps ignore.</small>
            </span>
          </Row>

          <Row onClick={() => save(`${name}.md`, toMarkdown(doc), 'text/markdown')}>
            <span className="export-ext">.md</span>
            <span>
              <b>Markdown</b>
              <small>A nested list with every level kept, to open in Obsidian, Logseq or Workflowy. Positions, colours and free links stay in the map.</small>
            </span>
          </Row>

          <Row onClick={() => save(`${name}.opml`, toOPML(doc), 'text/x-opml')}>
            <span className="export-ext">.opml</span>
            <span>
              <b>OPML</b>
              <small>For outliners and mind-map apps that speak OPML.</small>
            </span>
          </Row>

          <Row onClick={() => void png()} disabled={busy === 'png'}>
            <span className="export-ext">.png</span>
            <span>
              <b>Image</b>
              <small>The current shape ({kind === 'canvas' ? 'map, free layout' : kind === 'org' ? 'map, org chart' : kind}), at 2×, in the current theme.</small>
            </span>
          </Row>
        </div>

        {problem && <p className="sheet-note is-problem">{problem}</p>}

        {dropped > 0 && (
          <p className="sheet-note">
            {dropped} free {dropped === 1 ? 'link' : 'links'} will be dropped from the Markdown and OPML exports — neither
            format has an equivalent. They survive in <b>.canvas</b>.
          </p>
        )}
      </div>
    </div>
  )
}
