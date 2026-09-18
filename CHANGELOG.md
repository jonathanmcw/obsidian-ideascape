# Changelog

What changed in each release of Ideascape, newest first. The layout follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Only changes you can see or that touch your notes are listed; work on the checks and the screenshots is in the commit history.

## [Unreleased]

### Added

- The layout block's format version is now a promise. A map written by a newer Ideascape opens in this one, and any fields this one does not know are kept and written back rather than dropped, with the newer version number left as it was.

### Changed

- Export is no longer marked beta. `.canvas`, Markdown and OPML exports are now held to the whole map: folded branches, deep nesting and large maps are included, and free links are kept in `.canvas` and counted where a format cannot hold them.
- Opening one of your own notes as a map is no longer marked beta. It still asks before it rewrites anything, says how many lines, and offers **Convert a copy**. Dropped and pasted content stays beta.
- An exported picture of a large map is drawn at the largest scale the device can hold, and the export sheet says when that is less than 2×. A map too large for any scale says so in words.
- Exported file names keep letters of every script and are cut at 120 bytes. A title such as 旅行計画 used to export as `untitled`, and Café as `caf`.

### Fixed

- The welcome window's three pictures show what they describe again. Since 0.9.4 each showed the welcome window inside itself, and the third pointed at a menu that was not there.
- Fenced code under a node is kept whole. A `^word` inside it could be taken as the node's block id, a list line inside it could become a node, and a tab inside it was written back as spaces.
- Attaching an image to a node that quotes embed syntax as code (`` `![[photo.png]]` ``) removed the quoted text.
- A note's frontmatter is kept line for line. Blank lines before the closing `---` were trimmed, and an `ideascape:` marker whose value ran over several lines was left as broken YAML.
- A paste that had to wait for the clipboard — a phone asks first — could write the map as it was before a sync, or into another note opened meanwhile. It now says the map changed and pastes nothing, as a cut already did.
- A layout block that stops being readable while its map is open (a merge's conflict markers, say) is said once, instead of positions and folds silently not saving.
- Highlight, code and link formatting can be taken back with ⌘Z. Undo used to remove the typing and leave the formatting standing.
- Exporting a picture of a large map did nothing, and did not say why.
- Exported pictures had a part-transparent seam down the right edge.
- A node with no text was drawn in full ink in an exported picture, where the screen shows it muted.
- An OPML export of a map whose centre has no text was titled "Untitled" rather than the map's name.
- Converting a note whose list is indented more widely than Ideascape writes it could move the note's own text out of the list on the first save, and into the last node on the second.
- Converting a note with a paragraph carrying a block id on the line under the heading escaped the id, so links to it stopped landing.
- Converting a note with empty frontmatter gave it a second frontmatter block and two stray rules, without asking.
- ⌘A inside a node, and F2 opening one, select that node's text only. If focus had slipped to a toolbar button they could select the whole view.

## [0.9.5] - 2026-09-18

Almost all of this is the phone and the tablet, found by using one. The nine 0.9.5-beta builds are folded in here.

### Added

- Moving a row in or out a level is in the phone's editing dock. A soft keyboard has no Tab.
- Delete is in the dock's More panel, with **Undo** offered for five seconds afterwards rather than a question beforehand.
- A dock with a tablet's width shows the keys a phone folds under ⋯.
- Mobile screenshots on the listing.

### Changed

- A finger on a list scrolls it. Reordering waits for the finger to rest on a row, so scrolling no longer picks rows up by accident.
- A flick carries on and slows, and stops when you touch it.
- Focus takes the keyboard with it, so the arrow keys move between nodes rather than along the toolbar. With no node selected it falls back to the one you last typed into, then the root. It sits beside the Map/Outline toggle at every width.
- Fit joined the zoom steps in the corner. Alignment is one key that shows the current alignment, with its menu over that key.
- The Free layout joins children from the sides, as the tidy layout does, instead of drawing lines from all four.
- The note's name stands in the canvas corner on every screen.
- Bold is no longer offered on the root, where it could only edit the file.

### Fixed

- An image could be copied into a node that never had one: pressing Return for a new node and typing a character fetched the previous node's picture. This was the only fault in this release that damaged a note.
- The last row of an outline was hidden behind Obsidian's navigation bar, or behind the editing dock. The bar's reach is measured now rather than assumed.
- The dock sat a finger's width above the keyboard. It sits on it, and the row you are typing into settles where you can read it.
- A finger the system takes away (a long press, a photo picker, a share sheet) was remembered forever, which made a thumb zoom a map it meant to pan.
- A long press was also a tap, which raised the keyboard and the context menu together on Android.

## [0.9.4] - 2026-09-18

Mostly a phone and keyboard release.

### Added

- Every built-in chord is a command, so its keys can be reassigned in Settings → Hotkeys: editing, bold, italic, underline, zoom, and moving a node up or down.
- In the outline on a phone or tablet, swiping a row right or left moves it in or out a level, and a labelled Move menu offers Up, Down, Outdent and Indent.
- Escape cancels a gesture.

### Changed

- Dragging in the outline tells "between these two rows" from "inside this one". The top and bottom edges of a row place the branch above or below it, the middle makes it a child, and the two look different while you drag.
- Corner shape, type scale, icon weight and animation speed come from Obsidian's own variables, and the map reads your background colours the way Obsidian's Canvas does.
- On a phone, the editing dock draws its icons at Obsidian's mobile size, overflow comes before New line, and editing stays anchored above the keyboard.
- Return behaves like an outliner's on a phone, and line breaks still work.

### Fixed

- The zoom, undo and redo buttons are back on phones and tablets. A stylesheet mistake in 0.9.3 hid them.
- Tooltip and touch-copy fixes.

## [0.9.3] - 2026-09-17

### Changed

- The editing toolbar docks above the phone keyboard and follows the visual viewport. Desktop keeps the floating toolbar.
- Markdown export is one predictable nested-list format.
- Mobile zoom, history and help controls match Obsidian Canvas sizing.
- Screenshots and the animated showcase were retaken.

### Fixed

- A one-finger drag pans the map without also opening Obsidian's sidebars.
- The export and shortcuts dialogs fit and scroll on narrow screens.
- The release check catches the CSS patterns Obsidian's scanner had flagged.

## [0.9.2] - 2026-09-17

### Changed

- The README and the listing lead with keyboard-first mapping and the outline view, and mark converting an existing note, import and export as beta.
- The directory icon is the same lightbulb as the ribbon button.

### Fixed

- New nodes could be drawn too narrow for their text. When the canvas used for measuring text lost its context it reported every width as 0, and those zeros were cached. A 0 for visible text now replaces the canvas and clears the cache.

## [0.9.1] - 2026-09-16

Prepared for the Obsidian community directory.

### Added

- The community-directory icon.

### Changed

- The README says that clipboard access is used only to copy, cut and paste branches.
- The README introduction and showcase were refined.

### Fixed

- The plugin review's fixable warnings about DOM creation, CSS specificity and layout properties.

## [0.9.0] - 2026-09-16

First public beta.

### Added

- A note as a mind map: the heading is the centre and a nested list is the tree. The map is kept in the note itself, with a small layout block at the end, so the note still opens, searches and syncs like any other.
- Building from the keyboard: Tab adds a child, Enter a sibling, and typing replaces the text. Bold, italic, headings, checkboxes, numbered items, links and tags work inside nodes.
- The same note as an outline, one key away. Fold, focus and find work in both views.
- Themes that follow your vault, or Paper, Slate, Graphite or Midnight pinned to one map.
- Opening an existing note as a map from its menu. Pasting Markdown lists, dropping in OPML or Canvas files, and exporting PNG, Markdown, OPML or JSON Canvas.
- No network requests. Everything happens on your machine.
- Narrow panes and small windows: the switcher stays at the top left, the layout tools fold into the ⋯ menu, and zoom, undo and help sit in one column at the bottom right.

[Unreleased]: https://github.com/jonathanmcw/obsidian-ideascape/compare/0.9.5...HEAD
[0.9.5]: https://github.com/jonathanmcw/obsidian-ideascape/compare/0.9.4...0.9.5
[0.9.4]: https://github.com/jonathanmcw/obsidian-ideascape/compare/0.9.3...0.9.4
[0.9.3]: https://github.com/jonathanmcw/obsidian-ideascape/compare/0.9.2...0.9.3
[0.9.2]: https://github.com/jonathanmcw/obsidian-ideascape/compare/0.9.1...0.9.2
[0.9.1]: https://github.com/jonathanmcw/obsidian-ideascape/compare/0.9.0...0.9.1
[0.9.0]: https://github.com/jonathanmcw/obsidian-ideascape/releases/tag/0.9.0
