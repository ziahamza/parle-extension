/**
 * The other end of the contract: turning a corpus into the bytes the client reads.
 *
 * This lives in the SHARED package rather than in the backend for one reason —
 * the artifact is a byte-for-byte contract, and a contract with one
 * implementation on each side has two implementations. Everything here is pure
 * and dependency-free, so the CI builder and the extension's test suite execute
 * the same code, and a golden vector that passes in one passes in the other.
 *
 * Measured shape of the real thing, against 3,583,620 Hacker News keys:
 * 4,046,876 bytes (≈9.03 bits/key), 0.3785% false positives, zero false
 * negatives, 2.3 s to build, 2 ms to serialize, 2 ms to deserialize. gzip and
 * brotli both save under 5% on it — the payload is already incompressible
 * fingerprints — so **serve it as identity**; compressing costs CPU on both
 * ends for nothing.
 *
 * The build is **deterministic and order-independent** — measured, not assumed.
 * The seed sequence starts from a fixed SplitMix64 state, and construction
 * bucket-sorts keys by hash before peeling, so the same key SET produces the
 * same bytes whatever order it arrived in. That is what makes the manifest's
 * `sha256` worth anything to somebody else: a rebuilder with the same corpus,
 * in a different order, in a different language, lands on the same digest.
 *
 * Nothing here is parameterised by shard, because there are no shards.
 */
import { serializeAddendum } from "./Addendum.ts"
import { keyOfCanonical, type Key64 } from "./Key.ts"
import { sha256Hex } from "./Sha256.ts"
import { createBinaryFuseFilterFromKeys, type BinaryFuseFingerprintBits } from "./vendor/filter.ts"
import { serializeBinaryFuseFilter } from "./vendor/serialize.ts"

/** A built artifact and the pin that will go in the manifest beside it. */
export interface Built {
  readonly bytes: Uint8Array
  readonly sha256: string
  readonly keyCount: number
}

const pin = (bytes: Uint8Array, keyCount: number): Built => ({ bytes, sha256: sha256Hex(bytes), keyCount })

/**
 * Build a filter over canonicalized addresses.
 *
 * `fingerprintBits` defaults to 8 and should stay there. It is not a tuning
 * knob with a continuum behind it: the only legal widths are 8, 16 and 32, and
 * 9, 10 and 12 throw at serialize time. 8-bit gives ~0.38% false positives at
 * ~9 bits/key; 16-bit gives 0.0015% for double the bytes, which is the wrong
 * trade for something that may only ever *suspect* — a false positive costs one
 * Lookup we were probably making anyway.
 *
 * **Duplicates are removed first, and that is load-bearing rather than an
 * optimisation.** Construction has duplicate detection and it is nowhere near
 * as robust as it looks: measured, a 500-key set tolerates about five repeats
 * and then exhausts all 100 seed attempts and throws (pinned in
 * ./vendor/vendor.test.ts). A corpus of canonicalized URLs arrives with far
 * more than five. Deleting the dedup does not cost a few wasted slots; it
 * breaks the build.
 */
export const buildFilter = (
  canonicalUrls: Iterable<string>,
  fingerprintBits: BinaryFuseFingerprintBits = 8
): Built => {
  const keys = distinctKeys(canonicalUrls)
  const high = new Uint32Array(keys.length)
  const low = new Uint32Array(keys.length)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    if (key === undefined) continue
    high[i] = key.high
    low[i] = key.low
  }
  const filter = createBinaryFuseFilterFromKeys(high, low, fingerprintBits)
  return pin(serializeBinaryFuseFilter(filter), keys.length)
}

/**
 * Build the cumulative addendum for a base generation.
 *
 * Cumulative, replaced daily, never chained: the client fetches exactly one and
 * a mismatched `baseGeneration` means refetch the base. That is the whole
 * catch-up protocol.
 */
export const buildAddendum = (canonicalUrls: Iterable<string>): Built => {
  const keys = distinctKeys(canonicalUrls)
  const bytes = serializeAddendum(keys)
  return pin(bytes, keys.length)
}

/** The pin a manifest must carry for these bytes. */
export const pinOf = (bytes: Uint8Array): string => sha256Hex(bytes)

/**
 * The distinct KEYS of a corpus, in first-seen order.
 *
 * Deduplicated on the derived key rather than on the URL string, because the
 * key is what construction requires to be distinct. Deduplicating URLs leaves
 * one hole: two different addresses whose first eight digest bytes agree arrive
 * as a repeated key and take the build down (see {@link buildFilter}). SHA-256
 * makes that vanishingly rare — around one chance in three million at the
 * corpus size Hacker News is at — but "vanishingly rare" is a bad property for
 * a nightly build to depend on when deduplicating on the right thing costs
 * nothing. The resulting bytes are identical either way, since a colliding pair
 * would have produced one filter entry regardless.
 */
const distinctKeys = (canonicalUrls: Iterable<string>): ReadonlyArray<Key64> => {
  const seen = new Set<string>()
  const keys: Array<Key64> = []
  for (const url of canonicalUrls) {
    const key = keyOfCanonical(url)
    const identity = `${key.high},${key.low}`
    if (seen.has(identity)) continue
    seen.add(identity)
    keys.push(key)
  }
  return keys
}
