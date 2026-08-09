/**
 * The scanner's job is to read fewer things rather than wrong things.
 *
 * Every number that leaves this file becomes an Observation, and the glossary
 * is explicit that Observations are never corrected, only superseded. So a
 * count we invented does not fade — it becomes a Movement the reader is shown,
 * traceable to nothing. A missing count renders as nothing at all, which is
 * why refusing is always the cheaper mistake here.
 */
import { describe, expect, it } from "vitest"
import { leadingCount } from "./Markup.ts"

describe("a count is read, never inferred", () => {
  it("reads the counts the Networks actually render", () => {
    expect(leadingCount("127 points")).toBe(127)
    expect(leadingCount("45 comments")).toBe(45)
    expect(leadingCount("1,234 comments")).toBe(1234)
    expect(leadingCount("-3 points")).toBe(-3)
  })

  it("expands an abbreviation attached to its digits", () => {
    expect(leadingCount("1.2K")).toBe(1200)
    expect(leadingCount("1.2k replies")).toBe(1200)
    expect(leadingCount("3M")).toBe(3_000_000)
  })

  it("does not read the next word's first letter as a multiplier", () => {
    // The bug this replaces: `\s*[KM]?` with a case-insensitive flag turned the
    // `m` of "minutes" and the `M` of "Members" into a million. A post from
    // five minutes ago scored five million, and nothing downstream could tell
    // that number from one X published.
    expect(leadingCount("5 minutes ago")).toBe(5)
    expect(leadingCount("12 Members")).toBe(12)
    expect(leadingCount("3 karma")).toBe(3)
    expect(leadingCount("2 months ago")).toBe(2)
    expect(leadingCount("8 Karma · 4 posts")).toBe(8)
  })

  it("has nothing to say about text carrying no count", () => {
    expect(leadingCount("")).toBe(null)
    expect(leadingCount("discuss")).toBe(null)
  })
})
