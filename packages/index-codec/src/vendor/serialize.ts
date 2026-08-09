/**
 * The filter's own byte format — the inner half of the artifact contract.
 *
 * VENDORED from `@expo/binary-fuse-filter@1.0.0` (MIT — see ./LICENSE),
 * unchanged in behaviour. The transformations are the same three as in
 * ./filter.ts: types restored, bounds-safe reads, and — here only — thrown
 * `Error`s replaced by a returned {@link Malformed} so that a corrupt artifact
 * degrades instead of propagating. A throw from this file would land in
 * whichever fiber happened to be reading the index; ADR 0005 requires that a
 * broken index be indistinguishable from no index, and that is a value, not an
 * exception.
 *
 * Format, little-endian throughout, 28-byte header:
 *
 * ```
 *   offset  size  field
 *   0       1     version = 1
 *   1       1     fingerprint bits (8, 16 or 32)
 *   2       2     reserved, zero
 *   4       4     seed, high 32 bits
 *   8       4     seed, low 32 bits
 *   12      4     size (number of keys the filter was built from)
 *   16      4     segment length
 *   20      4     segment count
 *   24      4     array length
 *   28      …     fingerprints: arrayLength × (fingerprintBits / 8) bytes
 * ```
 *
 * `segmentLengthMask` and `segmentCountLength` are not stored: they are
 * `segmentLength - 1` and `segmentCount × segmentLength`, and storing a
 * derivable value is storing a value that can disagree with its source.
 */
import type { BinaryFuseFilter, BinaryFuseFingerprintBits, FingerprintArray } from "./filter.ts"

const FORMAT_VERSION = 1
const HEADER_SIZE = 28

/** The bytes were not a filter this build can read. Returned, never thrown. */
export interface Malformed {
  readonly _tag: "Malformed"
  readonly detail: string
}

const malformed = (detail: string): Malformed => ({ _tag: "Malformed", detail })

/** Serialize a filter. Deterministic: the same filter always produces the same bytes. */
export const serializeBinaryFuseFilter = (filter: BinaryFuseFilter): Uint8Array => {
  const bytesPerFingerprint = filter.fingerprintBits / 8
  const dataSize = filter.arrayLength * bytesPerFingerprint
  const bytes = new Uint8Array(HEADER_SIZE + dataSize)
  const view = new DataView(bytes.buffer)

  view.setUint8(0, FORMAT_VERSION)
  view.setUint8(1, filter.fingerprintBits)
  // bytes 2–3: reserved, already zero
  view.setUint32(4, filter.seedHigh, true)
  view.setUint32(8, filter.seedLow, true)
  view.setUint32(12, filter.size, true)
  view.setUint32(16, filter.segmentLength, true)
  view.setUint32(20, filter.segmentCount, true)
  view.setUint32(24, filter.arrayLength, true)

  // The fingerprint table is copied out of its backing buffer directly. That is
  // sound only because this format is little-endian and typed arrays use native
  // endianness — which is little-endian on every platform Parle ships to
  // (x86, ARM, WASM). A big-endian host would need to swap here.
  const { fingerprints } = filter
  bytes.set(new Uint8Array(fingerprints.buffer, fingerprints.byteOffset, fingerprints.byteLength), HEADER_SIZE)

  return bytes
}

/**
 * Read a filter back, or say why the bytes are not one.
 *
 * Every rejection path here is a real thing that happens to a 4 MB download: a
 * truncated body, a proxy's error page, a half-written cache entry, an artifact
 * from a future build. None of them may throw.
 */
export const deserializeBinaryFuseFilter = (bytes: Uint8Array): BinaryFuseFilter | Malformed => {
  if (bytes.length < HEADER_SIZE) {
    return malformed(`expected at least ${HEADER_SIZE} bytes, got ${bytes.length}`)
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const version = view.getUint8(0)
  if (version !== FORMAT_VERSION) {
    return malformed(`unsupported filter format version ${version}`)
  }

  const fingerprintBits = view.getUint8(1)
  if (fingerprintBits !== 8 && fingerprintBits !== 16 && fingerprintBits !== 32) {
    return malformed(`fingerprint width ${fingerprintBits} is not 8, 16 or 32`)
  }

  const seedHigh = view.getUint32(4, true)
  const seedLow = view.getUint32(8, true)
  const size = view.getUint32(12, true)
  const segmentLength = view.getUint32(16, true)
  const segmentCount = view.getUint32(20, true)
  const arrayLength = view.getUint32(24, true)

  if (segmentLength === 0 || (segmentLength & (segmentLength - 1)) !== 0) {
    return malformed(`segment length ${segmentLength} is not a power of two`)
  }
  // At least one segment. A header claiming zero passes the geometry check
  // below (arrayLength = 2 × segmentLength) but makes `segmentCountLength` zero,
  // which collapses the first of the three probe positions onto index 0 and
  // pushes the third off the end of the fingerprint table. Nothing throws — the
  // bounds-safe reads see to that — it simply answers nonsense, which is the
  // class of failure this deserializer exists to convert into a refusal.
  if (segmentCount === 0) {
    return malformed("segment count is zero")
  }
  if (arrayLength !== (segmentCount + 2) * segmentLength) {
    return malformed(`array length ${arrayLength} disagrees with ${segmentCount} segments of ${segmentLength}`)
  }

  const bytesPerFingerprint = fingerprintBits / 8
  const expectedSize = HEADER_SIZE + arrayLength * bytesPerFingerprint
  // Exactly, not at least, for the same reason as the addendum: a body longer
  // than its header describes is two things glued together, and reading the
  // prefix of it would adopt half an artifact without saying so.
  if (bytes.length !== expectedSize) {
    return malformed(`expected exactly ${expectedSize} bytes of fingerprints, got ${bytes.length}`)
  }

  // The fingerprint region is COPIED into its own ArrayBuffer rather than
  // viewed in place: a typed array of 16- or 32-bit fingerprints must start at
  // byte offset 0 of its buffer, and `ArrayBuffer.prototype.slice` always
  // copies, where `Uint8Array.prototype.slice` on a Node Buffer returns a view
  // into a shared pool. Peak memory is therefore transiently about twice the
  // artifact — the one real cost of this format.
  const start = bytes.byteOffset + HEADER_SIZE
  const fingerprintBuffer = bytes.buffer.slice(start, start + arrayLength * bytesPerFingerprint)

  return {
    fingerprintBits,
    size,
    seedHigh,
    seedLow,
    segmentLength,
    segmentLengthMask: segmentLength - 1,
    segmentCount,
    segmentCountLength: segmentCount * segmentLength,
    arrayLength,
    fingerprints: fingerprintArrayFrom(fingerprintBits, fingerprintBuffer)
  }
}

const fingerprintArrayFrom = (bits: BinaryFuseFingerprintBits, buffer: ArrayBufferLike): FingerprintArray => {
  if (bits === 8) return new Uint8Array(buffer)
  if (bits === 16) return new Uint16Array(buffer)
  return new Uint32Array(buffer)
}
