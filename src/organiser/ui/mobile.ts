export const PHONE_STAGE_MAX = 600

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
  if (nodeTop < top) return top - nodeTop
  if (nodeBottom > bottom) return bottom - nodeBottom
  return 0
}

/** Keep a one-finger map gesture inside Ideascape, instead of also feeding Obsidian's global sidebar swipe. */
export function claimMapTouch(event: { pointerType: string; stopPropagation(): void }): boolean {
  if (event.pointerType !== 'touch') return false
  event.stopPropagation()
  return true
}
