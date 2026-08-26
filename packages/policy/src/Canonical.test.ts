/**
 * Canonicalization is the one place where being wrong is invisible.
 *
 * Under-canonicalize and the same article is three keys, so a 900-point Hacker
 * News thread is never found; over-canonicalize and two articles are one key,
 * so the panel confidently shows the wrong discussion. Neither throws, neither
 * logs, and neither is visible to the reader — which is why these tests assert
 * on exact strings rather than on properties.
 */
import { describe, expect, it } from "vitest"
import { canonicalize } from "./Canonical.ts"

describe("one article, many addresses", () => {
  const expected = "https://example.com/posts/hello"

  it.each([
    ["the plain form", "https://example.com/posts/hello"],
    ["www", "https://www.example.com/posts/hello"],
    ["a trailing slash", "https://example.com/posts/hello/"],
    ["a mobile host", "https://m.example.com/posts/hello"],
    ["an AMP host and an AMP path", "https://amp.example.com/posts/hello/amp"],
    ["an AMP file extension", "https://example.com/posts/hello.amp"],
    ["an index file", "https://example.com/posts/hello/index.html"],
    ["a campaign", "https://www.example.com/posts/hello?utm_source=x&utm_campaign=y&utm_medium=social"],
    ["a Facebook click id", "https://example.com/posts/hello?fbclid=IwAR0abc"],
    ["a Google click id", "https://example.com/posts/hello/?gclid=abc123"],
    ["a fragment", "https://example.com/posts/hello#the-conclusion"],
    ["an explicit root dot", "https://example.com./posts/hello"],
    ["the default port", "https://example.com:443/posts/hello"],
    ["a Google AMP cache", "https://example-com.cdn.ampproject.org/c/s/example.com/posts/hello"],
    ["a Google AMP viewer", "https://www.google.com/amp/s/example.com/posts/hello"],
    ["an Internet Archive copy", "https://web.archive.org/web/20260824010203/https://example.com/posts/hello"],
    ["an Internet Archive raw copy", "https://web.archive.org/web/20260824010203id_/https://example.com/posts/hello"]
  ])("%s", (_name, raw) => {
    expect(canonicalize(raw)).toBe(expected)
  })

  it("keeps the mobile Wikipedia estate together", () => {
    // `m` is the SECOND label here, which a leading-label rule misses entirely
    // — and this is the largest mobile-variant family on the web.
    expect(canonicalize("https://en.m.wikipedia.org/wiki/Effect_system"))
      .toBe("https://en.wikipedia.org/wiki/Effect_system")
  })
})

describe("YouTube is one video identity", () => {
  const expected = "https://youtube.com/watch?v=dQw4w9WgXcQ"

  it.each([
    ["watch", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["the shortlink", "https://youtu.be/dQw4w9WgXcQ"],
    ["a share attribution", "https://youtu.be/dQw4w9WgXcQ?si=8Kk2mQ1a"],
    ["a timestamp", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=317s"],
    ["playlist context", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123&index=4"],
    ["mobile", "https://m.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["Shorts", "https://www.youtube.com/shorts/dQw4w9WgXcQ"],
    ["an embed", "https://www.youtube.com/embed/dQw4w9WgXcQ?start=30"],
    ["the no-cookie embed", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["the music surface", "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ"],
    ["a live permalink", "https://www.youtube.com/live/dQw4w9WgXcQ"]
  ])("%s", (_name, raw) => {
    expect(canonicalize(raw)).toBe(expected)
  })

  it("does not mint a video identity from a channel page", () => {
    // `/@handle` and `/results` are not videos, and treating them as one would
    // merge a whole channel into a single Subject.
    expect(canonicalize("https://www.youtube.com/@somechannel")).toBe("https://youtube.com/@somechannel")
    expect(canonicalize("https://www.youtube.com/results?search_query=effect"))
      .toBe("https://youtube.com/results?search_query=effect")
  })
})

describe("the fragment never survives", () => {
  it("drops an implicit-grant access token", () => {
    // RFC 6749 §4.2.2 puts the token here. The browser never sends a fragment
    // to any server, but `chrome.tabs` hands it to us in full — so this is the
    // one exclusion rule that is complete and costs nothing.
    expect(canonicalize("https://app.example.com/callback#access_token=ya29.SECRET&token_type=bearer"))
      .toBe("https://app.example.com/callback")
  })

  it("drops an anchor that would otherwise split a page into many keys", () => {
    expect(canonicalize("https://example.com/faq#q17")).toBe("https://example.com/faq")
  })
})

describe("significant parameters survive", () => {
  it("keeps a WordPress post id", () => {
    expect(canonicalize("https://blog.example.com/?p=1234&utm_source=rss"))
      .toBe("https://blog.example.com/?p=1234")
  })

  it("keeps pagination", () => {
    expect(canonicalize("https://forum.example.com/thread?page=3&fbclid=abc"))
      .toBe("https://forum.example.com/thread?page=3")
  })

  it("keeps a parameter nobody enumerated", () => {
    // The tracking rule is a blocklist on purpose: dropping an unknown
    // parameter silently collapses distinct pages into one key, and a collision
    // is not repairable while a duplicate is.
    expect(canonicalize("https://cms.example.com/view?storyId=88213"))
      .toBe("https://cms.example.com/view?storyId=88213")
  })

  it("orders parameters so two orderings are one key", () => {
    expect(canonicalize("https://example.com/s?b=2&a=1")).toBe(canonicalize("https://example.com/s?a=1&b=2"))
    expect(canonicalize("https://example.com/s?b=2&a=1")).toBe("https://example.com/s?a=1&b=2")
  })
})

describe("what canonicalization deliberately does not do", () => {
  it("does not upgrade the scheme", () => {
    // An elected address must be one we could have observed. Inventing an https
    // twin for an http-only host produces a Lookup that is a systematic
    // Silence; the two schemes are an Alias relationship instead.
    expect(canonicalize("http://example.com/a")).toBe("http://example.com/a")
    expect(canonicalize("http://example.com/a")).not.toBe(canonicalize("https://example.com/a"))
  })

  it("returns nothing for a string that is not an address", () => {
    expect(canonicalize("not a url")).toBeUndefined()
    expect(canonicalize("")).toBeUndefined()
  })

  it("does not recurse forever on a self-wrapping AMP chain", () => {
    const wrapped =
      "https://cdn.ampproject.org/c/s/cdn.ampproject.org/c/s/cdn.ampproject.org/c/s/cdn.ampproject.org/c/s/example.com/a"
    expect(canonicalize(wrapped)).toBeDefined()
  })
})
