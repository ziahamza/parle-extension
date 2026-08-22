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
    expect(pillSource).toMatch(/pixelsOf\(\s*park,\s*MARK_SIZE,\s*visibleViewport\(\)/)
    expect(pillSource).toMatch(/parkFromPixels\(\s*left,\s*top,\s*MARK_SIZE,\s*visibleViewport\(\)/)
    expect(pillSource).toMatch(/const view = visibleViewport\(\)[\s\S]*?view\.width - MARK_SIZE[\s\S]*?view\.height - MARK_SIZE/)
    // `holdRoom` legitimately keys the 640px docked boundary on innerWidth; the
    // mark's geometry must not.
    expect(pillSource).not.toMatch(/window\.inner(Width|Height)\s*-\s*MARK_SIZE/)
    expect(pillSource).not.toMatch(/(width|height):\s*window\.inner(Width|Height)/)
  })
})
