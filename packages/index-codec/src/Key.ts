/**
 * The key derivation — the part of this format that must be reproducible in
 * another language, and the part that was in danger of not being.
 *
 * The filter library Parle vendors hashes key STRINGS itself, with a
 * non-standard FNV-1a variant carrying a real collision family (see
 * ./vendor/hash.ts). Had we entered the filter through that door, the artifact
 * contract would have read "whatever `@expo/binary-fuse-filter@1.0.0` does to a
 * string", and ADR 0010's promise — that anyone may rebuild these artifacts —
 * would have been unmeetable outside JavaScript. So the 64-bit key is derived
 * HERE, from SHA-256, and handed to the filter already reduced.
 *
 * ## The rule, in full
 *
 * ```
 *   d      = SHA-256(UTF-8 bytes of the Subject URL)      // FIPS 180-4
 *   low32  = d[0] | d[1]<<8 | d[2]<<16 | d[3]<<24         // unsigned
 *   high32 = d[4] | d[5]<<8 | d[6]<<16 | d[7]<<24         // unsigned
 *   key64  = high32 × 2^32 + low32                        // = first 8 bytes, little-endian
 * ```
 *
 * That is the whole thing. Eight lines of Rust, eight of Python, and no
 * JavaScript semantics anywhere in it.
 *
 * ## What a Subject URL is, and why the version travels
 *
 * The input is a **Subject URL** — the address elected by a specific numbered
 * version of the canonicalization rules, minted by `@parle/policy` and by
 * nothing else. A key derived from a differently-canonicalized address is a
 * different key, and a filter probed with keys it was not built from answers
 * "no" for pages that are in it. That is a SILENT FALSE NEGATIVE: nothing
 * throws, the panel is merely empty, and the reader has no way to know a
 * Discussion existed. It is the one failure a membership filter is supposed to
 * make impossible.
 *
 * This is why the manifest carries a `canonicalizerVersion` and why a mismatch
 * makes the client ignore the artifact ENTIRELY rather than probe it (see
 * ./Manifest.ts). It is also why this module does not accept a bare `string`:
 * the type system holds the line that only a `SubjectUrl` may be keyed.
 */
import { hrefOf, type SubjectUrl } from "@parle/domain/Subject"
import { sha256, toHex, utf8 } from "./Sha256.ts"

/**
 * A key, as the filter wants it: 64 bits in two unsigned 32-bit halves.
 *
 * Two 32-bit numbers rather than a `bigint` because construction over millions
 * of keys allocates one `bigint` per operation otherwise, and because the
 * vendored filter is written in 32-bit pairs throughout.
 */
export interface Key64 {
  readonly high: number
  readonly low: number
}

/** Derive the 64-bit index key of a Subject URL. Total, synchronous, pure. */
export const keyOf = (subject: SubjectUrl): Key64 => keyOfCanonical(hrefOf(subject))

/**
 * The same derivation, over a plain string.
 *
 * Exists for the artifact BUILDER, which reads canonicalized addresses out of a
 * corpus file and has no `SubjectUrl` to hand — and for the golden vectors,
 * which must be stated in terms of literal strings if another implementation is
 * to check itself against them. Client code uses {@link keyOf}.
 */
export const keyOfCanonical = (canonicalUrl: string): Key64 => {
  const digest = sha256(utf8(canonicalUrl))
  return {
    low: readLittleEndian32(digest, 0),
    high: readLittleEndian32(digest, 4)
  }
}

/**
 * The key rendered as 16 lowercase hex digits, high half first.
 *
 * This is the golden-vector notation: a big-endian rendering of the 64-bit
 * integer, which is what a reimplementation gets if it prints `key64` in hex.
 * It is NOT the byte order of the digest prefix — that is little-endian — and
 * conflating the two is the single easiest way to build an unqueryable filter.
 */
export const keyHex = (key: Key64): string => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setUint32(0, key.high, false)
  new DataView(bytes.buffer).setUint32(4, key.low, false)
  return toHex(bytes)
}

/**
 * The 32-bit truncation used by the addendum.
 *
 * The low half, which is bytes 0–3 of the digest. Documented separately because
 * "truncate the key" has two plausible readings and only one of them is this
 * one.
 */
export const key32 = (key: Key64): number => key.low

const readLittleEndian32 = (bytes: Uint8Array, offset: number): number =>
  (((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
    0)
