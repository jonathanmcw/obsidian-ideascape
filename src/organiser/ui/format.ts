// obsidian: inline formatting while editing a node. The label is a WYSIWYG contenteditable
// (see wysiwyg.ts); bold, italic, underline and strike use the browser's own commands, the
// rest wrap the selection in an element. Every path fires `input`, which the draft listens to.
import { toggleInline } from './wysiwyg.ts'

export type Format = 'bold' | 'italic' | 'underline' | 'strike' | 'highlight' | 'code' | 'link'

/** The name, and the keys when there are any — the bar's tip shows them apart. */
export const FORMAT_LABEL: Record<Format, { title: string; keys?: string }> = {
  bold: { title: 'Bold', keys: '⌘B' },
  italic: { title: 'Italic', keys: '⌘I' },
  underline: { title: 'Underline', keys: '⌘U' },
  strike: { title: 'Strikethrough' },
  highlight: { title: 'Highlight' },
  code: { title: 'Code' },
  link: { title: 'Link to a note' },
}

/** The node label being edited, if the caret is in one. `root` is the document the map is in: a popped-out
 *  window has its own, and the global `document` stays the main window's. */
export function activeLabel(root: Document = document): HTMLElement | null {
  const el = root.activeElement as HTMLElement | null
  // nodeType, not instanceof: an element in a popped-out window is not this window's HTMLElement.
  return el?.nodeType === 1 && el.classList.contains('node-label') && el.isContentEditable ? el : null
}

/** Select everything in the node label being typed into — ⌘A, and F2 opening a node with all its text selected.
 *  A range over the label's own contents, rather than the document's `selectAll` command: it selects the label
 *  and nothing else, so focus that has slipped out of it (to a toolbar button) cannot turn ⌘A into a selection
 *  of the whole view. */
export function selectAllIn(root: Document = document): boolean {
  const label = activeLabel(root)
  if (!label) return false
  const doc = label.ownerDocument
  const sel = doc.defaultView?.getSelection()
  if (!sel) return false
  const range = doc.createRange()
  range.selectNodeContents(label)
  sel.removeAllRanges()
  sel.addRange(range)
  return true
}

/** Insert a real Markdown line break at the caret without leaving the node. The mobile toolbar keeps the label
 *  focused on pointer-down, so this is the touch equivalent of Shift+Enter on a physical keyboard. */
export function insertLineBreak(root: Document = document): boolean {
  const label = activeLabel(root)
  if (!label) return false
  // execCommand is deprecated, and kept on purpose: it is the only insert that joins the browser's own undo
  // history, which is what ⌘Z takes back inside a label (see map-view.ts, where ⌘Z is handed to the browser
  // once something has been typed). MDN keeps this exact use as one the platform has no replacement for.
  label.ownerDocument.execCommand('insertText', false, '\n')
  return true
}

export function applyFormat(f: Format, root: Document = document): boolean {
  const label = activeLabel(root)
  if (!label) return false
  const doc = label.ownerDocument
  // These four are the browser's own commands, deprecated and kept on purpose: they are what puts the change in
  // the undo history ⌘Z reads inside a label. The three below wrap the selection themselves and so cannot be
  // taken back that way — the standing difference this editor lives with. `styleWithCSS` off asks for <b>/<i>
  // tags rather than styled spans; the reader (wysiwyg.ts `lookOf`) understands both either way.
  doc.execCommand('styleWithCSS', false, 'false')
  switch (f) {
    case 'bold':
      doc.execCommand('bold')
      break
    case 'italic':
      doc.execCommand('italic')
      break
    case 'underline':
      doc.execCommand('underline')
      break
    case 'strike':
      doc.execCommand('strikeThrough')
      break
    case 'highlight':
      toggleInline(label, 'mark')
      return true
    case 'code':
      toggleInline(label, 'code')
      return true
    case 'link':
      toggleInline(label, 'a', { class: 'node-link', 'data-wiki': '1' })
      return true
  }
  label.dispatchEvent(new (doc.defaultView?.Event ?? Event)('input', { bubbles: true }))
  return true
}
