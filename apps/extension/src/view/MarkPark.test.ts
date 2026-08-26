import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"
import {
  DEFAULT_MARK_PARK,
  isMarkPark,
  parkFromPixels,
  parkOf,
  pixelsOf,
  readPark
} from "./MarkPark.ts"

describe("MarkPark", () => {
  it("defaults to the historic top-right corner", () => {
    expect(DEFAULT_MARK_PARK).toEqual({ x: 1, y: 0 })
  })

  it("clamps fractions into the unit square", () => {
    expect(parkOf(-1, 2)).toEqual({ x: 0, y: 1 })
  })

  it("round-trips pixels at the default corner", () => {
    const viewport = { width: 1280, height: 800 }
    const at = pixelsOf(DEFAULT_MARK_PARK, 36, viewport)
    expect(at.left).toBe(1280 - 36 - 16)
    expect(at.top).toBe(16)
    expect(parkFromPixels(at.left, at.top, 36, viewport)).toEqual(DEFAULT_MARK_PARK)
  })

  /**
   * `window.innerWidth` includes a classic scrollbar; `clientWidth` does not.
   * `pixelsOf` is pure, so this is the whole bug: feed it the inner box and a
   * 36px mark at `{x:1,y:0}` is 16px from the *window's* right edge, which is
   * the scrollbar. Feed it the client box and it lands where `right: 16px` did.
   *
   * 15px is Chrome's typical classic scrollbar on Linux. Remaining client-side
   * margin is then 1px, not 16px — and a 17px Windows scrollbar overlaps the
   * 36px box itself.
   */
  it("a 36px default park overlaps a classic scrollbar when the viewport is innerWidth", () => {
    const inner = { width: 1280, height: 800 }
    const linuxBar = 15
    const windowsBar = 17
    const againstInner = pixelsOf(DEFAULT_MARK_PARK, 36, inner)
    const markRight = againstInner.left + 36

    expect(markRight).toBe(inner.width - 16)
    expect((inner.width - linuxBar) - markRight).toBe(1)
    expect(markRight).toBeGreaterThan(inner.width - windowsBar)

    const client = { width: inner.width - linuxBar, height: inner.height }
    const againstClient = pixelsOf(DEFAULT_MARK_PARK, 36, client)
    expect(againstClient.left + 36).toBe(client.width - 16)
    expect(againstInner.left - againstClient.left).toBe(linuxBar)
    expect(parkFromPixels(againstClient.left, againstClient.top, 36, client))
      .toEqual(DEFAULT_MARK_PARK)
  })

  /**
   * PR #24 parks against `clientWidth`, still with MARK_SIZE=36. A Nature
   * article with HN + Reddit paints two 28px discs at -10px overlap plus 8px
   * padding: 54px. `{x:1,y:0}` then puts the 54px box at left=1228, right=1282
   * — 2px past a 1280px client. Feeding the painted width lands 16px in.
   */
  it("a 54px painted mark at the default park sits 16px inside a 1280px client", () => {
    const client = { width: 1280, height: 800 }
    const painted = 54
    const againstPainted = pixelsOf(DEFAULT_MARK_PARK, painted, client)
    expect(againstPainted.left).toBe(1210)
    expect(againstPainted.top).toBe(16)
    expect(againstPainted.left + painted).toBe(1264)
    expect(client.width - (againstPainted.left + painted)).toBe(16)

    const againstMarkSize = pixelsOf(DEFAULT_MARK_PARK, 36, client)
    expect(againstMarkSize.left + painted - client.width).toBe(2)
    expect(parkFromPixels(againstPainted.left, againstPainted.top, painted, client))
      .toEqual(DEFAULT_MARK_PARK)
  })

  it("reads a parked place from disk text and refuses garbage", () => {
    expect(readPark(JSON.stringify({ x: 0.25, y: 0.75 }))).toEqual({ x: 0.25, y: 0.75 })
    expect(readPark("{")).toBeNull()
    expect(isMarkPark({ x: "left", y: 0 })).toBe(false)
  })
})

