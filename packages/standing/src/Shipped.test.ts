/**
 * The checked-in artifact, read exactly as a build would read it.
 *
 * `data/standing.json` is committed rather than fetched, so that a build is
 * hermetic and so that nobody's release depends on four third parties being up
 * that morning. That makes this file the only thing standing between a bad
 * refresh and a shipped artifact: `tools/build.ts` runs on a developer's
 * machine, against live sources that change, and its output goes straight into
 * a release.
 *
 * These checks are therefore about the *file on disk*, not about the schema in
 * the abstract — including the ones that look like trivia. The size budget is
 * here because the extension ships it to every reader; the provenance
 * completeness is here because the licences require attribution and an artifact
 * that cannot say where a layer came from must not be shipped at all.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { licenceNotices, readStanding, standingOf, type StandingArtifact } from "./Artifact.ts"
import { RATER_NAMES, type RaterOrigin } from "./Standing.ts"

const path = fileURLToPath(new URL("../data/standing.json", import.meta.url))
const bytes = readFileSync(path)
const artifact = readStanding(JSON.parse(bytes.toString("utf8")))

describe("the checked-in artifact", () => {
  it("decodes", () => {
    expect(artifact).toBeDefined()
  })

  it("is small enough to ship to every reader", () => {
    // 250 KB raw is the budget the feasibility study set. It is checked on the
    // raw bytes rather than gzipped because the raw size is what a refresh can
    // quietly triple.
    expect(bytes.byteLength).toBeLessThanOrEqual(250 * 1024)
  })

  it("holds thousands of publishers rather than dozens", () => {
    // A join that silently breaks produces a valid, tiny artifact. This is the
    // check that notices.
    expect(Object.keys((artifact as StandingArtifact).publishers).length).toBeGreaterThan(2_000)
  })
})

describe("its provenance block", () => {
  const raters = (artifact as StandingArtifact).raters

  it("accounts for all four raters", () => {
    for (const origin of Object.keys(RATER_NAMES) as ReadonlyArray<RaterOrigin>) {
      expect(raters[origin]).toBeDefined()
    }
  })

  it("gives every rater a licence, a URL, a source and a date", () => {
    for (const [origin, rater] of Object.entries(raters)) {
      expect(rater.name.length, origin).toBeGreaterThan(0)
      expect(rater.license, origin).toMatch(/^(CC BY|CC BY-SA|CC BY-NC|CC0)/)
      expect(rater.licenseUrl, origin).toMatch(/^https:\/\/creativecommons\.org\//)
      expect(rater.sourceUrl, origin).toMatch(/^https:\/\//)
      expect(Number.isNaN(Date.parse(rater.fetchedAt)), origin).toBe(false)
    }
  })

  it("says out loud where AllSides actually came from", () => {
    // ADR 0022 turns on this being honest: allsides.com refuses automated
    // clients, the ratings are read from a community mirror, and an artifact
    // that recorded `direct` here would be claiming a provenance it does not
    // have.
    expect(raters.allsides?.obtained).toBe("mirror")
    expect(raters.allsides?.note).toBeDefined()
    expect(raters.allsides?.license).toBe("CC BY-NC 4.0")
  })

  it("records a layer it could not fetch rather than omitting it", () => {
    // No layer should be `unavailable` in a shipped artifact — but if one is,
    // it must still be in the block, with a note saying so, because a missing
    // rater and an unrated publisher look identical to a reader.
    for (const [origin, rater] of Object.entries(raters)) {
      if (rater.obtained === "unavailable") expect(rater.note, origin).toBeDefined()
    }
  })

  it("produces one licence notice per rater", () => {
    expect(licenceNotices(artifact as StandingArtifact)).toHaveLength(4)
  })
})

describe("what it says about publishers a reader will meet", () => {
  const lookup = (host: string) => standingOf(artifact as StandingArtifact, host)

  it("answers for a major publisher, attributed", () => {
    const standing = lookup("www.nytimes.com")
    expect(standing?.matchedHost).toBe("nytimes.com")
    expect(standing?.claims.map((claim) => claim.attribution)).toContain(
      "Generally reliable — per Wikipedia's perennial sources list"
    )
  })

  it("answers for a site the Iffy Index lists", () => {
    const standing = lookup("infowars.com")
    expect(standing?.claims.some((claim) => claim._tag === "Credibility")).toBe(true)
  })

  it("climbs a two-level suffix on a real entry", () => {
    expect(lookup("news.bbc.co.uk")?.matchedHost).toBe("bbc.co.uk")
  })

  it("gives every claim it returns an origin and words to show", () => {
    for (const host of ["nytimes.com", "infowars.com", "bbc.co.uk", "breitbart.com", "foxnews.com"]) {
      const claims = lookup(host)?.claims ?? []
      expect(claims.length, host).toBeGreaterThan(0)
      for (const claim of claims) {
        expect(RATER_NAMES[claim.origin], `${host} ${claim._tag}`).toBeDefined()
        expect(claim.attribution.endsWith(`per ${RATER_NAMES[claim.origin]}`), `${host} ${claim._tag}`).toBe(true)
      }
    }
  })

  it("has nothing to say about a page nobody rates", () => {
    expect(lookup("some-personal-blog.example")).toBeUndefined()
  })

  it("never files an entry under a bare public suffix", () => {
    // An entry under `co.uk` would be returned for every British publisher the
    // walk failed to match. The walk refuses to ask for one; this is the check
    // that the build never wrote one either.
    for (const domain of Object.keys((artifact as StandingArtifact).publishers)) {
      expect(domain.split(".").length, domain).toBeGreaterThanOrEqual(2)
      expect(["co.uk", "com.au", "co.jp", "com.br", "co.za", "com"], domain).not.toContain(domain)
    }
  })
})
