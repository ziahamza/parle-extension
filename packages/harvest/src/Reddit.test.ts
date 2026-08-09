/**
 * Reddit is two sites, and both of them have to work.
 *
 * The interesting cases are the ones where a looser parser would produce
 * something: a self post whose `content-href` is its own permalink, and a
 * comment linking to another Reddit thread. Both must yield nothing.
 */
import { describe, expect, it } from "vitest"
import { redditCommentPage, redditListing, redditOldListing, reskinned } from "./Fixtures.ts"
import { NetworkPage } from "./Page.ts"
import { readCommentPage, readListing } from "./Reddit.ts"

const page = (url: string, markup: string) => NetworkPage.make({ network: "reddit", url, markup })

describe("a subreddit listing on reddit.com", () => {
  const reading = readListing(page("https://www.reddit.com/r/science/", redditListing))

  it("takes one Linked Mention per post that submitted an address elsewhere", () => {
    expect(reading.sightings.map((sighting) => sighting.tier)).toEqual(["Linked", "Linked"])
    expect(reading.sightings[0]?.link).toBe("https://www.nature.com/articles/d41586-024-02012-5")
  })

  it("does not turn a self post into a Mention about Reddit", () => {
    // `content-href` on a text post is the post's own permalink. A parser that
    // took it at face value would fill the cache with Mentions claiming Reddit
    // threads are about Reddit threads.
    expect(reading.sightings.every((sighting) => sighting.discussion.id.nativeId !== "1dq00zz")).toBe(true)
    expect(reading.sightings).toHaveLength(2)
  })

  it("keeps a tracking wrapper verbatim for the resolver to unwrap", () => {
    // `out.reddit.com/?url=…` carries its own destination, but unwrapping is
    // the resolver's job and the raw href is the evidence.
    expect(reading.sightings[1]?.link).toContain("out.reddit.com")
  })

  it("reads the identity out of the permalink, where Reddit always puts it", () => {
    expect(reading.sightings[0]?.discussion.id.nativeId).toBe("1dnr4kx")
    expect(reading.sightings[0]?.discussion.id.network).toBe("reddit")
  })

  it("reads the numbers and the posting time the element declared", () => {
    expect(reading.sightings[0]?.numbers).toEqual({ score: 4821, comments: 213 })
    expect(reading.sightings[0]?.discussion.postedAt).toBe(Date.parse("2024-06-25T09:17:08.000Z"))
  })
})

describe("the same subreddit on old.reddit.com", () => {
  const reading = readListing(page("https://old.reddit.com/r/science/", redditOldListing))

  it("reads the other dialect rather than reporting a broken parser", () => {
    expect(reading.legibility._tag).toBe("Legible")
    expect(reading.sightings).toHaveLength(1)
    expect(reading.sightings[0]?.link).toBe("https://www.nature.com/articles/d41586-024-02012-5")
    expect(reading.sightings[0]?.numbers).toEqual({ score: 4821, comments: 213 })
  })

  it("still drops the self post", () => {
    expect(reading.sightings.every((sighting) => sighting.discussion.id.nativeId !== "1dq00zz")).toBe(true)
  })
})

describe("a comment page yields Passing Mentions, not Linked ones", () => {
  const reading = readCommentPage(
    page("https://www.reddit.com/r/science/comments/1dnr4kx/not_all_open_source/", redditCommentPage)
  )

  it("keeps the post itself Linked and everything in the comments Passing", () => {
    expect(reading.sightings.map((sighting) => sighting.tier)).toEqual(["Linked", "Passing", "Passing"])
  })

  it("attributes comment links to the post, naming the comment they were in", () => {
    const passing = reading.sightings.filter((sighting) => sighting.tier === "Passing")
    expect(passing.map((sighting) => sighting.link)).toEqual([
      "https://arxiv.org/abs/2402.00001",
      "https://example.org/data.csv"
    ])
    expect(passing.every((sighting) => sighting.discussion.id.nativeId === "1dnr4kx")).toBe(true)
    expect(passing[0]?.inComment).toBe("l5abcde")
  })

  it("ignores a comment linking to another Reddit thread", () => {
    expect(reading.sightings.every((sighting) => !sighting.link.includes("reddit.com"))).toBe(true)
  })

  it("carries the post's numbers as read on this page, not on the listing", () => {
    expect(reading.sightings[0]?.numbers).toEqual({ score: 4890, comments: 214 })
  })
})

describe("a reskin is reported", () => {
  it("yields nothing and names both dialects it expected", () => {
    const reading = readListing(page("https://www.reddit.com/r/science/", reskinned))
    expect(reading.sightings).toEqual([])
    expect(reading.legibility._tag).toBe("Illegible")
    expect(reading.legibility._tag === "Illegible" ? reading.legibility.expected : "").toContain("shreddit-post")
  })
})
