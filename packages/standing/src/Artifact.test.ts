/**
 * Reading the artifact, and refusing to.
 *
 * The tests that matter most here are the negative ones. A lookup that returns
 * nothing costs a reader a line in a panel; a lookup that returns a rating the
 * named rater never made costs them the reason to believe any of it, and it
 * does so in somebody else's name.
 */
import { describe, expect, it } from "vitest"
import { licenceNotices, readStanding, standingOf, type StandingArtifact } from "./Artifact.ts"

const rater = {
  name: "AllSides Media Bias Ratings",
  license: "CC BY-NC 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
  sourceUrl: "https://www.allsides.com/media-bias/ratings",
  fetchedAt: "2026-08-24T20:00:00.000Z",
  obtained: "mirror",
  entries: 325
}

const raw = {
  schemaVersion: 1,
  builtAt: "2026-08-24T20:00:00.000Z",
  raters: {
    allsides: rater,
    "wikipedia-rsp": { ...rater, name: "Wikipedia", license: "CC BY-SA 4.0", obtained: "direct" },
    iffy: { ...rater, name: "Iffy Index", license: "CC BY 4.0", obtained: "direct" },
    wikidata: { ...rater, name: "Wikidata", license: "CC0 1.0", obtained: "direct" }
  },
  publishers: {
    "example.com": {
      name: "Example",
      allsides: "left-center",
      wikipediaRsp: "generally-reliable",
      iffy: "mixed",
      wikidata: { alignment: "centre-left", founded: "1851", owner: "Someone", country: "Nowhere" }
    },
    "bbc.co.uk": { name: "BBC News", wikipediaRsp: "generally-reliable" },
    "hollow.com": {}
  }
}

const artifact = readStanding(raw) as StandingArtifact

describe("reading the artifact", () => {
  it("decodes a well-formed one", () => {
    expect(artifact).toBeDefined()
    expect(Object.keys(artifact.publishers)).toHaveLength(3)
  })

  it("fails closed on a value this build does not know", () => {
    // The dangerous case. A lean of "hard-left" is not a lean we can spell, and
    // a build that half-understood the artifact would render it as something.
    expect(readStanding({ ...raw, publishers: { "a.com": { allsides: "hard-left" } } })).toBeUndefined()
    expect(readStanding({ ...raw, publishers: { "a.com": { wikipediaRsp: "probably-fine" } } })).toBeUndefined()
    expect(readStanding({ ...raw, publishers: { "a.com": { iffy: "terrible" } } })).toBeUndefined()
  })

  it("fails closed on a rater it cannot name", () => {
    expect(readStanding({ ...raw, raters: { ...raw.raters, mbfc: rater } })).toBeUndefined()
  })

  it("fails closed on a missing provenance field", () => {
    const { licenseUrl: _dropped, ...withoutLicenceUrl } = rater
    expect(readStanding({ ...raw, raters: { ...raw.raters, allsides: withoutLicenceUrl } })).toBeUndefined()
  })

  it("fails closed on a schema version it does not support", () => {
    expect(readStanding({ ...raw, schemaVersion: 2 })).toBeUndefined()
  })

  it("fails closed on rubbish, without throwing", () => {
    for (const nonsense of [undefined, null, 0, "", [], {}, { schemaVersion: 1 }]) {
      expect(readStanding(nonsense)).toBeUndefined()
    }
  })

  it("does not throw on a value whose properties throw when read", () => {
    const hostile = { schemaVersion: 1 }
    Object.defineProperty(hostile, "publishers", {
      enumerable: true,
      get() {
        throw new Error("no")
      }
    })
    expect(readStanding(hostile)).toBeUndefined()
  })
})

describe("looking a host up", () => {
  it("finds an exact match and says so", () => {
    const standing = standingOf(artifact, "example.com")
    expect(standing?.matchedOn).toBe("exact")
    expect(standing?.matchedHost).toBe("example.com")
    expect(standing?.name).toBe("Example")
  })

  it("climbs to the parent domain and says it climbed", () => {
    const standing = standingOf(artifact, "www.example.com")
    expect(standing?.matchedOn).toBe("parent-domain")
    expect(standing?.matchedHost).toBe("example.com")
    expect(standing?.host).toBe("www.example.com")
  })

  it("climbs across a two-level suffix", () => {
    expect(standingOf(artifact, "news.bbc.co.uk")?.matchedHost).toBe("bbc.co.uk")
  })

  it("has nothing to say about an unrated publisher", () => {
    expect(standingOf(artifact, "nobody-rated-this.example.org")).toBeUndefined()
  })

  it("has nothing to say about a host that is not a publisher", () => {
    expect(standingOf(artifact, "localhost")).toBeUndefined()
    expect(standingOf(artifact, "10.0.0.1")).toBeUndefined()
  })

  it("declines to construct a Standing from an entry with no claims", () => {
    // `hollow.com` has an entry and nothing in it. Returning a Standing with an
    // empty claims list would render as a heading over nothing.
    expect(standingOf(artifact, "hollow.com")).toBeUndefined()
  })
})

describe("attribution", () => {
  it("names a rater on every claim, in the claim itself", () => {
    const standing = standingOf(artifact, "example.com")
    expect(standing?.claims.length).toBe(7)
    for (const claim of standing?.claims ?? []) {
      expect(claim.origin.length).toBeGreaterThan(0)
      expect(claim.attribution).toMatch(/ — per .+$/)
    }
  })

  it("says what a reader would recognise", () => {
    const claims = standingOf(artifact, "example.com")?.claims ?? []
    const spoken = claims.map((claim) => claim.attribution)
    expect(spoken).toContain("Lean Left — per AllSides")
    expect(spoken).toContain("Generally reliable — per Wikipedia's perennial sources list")
    expect(spoken).toContain("Listed as unreliable, mixed factual reporting — per the Iffy Index")
    expect(spoken).toContain("Founded 1851 — per Wikidata")
  })

  it("keeps the origin and the words in step", () => {
    const claims = standingOf(artifact, "example.com")?.claims ?? []
    const lean = claims.find((claim) => claim._tag === "Lean")
    expect(lean?.origin).toBe("allsides")
    expect(lean?.attribution.endsWith("per AllSides")).toBe(true)
  })
})

describe("the licence notices", () => {
  it("names every rater, its licence, its source and when it was compiled", () => {
    const notices = licenceNotices(artifact)
    expect(notices).toHaveLength(4)
    for (const notice of notices) {
      expect(notice).toMatch(/^.+ — CC.+ \(https:\/\/creativecommons\.org\/.+\), from https:\/\/.+, compiled \d{4}-\d{2}-\d{2}\.$/)
    }
  })
})
