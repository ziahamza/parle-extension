/**
 * The address comparison is the only thing standing between Algolia's fuzzy
 * URL scoring and a Linked Mention, so it is tested for both directions of
 * error: merging two documents, and splitting one.
 */
import { describe, expect, it } from "vitest"
import { comparableAddress, matchingAddress, sameAddress } from "./Address.ts"

describe("addresses that are the same document", () => {
  it("ignores the scheme", () => {
    expect(sameAddress("http://example.com/a", "https://example.com/a")).toBe(true)
  })

  it("ignores a leading www.", () => {
    expect(sameAddress("https://www.nature.com/x", "https://nature.com/x")).toBe(true)
  })

  it("ignores a trailing slash and the fragment", () => {
    expect(sameAddress("https://example.com/a/", "https://example.com/a#intro")).toBe(true)
  })

  it("ignores campaign parameters and parameter order", () => {
    expect(
      sameAddress(
        "https://example.com/a?utm_source=twitter&id=7&utm_medium=social",
        "https://example.com/a?id=7"
      )
    ).toBe(true)
  })
})

describe("addresses that are NOT the same document", () => {
  it("keeps one digit apart", () => {
    // Verified live 2026-08-08: Algolia returns BOTH of these for a
    // url-restricted query on the first. Without this the second becomes a
    // Linked Mention — the tier that licenses an authenticated X request.
    expect(
      sameAddress(
        "https://www.nature.com/articles/d41586-024-02012-5",
        "https://www.nature.com/articles/d41586-024-02082-5"
      )
    ).toBe(false)
  })

  it("keeps a meaningful query parameter", () => {
    expect(sameAddress("https://example.com/watch?v=abc", "https://example.com/watch?v=def")).toBe(false)
    expect(sameAddress("https://example.com/watch?v=abc", "https://example.com/watch")).toBe(false)
  })

  it("keeps distinct hosts apart even when the path matches", () => {
    expect(sameAddress("https://example.com/a", "https://example.org/a")).toBe(false)
  })

  it("does not treat two unparseable addresses as one", () => {
    expect(sameAddress("not a url", "also not a url")).toBe(false)
    expect(sameAddress("not a url", "NOT A URL")).toBe(true)
  })

  it("refuses to normalize a non-web scheme into a web one", () => {
    // `javascript:` and `data:` must never compare equal to anything by way of
    // a hostname the URL parser invented for them.
    expect(comparableAddress("javascript:void(0)")).toBe("javascript:void(0)")
  })
})

describe("which Alias a submission matched", () => {
  const aliases = [
    "https://example.com/a",
    "https://example.com/amp/a"
  ]

  it("returns the Alias as it was supplied, not the normalized form", () => {
    // A Linked Mention records the Alias it matched, and the reader is owed the
    // address we actually hold rather than a comparison artefact.
    expect(matchingAddress("http://www.example.com/a/?utm_source=x", aliases)).toBe(
      "https://example.com/a"
    )
  })

  it("is undefined when nothing matched, rather than falling back to the first", () => {
    expect(matchingAddress("https://example.com/b", aliases)).toBeUndefined()
  })
})
