/**
 * The properties the whole design rests on, checked rather than asserted.
 *
 * Two of them are non-negotiable and one is merely important:
 *
 * 1. **Zero false negatives.** A key that went in must come out. This is the
 *    only guarantee the index makes, and every ADR that permits shipping it
 *    depends on it.
 * 2. **Corruption degrades, never throws.** Truncated bodies, captive-portal
 *    HTML, half-written cache entries and flipped bits all arrive as a
 *    `Rejection` value.
 * 3. **The false-positive rate is roughly what was measured.** Around 0.38% at
 *    an 8-bit fingerprint. Being wrong in this direction costs one Lookup we
 *    were probably going to make anyway, so the tolerance here is generous on
 *    purpose — the test exists to catch a broken build, not to police the
 *    fourth decimal place.
 */
import { describe, expect, it } from "vitest"
import type { Network } from "@parle/domain/Network"
import { SubjectUrl } from "@parle/domain/Subject"
import { buildAddendum, buildFilter } from "./Build.ts"
import { decodeArtifact, hintFor, isPinned, keyCountOf, type OfferedFilter } from "./Artifact.ts"
import { sha256Hex, utf8 } from "./Sha256.ts"
import { isString } from "@parle/domain/Refine"

const present = (n: number): ReadonlyArray<string> =>
  Array.from({ length: n }, (_, i) => `https://example.com/story/${i}`)

const absent = (n: number): ReadonlyArray<string> =>
  Array.from({ length: n }, (_, i) => `https://elsewhere.test/page/${i}?v=2`)

const offer = (network: Network, urls: ReadonlyArray<string>): OfferedFilter => {
  const built = buildFilter(urls)
  return { network, sha256: built.sha256, bytes: built.bytes }
}

const artifactOf = (filters: ReadonlyArray<OfferedFilter>) =>
  decodeArtifact({
    generation: "2026-08-01T00:00:00Z",
    canonicalizerVersion: "1",
    filters
  })

const asSubject = (url: string): SubjectUrl => SubjectUrl.make(url)

describe("round-tripping the filter", () => {
  const urls = present(50_000)
  const built = buildFilter(urls)

  it("survives serialize → pin → deserialize with every key intact", () => {
    const artifact = artifactOf([{ network: "hackernews", sha256: built.sha256, bytes: built.bytes }])
    expect(isString(artifact)).toBe(false)
    if (isString(artifact)) return

    expect(keyCountOf(artifact)).toBe(urls.length)
    for (const url of urls) {
      expect(hintFor(artifact, asSubject(url))._tag, url).toBe("Possible")
    }
  }, 20_000)

  it("costs about nine bits per key, which is what the sizing was done from", () => {
    // 9.03 bits/key was measured at 3,583,620 keys. Size quantizes in whole
    // segments (segmentLength × (segmentCount + 2)), so at 50,000 keys the last
    // partial segment is still a visible fraction of the artifact and the ratio
    // sits nearer 9.8. The band is wide enough to allow that and narrow enough
    // that a filter which has silently become 16-bit fails here.
    const bitsPerKey = (built.bytes.length * 8) / urls.length
    expect(bitsPerKey).toBeGreaterThan(8.5)
    expect(bitsPerKey).toBeLessThan(10.5)
  })

  it("has a false-positive rate near the measured 0.38%", () => {
    const artifact = artifactOf([{ network: "hackernews", sha256: built.sha256, bytes: built.bytes }])
    if (isString(artifact)) throw new Error(artifact)

    const probes = absent(200_000)
    let positives = 0
    for (const url of probes) {
      if (hintFor(artifact, asSubject(url))._tag === "Possible") positives++
    }
    const rate = positives / probes.length
    expect(rate).toBeGreaterThan(0.001)
    expect(rate).toBeLessThan(0.01)
  }, 20_000)

  it("is deterministic: the same keys produce the same bytes and the same pin", () => {
    // What makes `sha256` in the manifest checkable by a third party at all.
    const again = buildFilter(urls)
    expect(again.sha256).toBe(built.sha256)
    expect(sha256Hex(again.bytes)).toBe(built.sha256)
  })
})

describe("pinning", () => {
  const built = buildFilter(present(1_000))

  it("accepts bytes that hash to the pinned digest", () => {
    expect(isPinned(built.bytes, built.sha256)).toBe(true)
  })

  it("refuses a single flipped byte", () => {
    const tampered = Uint8Array.from(built.bytes)
    tampered[100] = (tampered[100] ?? 0) ^ 0x01
    expect(isPinned(tampered, built.sha256)).toBe(false)
    expect(artifactOf([{ network: "hackernews", sha256: built.sha256, bytes: tampered }])).toBe("sha256-mismatch")
  })

  it("refuses bytes pinned at somebody else's digest", () => {
    const other = buildFilter(present(999))
    expect(artifactOf([{ network: "hackernews", sha256: other.sha256, bytes: built.bytes }])).toBe("sha256-mismatch")
  })
})

