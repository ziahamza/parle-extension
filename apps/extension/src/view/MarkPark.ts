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

/** Fractions of the viewport; (1, 0) is the historic top-right default. */
export interface MarkPark {
  readonly x: number
  readonly y: number
}

/** The mark's untransformed layout box. A Network stack is wider than it is tall. */
export interface MarkDimensions {
  readonly width: number
  readonly height: number
}

export const DEFAULT_MARK_PARK: MarkPark = { x: 1, y: 0 }

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

export const parkOf = (x: number, y: number): MarkPark => ({
  x: clamp01(x),
  y: clamp01(y)
})

export const isMarkPark = (raw: unknown): raw is MarkPark => {
  if (typeof raw !== "object" || raw === null) return false
  const held = raw as { x?: unknown; y?: unknown }
  return typeof held.x === "number" && Number.isFinite(held.x)
    && typeof held.y === "number" && Number.isFinite(held.y)
}

export const readPark = (text: string): MarkPark | null => {
  try {
    const raw: unknown = JSON.parse(text)
    if (!isMarkPark(raw)) return null
    return parkOf(raw.x, raw.y)
  } catch {
    return null
  }
}

/**
 * Pixel position for a mark of given dimensions, with a small margin from the edges.
 *
 * `x = 1, y = 0` lands where the old `top/right: 16px` rule put it. That rule
 * is measured against the visible client area (`documentElement.clientWidth` /
 * `clientHeight`), not `window.innerWidth` / `innerHeight`: those include a
 * classic scrollbar, and a 36px mark at the default park then sits on it.
 * The function itself stays a pure conversion of the numbers it is given.
 * A Network stack is wider than the 36px minimum but remains 36px tall, so x
 * must convert through its width while y converts through its height.
 */
export const pixelsOf = (
  park: MarkPark,
  dimensions: MarkDimensions,
  viewport: { readonly width: number; readonly height: number },
  margin = 16
): { readonly left: number; readonly top: number } => {
  const maxLeft = Math.max(margin, viewport.width - dimensions.width - margin)
  const maxTop = Math.max(margin, viewport.height - dimensions.height - margin)
  return {
    left: Math.round(margin + park.x * (maxLeft - margin)),
    top: Math.round(margin + park.y * (maxTop - margin))
  }
}

/** Invert {@link pixelsOf}: where the reader put a mark, as fractions. */
export const parkFromPixels = (
  left: number,
  top: number,
  dimensions: MarkDimensions,
  viewport: { readonly width: number; readonly height: number },
  margin = 16
): MarkPark => {
  const maxLeft = Math.max(margin, viewport.width - dimensions.width - margin)
  const maxTop = Math.max(margin, viewport.height - dimensions.height - margin)
  const spanX = Math.max(1, maxLeft - margin)
  const spanY = Math.max(1, maxTop - margin)
  return parkOf((left - margin) / spanX, (top - margin) / spanY)
}
