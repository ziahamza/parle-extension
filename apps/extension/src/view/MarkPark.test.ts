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

  it("reads a parked place from disk text and refuses garbage", () => {
    expect(readPark(JSON.stringify({ x: 0.25, y: 0.75 }))).toEqual({ x: 0.25, y: 0.75 })
    expect(readPark("{")).toBeNull()
    expect(isMarkPark({ x: "left", y: 0 })).toBe(false)
  })
})
