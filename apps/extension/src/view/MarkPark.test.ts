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
    const dimensions = { width: 36, height: 36 }
    const at = pixelsOf(DEFAULT_MARK_PARK, dimensions, viewport)
    expect(at.left).toBe(1280 - 36 - 16)
    expect(at.top).toBe(16)
    expect(parkFromPixels(at.left, at.top, dimensions, viewport)).toEqual(DEFAULT_MARK_PARK)
  })

  it("parks a two-Network mark with its width and height independently", () => {
    const viewport = { width: 1280, height: 800 }
    const dimensions = { width: 54, height: 36 }
    const park = { x: 1, y: 0.75 }

    const at = pixelsOf(park, dimensions, viewport)

    expect(at).toEqual({ left: 1210, top: 565 })
    expect(parkFromPixels(at.left, at.top, dimensions, viewport)).toEqual(park)
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
    const dimensions = { width: 36, height: 36 }
    const againstInner = pixelsOf(DEFAULT_MARK_PARK, dimensions, inner)
    const markRight = againstInner.left + 36

    expect(markRight).toBe(inner.width - 16)
    expect((inner.width - linuxBar) - markRight).toBe(1)
    expect(markRight).toBeGreaterThan(inner.width - windowsBar)

    const client = { width: inner.width - linuxBar, height: inner.height }
    const againstClient = pixelsOf(DEFAULT_MARK_PARK, dimensions, client)
    expect(againstClient.left + 36).toBe(client.width - 16)
    expect(againstInner.left - againstClient.left).toBe(linuxBar)
    expect(parkFromPixels(againstClient.left, againstClient.top, dimensions, client))
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
    const dimensions = { width: 54, height: 36 }
    const againstPainted = pixelsOf(DEFAULT_MARK_PARK, dimensions, client)
    expect(againstPainted.left).toBe(1210)
    expect(againstPainted.top).toBe(16)
    expect(againstPainted.left + dimensions.width).toBe(1264)
    expect(client.width - (againstPainted.left + dimensions.width)).toBe(16)

    const againstMarkSize = pixelsOf(DEFAULT_MARK_PARK, { width: 36, height: 36 }, client)
    expect(againstMarkSize.left + dimensions.width - client.width).toBe(2)
    expect(parkFromPixels(againstPainted.left, againstPainted.top, dimensions, client))
      .toEqual(DEFAULT_MARK_PARK)
  })

  it("reads a parked place from disk text and refuses garbage", () => {
    expect(readPark(JSON.stringify({ x: 0.25, y: 0.75 }))).toEqual({ x: 0.25, y: 0.75 })
    expect(readPark("{")).toBeNull()
    expect(isMarkPark({ x: "left", y: 0 })).toBe(false)
  })
})