describe("corruption degrades rather than throwing", () => {
  const built = buildFilter(present(1_000))

  const rejectedFor = (bytes: Uint8Array) =>
    artifactOf([{ network: "hackernews", sha256: sha256Hex(bytes), bytes }])

  it("refuses a truncated body", () => {
    // The pin is recomputed over the truncated bytes so this exercises the
    // DESERIALIZER, not the pin — a proxy that truncates and a manifest that
    // was refreshed against the truncated blob are both real.
    expect(rejectedFor(built.bytes.slice(0, built.bytes.length - 1_000))).toBe("bytes-unreadable")
  })

  it("refuses a body shorter than the header", () => {
    expect(rejectedFor(built.bytes.slice(0, 12))).toBe("bytes-unreadable")
  })

  it("refuses an HTML error page served with a 200", () => {
    const interstitial = utf8("<!doctype html><title>Just a moment…</title>")
    expect(rejectedFor(interstitial)).toBe("bytes-unreadable")
  })

  it("refuses a filter from a future format version", () => {
    const future = Uint8Array.from(built.bytes)
    future[0] = 2
    expect(rejectedFor(future)).toBe("bytes-unreadable")
  })

  it("refuses a fingerprint width outside 8, 16 and 32", () => {
    // The library's own type is `8 | 16 | 32`; 9, 10 and 12 are missing input
    // validation upstream rather than supported settings, and they throw at
    // serialize time. On the read side they must simply be declined.
    for (const width of [9, 10, 12, 0, 255]) {
      const odd = Uint8Array.from(built.bytes)
      odd[1] = width
      expect(rejectedFor(odd), `width ${width}`).toBe("bytes-unreadable")
    }
  })

  it("refuses a header whose geometry does not add up", () => {
    const inconsistent = Uint8Array.from(built.bytes)
    new DataView(inconsistent.buffer).setUint32(20, 999_999, true) // segmentCount
    expect(rejectedFor(inconsistent)).toBe("bytes-unreadable")
  })

  it("refuses an offer with no filters at all", () => {
    expect(artifactOf([])).toBe("no-filter-published")
  })

  it("refuses a body LONGER than its header describes", () => {
    // A concatenation, a proxy that appended, a cache entry written over a
    // longer one. Reading the prefix would adopt half an artifact and say
    // Serving. Checking the length as a lower bound rather than exactly is how
    // that gets through.
    const glued = new Uint8Array(built.bytes.length * 2)
    glued.set(built.bytes)
    glued.set(built.bytes, built.bytes.length)
    expect(rejectedFor(glued)).toBe("bytes-unreadable")

    const padded = new Uint8Array(built.bytes.length + 1)
    padded.set(built.bytes)
    expect(rejectedFor(padded)).toBe("bytes-unreadable")
  })

  it("refuses a header claiming zero segments", () => {
    // It satisfies the geometry check — arrayLength does equal
    // (0 + 2) × segmentLength — and then makes segmentCountLength zero, which
    // pins the first probe position to index 0 and pushes the third off the end
    // of the fingerprint table. Nothing throws; it simply answers nonsense,
    // which is the class of failure the deserializer exists to convert into a
    // refusal.
    const segmentLength = 4
    const arrayLength = 2 * segmentLength
    const bytes = new Uint8Array(28 + arrayLength)
    const view = new DataView(bytes.buffer)
    view.setUint8(0, 1)
    view.setUint8(1, 8)
    view.setUint32(12, 5, true)
    view.setUint32(16, segmentLength, true)
    view.setUint32(20, 0, true)
    view.setUint32(24, arrayLength, true)
    expect(rejectedFor(bytes)).toBe("bytes-unreadable")
  })

  it("reads a blob that arrived as a view into a larger buffer", () => {
    // What `fetch` → `arrayBuffer` hands you on Node, and what the Cache API
    // can hand you in the extension. Reading from byte zero of the backing
    // buffer instead of from the view would refuse every artifact ever
    // downloaded, and every test that builds its own bytes would still pass.
    const pool = new Uint8Array(built.bytes.length + 13)
    pool.set(built.bytes, 13)
    const view = new Uint8Array(pool.buffer, 13, built.bytes.length)
    const artifact = artifactOf([{ network: "hackernews", sha256: built.sha256, bytes: view }])
    expect(isString(artifact)).toBe(false)
    if (isString(artifact)) return
    expect(hintFor(artifact, asSubject("https://example.com/story/7"))._tag).toBe("Possible")
  })
})

