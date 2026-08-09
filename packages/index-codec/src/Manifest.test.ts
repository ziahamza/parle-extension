/**
 * The manifest is the only mutable document, so every rejection path in it is a
 * path a shipped client will take one day. Ticket 13 asks for a fixture per
 * path; this is it.
 *
 * The pair of rules under test is the important part: unknown FIELDS are
 * ignored so the backend can ship ahead of the client, and unknown VALUES are
 * refused so an old client never probes something it does not understand.
 */
import { describe, expect, it } from "vitest"
import * as Option from "effect/Option"
import { elect, lookupsEnabledFor, readManifest, sharedDigestMinScore, type Manifest } from "./Manifest.ts"

const digest = (seed: string): string => seed.repeat(64).slice(0, 64)

const wellFormed = {
  schemaVersion: 1,
  generation: "2026-08-01T00:00:00Z",
  canonicalizerVersion: "1",
  filters: {
    hackernews: {
      kind: "binary-fuse",
      fingerprintBits: 8,
      serializationVersion: 1,
      keyCount: 3_768_666,
      bytes: 4_255_232,
      url: "/v1/blobs/aa.bin",
      sha256: digest("a")
    }
  },
  addendum: {
    kind: "u64-truncated-32",
    baseGeneration: "2026-08-01T00:00:00Z",
    keyCount: 15_890,
    url: "/v1/blobs/bb.bin",
    sha256: digest("b")
  },
  policy: { lookupsEnabled: { x: false, hackernews: true }, sharedDigestMinScore: 50 },
  digests: { baseUrl: "https://index.example/v1/digests/" }
}

const read = (raw: unknown): Manifest => {
  const manifest = readManifest(raw)
  if (typeof manifest === "string") throw new Error(`expected a manifest, got ${manifest}`)
  return manifest
}

describe("reading a manifest", () => {
  it("decodes a well-formed one", () => {
    const manifest = read(wellFormed)
    expect(manifest.generation).toBe("2026-08-01T00:00:00Z")
    expect(lookupsEnabledFor(manifest, "x")).toEqual(Option.some(false))
    expect(sharedDigestMinScore(manifest)).toEqual(Option.some(50))
  })

  it("carries ADR 0001's kill switch and ADR 0007's threshold without a build", () => {
    const manifest = read(wellFormed)
    // Thrown for X, left alone for Hacker News, and SILENT for Reddit — three
    // different answers, and the third must not read as the second.
    expect(lookupsEnabledFor(manifest, "x")).toEqual(Option.some(false))
    expect(lookupsEnabledFor(manifest, "hackernews")).toEqual(Option.some(true))
    expect(Option.isNone(lookupsEnabledFor(manifest, "reddit"))).toBe(true)
  })

  it("says nothing about policy when the manifest says nothing, rather than saying yes", () => {
    // The failure this shape prevents: a client that could not reach the
    // manifest, or reached an older one, enabling an authenticated request
    // against the reader's own account by default.
    const silent = { ...wellFormed }
    delete (silent as { policy?: unknown }).policy
    const manifest = read(silent)
    expect(Option.isNone(lookupsEnabledFor(manifest, "x"))).toBe(true)
    expect(Option.isNone(sharedDigestMinScore(manifest))).toBe(true)
  })

  it("ignores fields it has never heard of", () => {
    // What lets the backend publish a new artifact kind without a coordinated
    // release. If this stops being true, the two tracks can no longer ship
    // independently, which is most of what ADR 0011 buys.
    const manifest = read({ ...wellFormed, somethingNew: { nested: [1, 2, 3] }, filters: wellFormed.filters })
    expect(manifest.schemaVersion).toBe(1)
  })

  it("refuses a document that is not a manifest at all", () => {
    expect(readManifest("<!doctype html>")).toBe("manifest-unreadable")
    expect(readManifest(null)).toBe("manifest-unreadable")
    expect(readManifest({})).toBe("manifest-unreadable")
  })

  it("refuses a pin that is not a lowercase 64-hex-digit digest", () => {
    // Detected at election rather than at decode, because `filters` values are
    // read entry by entry so that a future filter FAMILY cannot sink the whole
    // document (see below). The rejection reaching the shelf is the same either
    // way, and a Hacker News entry we cannot read is still a refusal — it is a
    // filter this build was meant to be able to use.
    const shouty = read({
      ...wellFormed,
      filters: { hackernews: { ...wellFormed.filters.hackernews, sha256: digest("A") } }
    })
    expect(elect(shouty, "1")).toEqual({ _tag: "Ignore", rejection: "manifest-unreadable" })

    const short = read({
      ...wellFormed,
      filters: { hackernews: { ...wellFormed.filters.hackernews, sha256: "abc" } }
    })
    expect(elect(short, "1")).toEqual({ _tag: "Ignore", rejection: "manifest-unreadable" })
  })

  it("ignores a policy entry for a Network it has never heard of", () => {
    const manifest = read({
      ...wellFormed,
      policy: { ...wellFormed.policy, lookupsEnabled: { ...wellFormed.policy.lookupsEnabled, lemmy: true } }
    })
    expect(lookupsEnabledFor(manifest, "x")).toEqual(Option.some(false))
  })
})

