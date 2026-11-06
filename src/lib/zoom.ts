/**
 * Whole-window interface zoom, in percent. The webview scales everything (text, grids, hit
 * targets and pointer coordinates alike), so layout code keeps working in CSS pixels.
 */

import { parseShortcut, type Shortcut } from "./shortcuts"

/** The levels zooming steps through. At 175% the minimum window is still ~550 CSS px wide. */
export const ZOOM_LEVELS = [80, 90, 100, 110, 125, 150, 175] as const

export const DEFAULT_ZOOM = 100

export type ZoomAction = "in" | "out" | "reset"

/**
 * Browser zoom keys, matched by physical key: Mod+= (with or without Shift, which is Mod++ on a
 * US layout) zooms in, Mod+- out, Mod+0 back to 100%, and the keypad's +, - and 0 do the same.
 * The first of each is the one shown in hints.
 */
export const ZOOM_SHORTCUTS: Readonly<Record<ZoomAction, readonly Shortcut[]>> = {
  in: ["Mod+=", "Mod+Shift+=", "Mod+NumpadAdd"].map(parseShortcut),
  out: ["Mod+-", "Mod+NumpadSubtract"].map(parseShortcut),
  reset: ["Mod+0", "Mod+Numpad0"].map(parseShortcut),
}

/**
 * The zoom after `action` from `current`: the next level up or down, or the default. A value
 * between two levels (a hand-edited settings file) steps to the nearest level in that direction;
 * the ends stay where they are.
 */
export function stepZoom(current: number, action: ZoomAction): number {
  if (action === "reset") return DEFAULT_ZOOM
  if (action === "in") return ZOOM_LEVELS.find((level) => level > current) ?? ZOOM_LEVELS.at(-1)!
  return ZOOM_LEVELS.findLast((level) => level < current) ?? ZOOM_LEVELS[0]
}

/** "125%" */
export function formatZoom(percent: number): string {
  return `${percent}%`
}
