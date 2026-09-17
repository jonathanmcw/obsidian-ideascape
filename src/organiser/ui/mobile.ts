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

/** Keep a one-finger map gesture inside Ideascape, instead of also feeding Obsidian's global sidebar swipe. */
export function claimMapTouch(event: { pointerType: string; stopPropagation(): void }): boolean {
  if (event.pointerType !== 'touch') return false
  event.stopPropagation()
  return true
}