describe("electing what to fetch", () => {
  it("elects the published filters and the addendum", () => {
    const election = elect(read(wellFormed), "1")
    expect(election._tag).toBe("Fetch")
    if (election._tag !== "Fetch") return
    expect(election.filters.map((elected) => elected.network)).toEqual(["hackernews"])
    expect(Option.isSome(election.addendum)).toBe(true)
  })

  it("IGNORES EVERYTHING on a canonicalizerVersion mismatch", () => {
    // The one guard whose failure is invisible. A client probing a filter built
    // from different canonicalization rules gets "not listed" for pages that
    // are in it — a silent false negative, which is the single failure a
    // membership filter is supposed to make impossible. Refusing the whole
    // document, rather than the filter, is what keeps anyone from later adding
    // a "but the filter itself is fine" exception.
    const election = elect(read(wellFormed), "2")
    expect(election).toEqual({ _tag: "Ignore", rejection: "canonicalizer-mismatch" })
  })

  it("checks the canonicalizer before anything else it might have objected to", () => {
    const alsoBroken = read({ ...wellFormed, schemaVersion: 99 })
    expect(elect(alsoBroken, "2")).toEqual({ _tag: "Ignore", rejection: "canonicalizer-mismatch" })
  })

  it("refuses a schema version it does not know", () => {
    expect(elect(read({ ...wellFormed, schemaVersion: 2 }), "1")).toEqual({
      _tag: "Ignore",
      rejection: "schema-version-unsupported"
    })
  })

  it("refuses a filter family it cannot read", () => {
    const cuckoo = read({
      ...wellFormed,
      filters: { hackernews: { ...wellFormed.filters.hackernews, kind: "cuckoo" } }
    })
    expect(elect(cuckoo, "1")).toEqual({ _tag: "Ignore", rejection: "filter-kind-unsupported" })
  })

  it("refuses an inner serialization version it cannot read", () => {
    const future = read({
      ...wellFormed,
      filters: { hackernews: { ...wellFormed.filters.hackernews, serializationVersion: 2 } }
    })
    expect(elect(future, "1")).toEqual({ _tag: "Ignore", rejection: "filter-kind-unsupported" })
  })

  it("refuses a fingerprint width that is not 8, 16 or 32", () => {
    const twelve = read({
      ...wellFormed,
      filters: { hackernews: { ...wellFormed.filters.hackernews, fingerprintBits: 12 } }
    })
    expect(elect(twelve, "1")).toEqual({ _tag: "Ignore", rejection: "fingerprint-width-unsupported" })
  })

  it("skips a Network it has never heard of without refusing the rest", () => {
    // The forward-skew case that matters most: adding a Network must not be a
    // format change, so an unknown key is dropped and Hacker News still loads.
    const withLemmy = read({
      ...wellFormed,
      filters: { ...wellFormed.filters, lemmy: { ...wellFormed.filters.hackernews, url: "/v1/blobs/cc.bin" } }
    })
    const election = elect(withLemmy, "1")
    expect(election._tag).toBe("Fetch")
    if (election._tag !== "Fetch") return
    expect(election.filters.map((elected) => elected.network)).toEqual(["hackernews"])
  })

  it("skips an unknown Network whose entry is a SHAPE this build has never seen", () => {
    // The test above only proves a new KEY survives, and it proves it with an
    // entry that already is a FilterRef — an input that satisfies the claim
    // trivially. The claim being made is bigger: the backend can publish a new
    // artifact family without a coordinated release. So the entry here has no
    // fingerprintBits, no serializationVersion, no keyCount, and a field this
    // build has never heard of. It must be stepped over, and Hacker News must
    // still load — not take the whole document, and with it the whole index,
    // down.
    const withRibbon = read({
      ...wellFormed,
      filters: {
        ...wellFormed.filters,
        lemmy: { kind: "ribbon", overhead: 1.02, url: "/v1/blobs/cc.bin", sha256: digest("c") }
      }
    })
    const election = elect(withRibbon, "1")
    expect(election._tag).toBe("Fetch")
    if (election._tag !== "Fetch") return
    expect(election.filters.map((elected) => elected.network)).toEqual(["hackernews"])
  })

  it("drops an addendum of a family it cannot read, and keeps the base", () => {
    // Addendum failures degrade; only filter failures refuse.
    const withRoaring = read({
      ...wellFormed,
      addendum: { kind: "roaring", baseGeneration: "2026-08-01T00:00:00Z", url: "/v1/blobs/dd.bin" }
    })
    const election = elect(withRoaring, "1")
    expect(election._tag).toBe("Fetch")
    if (election._tag !== "Fetch") return
    expect(Option.isNone(election.addendum)).toBe(true)
    expect(election.filters.map((elected) => elected.network)).toEqual(["hackernews"])
  })

  it("reads a policy value of an unexpected type as NO INSTRUCTION, not as yes", () => {
    // Two failures in one. A future `lookupsEnabled` value — a schedule, a
    // percentage, an object — must not make the document undecodable, because
    // that costs the whole index; and it must not read as truthy either, or a
    // backend that started publishing richer controls would silently enable an
    // authenticated request against the reader's own X account.
    const richer = read({
      ...wellFormed,
      policy: {
        lookupsEnabled: { x: { rolloutPercent: 100 }, hackernews: true },
        sharedDigestMinScore: { hackernews: 50 }
      }
    })
    expect(Option.isNone(lookupsEnabledFor(richer, "x"))).toBe(true)
    expect(lookupsEnabledFor(richer, "hackernews")).toEqual(Option.some(true))
    expect(Option.isNone(sharedDigestMinScore(richer))).toBe(true)
  })

  it("never throws, whatever it is handed", () => {
    // `Shelf.offer` promises never to throw and its manifest parameter is
    // `unknown` by design, so the promise has to hold here, where an untrusted
    // value is first touched. Reading a property can throw; a decoder surfaces
    // that as a defect rather than a schema issue, and it would land in
    // whichever fiber happened to be refreshing the index.
    const hostiles: ReadonlyArray<readonly [string, unknown]> = [
      ["a getter that throws", {
        get schemaVersion(): number {
          throw new Error("boom")
        }
      }],
      ["a proxy that throws on every trap", new Proxy({}, {
        get() {
          throw new Error("boom")
        },
        ownKeys() {
          throw new Error("boom")
        }
      })],
      ["a filters entry whose getter throws", {
        ...wellFormed,
        filters: {
          get hackernews(): never {
            throw new Error("boom")
          }
        }
      }],
      ["a self-referential document", (() => {
        const o: Record<string, unknown> = { schemaVersion: 1 }
        o["self"] = o
        return o
      })()],
      ["a bigint where a number belongs", { ...wellFormed, schemaVersion: 1n }]
    ]
    for (const [name, raw] of hostiles) {
      expect(() => readManifest(raw), name).not.toThrow()
      expect(readManifest(raw), name).toBe("manifest-unreadable")
    }
  })

  it("says so when nothing usable was published", () => {
    const empty = read({ ...wellFormed, filters: {} })
    expect(elect(empty, "1")).toEqual({ _tag: "Ignore", rejection: "no-filter-published" })
  })

  it("treats a Hacker News only manifest as entirely normal", () => {
    // v1 ships one Network. That must be a Fetch, not a degraded state and
    // certainly not an error: Reddit cannot be crawled from a datacenter IP,
    // and the `filters` map exists precisely so adding it later is an added key.
    const election = elect(read(wellFormed), "1")
    expect(election._tag).toBe("Fetch")
  })
})
