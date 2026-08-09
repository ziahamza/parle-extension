/**
 * Why the library is vendored, demonstrated rather than asserted.
 *
 * The published package hashes key strings itself, with a hash that cannot be
 * reimplemented from its name. If that were merely an aesthetic complaint the
 * dependency would have stayed a dependency. It is not: ADR 0010 promises
 * anyone can rebuild these artifacts, and a wire format defined as "whatever
 * this npm build does to a string" cannot be rebuilt in Rust or Python at all.
 *
 * These tests pin the two facts that decision rests on, so that if either ever
 * stops being true someone finds out here rather than in an issue from a
 * self-hoster whose index answers "not listed" for everything.
 */
import { describe, expect, it } from "vitest"
import { hashString } from "./hash.ts"
import {
  binaryFuseFilterContains,
  binaryFuseFilterHasKey,
  createBinaryFuseFilter,
  createBinaryFuseFilterFromKeys
} from "./filter.ts"
import { deserializeBinaryFuseFilter, serializeBinaryFuseFilter } from "./serialize.ts"

describe("the hash we do not use", () => {
  it("collides on strings a standard FNV-1a would separate", () => {
    // The library XORs the low byte of each UTF-16 code unit and mixes the high
    // byte only when the code unit exceeds 255, so U+0100 and the pair
    // U+0000 U+0001 walk the same path. Harmless for URLs — and proof that the
    // function is a specific build's behaviour rather than a named algorithm.
    expect(hashString("\u0100")).toEqual(hashString("\u0000\u0001"))
    expect(hashString("\u0100")).toEqual([137529095, 3035328058])
  })

  it("is not what Parle keys with", () => {
    // Belt and braces: the string API still works, and its filters are simply
    // different objects from ours. Nothing in @parle/index-codec calls it.
    const filter = createBinaryFuseFilter(["https://example.com/"])
    expect(binaryFuseFilterContains(filter, "https://example.com/")).toBe(true)
  })
})

describe("the entry point we added", () => {
  const keys = Array.from({ length: 5_000 }, (_, i) => ({ high: (i * 2654435761) >>> 0, low: (i * 40503) >>> 0 }))

  const build = () => {
    const high = new Uint32Array(keys.length)
    const low = new Uint32Array(keys.length)
    keys.forEach((key, i) => {
      high[i] = key.high
      low[i] = key.low
    })
    return createBinaryFuseFilterFromKeys(high, low, 8)
  }

  it("has no false negatives, before or after a round trip", () => {
    const filter = build()
    for (const key of keys) {
      expect(binaryFuseFilterHasKey(filter, key.high, key.low)).toBe(true)
    }

    const revived = deserializeBinaryFuseFilter(serializeBinaryFuseFilter(filter))
    if ("_tag" in revived) throw new Error(revived.detail)
    for (const key of keys) {
      expect(binaryFuseFilterHasKey(revived, key.high, key.low)).toBe(true)
    }
  })

  it("gives up on a key set with real duplicates in it, which is why the builder deduplicates", () => {
    // Upstream's duplicate handling looks more capable than it is: measured, a
    // 500-key set survives about five repeats and then exhausts all 100 seed
    // attempts. A corpus of canonicalized URLs arrives with far more than five,
    // so `Build.buildFilter` deduplicating first is load-bearing rather than
    // tidy — and this test is here so nobody removes it as an optimisation.
    const withDuplicates = [...keys.slice(0, 500), ...keys.slice(0, 100)]
    const high = new Uint32Array(withDuplicates.length)
    const low = new Uint32Array(withDuplicates.length)
    withDuplicates.forEach((key, i) => {
      high[i] = key.high
      low[i] = key.low
    })
    expect(() => createBinaryFuseFilterFromKeys(high, low, 8)).toThrow(/maximum iterations/)
  })

  it("builds an empty filter without complaint", () => {
    // v1 publishes Hacker News only and a fresh corpus can legitimately be
    // empty. That has to be an artifact, not an exception.
    const filter = createBinaryFuseFilterFromKeys(new Uint32Array(0), new Uint32Array(0), 8)
    const revived = deserializeBinaryFuseFilter(serializeBinaryFuseFilter(filter))
    expect("_tag" in revived).toBe(false)
  })

  it("refuses mismatched key arrays instead of building half a filter", () => {
    expect(() => createBinaryFuseFilterFromKeys(new Uint32Array(3), new Uint32Array(4), 8)).toThrow()
  })
})

describe("the serialized header", () => {
  it("is 28 bytes, little-endian, version 1, and says its own fingerprint width", () => {
    const filter = createBinaryFuseFilterFromKeys(new Uint32Array([1, 2, 3]), new Uint32Array([4, 5, 6]), 16)
    const bytes = serializeBinaryFuseFilter(filter)
    const view = new DataView(bytes.buffer)
    expect(view.getUint8(0)).toBe(1)
    expect(view.getUint8(1)).toBe(16)
    expect(view.getUint32(24, true)).toBe(filter.arrayLength)
    expect(bytes.length).toBe(28 + filter.arrayLength * 2)
  })

  it("reads back into a filter equal in every field to the one that was written", () => {
    const filter = createBinaryFuseFilterFromKeys(new Uint32Array([7, 8]), new Uint32Array([9, 10]), 32)
    const revived = deserializeBinaryFuseFilter(serializeBinaryFuseFilter(filter))
    if ("_tag" in revived) throw new Error(revived.detail)
    expect(revived.fingerprintBits).toBe(filter.fingerprintBits)
    expect(revived.seedHigh).toBe(filter.seedHigh)
    expect(revived.seedLow).toBe(filter.seedLow)
    expect(revived.segmentLength).toBe(filter.segmentLength)
    expect(revived.segmentCount).toBe(filter.segmentCount)
    expect(revived.arrayLength).toBe(filter.arrayLength)
    expect([...revived.fingerprints]).toEqual([...filter.fingerprints])
  })
})
