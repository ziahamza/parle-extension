/**
 * Where the reader parked the on-page mark.
 *
 * A corner preference expressed as fractions of the viewport (0..1), not pixels:
 * a phone and a wide monitor then keep the same relative place, and a resize
 * cannot shove the mark off-screen. Defaults to the top-right — where the mark
 * lived before it was draggable — so a reader who never moves it sees nothing
 * change.
 *
 * Pure data and guards only. Persistence lives in `markParkStore.ts` and runs
 * in the background, so this file can be imported by the injected surface
 * without dragging Effect into every page.
 */
import { type Json, isNumber, isPlainObject, propertyOf } from "@parle/domain/Refine"

/** Fractions of the viewport; (1, 0) is the historic top-right default. */
export interface MarkPark {
  readonly x: number
  readonly y: number
}

export const DEFAULT_MARK_PARK: MarkPark = { x: 1, y: 0 }

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

export const parkOf = (x: number, y: number): MarkPark => ({
  x: clamp01(x),
  y: clamp01(y)
})

export const isMarkPark = (raw: Json): raw is MarkPark => {
  if (!isPlainObject(raw)) return false
  const x = propertyOf(raw, "x")
  const y = propertyOf(raw, "y")
  return isNumber(x) && Number.isFinite(x)
    && isNumber(y) && Number.isFinite(y)
}

export const readPark = (text: string): MarkPark | null => {
  try {
    const raw: Json = JSON.parse(text)
    if (!isMarkPark(raw)) return null
    return parkOf(raw.x, raw.y)
  } catch {
    return null
  }
}

/**
 * Pixel position for a mark of a given size, with a small margin from the edges.
 *
 * `x = 1, y = 0` lands where the old `top/right: 16px` rule put it.
 */
export const pixelsOf = (
  park: MarkPark,
  size: number,
  viewport: { readonly width: number; readonly height: number },
  margin = 16
) => {
  const maxLeft = Math.max(margin, viewport.width - size - margin)
  const maxTop = Math.max(margin, viewport.height - size - margin)
  return {
    left: Math.round(margin + park.x * (maxLeft - margin)),
    top: Math.round(margin + park.y * (maxTop - margin))
  }
}

/** Invert {@link pixelsOf}: where the reader put a mark, as fractions. */
export const parkFromPixels = (
  left: number,
  top: number,
  size: number,
  viewport: { readonly width: number; readonly height: number },
  margin = 16
): MarkPark => {
  const maxLeft = Math.max(margin, viewport.width - size - margin)
  const maxTop = Math.max(margin, viewport.height - size - margin)
  const spanX = Math.max(1, maxLeft - margin)
  const spanY = Math.max(1, maxTop - margin)
  return parkOf((left - margin) / spanX, (top - margin) / spanY)
}
