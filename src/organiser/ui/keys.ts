// The Shortcuts sheet's content and the pure helpers around it: platform key names and the filter.
// No React and no Obsidian here, so the tests can import it directly.

/** One row. `keys` lists alternatives ("or"); each alternative is a list of caps, one cap per key. */
export type Shortcut = { keys: string[][]; label: string; words?: string[]; mouse?: true }

export type ShortcutGroup = { title: string; rows: Shortcut[] }

// Rows are written in Mac notation; capLabel and platformCaps translate them for everyone else.
// A range or a run of letters after one modifier (⌥⌘ 1–3, ⌘ B I U) stays compact, the way the
// long form would push every label in its group onto two lines.

/** The six things worth knowing first, shown in a strip above the groups. */
export const ESSENTIALS: Shortcut[] = [
  { keys: [['Tab']], label: 'Add child' },
  { keys: [['Enter']], label: 'Add sibling' },
  { keys: [['type']], label: 'Replace text', words: ['typing', 'overwrite', 'letter'] },
  { keys: [['⌘', 'E']], label: 'Edit text', words: ['rename', 'caret', 'cursor'] },
  { keys: [['Esc']], label: 'Leave node', words: ['exit', 'stop editing', 'deselect'] },
  { keys: [['⌘', '.']], label: 'Fold branch', words: ['collapse', 'expand', 'unfold'] },
]

export const GROUPS: ShortcutGroup[] = [
  // Ordered so the three flowed columns come out even: Build and Fold · Move and Format · View and Mouse.
  {
    title: 'Build',
    rows: [
      { keys: [['Tab']], label: 'Add child', words: ['new node', 'indent'] },
      { keys: [['⇧', 'Tab']], label: 'Move out a level', words: ['outdent', 'unindent', 'parent'] },
      { keys: [['Enter']], label: 'Add sibling', words: ['new node'] },
      { keys: [['⇧', 'Enter']], label: 'New line in node', words: ['line break', 'newline', 'soft return'] },
      { keys: [['⌫']], label: 'Delete branch', words: ['remove', 'node'] },
      { keys: [['⌘', 'Enter']], label: 'Toggle checkbox', words: ['task', 'todo', 'tick', 'done'] },
      { keys: [['⇧', '⌘', '7']], label: 'Toggle numbered item', words: ['numbered list', 'ordered', 'bullet'] },
      { keys: [['⌘', 'Z']], label: 'Undo', words: ['revert'] },
      { keys: [['⇧', '⌘', 'Z']], label: 'Redo' },
    ],
  },
  {
    title: 'Fold and focus',
    rows: [
      { keys: [['⌘', '.']], label: 'Fold or unfold', words: ['collapse', 'expand', 'hide children'] },
      { keys: [['⌥', '⌘', 'F']], label: 'Focus on branch', words: ['isolate', 'hoist'] },
    ],
  },
  {
    title: 'Move and select',
    rows: [
      { keys: [['↑', '↓', '←', '→']], label: 'Move selection', words: ['navigate'] },
      { keys: [['⇧', '+ arrows']], label: 'Extend selection', words: ['multiple', 'several'] },
      { keys: [['⌘', 'A']], label: 'Select all', words: ['everything'] },
      { keys: [['⌘', '↑'], ['⌘', '↓']], label: 'Reorder siblings', words: ['move up', 'move down'] },
      { keys: [['⌘', 'F']], label: 'Find in map', words: ['search'] },
      { keys: [['⌘', 'C', 'X', 'V']], label: 'Copy, cut, paste branches', words: ['clipboard', 'duplicate'] },
      { keys: [['⌥', '+ arrows']], label: 'Nudge branch (Free layout)', words: ['move', 'position'] },
    ],
  },
  {
    title: 'Format while typing',
    rows: [
      { keys: [['⌘', 'B', 'I', 'U']], label: 'Bold, italic, underline', words: ['style', 'emphasis'] },
      { keys: [['⌥', '⌘', '1–3']], label: 'Heading 1 to 3', words: ['size', 'title', 'h1', 'h2', 'h3'] },
      { keys: [['⌥', '⌘', '0']], label: 'Body text', words: ['heading', 'size', 'paragraph', 'normal'] },
      { keys: [['⇧', '⌘', 'L', 'E', 'R']], label: 'Align left, centre, right', words: ['alignment', 'center'] },
      { keys: [['⇧', '⌘', 'V']], label: 'Paste as plain text', words: ['unformatted', 'clipboard'] },
      { keys: [['type #tag']], label: 'Tag a node', words: ['hashtag'] },
      { keys: [['type [[']], label: 'Link a note', words: ['wikilink', 'backlink'] },
    ],
  },
  {
    title: 'View',
    rows: [
      { keys: [['⌘', '1']], label: 'Show map', words: ['mind map', 'canvas'] },
      { keys: [['⌘', '2']], label: 'Show outline', words: ['outliner', 'list'] },
      { keys: [['⌘', '3']], label: 'Switch layout', words: ['mind map', 'free', 'tidy'] },
      { keys: [['⌘', '/']], label: 'Toggle document panel', words: ['inspector', 'theme', 'style', 'sidebar'] },
      { keys: [['⌥', '⌘', '=']], label: 'Zoom in', words: ['magnify', 'bigger', 'fit'] },
      { keys: [['⌥', '⌘', '-']], label: 'Zoom out', words: ['smaller', 'fit'] },
      { keys: [['⇧', '⌘', '0']], label: 'Fit map', words: ['zoom', 'reset', 'whole map'] },
    ],
  },
  {
    title: 'Mouse',
    rows: [
      { keys: [['double-click']], label: 'Edit node', words: ['rename'], mouse: true },
      { keys: [['drag +']], label: 'Pull out a new idea', words: ['handle', 'knob', 'child'], mouse: true },
      { keys: [['drag node']], label: 'Move or reparent', words: ['reorder', 'drop'], mouse: true },
      { keys: [['drag empty space']], label: 'Select several', words: ['marquee', 'lasso', 'box', 'multiple'], mouse: true },
      { keys: [['scroll']], label: 'Pan the map', words: ['trackpad', 'move'], mouse: true },
      { keys: [['⌘', 'scroll']], label: 'Zoom the map', words: ['pinch'], mouse: true },
    ],
  },
]