/**
 * The caller, with its comments removed: a `/** … *\/` that *mentions*
 * `clientWidth` must not satisfy a check meant to prove the code *uses* it.
 */
const pillSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "entrypoints", "pill.content.ts"),
  "utf8"
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")

describe("pill.content feeds pixelsOf the client viewport", () => {
  it("measures the mark against documentElement.clientWidth/clientHeight at all three sites", () => {
    expect(pillSource).toMatch(/width:\s*document\.documentElement\.clientWidth/)
    expect(pillSource).toMatch(/height:\s*document\.documentElement\.clientHeight/)
    expect(pillSource).toMatch(/pixelsOf\(\s*park,\s*size,\s*visibleViewport\(\)/)
    expect(pillSource).toMatch(/parkFromPixels\(\s*left,\s*top,\s*size,\s*visibleViewport\(\)/)
    expect(pillSource).toMatch(/const view = visibleViewport\(\)[\s\S]*?view\.width - size[\s\S]*?view\.height - size/)
    // `holdRoom` legitimately keys the 640px docked boundary on innerWidth; the
    // mark's geometry must not.
    expect(pillSource).not.toMatch(/window\.inner(Width|Height)\s*-\s*MARK_SIZE/)
    expect(pillSource).not.toMatch(/(width|height):\s*window\.inner(Width|Height)/)
  })

  it("converts park fractions through the painted box, not MARK_SIZE, at all three sites", () => {
    expect(pillSource).toMatch(/Math\.max\(\s*MARK_SIZE,\s*\w+\.getBoundingClientRect\(\)\.width\s*\)/)
    expect(pillSource).toMatch(
      /const size = paintedSize\(\s*mark\s*\)[\s\S]{0,240}?pixelsOf\(\s*park,\s*size,\s*visibleViewport\(\)/
    )
    expect(pillSource).toMatch(
      /const size = paintedSize\(\s*button\s*\)[\s\S]{0,240}?view\.width - size[\s\S]{0,120}?view\.height - size/
    )
    expect(pillSource).toMatch(
      /const size = paintedSize\(\s*button\s*\)[\s\S]{0,240}?parkFromPixels\(\s*left,\s*top,\s*size,\s*visibleViewport\(\)/
    )
    expect(pillSource).not.toMatch(/pixelsOf\(\s*park,\s*MARK_SIZE,/)
    expect(pillSource).not.toMatch(/parkFromPixels\(\s*left,\s*top,\s*MARK_SIZE,/)
    expect(pillSource).not.toMatch(/view\.width - MARK_SIZE/)
  })
})

/**
 * `showPopover` UA styles centre with `inset: 0; margin: auto`. A comment that
 * *mentions* `bottom` or `margin` must not satisfy a check meant to prove
 * `placeMark` and drag both *write* them. Bounded gaps keep `pixelsOf` from
 * matching the drag assignments as if they were `placeMark`'s.
 */
describe("pill.content clears showPopover UA inset when parking the mark", () => {
  it("placeMark writes right, bottom, and margin after pixelsOf", () => {
    expect(pillSource).toMatch(
      /pixelsOf\(\s*park,\s*size,\s*visibleViewport\(\)\)[\s\S]{0,400}?mark\.style\.right\s*=\s*"auto"[\s\S]{0,120}?mark\.style\.bottom\s*=\s*"auto"[\s\S]{0,120}?mark\.style\.margin\s*=\s*"0"/
    )
  })

  it("bindDrag's onMove writes the same three so a drag cannot leave UA inset behind", () => {
    expect(pillSource).toMatch(
      /button\.style\.left\s*=\s*`\$\{left\}px`[\s\S]{0,120}?button\.style\.top\s*=\s*`\$\{top\}px`[\s\S]{0,120}?button\.style\.right\s*=\s*"auto"[\s\S]{0,120}?button\.style\.bottom\s*=\s*"auto"[\s\S]{0,120}?button\.style\.margin\s*=\s*"0"/
    )
  })
})
