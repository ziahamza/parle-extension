/**
 * The binary fuse filter itself: construction, and membership queries.
 *
 * VENDORED from `@expo/binary-fuse-filter@1.0.0` (MIT — see ./LICENSE), a port
 * of the C reference implementation by Thomas Mueller Graf and Daniel Lemire
 * (https://github.com/FastFilter/xor_singleheader — see
 * ./LICENSE-xor_singleheader).
 *
 * **Why vendored, and what changed.** The published API is
 * `createBinaryFuseFilter(keys: string[])` and `binaryFuseFilterContains(f,
 * key: string)`: it hashes the key strings ITSELF, with a non-standard FNV-1a
 * variant (see ./hash.ts), and offers no way to supply precomputed 64-bit keys.
 * That would make Parle's artifact format un-specifiable except as "whatever
 * this exact npm build does", which ADR 0010 — anyone may rebuild these
 * artifacts — does not permit. So this copy adds ONE pair of entry points,
 * {@link createBinaryFuseFilterFromKeys} and {@link binaryFuseFilterHasKey},
 * that take keys already reduced to 64 bits. Parle derives those 64 bits itself
 * from SHA-256 (see ../Key.ts) and uses only these two.
 *
 * Everything else is upstream's, with two mechanical transformations: the type
 * annotations the published build had erased are restored, and every typed
 * array read is written `a[i] ?? 0` because this repo compiles with
 * `noUncheckedIndexedAccess`. Every such read is in bounds by construction, so
 * the `?? 0` branch is dead — it is a compiler obligation, not a behaviour
 * change.
 *
 * **The fingerprint width is not a tuning knob.** Legal values are 8, 16 and
 * 32; 9, 10 and 12 throw `RangeError` at serialize time, because the published
 * type was `8 | 16 | 32` all along and the input validation is missing rather
 * than the support. Parle takes 8: ~0.38% false positives at ~9.03 bits/key,
 * measured over 3,583,620 Hacker News keys. 16-bit buys 0.0015% for double the
 * bytes, which is the wrong trade for a filter that may only ever *suspect*.
 */
import { hashString, murmur64, splitmix64 } from "./hash.ts"
import { add64, mulhi64x32, type Uint64 } from "./math.ts"

const MAX_ITERATIONS = 100

/** The three legal fingerprint widths. Not a continuum — see the module doc. */
export type BinaryFuseFingerprintBits = 8 | 16 | 32

/** The fingerprint table. Width follows {@link BinaryFuseFingerprintBits}. */
export type FingerprintArray = Uint8Array | Uint16Array | Uint32Array

/** A binary fuse filter. Immutable once populated. */
export interface BinaryFuseFilter {
  readonly fingerprintBits: BinaryFuseFingerprintBits
  readonly size: number
  readonly seedHigh: number
  readonly seedLow: number
  readonly segmentLength: number
  readonly segmentLengthMask: number
  readonly segmentCount: number
  readonly segmentCountLength: number
  readonly arrayLength: number
  readonly fingerprints: FingerprintArray
}

/** The mutable view construction needs. Callers only ever see the readonly one. */
interface MutableBinaryFuseFilter {
  fingerprintBits: BinaryFuseFingerprintBits
  size: number
  seedHigh: number
  seedLow: number
  segmentLength: number
  segmentLengthMask: number
  segmentCount: number
  segmentCountLength: number
  arrayLength: number
  fingerprints: FingerprintArray
}

/** Construction ran out of seeds. Only reachable on a pathological key set. */
export class BinaryFuseConstructionFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BinaryFuseConstructionFailed"
  }
}

/**
 * PARLE ADDITION — build a filter from keys already reduced to 64 bits.
 *
 * The two arrays are parallel and must be the same length: `keysHigh[i]` and
 * `keysLow[i]` are the high and low 32 bits of key `i`. Parallel `Uint32Array`s
 * rather than an array of pairs because construction touches every key several
 * times per attempt and an array of objects costs more than the filter does.
 *
 * **The caller MUST deduplicate.** Construction has duplicate detection, and it
 * is nowhere near as robust as it looks: measured, a 500-key set tolerates
 * about five repeats and then exhausts all 100 seed attempts and throws. A
 * corpus of canonicalized URLs arrives with far more than five, so
 * {@link import("../Build.ts").buildFilter} deduplicates first — that is
 * load-bearing, not an optimisation.
 */
