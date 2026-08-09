/**
 * What the Hacker News parsers must get right: the tier, the identity, and the
 * refusal to invent either.
 */
import { describe, expect, it } from "vitest"
import { hackerNewsItem, hackerNewsListing, reskinned } from "./Fixtures.ts"
import { readItem, readListing } from "./HackerNews.ts"
import { NetworkPage } from "./Page.ts"

const listing = NetworkPage.make({
  network: "hackernews",
  url: "https://news.ycombinator.com/",
  markup: hackerNewsListing
})

const item = NetworkPage.make({
  network: "hackernews",
  url: "https://news.ycombinator.com/item?id=40786237",
  markup: hackerNewsItem
})

describe("a list page is a page of Linked Mentions", () => {
  const reading = readListing(listing)

  it("takes one sighting per story that links somewhere else", () => {
    expect(reading.sightings.map((sighting) => sighting.link)).toEqual([
      "https://www.nature.com/articles/d41586-024-02012-5",
      "https://example.com/a-second-story?utm_source=hn"
    ])
  })

  it("keeps the tracking parameters verbatim, because they are the evidence", () => {
    // Canonicalization happens exactly once, in `@parle/policy`, on the way to
    // a key. A parser that stripped `utm_source` here would be a second rules
    // table nobody versioned.
    expect(reading.sightings[1]?.link).toContain("utm_source=hn")
  })

  it("yields nothing at all for an Ask HN, and does not call that a failure", () => {
    expect(reading.sightings.some((sighting) => sighting.discussion.id.nativeId === "36615023")).toBe(false)
    expect(reading.legibility._tag).toBe("Legible")
  })

  it("identifies each Discussion by the Network and the item id together", () => {
    const first = reading.sightings[0]?.discussion.id
    expect(first?.network).toBe("hackernews")
    expect(first?.nativeId).toBe("40786237")
  })

  it("reads the numbers the row showed, and no number it did not", () => {
    expect(reading.sightings[0]?.numbers).toEqual({ score: 127, comments: 18 })
    // The second story's link says "discuss", not "0 comments". A zero here
    // would later render as a comment count that fell.
    expect(reading.sightings[1]?.numbers).toEqual({ score: 4, comments: null })
  })

  it("prefers the epoch seconds in the age title over its unzoned ISO twin", () => {
    // 1719307028 seconds. Parsing the ISO half instead would move every posting
    // time by the reader's own UTC offset.
    expect(reading.sightings[0]?.discussion.postedAt).toBe(1719307028000)
  })

  it("never treats a link back into Hacker News as an outbound one", () => {
    expect(reading.sightings.every((sighting) => !sighting.link.includes("ycombinator"))).toBe(true)
  })
})

describe("an item page separates the submission from what commenters linked", () => {
  const reading = readItem(item)

  it("keeps the submission Linked and every comment address Passing", () => {
    const tiers = reading.sightings.map((sighting) => sighting.tier)
    expect(tiers).toEqual(["Linked", "Passing", "Passing"])
  })

  it("attributes a comment's link to the thread, and names the comment it was in", () => {
    const passing = reading.sightings.filter((sighting) => sighting.tier === "Passing")
    expect(passing.map((sighting) => sighting.link)).toEqual([
      "https://opening-up-chatgpt.github.io/",
      "https://example.org/paper.pdf"
    ])
    // A Discussion is the conversation; a comment is a place inside it.
    expect(passing.every((sighting) => sighting.discussion.id.nativeId === "40786237")).toBe(true)
    expect(passing[0]?.inComment).toBe("40787001")
  })

  it("drops a comment linking back to another Hacker News thread", () => {
    expect(reading.sightings.some((sighting) => sighting.inComment === "40787412")).toBe(false)
  })
})

describe("a reskin is reported, not silently absorbed", () => {
  it("yields nothing and says which structure it wanted", () => {
    const reading = readListing(
      NetworkPage.make({ network: "hackernews", url: "https://news.ycombinator.com/", markup: reskinned })
    )
    expect(reading.sightings).toHaveLength(0)
    expect(reading.legibility._tag).toBe("Illegible")
    expect(reading.legibility._tag === "Illegible" ? reading.legibility.expected : "").toContain("athing")
  })

  it("does not mistake the reskinned page's real link for a Discussion", () => {
    // The dangerous failure is not the empty one. This page HAS the article
    // link on it; a looser parser would emit a Mention with no identifiable
    // Discussion behind it.
    const reading = readListing(
      NetworkPage.make({ network: "hackernews", url: "https://news.ycombinator.com/", markup: reskinned })
    )
    expect(reading.sightings).toEqual([])
  })
})
