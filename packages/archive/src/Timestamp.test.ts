/**
 * The edges, because the middle was never in doubt.
 *
 * Every case here is one `Date.parse` or a naive `Date.UTC` would get wrong
 * silently: midnight, a year boundary, a leap day, a day that does not exist,
 * and a rolled-over hour.
 */
import { describe, expect, it } from "vitest"
import { parseWaybackTimestamp, toWaybackTimestamp } from "./Timestamp.ts"

describe("reading a 14-digit Wayback timestamp", () => {
  it("reads a capture as UTC, not as local time", () => {
    // Chosen because it is the first row of a live CDX answer captured
    // 2026-08-24, not because it is convenient.
    expect(parseWaybackTimestamp("20240619144848")).toBe(Date.UTC(2024, 5, 19, 14, 48, 48))
  })

  it("reads midnight as the start of that day and not the end of the one before", () => {
    expect(parseWaybackTimestamp("20240619000000")).toBe(Date.UTC(2024, 5, 19, 0, 0, 0))
  })

  it("reads the last second of a year and the first second of the next as one second apart", () => {
    const endOf2024 = parseWaybackTimestamp("20241231235959")
    const startOf2025 = parseWaybackTimestamp("20250101000000")
    expect(endOf2024).toBe(Date.UTC(2024, 11, 31, 23, 59, 59))
    expect(startOf2025).toBe(Date.UTC(2025, 0, 1, 0, 0, 0))
    expect(startOf2025! - endOf2024!).toBe(1000)
  })

  it("reads a leap day that exists", () => {
    expect(parseWaybackTimestamp("20240229120000")).toBe(Date.UTC(2024, 1, 29, 12, 0, 0))
  })

  it("refuses a leap day that does not exist rather than rolling it into March", () => {
    // `Date.UTC(2023, 1, 29)` is 1 March. The round trip is the only thing that
    // catches it, and an off-by-one-day snapshot age is exactly the kind of
    // wrongness nobody reports.
    expect(parseWaybackTimestamp("20230229120000")).toBeNull()
  })

  it("refuses 31 April", () => {
    expect(parseWaybackTimestamp("20240431120000")).toBeNull()
  })

  it("refuses an hour, minute or second that has rolled over", () => {
    expect(parseWaybackTimestamp("20240619240000")).toBeNull()
    expect(parseWaybackTimestamp("20240619146000")).toBeNull()
    expect(parseWaybackTimestamp("20240619144860")).toBeNull()
  })

  it("refuses month 00 and month 13", () => {
    expect(parseWaybackTimestamp("20240019144848")).toBeNull()
    expect(parseWaybackTimestamp("20241319144848")).toBeNull()
  })

  it("refuses day 00", () => {
    expect(parseWaybackTimestamp("20240600144848")).toBeNull()
  })

  it("refuses anything that is not exactly fourteen digits", () => {
    for (const raw of ["", "2024", "2024061914484", "202406191448480", "2024-06-19", "20240619 14484a"]) {
      expect(parseWaybackTimestamp(raw)).toBeNull()
    }
  })

  it("reads a two-digit year as that year and not as the nineteen-hundreds", () => {
    // `Date.UTC(96, ...)` is 1996. No real capture predates 1996, so this never
    // bites in production — which is precisely why it would survive forever.
    expect(new Date(parseWaybackTimestamp("00960101000000")!).getUTCFullYear()).toBe(96)
  })
})

describe("writing one back", () => {
  it("round-trips every timestamp this package can read", () => {
    for (const raw of [
      "19960101000000",
      "20240619144848",
      "20241231235959",
      "20250101000000",
      "20240229120000"
    ]) {
      expect(toWaybackTimestamp(parseWaybackTimestamp(raw)!)).toBe(raw)
    }
  })

  it("refuses a moment that is not one", () => {
    expect(toWaybackTimestamp(Number.NaN)).toBeNull()
    expect(toWaybackTimestamp(Number.POSITIVE_INFINITY)).toBeNull()
  })
})
