/**
 * Lemmy, where the interesting case is federation.
 *
 * The same conversation has a different address on every instance that mirrors
 * it. A parser keying on the local one mints a Discussion per instance the
 * reader happens to browse, and the panel shows one thread three times with
 * three different comment counts. The ap_id in the fedilink is the one identity
 * every copy agrees on, and these tests are mostly about taking it.
 */
import { describe, expect, it } from "vitest"
import { lemmyListing, lemmyPost, reskinned } from "./Fixtures.ts"
import { readListing, readPost } from "./Lemmy.ts"
import { NetworkPage } from "./Page.ts"

const page = (url: string, markup: string) => NetworkPage.make({ network: "lemmy", url, markup })

describe("an instance front page is a page of Linked Mentions", () => {
  const reading = readListing(page("https://lemmy.ml/", lemmyListing))

  it("takes one sighting per post that submitted an address elsewhere", () => {
    expect(reading.sightings.map((sighting) => sighting.tier)).toEqual(["Linked", "Linked"])
    expect(reading.sightings.map((sighting) => sighting.link)).toEqual([
      "https://minddump-5f4.pages.dev/posts/online-tracking-methods/",
      "https://example.com/a-second-story?utm_source=lemmy"
    ])
  })

  it("identifies a federated post by its ap_id, not by the address it is showing", () => {
    // Verified live: `lemmy.ml/post/51762294` is a copy of `lemmy.ca/post/69795063`,
    // and lemmy-ui puts the ap_id in the fedilink beside the local permalink.
    expect(reading.sightings[0]?.discussion.id.nativeId).toBe("https://lemmy.ca/post/69795063")
    expect(reading.sightings[0]?.discussion.id.network).toBe("lemmy")
  })

  it("uses a local post's own address, which is what its fedilink carries", () => {
    expect(reading.sightings[1]?.discussion.id.nativeId).toBe("https://lemmy.ml/post/51770001")
  })

  it("never harvests the fedilink itself as a Mention", () => {
    // It points at another instance, and `Outbound` only knows the three we ask,
    // so a sweep of the block would store "a Lemmy post is about a Lemmy post".
    expect(reading.sightings.some((sighting) => sighting.link.includes("lemmy.ca"))).toBe(false)
  })

  it("reads the score from the wide-screen copy of a post rendered twice", () => {
    expect(reading.sightings[0]?.numbers).toEqual({ score: 91, comments: 24 })
    expect(reading.sightings[1]?.numbers).toEqual({ score: 12, comments: 3 })
  })

  it("reads the title, the author and the community the post is in", () => {
    const post = reading.sightings[0]?.discussion
    expect(post?.title).toBe("Effective Web Tracking Methods in 2026: Explained")
    expect(post?.author).toBe("tumbling4986@lemmy.ca")
    expect(post?.venue).toBe("privacy")
  })

  it("records no posting time, because lemmy-ui publishes none a machine can read", () => {
    // `data-tippy-content="Sunday, August 23rd, 2026 at 1:55:21 PM GMT+00:00"`
    // is prose. A date we guessed at is worse than a date we do not have.
    expect(reading.sightings[0]?.discussion.postedAt).toBe(null)
  })

  it("yields nothing for a text post, and does not call that a failure", () => {
    expect(reading.legibility).toEqual({ _tag: "Legible", anchors: 3, read: 2 })
  })

  it("does not attribute the page footer's links to the last post on it", () => {
    expect(reading.sightings.some((sighting) => sighting.link.includes("join-lemmy.org"))).toBe(false)
  })
})

describe("a post page yields Passing Mentions, not Linked ones", () => {
  const reading = readPost(page("https://lemmy.ml/post/51762294", lemmyPost))

  it("keeps the post itself Linked and everything in the comments Passing", () => {
    expect(reading.sightings.map((sighting) => sighting.tier)).toEqual(["Linked", "Passing", "Passing"])
  })

  it("attributes comment links to the post's ap_id, naming the comment they were in", () => {
    const passing = reading.sightings.filter((sighting) => sighting.tier === "Passing")
    expect(passing.map((sighting) => sighting.link)).toEqual([
      "https://arxiv.org/abs/2402.00001",
      "https://example.org/data.csv"
    ])
    expect(passing.every((sighting) => sighting.discussion.id.nativeId === "https://lemmy.ca/post/69795063")).toBe(true)
    expect(passing[0]?.inComment).toBe("27405556")
  })

  it("never harvests a comment's own fedilink", () => {
    // `lemmy.world/comment/25444765` sits in the comment's byline, outside
    // `div.comment-content`, which is the only place addresses are read from.
    expect(reading.sightings.some((sighting) => sighting.link.includes("/comment/"))).toBe(false)
  })

  it("drops a comment linking to an instance we already read", () => {
    expect(reading.sightings.some((sighting) => sighting.link.includes("lemmy.world/post"))).toBe(false)
  })

  it("carries the post's numbers as read on this page, not on the listing", () => {
    expect(reading.sightings[0]?.numbers).toEqual({ score: 94, comments: 26 })
  })
})

describe("a reskin is reported", () => {
  it("yields nothing and names the structure it wanted", () => {
    const reading = readListing(page("https://lemmy.world/", reskinned))
    expect(reading.sightings).toEqual([])
    expect(reading.legibility._tag).toBe("Illegible")
    expect(reading.legibility._tag === "Illegible" ? reading.legibility.expected : "").toContain("post-listing")
  })
})
