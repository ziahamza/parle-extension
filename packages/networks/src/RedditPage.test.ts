/**
 * The tier-2 scanner. It has no DOM available to it and it is the fallback, so
 * the bar is: fewer results when the markup surprises it, never an exception.
 */
import { describe, expect, it } from "vitest"
import { isBlockPage, readSearchPage } from "./RedditPage.ts"
import { redditBlockPage, redditSearchPage } from "./Recorded.ts"

describe("reading a search page", () => {
  const results = readSearchPage(redditSearchPage)

  it("keeps only rows it can identify", () => {
    // The page also carries a `search-result-subreddit` row, which has no
    // permalink. A Mention we cannot identify is one we can neither dedupe nor
    // observe twice nor cite, so it is dropped rather than guessed at.
    expect(results.map((r) => r.nativeId)).toEqual(["1dnr4kx", "1dpz9qa", "1dq00zz"])
  })

  it("reads a thousands-separated score", () => {
    expect(results[0]?.score).toBe(4821)
  })

  it("reads the comment count out of the link text", () => {
    expect(results.map((r) => r.comments)).toEqual([213, 41, 1])
  })

  it("decodes entities in the submitted address", () => {
    // `&amp;` in an href is a different URL from `&amp;` taken literally, and
    // the literal reading fails every Alias comparison silently.
    expect(results[1]?.submitted).toBe(
      "https://www.nature.com/articles/d41586-024-02012-5?utm_source=twitter&utm_medium=social"
    )
  })

  it("does not depend on attribute order", () => {
    // The second row writes `href` before `class`; Reddit varies this between
    // the logged-in and logged-out renderings.
    expect(results[1]?.title).toBe("Not all open source AI models are open")
  })

  it("reads the subreddit so two Reddit tabs can be told apart", () => {
    expect(results.map((r) => r.venue)).toEqual(["science", "MachineLearning", "technology"])
  })
})

describe("markup that is not a search page", () => {
  it("returns nothing rather than throwing on a truncated body", () => {
    const half = redditSearchPage.slice(0, redditSearchPage.length / 3)
    expect(() => readSearchPage(half)).not.toThrow()
  })

  it("returns nothing rather than throwing on an empty body", () => {
    expect(readSearchPage("")).toEqual([])
  })

  it("recognises Reddit's block page", () => {
    // Captured live from this sandbox on 2026-08-08. It scans to zero rows, so
    // without this it becomes a Silence — the one outcome we may cache.
    expect(isBlockPage(redditBlockPage)).toBe(true)
    expect(readSearchPage(redditBlockPage)).toEqual([])
  })

  it("does not mistake a real search page for a block page", () => {
    expect(isBlockPage(redditSearchPage)).toBe(false)
  })
})