export const createBinaryFuseFilterFromKeys = (
  keysHigh: Uint32Array,
  keysLow: Uint32Array,
  fingerprintBits: BinaryFuseFingerprintBits = 8
): BinaryFuseFilter => {
  if (keysHigh.length !== keysLow.length) {
    throw new BinaryFuseConstructionFailed(
      `key arrays disagree: ${keysHigh.length} high words, ${keysLow.length} low words`
    )
  }
  const filter = allocate(keysHigh.length, fingerprintBits)
  populate(keysHigh, keysLow, filter)
  return filter
}

/**
 * PARLE ADDITION — test a key already reduced to 64 bits.
 *
 * Returns a boolean because at this depth it is a raw table probe, not an
 * answer about the world. Nothing outside this package may call it: the only
 * thing Parle is allowed to conclude from a filter is a `Hint`, and `Hint` has
 * no boolean in it (see ../Hint.ts).
 */
export const binaryFuseFilterHasKey = (filter: BinaryFuseFilter, keyHigh: number, keyLow: number): boolean => {
  const [mixedHigh, mixedLow] = add64(keyHigh, keyLow, filter.seedHigh, filter.seedLow)
  const [hashHigh, hashLow] = murmur64(mixedHigh, mixedLow)
  const mask = fingerprintMask(filter.fingerprintBits)
  let fingerprint = computeFingerprint(hashHigh, hashLow, mask)
  const [h0, h1, h2] = hashBatch(
    hashHigh,
    hashLow,
    filter.segmentCountLength,
    filter.segmentLength,
    filter.segmentLengthMask
  )
  const table = filter.fingerprints
  fingerprint ^= (table[h0] ?? 0) ^ (table[h1] ?? 0) ^ (table[h2] ?? 0)
  return fingerprint === 0
}

// --- Upstream's string-keyed API, retained verbatim in behaviour ---

/**
 * Build a filter from strings, hashing them with upstream's own
 * {@link import("./hash.ts").hashString}.
 *
 * NOT used by Parle — see the module doc and ../Key.ts. Kept so that the
 * vendored copy stays a faithful one and so its hash collision family stays
 * demonstrable in our own test suite rather than only in prose.
 */
export const createBinaryFuseFilter = (
  keys: ReadonlyArray<string>,
  fingerprintBits: BinaryFuseFingerprintBits = 8
): BinaryFuseFilter => {
  const keysHigh = new Uint32Array(keys.length)
  const keysLow = new Uint32Array(keys.length)
  for (let i = 0; i < keys.length; i++) {
    const [hashHigh, hashLow] = hashString(keys[i] ?? "")
    keysHigh[i] = hashHigh
    keysLow[i] = hashLow
  }
  const filter = allocate(keys.length, fingerprintBits)
  populate(keysHigh, keysLow, filter)
  return filter
}

/** Test a string against a filter built by {@link createBinaryFuseFilter}. */
export const binaryFuseFilterContains = (filter: BinaryFuseFilter, key: string): boolean => {
  const [keyHigh, keyLow] = hashString(key)
  return binaryFuseFilterHasKey(filter, keyHigh, keyLow)
}

// --- Internal ---

const allocate = (size: number, fingerprintBits: BinaryFuseFingerprintBits): MutableBinaryFuseFilter => {
  const segmentLength = calculateSegmentLength(size)
  const segmentLengthMask = segmentLength - 1
  const sizeFactor = size <= 1 ? 0 : calculateSizeFactor(size)
  const capacity = size <= 1 ? 0 : Math.round(size * sizeFactor)
  const initialSegmentCount = Math.floor((capacity + segmentLength - 1) / segmentLength) - 2
  let arrayLength = (initialSegmentCount + 2) * segmentLength
  let segmentCount = Math.floor((arrayLength + segmentLength - 1) / segmentLength)
  segmentCount = segmentCount <= 2 ? 1 : segmentCount - 2
  arrayLength = (segmentCount + 2) * segmentLength
  const segmentCountLength = segmentCount * segmentLength

  return {
    fingerprintBits,
    size,
    seedHigh: 0,
    seedLow: 0,
    segmentLength,
    segmentLengthMask,
    segmentCount,
    segmentCountLength,
    arrayLength,
    fingerprints: createFingerprintArray(fingerprintBits, arrayLength)
  }
}

