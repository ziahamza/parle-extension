/**
 * Bluesky, where the interesting question is what a Discussion is called.
 *
 * `permalinkOf` in `@parle/domain` wants `"<did>/<rkey>"`, and the rendered
 * permalink usually names a handle instead. These tests pin the decision the
 * parser's header argues for — the handle goes in the did slot, because
 * `bsky.app/profile/<handle>/post/<rkey>` resolves identically and the
 * alternative is a Mention nobody ever sees.
 */
import { describe, expect, it } from "vitest"
import { blueskyFeed, blueskyThread, reskinned } from "./Fixtures.ts"
import { readFeed, readThread } from "./Bluesky.ts"
import { NetworkPage } from "./Page.ts"

const page = (url: string, markup: string) => NetworkPage.make({ network: "bluesky", url, markup })

describe("a feed is a column of posts, each a Linked Mention of what it linked", () => {
  const reading = readFeed(page("https://bsky.app/", blueskyFeed))

  it("takes the destination itself, because Bluesky does not rewrite links", () => {
    expect(reading.sightings.map((sighting) => sighting.link)).toEqual([
      "https://www.nature.com/articles/d41586-024-02012-5",
      "https://example.com/a-second-story?utm_source=bsky"
    ])
    expect(reading.sightings.every((sighting) => sighting.tier === "Linked")).toBe(true)
  })

  it("collapses the embed card and the in-text link, which are one address", () => {
    expect(
      reading.sightings.filter((sighting) => sighting.link.includes("d41586-024-02012-5"))
    ).toHaveLength(1)
  })

  it("stores the handle in the did slot when the permalink names a handle", () => {
    // Documented in Bluesky.ts: the NativeId contract is `<did-or-handle>/<rkey>`,
    // and bsky.app resolves the handle form of the permalink identically.
    expect(reading.sightings[0]?.discussion.id.nativeId).toBe("nature.com/3kv2xqz7abc22")
    expect(reading.sightings[0]?.discussion.id.network).toBe("bluesky")
    expect(reading.sightings[0]?.discussion.author).toBe("nature.com")
  })

  it("keeps the did when the permalink carries one", () => {
    expect(reading.sightings[1]?.discussion.id.nativeId).toBe(
      "did:plc:z72i7hdynmk6r22z27h6tvur/3kv2zzz11ghi"
    )
  })

  it("expands the abbreviated counts rather than dropping them", () => {
    expect(reading.sightings[0]?.numbers).toEqual({ score: 1200, comments: 18 })
  })

  it("records no reply count where the control names none", () => {
    // Absent, never zero: an invented zero renders later as a count that fell.
    expect(reading.sightings[1]?.numbers).toEqual({ score: 3, comments: null })
  })

  it("reads the post's own time from the machine-readable stamp", () => {
    expect(reading.sightings[0]?.discussion.postedAt).toBe(Date.parse("2026-08-25T09:17:08.000Z"))
  })

  it("yields nothing for a post with no link, and does not call that a failure", () => {
    expect(reading.legibility).toEqual({ _tag: "Legible", anchors: 3, read: 2 })
  })

  it("never harvests a link back into Bluesky itself", () => {
    expect(reading.sightings.every((sighting) => !sighting.link.includes("bsky."))).toBe(true)
  })
})

describe("a thread page separates the root post from its replies", () => {
  const reading = readThread(
    page("https://bsky.app/profile/nature.com/post/3kv2xqz7abc22", blueskyThread)
  )

  it("keeps the root Linked and every reply's address Passing", () => {
    expect(reading.sightings.map((sighting) => sighting.tier)).toEqual(["Linked", "Passing"])
  })

  it("attributes a reply's link to the conversation, and names the reply", () => {
    const passing = reading.sightings[1]
    expect(passing?.link).toBe("https://opening-up-chatgpt.github.io/")
    // A reply is a place inside a conversation, not a Discussion of its own.
    expect(passing?.discussion.id.nativeId).toBe("nature.com/3kv2xqz7abc22")
    expect(passing?.inComment).toBe("3kv3aaa22jkl")
  })

  it("carries the root's numbers as read on this page", () => {
    expect(reading.sightings[0]?.numbers).toEqual({ score: 1300, comments: 19 })
    expect(reading.sightings[1]?.numbers).toEqual({ score: 1300, comments: 19 })
  })

  it("drops a reply linking back to another Bluesky thread", () => {
    expect(reading.sightings.some((sighting) => sighting.inComment === "3kv3bbb33mno")).toBe(false)
  })
})

describe("a reskin is reported", () => {
  it("yields nothing and names the test hooks it was anchored on", () => {
    const reading = readFeed(page("https://bsky.app/", reskinned))
    expect(reading.sightings).toEqual([])
    expect(reading.legibility._tag).toBe("Illegible")
    expect(reading.legibility._tag === "Illegible" ? reading.legibility.expected : "").toContain("feedItem-by-")
  })
})
