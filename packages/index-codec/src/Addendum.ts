/**
 * The daily increment: every key added since the base filter was built.
 *
 * A binary fuse filter is immutable by construction — you cannot add a key to
 * one — and that is a feature, not a limitation to route around. The base is
 * rebuilt monthly from an authoritative snapshot; between rebuilds, one
 * CUMULATIVE addendum is published and replaced daily, so the client always
 * fetches exactly one, never a chain. Measured, Hacker News produces about
 * 2,270 new canonical URLs a day: roughly 9 KB daily, about 280 KB by the end
 * of a month, against a 4 MB base.
 *
 * Deletions need no mechanism at all. Dead and deleted stories — 15–21% of the
 * corpus — are excluded at build time and absorbed by the next rebuild. There
 * are no tombstones and no generational filters, and a stale key in the base
 * costs one Lookup that returns a Silence.
 *
 * Keys are truncated to their low 32 bits (see `key32` in ./Key.ts), which adds
 * its own false positives: at 280,000 entries, 0.0065% — two orders of
 * magnitude below the base filter's 0.38%, and in the same harmless direction.
 *
 * ## Wire format
 *
 * ```
 *   offset  size  field
 *   0       4     magic "PADD"  (0x50 0x41 0x44 0x44)
 *   4       1     version = 1
 *   5       3     reserved, zero
 *   8       4     key count, little-endian
 *   12      4     reserved, zero
 *   16      …     key count × uint32 little-endian, STRICTLY ASCENDING
 * ```
 *
 * Strictly ascending is checked on read, not assumed. It is what makes the
 * binary search correct: an out-of-order pair would make the search skip a
 * region, and a skipped region is a false negative.
 *
 * The length is checked EXACTLY, not as a lower bound, and that is the half of
 * the check that was missing. Ascending order alone does not catch a
 * concatenation of two days' addenda: the header of the first file says how many
 * keys to read, so a longer body reads back as a valid prefix and the second
 * day's keys vanish without a word. Both files are individually ascending, so
 * the order check passes trivially on exactly the input it was written to
 * reject. A trailing byte is now a refusal, and a refusal degrades to "the base
 * serves alone" (see ../Artifact.ts), which is a loss in the safe direction.
 *
 * The `baseGeneration` this addendum belongs to lives in the manifest, not in
 * these bytes: it is a fact about which base the increment attaches to, and the
 * blob is content-addressed and immutable while that relationship is exactly
 * what the mutable document exists to state.
 */
import { key32, type Key64 } from "./Key.ts"

const MAGIC = 0x50414444 // "PADD", read big-endian so the bytes read left to right
const FORMAT_VERSION = 1
const HEADER_SIZE = 16

/** The bytes were not an addendum this build can read. Returned, never thrown. */
export interface Unreadable {
  readonly _tag: "Unreadable"
  readonly detail: string
}

const unreadable = (detail: string): Unreadable => ({ _tag: "Unreadable", detail })

/** A decoded addendum: sorted truncated keys, and nothing else. */
export interface Addendum {
  readonly keys: Uint32Array
}

/** The addendum a client holds when the manifest published none. */
export const emptyAddendum: Addendum = { keys: new Uint32Array(0) }

/** Serialize an addendum. Sorts and deduplicates; deterministic for a given key set. */
export const serializeAddendum = (keys: Iterable<Key64>): Uint8Array => {
  const truncated: Array<number> = []
  for (const key of keys) truncated.push(key32(key))
  truncated.sort((a, b) => a - b)

  const distinct = new Uint32Array(truncated.length)
  let count = 0
  let previous = -1
  for (const value of truncated) {
    if (value !== previous) {
      distinct[count] = value
      count++
      previous = value
    }
  }

  const bytes = new Uint8Array(HEADER_SIZE + count * 4)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, MAGIC, false)
  view.setUint8(4, FORMAT_VERSION)
  view.setUint32(8, count, true)
  for (let i = 0; i < count; i++) {
    view.setUint32(HEADER_SIZE + i * 4, distinct[i] ?? 0, true)
  }
  return bytes
}

/** Read an addendum back, or say why the bytes are not one. */
export const deserializeAddendum = (bytes: Uint8Array): Addendum | Unreadable => {
  if (bytes.length < HEADER_SIZE) {
    return unreadable(`expected at least ${HEADER_SIZE} bytes, got ${bytes.length}`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, false) !== MAGIC) {
    return unreadable("magic is not PADD")
  }
  const version = view.getUint8(4)
  if (version !== FORMAT_VERSION) {
    return unreadable(`unsupported addendum format version ${version}`)
  }
  const count = view.getUint32(8, true)
  const expected = HEADER_SIZE + count * 4
  // EXACTLY, not at least: see the module doc. A body longer than its own header
  // claims is a concatenation, and reading its prefix would silently drop the
  // rest.
  if (bytes.length !== expected) {
    return unreadable(`expected exactly ${expected} bytes for ${count} keys, got ${bytes.length}`)
  }

  const keys = new Uint32Array(count)
  let previous = -1
  for (let i = 0; i < count; i++) {
    const value = view.getUint32(HEADER_SIZE + i * 4, true)
    if (value <= previous) {
      return unreadable(`keys are not strictly ascending at position ${i}`)
    }
    keys[i] = value
    previous = value
  }
  return { keys }
}

/**
 * Whether a key appears in the addendum.
 *
 * Internal: a boolean here is a table probe, not an answer about the world. The
 * only thing this package will say about a Subject is a `Hint`.
 */
export const addendumHas = (addendum: Addendum, key: Key64): boolean => {
  const needle = key32(key)
  const keys = addendum.keys
  let low = 0
  let high = keys.length - 1
  while (low <= high) {
    const mid = (low + high) >>> 1
    const value = keys[mid] ?? 0
    if (value === needle) return true
    if (value < needle) low = mid + 1
    else high = mid - 1
  }
  return false
}