const populate = (keysHigh: Uint32Array, keysLow: Uint32Array, filter: MutableBinaryFuseFilter): void => {
  const size = keysHigh.length
  if (size !== filter.size) {
    throw new BinaryFuseConstructionFailed(`key count ${size} does not match filter size ${filter.size}`)
  }

  const mask = fingerprintMask(filter.fingerprintBits)
  const { arrayLength: capacity, segmentCountLength, segmentLength, segmentLengthMask } = filter

  const rngState: Uint64 = [0x726b2b9d, 0x438b9d4d]
  let [seedHigh, seedLow] = splitmix64(rngState)
  filter.seedHigh = seedHigh
  filter.seedLow = seedLow

  const reverseHigh = new Uint32Array(size + 1)
  const reverseLow = new Uint32Array(size + 1)
  const alone = new Uint32Array(capacity)
  const slotCount = new Uint8Array(capacity)
  const reverseOrder = new Uint8Array(size)
  const xorHashHigh = new Uint32Array(capacity)
  const xorHashLow = new Uint32Array(capacity)

  let blockBits = 1
  while (1 << blockBits < filter.segmentCount) {
    blockBits++
  }
  const blockCount = 1 << blockBits
  const startPosition = new Uint32Array(blockCount)

  reverseLow[size] = 1
  let workingSize = size

  for (let attempt = 0; ; attempt++) {
    if (attempt + 1 > MAX_ITERATIONS) {
      throw new BinaryFuseConstructionFailed("failed to construct binary fuse filter after maximum iterations")
    }

    for (let i = 0; i < blockCount; i++) {
      startPosition[i] = (i * size) >>> blockBits
    }
    const blockMask = blockCount - 1

    for (let i = 0; i < size; i++) {
      const [addedHigh, addedLow] = add64(keysHigh[i] ?? 0, keysLow[i] ?? 0, seedHigh, seedLow)
      const [hashHigh, hashLow] = murmur64(addedHigh, addedLow)
      // hash >> (64 - blockBits): blockBits stays small, so the shift exceeds 32
      let segmentIndex = hashHigh >>> (32 - blockBits)
      while (
        (reverseHigh[startPosition[segmentIndex] ?? 0] ?? 0) !== 0 ||
        (reverseLow[startPosition[segmentIndex] ?? 0] ?? 0) !== 0
      ) {
        segmentIndex = (segmentIndex + 1) & blockMask
      }
      const position = startPosition[segmentIndex] ?? 0
      reverseHigh[position] = hashHigh
      reverseLow[position] = hashLow
      startPosition[segmentIndex] = position + 1
    }

    let hasError = false
    let duplicates = 0

    for (let i = 0; i < size; i++) {
      const hashHigh = reverseHigh[i] ?? 0
      const hashLow = reverseLow[i] ?? 0
      const h0 = hashIndex(0, hashHigh, hashLow, segmentCountLength, segmentLength, segmentLengthMask)
      const h1 = hashIndex(1, hashHigh, hashLow, segmentCountLength, segmentLength, segmentLengthMask)
      const h2 = hashIndex(2, hashHigh, hashLow, segmentCountLength, segmentLength, segmentLengthMask)

      slotCount[h0] = (slotCount[h0] ?? 0) + 4
      xorHashHigh[h0] = (xorHashHigh[h0] ?? 0) ^ hashHigh
      xorHashLow[h0] = (xorHashLow[h0] ?? 0) ^ hashLow

      slotCount[h1] = ((slotCount[h1] ?? 0) + 4) ^ 1
      xorHashHigh[h1] = (xorHashHigh[h1] ?? 0) ^ hashHigh
      xorHashLow[h1] = (xorHashLow[h1] ?? 0) ^ hashLow

      slotCount[h2] = ((slotCount[h2] ?? 0) + 4) ^ 2
      xorHashHigh[h2] = (xorHashHigh[h2] ?? 0) ^ hashHigh
      xorHashLow[h2] = (xorHashLow[h2] ?? 0) ^ hashLow

      if (
        ((xorHashHigh[h0] ?? 0) & (xorHashHigh[h1] ?? 0) & (xorHashHigh[h2] ?? 0)) === 0 &&
        ((xorHashLow[h0] ?? 0) & (xorHashLow[h1] ?? 0) & (xorHashLow[h2] ?? 0)) === 0
      ) {
        if (
          ((xorHashHigh[h0] ?? 0) === 0 && (xorHashLow[h0] ?? 0) === 0 && (slotCount[h0] ?? 0) === 8) ||
          ((xorHashHigh[h1] ?? 0) === 0 && (xorHashLow[h1] ?? 0) === 0 && (slotCount[h1] ?? 0) === 8) ||
          ((xorHashHigh[h2] ?? 0) === 0 && (xorHashLow[h2] ?? 0) === 0 && (slotCount[h2] ?? 0) === 8)
        ) {
          duplicates++
          slotCount[h0] = (slotCount[h0] ?? 0) - 4
          xorHashHigh[h0] = (xorHashHigh[h0] ?? 0) ^ hashHigh
          xorHashLow[h0] = (xorHashLow[h0] ?? 0) ^ hashLow

          slotCount[h1] = ((slotCount[h1] ?? 0) - 4) ^ 1
          xorHashHigh[h1] = (xorHashHigh[h1] ?? 0) ^ hashHigh
          xorHashLow[h1] = (xorHashLow[h1] ?? 0) ^ hashLow

          slotCount[h2] = ((slotCount[h2] ?? 0) - 4) ^ 2
          xorHashHigh[h2] = (xorHashHigh[h2] ?? 0) ^ hashHigh
          xorHashLow[h2] = (xorHashLow[h2] ?? 0) ^ hashLow
        }
      }

      if ((slotCount[h0] ?? 0) < 4) hasError = true
      if ((slotCount[h1] ?? 0) < 4) hasError = true
      if ((slotCount[h2] ?? 0) < 4) hasError = true
    }

    if (hasError) {
      reverseHigh.fill(0, 0, size)
      reverseLow.fill(0, 0, size)
      slotCount.fill(0)
      xorHashHigh.fill(0)
      xorHashLow.fill(0)
      ;[seedHigh, seedLow] = splitmix64(rngState)
      filter.seedHigh = seedHigh
      filter.seedLow = seedLow
      continue
    }

    // Peeling: extract keys from positions with exactly one occupant
    let queueSize = 0
    for (let i = 0; i < capacity; i++) {
      alone[queueSize] = i
      if ((slotCount[i] ?? 0) >> 2 === 1) {
        queueSize++
      }
    }

    let stackSize = 0
    const hashPositions = new Uint32Array(5)
    while (queueSize > 0) {
      queueSize--
      const index = alone[queueSize] ?? 0
      if ((slotCount[index] ?? 0) >> 2 === 1) {
        const hashHigh = xorHashHigh[index] ?? 0
        const hashLow = xorHashLow[index] ?? 0
        hashPositions[1] = hashIndex(1, hashHigh, hashLow, segmentCountLength, segmentLength, segmentLengthMask)
        hashPositions[2] = hashIndex(2, hashHigh, hashLow, segmentCountLength, segmentLength, segmentLengthMask)
        hashPositions[3] = hashIndex(0, hashHigh, hashLow, segmentCountLength, segmentLength, segmentLengthMask)
        hashPositions[4] = hashPositions[1] ?? 0

        const hashSlot = (slotCount[index] ?? 0) & 3
        reverseOrder[stackSize] = hashSlot
        reverseHigh[stackSize] = hashHigh
        reverseLow[stackSize] = hashLow
        stackSize++

        const other1 = hashPositions[hashSlot + 1] ?? 0
        alone[queueSize] = other1
        if ((slotCount[other1] ?? 0) >> 2 === 2) {
          queueSize++
        }
        slotCount[other1] = ((slotCount[other1] ?? 0) - 4) ^ ((hashSlot + 1) % 3)
        xorHashHigh[other1] = (xorHashHigh[other1] ?? 0) ^ hashHigh
        xorHashLow[other1] = (xorHashLow[other1] ?? 0) ^ hashLow

        const other2 = hashPositions[hashSlot + 2] ?? 0
        alone[queueSize] = other2
        if ((slotCount[other2] ?? 0) >> 2 === 2) {
          queueSize++
        }
        slotCount[other2] = ((slotCount[other2] ?? 0) - 4) ^ ((hashSlot + 2) % 3)
        xorHashHigh[other2] = (xorHashHigh[other2] ?? 0) ^ hashHigh
        xorHashLow[other2] = (xorHashLow[other2] ?? 0) ^ hashLow
      }
    }

    if (stackSize + duplicates === size) {
      workingSize = stackSize
      break
    }

    reverseHigh.fill(0, 0, size)
    reverseLow.fill(0, 0, size)
    slotCount.fill(0)
    xorHashHigh.fill(0)
    xorHashLow.fill(0)
    ;[seedHigh, seedLow] = splitmix64(rngState)
    filter.seedHigh = seedHigh
    filter.seedLow = seedLow
  }

  // Assign fingerprints in reverse peeling order, so the XOR of a key's three
  // positions reproduces its fingerprint.
  const hashPositions = new Uint32Array(5)
  const table = filter.fingerprints
  for (let i = workingSize - 1; i >= 0; i--) {
    const hashHigh = reverseHigh[i] ?? 0
    const hashLow = reverseLow[i] ?? 0
    const fingerprint = computeFingerprint(hashHigh, hashLow, mask)
    const hashSlot = reverseOrder[i] ?? 0
    hashPositions[0] = hashIndex(0, hashHigh, hashLow, segmentCountLength, segmentLength, segmentLengthMask)
    hashPositions[1] = hashIndex(1, hashHigh, hashLow, segmentCountLength, segmentLength, segmentLengthMask)
    hashPositions[2] = hashIndex(2, hashHigh, hashLow, segmentCountLength, segmentLength, segmentLengthMask)
    hashPositions[3] = hashPositions[0] ?? 0
    hashPositions[4] = hashPositions[1] ?? 0

    table[hashPositions[hashSlot] ?? 0] =
      fingerprint ^ (table[hashPositions[hashSlot + 1] ?? 0] ?? 0) ^ (table[hashPositions[hashSlot + 2] ?? 0] ?? 0)
  }
}

