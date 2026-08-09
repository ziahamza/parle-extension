/**
 * The hash functions the binary fuse filter is defined over.
 *
 * VENDORED from `@expo/binary-fuse-filter@1.0.0` (MIT — see ./LICENSE),
 * unchanged apart from restored type annotations.
 *
 * {@link murmur64} and {@link splitmix64} are load-bearing parts of the WIRE
 * FORMAT: the filter mixes each 64-bit key with the filter's seed through
 * `murmur64`, and derives the seed sequence through `splitmix64`. Any
 * reimplementation in another language must reproduce both exactly, bit for
 * bit, or it will build a filter our client cannot query. They are ordinary,
 * well-known constructions and reimplementing them is routine.
 *
 * {@link hashString} is a different matter and is the reason this package
 * exists. It is a NON-STANDARD FNV-1a-64 over UTF-16 code units — it XORs the
 * low byte of each code unit, and mixes the high byte only when the code unit
 * exceeds 255 — which gives it a genuine collision family that standard FNV-1a
 * does not have: the one-character string U+0100 and the two-character string
 * U+0000 U+0001 hash to the same 64 bits (`[137529095, 3035328058]`, measured).
 * Harmless for URLs, but it proves the function is not reimplementable from its
 * name, and ADR 0010 promises that anyone can rebuild these artifacts.
 * So `hashString` is NOT part of Parle's wire format: we derive keys ourselves
 * (see ../Key.ts) and enter the filter through the precomputed-key entry points
 * in ./filter.ts. It is retained only so the collision above stays testable and
 * so this file remains a faithful copy of what it was vendored from.
 */
import { add64, mul64, type Uint64 } from "./math.ts"

/**
 * FNV-1a-64 over UTF-16 code units.
 *
 * NOT used by Parle. See the module doc comment — this is the hash whose
 * unreimplementability forced the vendoring.
 */
export const hashString = (input: string): Uint64 => {
  // FNV offset basis: 0xcbf29ce484222325
  let hashHigh = 0xcbf29ce4
  let hashLow = 0x84222325
  // FNV prime: 0x00000100000001B3
  const primeHigh = 0x00000100
  const primeLow = 0x000001b3

  for (let i = 0; i < input.length; i++) {
    const charCode = input.charCodeAt(i)
    // XOR with the low byte
    hashLow = (hashLow ^ (charCode & 0xff)) >>> 0
    ;[hashHigh, hashLow] = mul64(hashHigh, hashLow, primeHigh, primeLow)
    // Mix the high byte for multi-byte characters
    if (charCode > 255) {
      hashLow = (hashLow ^ (charCode >>> 8)) >>> 0
      ;[hashHigh, hashLow] = mul64(hashHigh, hashLow, primeHigh, primeLow)
    }
  }
  return [hashHigh, hashLow]
}

/** Murmur64 finalizer. Mixes a 64-bit hash to improve its avalanche properties. */
export const murmur64 = (hashHigh: number, hashLow: number): Uint64 => {
  // h ^= h >> 33 (33 >= 32, so the result is [0, hashHigh >>> 1])
  hashLow = (hashLow ^ (hashHigh >>> 1)) >>> 0
  // h *= 0xff51afd7ed558ccd
  ;[hashHigh, hashLow] = mul64(hashHigh, hashLow, 0xff51afd7, 0xed558ccd)
  // h ^= h >> 33
  hashLow = (hashLow ^ (hashHigh >>> 1)) >>> 0
  // h *= 0xc4ceb9fe1a85ec53
  ;[hashHigh, hashLow] = mul64(hashHigh, hashLow, 0xc4ceb9fe, 0x1a85ec53)
  // h ^= h >> 33
  hashLow = (hashLow ^ (hashHigh >>> 1)) >>> 0
  return [hashHigh, hashLow]
}

/**
 * SplitMix64. Mutates `state` in place and returns the next value.
 *
 * The construction seed sequence starts from the fixed state
 * `[0x726b2b9d, 0x438b9d4d]`, which is what makes a build deterministic: the
 * same key set produces the same bytes on any machine, which is what "pinned by
 * sha256" needs in order to be checkable by a third party.
 */
export const splitmix64 = (state: Uint64): Uint64 => {
  ;[state[0], state[1]] = add64(state[0], state[1], 0x9e3779b9, 0x7f4a7c15)
  let mixHigh = state[0]
  let mixLow = state[1]

  // z ^= z >> 30
  let shiftHigh = mixHigh >>> 30
  let shiftLow = ((mixHigh << 2) | (mixLow >>> 30)) >>> 0
  mixHigh = (mixHigh ^ shiftHigh) >>> 0
  mixLow = (mixLow ^ shiftLow) >>> 0
  // z *= 0xBF58476D1CE4E5B9
  ;[mixHigh, mixLow] = mul64(mixHigh, mixLow, 0xbf58476d, 0x1ce4e5b9)
  // z ^= z >> 27
  shiftHigh = mixHigh >>> 27
  shiftLow = ((mixHigh << 5) | (mixLow >>> 27)) >>> 0
  mixHigh = (mixHigh ^ shiftHigh) >>> 0
  mixLow = (mixLow ^ shiftLow) >>> 0
  // z *= 0x94D049BB133111EB
  ;[mixHigh, mixLow] = mul64(mixHigh, mixLow, 0x94d049bb, 0x133111eb)
  // z ^= z >> 31
  shiftHigh = mixHigh >>> 31
  shiftLow = ((mixHigh << 1) | (mixLow >>> 31)) >>> 0
  mixHigh = (mixHigh ^ shiftHigh) >>> 0
  mixLow = (mixLow ^ shiftLow) >>> 0

  return [mixHigh, mixLow]
}
