/**
 * Lobsters, where the interesting failure is a parser that harvests too much.
 *
 * A story row carries the submitted address AND two archive links about it. A
 * looser parser produces three Mentions per story, two of them claiming an
 * archive search page is what the conversation is about — which is exactly the
 * kind of wrong-but-plausible record {@link ./Page.ts} says is indistinguishable
 * from a real one once stored.
 */
import { describe, expect, it } from "vitest"
import { lobstersListing, lobstersStory, reskinned } from "./Fixtures.ts"
import { readListing, readStory } from "./Lobsters.ts"
import { NetworkPage } from "./Page.ts"

const page = (url: string, markup: string) => NetworkPage.make({ network: "lobsters", url, markup })

describe("a Lobsters listing is a page of Linked Mentions", () => {
  const reading = readListing(page("https://lobste.rs/", lobstersListing))

  it("takes one sighting per story that submitted an address elsewhere", () => {
    expect(reading.sightings.map((sighting) => sighting.tier)).toEqual(["Linked", "Linked"])
    expect(reading.sightings.map((sighting) => sighting.link)).toEqual([
      "https://fzakaria.com/2026/08/23/your-executable-is-a-sqlite-database",
      "https://example.com/emacs-30-released?utm_source=lobsters"
    ])
  })

  it("never harvests the archive links the row carries about the submission", () => {
    // Verified against live markup: every story row with an outbound URL also
    // has `details.caches` holding web.archive.org and ghostarchive.org.
    expect(
      reading.sightings.some((sighting) =>
        sighting.link.includes("web.archive.org") || sighting.link.includes("ghostarchive.org")
      )
    ).toBe(false)
  })

  it("keeps the tracking parameters verbatim, because they are the evidence", () => {
    expect(reading.sightings[1]?.link).toContain("utm_source=lobsters")
  })

  it("identifies each Discussion by the Network and the short id together", () => {
    expect(reading.sightings[0]?.discussion.id.network).toBe("lobsters")
    expect(reading.sightings[0]?.discussion.id.nativeId).toBe("8ttu5n")
  })

  it("reads the score and the comment count the row showed", () => {
    expect(reading.sightings[0]?.numbers).toEqual({ score: 148, comments: 13 })
  })

  it("records no comment count for a story that says 'no comments'", () => {
    // A zero we invented renders later as a count that fell, which is a
    // Movement nobody observed.
    expect(reading.sightings[1]?.numbers).toEqual({ score: 67, comments: null })
  })

  it("prefers the epoch seconds over the unzoned local strings beside them", () => {
    expect(reading.sightings[0]?.discussion.postedAt).toBe(1787556765000)
  })

  it("names the submitter rather than the empty avatar link above them", () => {
    expect(reading.sightings[0]?.discussion.author).toBe("jummo")
  })

  it("yields nothing for a text story, and does not call that a failure", () => {
    expect(reading.sightings.some((sighting) => sighting.discussion.id.nativeId === "0typpq")).toBe(false)
    expect(reading.legibility).toEqual({ _tag: "Legible", anchors: 3, read: 2 })
  })
})

describe("a story page separates the submission from what commenters linked", () => {
  const reading = readStory(page("https://lobste.rs/s/8ttu5n/your_executable_is_sqlite_database", lobstersStory))

  it("keeps the submission Linked and every comment address Passing", () => {
    expect(reading.sightings.map((sighting) => sighting.tier)).toEqual(["Linked", "Passing", "Passing"])
  })

  it("attributes a comment's link to the story, and names the comment it was in", () => {
    const passing = reading.sightings.filter((sighting) => sighting.tier === "Passing")
    expect(passing.map((sighting) => sighting.link)).toEqual([
      "https://sqlite.org/appfileformat.html",
      "https://example.org/notes.pdf"
    ])
    expect(passing.every((sighting) => sighting.discussion.id.nativeId === "8ttu5n")).toBe(true)
    expect(passing[0]?.inComment).toBe("bqdtco")
  })

  it("drops a comment linking back to another Lobsters story", () => {
    expect(reading.sightings.some((sighting) => sighting.inComment === "zzq14m")).toBe(false)
  })

  it("carries the numbers as read on this page, not on the listing", () => {
    expect(reading.sightings[0]?.numbers).toEqual({ score: 151, comments: 14 })
  })

  it("is not confused by the comment form, which carries an empty short id", () => {
    expect(reading.sightings.every((sighting) => sighting.inComment !== "")).toBe(true)
    expect(reading.legibility).toEqual({ _tag: "Legible", anchors: 4, read: 2 })
  })
})

describe("a reskin is reported, not silently absorbed", () => {
  it("yields nothing and names the attribute it was anchored on", () => {
    const reading = readListing(page("https://lobste.rs/", reskinned))
    expect(reading.sightings).toEqual([])
    expect(reading.legibility._tag).toBe("Illegible")
    expect(reading.legibility._tag === "Illegible" ? reading.legibility.expected : "").toContain("data-shortid")
  })
})
