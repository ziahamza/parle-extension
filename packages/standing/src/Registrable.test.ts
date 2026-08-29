/**
 * The walk up the labels is the only thing standing between a reader on a
 * subdomain and either no Standing at all or somebody else's, so it is tested
 * for both directions of error: failing to climb, and climbing too far.
 */
import { describe, expect, it } from "vitest"
import { isBareSuffix, lookupCandidates, normalizeHost } from "./Registrable.ts"

describe("normalising a host", () => {
  it("lowercases, and drops a port and a trailing root dot", () => {
    expect(normalizeHost("WWW.Example.COM:8443")).toBe("www.example.com")
    expect(normalizeHost("example.com.")).toBe("example.com")
    expect(normalizeHost("  example.com  ")).toBe("example.com")
  })

  it("drops userinfo, which an address can carry into a host field", () => {
    expect(normalizeHost("user:pass@example.com")).toBe("example.com")
  })

  it("refuses the addresses no publisher is behind", () => {
    expect(normalizeHost("")).toBeUndefined()
    expect(normalizeHost("localhost")).toBeUndefined()
    expect(normalizeHost("192.168.1.4")).toBeUndefined()
    expect(normalizeHost("[2001:db8::1]")).toBeUndefined()
    expect(normalizeHost("not a host")).toBeUndefined()
  })
})

describe("the candidates a host is looked up under", () => {
  it("tries the host itself first", () => {
    expect(lookupCandidates("example.com")).toEqual(["example.com"])
  })

  it("climbs to the registrable domain", () => {
    expect(lookupCandidates("a.b.example.com")).toEqual(["a.b.example.com", "b.example.com", "example.com"])
  })

  it("climbs past www.", () => {
    expect(lookupCandidates("www.nytimes.com")).toEqual(["www.nytimes.com", "nytimes.com"])
  })
})

describe("two-level suffixes", () => {
  // The failure this exists to prevent: asking the artifact about `co.uk`, and
  // showing whatever came back for every British publisher there is.
  it("stops before co.uk", () => {
    expect(lookupCandidates("news.bbc.co.uk")).toEqual(["news.bbc.co.uk", "bbc.co.uk"])
  })

  it("stops before com.au and co.jp too", () => {
    expect(lookupCandidates("www.abc.net.au")).toEqual(["www.abc.net.au", "abc.net.au"])
    expect(lookupCandidates("www.asahi.co.jp")).toEqual(["www.asahi.co.jp", "asahi.co.jp"])
  })

  it("never offers a bare suffix as a candidate", () => {
    expect(lookupCandidates("co.uk")).toEqual([])
    expect(lookupCandidates("com")).toEqual([])
    for (const candidate of lookupCandidates("a.b.c.d.co.uk")) {
      expect(isBareSuffix(candidate)).toBe(false)
    }
  })

  it("treats an unlisted two-label host as a registrable domain, not a suffix", () => {
    // `bbc.uk` is a real registration; only `co.uk` and its listed siblings are
    // suffixes. Getting this backwards would delete a publisher rather than
    // invent one, but it would still delete it.
    expect(lookupCandidates("bbc.uk")).toEqual(["bbc.uk"])
    expect(isBareSuffix("bbc.uk")).toBe(false)
  })
})
