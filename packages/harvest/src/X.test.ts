/**
 * X's timeline, where every outbound link is a `t.co` and none of them is the
 * address the reader will land on.
 *
 * These tests assert the parser's half of ADR 0012's marquee case. The other
 * half — that the Mention is keyed on the destination and not on the `t.co` —
 * is asserted in `Harvester.test.ts`, because it is the pipeline's promise
 * rather than the parser's.
 */
import { describe, expect, it } from "vitest"
import { reskinned, xTimeline } from "./Fixtures.ts"
import { NetworkPage } from "./Page.ts"
import { readTimeline } from "./X.ts"

const timeline = NetworkPage.make({
  network: "x",
  url: "https://x.com/home",
  markup: xTimeline
})

describe("a timeline is a page of posts, each one a Linked Mention of what it linked", () => {
  const reading = readTimeline(timeline)

  it("takes the t.co address exactly as X rewrote it", () => {
    expect(reading.sightings.map((sighting) => sighting.link)).toEqual([
      "https://t.co/x7Kd2Ab",
      "https://t.co/Zq9Lm3P"
    ])
  })

  it("collapses the card and the in-text link, which are the same t.co", () => {
    // The first post carries its `t.co` twice. One post is one Mention.
    expect(reading.sightings.filter((sighting) => sighting.link === "https://t.co/x7Kd2Ab")).toHaveLength(1)
  })

  it("yields nothing for a post with no link, and does not call that a failure", () => {
    expect(reading.sightings).toHaveLength(2)
    expect(reading.legibility).toEqual({ _tag: "Legible", anchors: 3, read: 2 })
  })

  it("identifies the Discussion by the status id, and names its author", () => {
    expect(reading.sightings[0]?.discussion.id.nativeId).toBe("1805123456789012345")
    expect(reading.sightings[0]?.discussion.id.network).toBe("x")
    expect(reading.sightings[0]?.discussion.author).toBe("nature")
  })

  it("expands X's abbreviated counts rather than dropping them", () => {
    // `1.2K` is not 1200 and never was. It is recorded because a Movement from
    // 1,200 to 3,400 is worth showing and a missing number is not.
    expect(reading.sightings[0]?.numbers).toEqual({ score: 1200, comments: 18 })
  })

  it("reads the post's own time from the machine-readable stamp", () => {
    expect(reading.sightings[0]?.discussion.postedAt).toBe(Date.parse("2024-06-25T09:17:08.000Z"))
  })

  it("never harvests a link back into X itself", () => {
    expect(reading.sightings.every((sighting) => !sighting.link.includes("x.com"))).toBe(true)
  })
})

describe("a reskin is reported", () => {
  it("yields nothing and names the attribute it was anchored on", () => {
    const reading = readTimeline(NetworkPage.make({ network: "x", url: "https://x.com/home", markup: reskinned }))
    expect(reading.sightings).toEqual([])
    expect(reading.legibility._tag).toBe("Illegible")
    expect(reading.legibility._tag === "Illegible" ? reading.legibility.expected : "").toContain("data-testid")
  })
})
