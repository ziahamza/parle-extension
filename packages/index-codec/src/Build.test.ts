/**
 * The builder is in the shared package so that the backend and the client run
 * the same code, and a golden vector that passes in one passes in the other.
 * These tests hold that seam honest.
 */
import { describe, expect, it } from "vitest"
import { buildAddendum, buildFilter, pinOf } from "./Build.ts"
import { decodeArtifact, hintFor } from "./Artifact.ts"
import type { SubjectUrl } from "@parle/domain/Subject"

const urls = Array.from({ length: 3_000 }, (_, i) => `https://example.com/story/${i}`)

const asSubject = (url: string): SubjectUrl => url as SubjectUrl

const artifactOf = (bytes: Uint8Array, sha256: string) =>
  decodeArtifact({
    generation: "g",
    canonicalizerVersion: "1",
    filters: [{ network: "hackernews", sha256, bytes }]
  })

describe("buildFilter", () => {
  it("deduplicates, because construction cannot survive a corpus that has not been", () => {
    // A real corpus is full of repeats — the same story submitted twice, the
    // same canonical URL reached from several aliases. Without this the build
    // does not merely waste slots, it throws after a hundred seed attempts.
    const messy = [...urls, ...urls.slice(0, 1_000), ...urls.slice(0, 500)]
    const built = buildFilter(messy)
    expect(built.keyCount).toBe(urls.length)

    const artifact = artifactOf(built.bytes, built.sha256)
    if (typeof artifact === "string") throw new Error(artifact)
    for (const url of urls) {
      expect(hintFor(artifact, asSubject(url))._tag, url).toBe("Possible")
    }
  })

  it("is order-independent: the artifact is a function of the key SET", () => {
    // The property that makes the manifest's `sha256` worth anything to a third
    // party. A rebuilder with the same corpus in a different order — a
    // different query plan, a different shard read order, a different language
    // — must land on the same bytes, or "reproducible" means "reproducible on
    // our CI". Measured true: the construction bucket-sorts keys by hash before
    // peeling, so input order does not reach the fingerprint table.
    const forwards = buildFilter(urls).sha256
    expect(buildFilter([...urls].reverse()).sha256).toBe(forwards)
    expect(buildFilter([...urls].sort()).sha256).toBe(forwards)

    // And under a shuffle, which is the case a reversal would not catch.
    let seed = 12345
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const shuffled = [...urls]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      const a = shuffled[i] ?? ""
      shuffled[i] = shuffled[j] ?? ""
      shuffled[j] = a
    }
    expect(buildFilter(shuffled).sha256).toBe(forwards)
  })

  it("publishes a pin that matches its own bytes", () => {
    const built = buildFilter(urls)
    expect(pinOf(built.bytes)).toBe(built.sha256)
    expect(built.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it("builds an empty corpus into a real artifact", () => {
    const built = buildFilter([])
    expect(built.keyCount).toBe(0)
    expect(typeof artifactOf(built.bytes, built.sha256)).not.toBe("string")
  })
})

describe("buildAddendum", () => {
  it("deduplicates and pins, like the filter", () => {
    const built = buildAddendum([...urls, ...urls])
    expect(built.keyCount).toBe(urls.length)
    expect(pinOf(built.bytes)).toBe(built.sha256)
  })

  it("is fully order-independent, because it sorts", () => {
    expect(buildAddendum([...urls].reverse()).sha256).toBe(buildAddendum(urls).sha256)
  })
})