const signature = (r: Shortcut) => r.keys.map((k) => k.join(' ')).join(' or ')

/** What the filter searches: the groups, plus the essentials that have no row of their own (⌘E, Esc, typing),
 *  since the strip hides while filtering and "esc" should still find something. */
export const SEARCHABLE: ShortcutGroup[] = [
  { title: 'Essentials', rows: ESSENTIALS.filter((e) => !GROUPS.some((g) => g.rows.some((r) => signature(r) === signature(e)))) },
  ...GROUPS,
]

const MODIFIERS = ['⌘', '⌥', '⇧']

const OTHER_PLATFORMS: Record<string, string> = { '⌘': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift', '⌫': 'Backspace' }

/** What a cap reads on this platform. Arrows and letters are the same everywhere. */
export function capLabel(cap: string, mac: boolean): string {
  return mac ? cap : OTHER_PLATFORMS[cap] ?? cap
}

/** One alternative's caps in the platform's own order: ⇧⌘Z on a Mac, Ctrl Shift Z elsewhere. */
export function platformCaps(caps: string[], mac: boolean): string[] {
  if (mac) return caps
  const mods = caps.filter((c) => MODIFIERS.includes(c)).sort((a, b) => MODIFIERS.indexOf(a) - MODIFIERS.indexOf(b))
  return [...mods, ...caps.filter((c) => !MODIFIERS.includes(c))]
}

/** Whether a token is drawn as a key cap. Gestures and typed text (lowercase: "scroll", "type #tag", "+ arrows") are plain text. */
export function isCap(token: string, mouse?: boolean): boolean {
  if (MODIFIERS.includes(token)) return true
  return !mouse && !/^[a-z+#[]/.test(token)
}

// The names people say out loud, so "shift tab" or "ctrl z" finds the row without typing a symbol.
const SPOKEN: Record<string, string> = {
  '⌘': 'cmd command ctrl control mod',
  '⌥': 'alt option opt',
  '⇧': 'shift',
  '⌫': 'delete backspace del',
  Tab: 'tab',
  Enter: 'enter return',
  Esc: 'esc escape',
  '↑': 'up arrow',
  '↓': 'down arrow',
  '←': 'left arrow',
  '→': 'right arrow',
  '.': 'period dot',
  '/': 'slash',
  '?': 'question mark',
  '=': 'equals plus',
  '-': 'minus hyphen',
}

function haystack(group: ShortcutGroup, row: Shortcut): string {
  const caps = row.keys.flat()
  return [group.title, row.label, ...(row.words ?? []), ...caps, ...caps.map((c) => SPOKEN[c] ?? '')].join(' ').toLowerCase()
}

/** The groups narrowed to rows that hold every word of the query; groups left empty drop out. A single character
 *  names a key ("ctrl z", "shift 7"), so it matches a cap exactly rather than every label with a z in it. */
export function filterGroups(groups: ShortcutGroup[], query: string): ShortcutGroup[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return groups
  const matches = (g: ShortcutGroup, r: Shortcut) => {
    const text = haystack(g, r)
    return terms.every((t) => (t.length === 1 ? r.keys.some((k) => k.some((c) => c.toLowerCase() === t)) : text.includes(t)))
  }
  return groups.map((g) => ({ title: g.title, rows: g.rows.filter((r) => matches(g, r)) })).filter((g) => g.rows.length > 0)
}

/** Whether shortcuts read with ⌘ and ⌥. obsidian: the page body carries mod-macos on a Mac and is-ios on an iPad or
 *  iPhone, whose keyboards use ⌘ too. Without a page (tests), the Mac spelling. */
export function macKeys(): boolean {
  const body = typeof activeDocument === 'undefined' ? null : activeDocument.body?.classList
  return !body || body.contains('mod-macos') || body.contains('is-ios')
}

/** A chord written the Mac way, as the keyboard in use spells it: `⇧⌘L` on a Mac, `Ctrl+Shift+L` elsewhere. Chords
 *  separated by spaces are spelled one by one; what is not a glyph (Enter, 0–3, a letter, an arrow) stays as it is. */
export function chord(keys: string, mac = macKeys()): string {
  if (mac) return keys
  return keys
    .split(' ')
    .map((part) => {
      const chars = [...part]
      const mods = MODIFIERS.filter((m) => chars.includes(m)).map((m) => OTHER_PLATFORMS[m])
      const rest = chars.filter((c) => !MODIFIERS.includes(c)).join('')
      return [...mods, OTHER_PLATFORMS[rest] ?? rest].filter(Boolean).join('+')
    })
    .join(' ')
}
