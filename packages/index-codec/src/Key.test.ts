/**
 * The golden vectors.
 *
 * ADR 0010 promises that anyone can rebuild these artifacts, and ticket 13
 * requires a vector file that both the CI builder and this test suite execute.
 * This is that file. A Rust or Python implementation that reproduces the table
 * below has reproduced Parle's key derivation exactly; one that does not will
 * build a filter this client cannot query, and — crucially — will do so
 * silently, producing an index that answers "not listed" for everything.
 *
 * The values were computed from the specification in ./Key.ts, and the SHA-256
 * prefixes were cross-checked against an independent implementation.
 */
import { describe, expect, it } from "vitest"
import { key32, keyHex, keyOf, keyOfCanonical } from "./Key.ts"
import type { SubjectUrl } from "@parle/domain/Subject"
import { sha256Hex, utf8 } from "./Sha256.ts"

/** canonical URL → SHA-256 prefix, key64 in hex (big-endian), and the 32-bit truncation. */
const vectors = [
  { url: "", digestPrefix: "e3b0c44298fc1c14", keyHex: "141cfc9842c4b0e3", key32: 1120186595 },
  { url: "https://example.com/", digestPrefix: "0f115db062b7c0dd", keyHex: "ddc0b762b05d110f", key32: 2958889231 },
  {
    url: "https://news.ycombinator.com/item?id=1",
    digestPrefix: "6dd66cdf745b9983",
    keyHex: "83995b74df6cd66d",
    key32: 3748451949
  },
  {
    url: "https://en.wikipedia.org/wiki/Binary_fuse_filter",
    digestPrefix: "d4f5430ae588d079",
    keyHex: "79d088e50a43f5d4",
    key32: 172226004
  },
  {
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    digestPrefix: "0424974c68530290",
    keyHex: "900253684c972404",
    key32: 1284973572
  },
  {
    // Non-ASCII host and path, so a reimplementation cannot pass by encoding
    // UTF-16 code units and calling it UTF-8.
    url: "https://例え.テスト/ページ?q=✓",
    digestPrefix: "b4343aa6e11a3192",
    keyHex: "92311ae1a63a34b4",
    key32: 2788832436
  },
  {
    // Outside the BMP: a surrogate pair in JavaScript, four UTF-8 bytes anywhere.
    url: "https://example.com/\u{1D11E}",
    digestPrefix: "4f9b5934c56a6b83",
    keyHex: "836b6ac534599b4f",
    key32: 878287695
  }
] as const

describe("key derivation", () => {
  it("reproduces the golden vectors", () => {
    for (const vector of vectors) {
      expect(sha256Hex(utf8(vector.url)).slice(0, 16), vector.url).toBe(vector.digestPrefix)
      expect(keyHex(keyOfCanonical(vector.url)), vector.url).toBe(vector.keyHex)
      expect(key32(keyOfCanonical(vector.url)), vector.url).toBe(vector.key32)
    }
  })

  it("reads the first eight digest bytes LITTLE-endian", () => {
    // The single most likely way to get this wrong, and it fails silently: the
    // key printed big-endian is the byte-reversal of the digest prefix.
    for (const vector of vectors) {
      const reversed = (vector.digestPrefix.match(/../g) ?? []).reverse().join("")
      expect(vector.keyHex).toBe(reversed)
    }
  })

  it("truncates to the LOW half — digest bytes 0..3, not 4..7", () => {
    for (const vector of vectors) {
      expect(key32(keyOfCanonical(vector.url))).toBe(keyOfCanonical(vector.url).low)
    }
  })

  it("keys a SubjectUrl exactly as it keys the string it wraps", () => {
    const url = "https://example.com/" as SubjectUrl
    expect(keyOf(url)).toEqual(keyOfCanonical("https://example.com/"))
  })

  it("gives different keys to addresses that differ only in canonicalization", () => {
    // Not a property of the hash — a reminder of the consequence. These are the
    // same page under different rule versions, and the index will disagree with
    // itself about them. That is what `canonicalizerVersion` exists to catch.
    const withSlash = keyOfCanonical("https://example.com/a/")
    const withoutSlash = keyOfCanonical("https://example.com/a")
    expect(withSlash).not.toEqual(withoutSlash)
  })
})
