/**
 * The cheap half of ADR 0012's budget: everything unwrapped here costs no
 * request, and everything misjudged here costs a wrong key or a pointless one.
 */
import { describe, expect, it } from "vitest"
import * as Option from "effect/Option"
import { isShortener, unwrap, unwrapFully } from "./Shortlinks.ts"

describe("what has to be followed", () => {
  it("knows the two that matter", () => {
    expect(isShortener("https://t.co/x7Kd2Ab")).toBe(true)
    expect(isShortener("https://bit.ly/3abc")).toBe(true)
  })

  it("does not guess from the shape of a path", () => {
    // A whitelist, not a heuristic. "Short path means shortener" sends requests
    // to ordinary pages and keys real Subjects on wherever those pages redirect.
    expect(isShortener("https://example.com/a")).toBe(false)
    expect(isShortener("https://nature.com/x")).toBe(false)
  })

  it("does not treat a real destination as a redirector", () => {
    // `youtu.be` looks like a shortener and is a canonical address for a video;
    // `@parle/policy` already relates it to `youtube.com` as an Alias.
    expect(isShortener("https://youtu.be/dQw4w9WgXcQ")).toBe(false)
  })

  it("survives an unparseable href without throwing", () => {
    expect(isShortener("not a url")).toBe(false)
  })
})

describe("what can be unwrapped for nothing", () => {
  it("reads a destination straight out of Reddit's own wrapper", () => {
    const found = unwrap("https://out.reddit.com/?url=https%3A%2F%2Fexample.com%2Fa&token=xyz")
    expect(Option.getOrNull(found)).toBe("https://example.com/a")
  })

  it("prefers the parameter that carries an address over the decoys beside it", () => {
    const found = unwrap("https://www.google.com/url?sa=t&url=https%3A%2F%2Fexample.com%2Fb&usg=AOv")
    expect(Option.getOrNull(found)).toBe("https://example.com/b")
  })

  it("refuses a wrapper host whose parameters carry no address", () => {
    // `youtube.com` is on the wrapper list for its `/redirect?q=` form. Its `v`
    // parameter is a video id, not a destination, and mistaking one for the
    // other would key every video on nothing.
    expect(Option.isNone(unwrap("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))).toBe(true)
  })

  it("leaves an ordinary address alone", () => {
    expect(Option.isNone(unwrap("https://example.com/a?url=notabsolute"))).toBe(true)
  })

  it("unwraps a nested tracker, because trackers nest", () => {
    const inner = encodeURIComponent("https://news.google.com/?url=" + encodeURIComponent("https://example.com/deep"))
    expect(unwrapFully(`https://out.reddit.com/?url=${inner}`)).toBe("https://example.com/deep")
  })

  it("returns the address unchanged when there is nothing to unwrap", () => {
    expect(unwrapFully("https://example.com/a")).toBe("https://example.com/a")
  })
})
