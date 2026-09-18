export const PHONE_STAGE_MAX = 600
/** A docked bar this wide has room for what a phone hides under More. Twelve 44px keys and their gaps come to
 *  roughly 580px; below that the bar keeps the phone's short row rather than crowding. */
export const ROOMY_DOCK_MIN = 700

/** Phone-specific UI needs both touch input and a phone-width map. A narrow desktop split stays desktop-like,
 *  while an iPad keeps the roomier touch treatment. */
export function isPhoneTouch(coarse: boolean, stageWidth: number, phoneDevice = false): boolean {
  return coarse && stageWidth > 0 && (phoneDevice || stageWidth <= PHONE_STAGE_MAX)
}

/** How much of the map's layout viewport is covered by the visual viewport (normally the software keyboard). */
export function viewportOcclusion(rootBottom: number, viewportOffsetTop: number, viewportHeight: number): number {
  return Math.max(0, Math.round(rootBottom - (viewportOffsetTop + viewportHeight)))
}

/** The part of a stage that the visual viewport can actually show, in stage-local coordinates. Intersecting the
 *  two rectangles avoids subtracting the keyboard twice when Obsidian has already resized the stage for it. */
export function stageViewportBand(stageTop: number, stageBottom: number, viewportTop: number, viewportHeight: number): { top: number; bottom: number } {
  const height = Math.max(0, stageBottom - stageTop)
  const top = Math.min(height, Math.max(0, Math.max(stageTop, viewportTop) - stageTop))
  const bottom = Math.min(height, Math.max(top, Math.min(stageBottom, viewportTop + viewportHeight) - stageTop))
  return { top: Math.round(top), bottom: Math.round(bottom) }
}

/** Maps keep their visual centre when their stage changes size. An outline is a top-anchored document, so a
 *  keyboard-height change must not recenter it vertically. */
export function stageResizeOffset(shape: 'map' | 'outline', widthDelta: number, heightDelta: number): { x: number; y: number } {
  return { x: widthDelta / 2, y: shape === 'outline' ? 0 : heightDelta / 2 }
}

/** The smallest camera movement that keeps a node inside the usable part of the stage. */
export function visibilityNudge(
  nodeTop: number,
  nodeBottom: number,
  visibleTop: number,
  visibleBottom: number,
  topPadding: number,
  bottomPadding: number,
): number {
  const top = visibleTop + topPadding
  const bottom = visibleBottom - bottomPadding
  // Nudging to one edge of a node taller than the band pushes the other edge out, and the next nudge (a keystroke
  // that wraps a line) would push it back: such a node gets one settled position instead.
  if (nodeBottom - nodeTop > bottom - top) return oversizedNudge(nodeTop, nodeBottom, top, bottom)
  if (nodeTop < top) return top - nodeTop
  if (nodeBottom > bottom) return bottom - nodeBottom
  return 0
}

/** Where a node taller than the usable band settles while it is typed into: its bottom edge, just above the keyboard,
 *  which is where the next line appears. The start of the text scrolls out of sight, and typing stays visible.
 *  Stable by construction — once applied, asking again returns 0, or every keystroke would move the camera. */
export function oversizedNudge(_nodeTop: number, nodeBottom: number, _top: number, bottom: number): number {
  return bottom - nodeBottom
}

/** Apple Notes' list gesture: a deliberate horizontal swipe changes nesting. A mostly vertical movement remains
 *  available to the outline's drag-and-drop reorder interaction. */
export function outlineSwipeAction(dx: number, dy: number, threshold = 48): 'indent' | 'outdent' | null {
  const x = Math.abs(dx)
  const y = Math.abs(dy)
  if (x < threshold || x < y * 1.35) return null
  return dx > 0 ? 'indent' : 'outdent'
}

/** Keep a one-finger map gesture inside Ideascape, instead of also feeding Obsidian's global sidebar swipe. */
export function claimMapTouch(event: { pointerType: string; stopPropagation(): void }): boolean {
  if (event.pointerType !== 'touch') return false
  event.stopPropagation()
  return true
}

/** Where the outline's scroll stops. The first row rests at the top margin, and the last stops at that same margin
 *  above the bottom of what can be seen — above the phone's editing dock when one stands there. Without the dock in
 *  the sum, the row being typed into sits behind it and no amount of scrolling brings it out, because the document
 *  has already reached its end. A document shorter than the view does not scroll at all. */
export function outlineScrollStop(y: number, visibleHeight: number, margin: number, dockInset: number, minY: number, maxY: number): number {
  const top = margin - minY
  const bottom = visibleHeight - margin - dockInset - maxY
  return !visibleHeight || bottom >= top ? top : Math.min(top, Math.max(bottom, y))
}

/** Where a row being typed into settles on a touch screen: as near the middle of what can be seen as its own height
 *  allows. A row is nudged only as far as it must be on a desktop, where the whole list is in view anyway — but on a
 *  phone the visible band is a few rows tall and a minimal nudge leaves the row hard against the dock, with the end
 *  of a long block out of sight. A row taller than the band keeps its bottom edge, which is where the next line
 *  appears; the start scrolls away, and typing stays visible. Stable by construction: asking again returns 0. */
export function centreNudge(nodeTop: number, nodeBottom: number, visibleTop: number, visibleBottom: number, bottomPadding: number): number {
  const bottom = visibleBottom - bottomPadding
  if (nodeBottom - nodeTop > bottom - visibleTop) return bottom - nodeBottom
  const wanted = visibleTop + (bottom - visibleTop - (nodeBottom - nodeTop)) / 2
  return Math.round(wanted - nodeTop)
}

/** Whether a docked bar has the width to show what a phone folds away — a tablet held in the hands, most often.
 *  Obsidian calls some tablets phones, so the dock is theirs; the room is not. */
export function roomyDock(docked: boolean, stageWidth: number): boolean {
  return docked && stageWidth >= ROOMY_DOCK_MIN
}

/** Which formatting keys a node's bar offers. The root is the map's title — the note's `# heading` — and is drawn at
 *  full weight whatever its text says, so Bold there cannot change anything a person can see while still writing
 *  `**` into the note. A key that only edits the file is worse than one that is missing, so it goes; on a phone,
 *  where Bold is the only key in the row, Italic takes its place rather than leaving a gap. */
export function formatsForNode(formats: readonly string[], isRoot: boolean): string[] {
  if (!isRoot) return [...formats]
  const kept = formats.filter((f) => f !== 'bold')
  return kept.length ? kept : ['italic']
}