describe("what the artifact will and will not say", () => {
  it("names which Networks suspect a Subject", () => {
    const everything = present(2_000)
    const onlyHackerNews = everything.slice(1_000)
    const artifact = artifactOf([offer("hackernews", everything), offer("reddit", everything.slice(0, 1_000))])
    if (isString(artifact)) throw new Error(artifact)

    const both = hintFor(artifact, asSubject(everything[0] ?? ""))
    expect(both._tag).toBe("Possible")
    if (both._tag === "Possible") expect([...both.networks].sort()).toEqual(["hackernews", "reddit"])

    // Every one of these is in the Hacker News filter and in no other, so all
    // of them must at least name it — a handful will also name Reddit, because
    // that is what a false positive is, and the assertion is written to be true
    // of a correct filter rather than of a lucky one.
    const named = onlyHackerNews.map((url) => hintFor(artifact, asSubject(url)))
    expect(named.every((hint) => hint._tag === "Possible" && hint.networks.includes("hackernews"))).toBe(true)
    const redditFalsePositives = named.filter(
      (hint) => hint._tag === "Possible" && hint.networks.includes("reddit")
    ).length
    expect(redditFalsePositives).toBeLessThan(onlyHackerNews.length / 20)
  })

  it("says NotListed — a fact about the index — and never that there are no Discussions", () => {
    const artifact = artifactOf([offer("hackernews", present(5_000))])
    if (isString(artifact)) throw new Error(artifact)

    const hint = hintFor(artifact, asSubject("https://nowhere.test/definitely-not-in-the-corpus"))
    expect(hint._tag).toBe("NotListed")
    // The point of the shape: there is nothing on a Hint to read as "no".
    expect(Object.keys(hint)).toEqual(["_tag"])
  })

  it("suspects every Network it holds when only the addendum matches", () => {
    // The addendum is not per-Network — it is whatever was added since the base
    // — so a hit there over-suspects. Over-suspecting costs a Lookup;
    // under-suspecting costs the reader a Discussion.
    const fresh = "https://example.com/published-yesterday"
    const addendum = buildAddendum([fresh])
    const artifact = decodeArtifact({
      generation: "2026-08-01T00:00:00Z",
      canonicalizerVersion: "1",
      filters: [offer("hackernews", present(1_000)), offer("reddit", present(1_000))],
      addendum: { baseGeneration: "2026-08-01T00:00:00Z", sha256: addendum.sha256, bytes: addendum.bytes }
    })
    if (isString(artifact)) throw new Error(artifact)

    const hint = hintFor(artifact, asSubject(fresh))
    expect(hint._tag).toBe("Possible")
    if (hint._tag === "Possible") expect([...hint.networks].sort()).toEqual(["hackernews", "reddit"])
  })

  it("drops an addendum belonging to a different base rather than trusting it", () => {
    const fresh = "https://example.com/published-yesterday"
    const addendum = buildAddendum([fresh])
    const artifact = decodeArtifact({
      generation: "2026-09-01T00:00:00Z",
      canonicalizerVersion: "1",
      filters: [offer("hackernews", present(1_000))],
      addendum: { baseGeneration: "2026-08-01T00:00:00Z", sha256: addendum.sha256, bytes: addendum.bytes }
    })
    if (isString(artifact)) throw new Error(artifact)

    expect(artifact.addendum.keys.length).toBe(0)
    expect(hintFor(artifact, asSubject(fresh))._tag).toBe("NotListed")
  })

  it("drops a corrupt addendum but keeps serving the base", () => {
    const base = present(1_000)
    const addendum = buildAddendum(["https://example.com/published-yesterday"])
    const mangled = Uint8Array.from(addendum.bytes)
    mangled[0] = 0x00
    const artifact = decodeArtifact({
      generation: "2026-08-01T00:00:00Z",
      canonicalizerVersion: "1",
      filters: [offer("hackernews", base)],
      addendum: { baseGeneration: "2026-08-01T00:00:00Z", sha256: sha256Hex(mangled), bytes: mangled }
    })
    if (isString(artifact)) throw new Error(artifact)

    expect(artifact.addendum.keys.length).toBe(0)
    expect(hintFor(artifact, asSubject(base[0] ?? ""))._tag).toBe("Possible")
  })
})