/** All three positions for a query, in one pass. */
const hashBatch = (
  hashHigh: number,
  hashLow: number,
  segmentCountLength: number,
  segmentLength: number,
  segmentLengthMask: number
): readonly [number, number, number] => {
  const h0 = mulhi64x32(hashHigh, hashLow, segmentCountLength)
  let h1 = (h0 + segmentLength) >>> 0
  let h2 = (h1 + segmentLength) >>> 0
  // hash >> 18: 18 < 32, so the low 32 bits are (hashHigh << 14 | hashLow >>> 18)
  h1 = (h1 ^ (((hashHigh << 14) | (hashLow >>> 18)) & segmentLengthMask)) >>> 0
  h2 = (h2 ^ (hashLow & segmentLengthMask)) >>> 0
  return [h0, h1, h2]
}

/** One position (0, 1 or 2), as construction needs them individually. */
const hashIndex = (
  index: number,
  hashHigh: number,
  hashLow: number,
  segmentCountLength: number,
  segmentLength: number,
  segmentLengthMask: number
): number => {
  let position = mulhi64x32(hashHigh, hashLow, segmentCountLength)
  position = (position + index * segmentLength) >>> 0
  // Extract the low 36 bits of the hash
  const maskedHigh = hashHigh & 0xf
  const shift = 36 - 18 * index
  let extractedBits: number
  if (shift >= 32) {
    extractedBits = maskedHigh >>> (shift - 32)
  } else if (shift === 0) {
    extractedBits = hashLow
  } else {
    extractedBits = ((maskedHigh << (32 - shift)) | (hashLow >>> shift)) >>> 0
  }
  return (position ^ (extractedBits & segmentLengthMask)) >>> 0
}

const computeFingerprint = (hashHigh: number, hashLow: number, mask: number): number => (hashHigh ^ hashLow) & mask

const calculateSegmentLength = (size: number): number => {
  if (size === 0) return 4
  const exponent = Math.floor(Math.log(size) / Math.log(3.33) + 2.25)
  return Math.min(262144, Math.pow(2, exponent)) >>> 0
}

const calculateSizeFactor = (size: number): number =>
  Math.max(1.125, 0.875 + (0.25 * Math.log(1000000)) / Math.log(size))

const fingerprintMask = (bits: BinaryFuseFingerprintBits): number => {
  if (bits === 8) return 0xff
  if (bits === 16) return 0xffff
  return 0xffffffff
}

const createFingerprintArray = (bits: BinaryFuseFingerprintBits, length: number): FingerprintArray => {
  if (bits === 8) return new Uint8Array(length)
  if (bits === 16) return new Uint16Array(length)
  return new Uint32Array(length)
}
