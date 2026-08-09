/**
 * A decoded, verified, queryable copy of the Discussion Index.
 *
 * This is the only place in the package where a filter is actually probed, and
 * it is deliberately the narrowest surface in it: bytes and a pin go in, a
 * {@link Hint} comes out. `binaryFuseFilterHasKey` returns a boolean, and that
 * boolean never leaves this module — it is a table probe, not a statement about
 * the world, and the difference is the entire point of ADR 0005.
 *
 * Decoding is TOTAL. Every failure a four-megabyte download can suffer — a
 * truncated body, a captive portal's HTML, a half-written cache entry, an
 * artifact from a future build, a byte flipped in transit — arrives here as a
 * {@link Rejection}, never as a thrown error and never as a wrong answer. The
 * caller's ladder (see ./Shelf.ts) then falls back to last-known-good, and
 * failing that to no index; both of those are states the client already handles
 * because "no backend deployed" is a supported configuration (ADR 0011).
 */
import type { Network } from "@parle/domain/Network"
import type { SubjectUrl } from "@parle/domain/Subject"
import { addendumHas, deserializeAddendum, emptyAddendum, type Addendum } from "./Addendum.ts"
import { Hint, noIndex, notListed, possible } from "./Hint.ts"
import type { Rejection } from "./IndexState.ts"
import { keyOf } from "./Key.ts"
import { sha256Hex } from "./Sha256.ts"
import { binaryFuseFilterHasKey, type BinaryFuseFilter } from "./vendor/filter.ts"
import { deserializeBinaryFuseFilter } from "./vendor/serialize.ts"

/** One Network's filter, decoded. */
export interface NetworkFilter {
  readonly network: Network
  readonly filter: BinaryFuseFilter
  readonly keyCount: number
}

/**
 * Everything the client is holding, as one immutable value.
 *
 * `generation` and `canonicalizerVersion` travel WITH the filters rather than
 * beside them, because the pair is what makes a probe meaningful: a filter
 * without the rules version that built it is a filter you cannot safely ask
 * anything.
 */
export interface Artifact {
  readonly generation: string
  readonly canonicalizerVersion: string
  readonly filters: ReadonlyArray<NetworkFilter>
  readonly addendum: Addendum
  /** Which base generation the addendum attaches to; empty when there is none. */
  readonly addendumBaseGeneration: string
}

/** Total keys across every filter held. What the state reports. */
export const keyCountOf = (artifact: Artifact): number =>
  artifact.filters.reduce((total, held) => total + held.keyCount, 0)

/** How many keys the addendum contributes. Zero when there is none. */
export const addendumKeyCountOf = (artifact: Artifact): number => artifact.addendum.keys.length

/**
 * Check bytes against the digest the manifest pinned them at.
 *
 * The whole trust root, and it is enough precisely because no URL ever leaves
 * the device to the index origin: a hostile origin can suppress discovery or
 * waste Lookups, but it cannot learn what the reader reads, so the bar this
 * check has to clear is "did the bytes arrive intact", not "is the publisher
 * honest". A signature would raise the bar and break self-hosting, which ADR
 * 0002 and ADR 0010 both want kept open.
 */
export const isPinned = (bytes: Uint8Array, sha256: string): boolean => sha256Hex(bytes) === sha256

/** One Network's filter as it arrives: pinned bytes, not yet trusted. */
export interface OfferedFilter {
  readonly network: Network
  readonly sha256: string
  readonly bytes: Uint8Array
}

/** The addendum as it arrives. */
export interface OfferedAddendum {
  readonly baseGeneration: string
  readonly sha256: string
  readonly bytes: Uint8Array
}

/**
 * Decode a whole artifact, or say why it cannot be trusted.
 *
 * The addendum is treated more leniently than the filters, and deliberately so:
 * an unusable addendum costs suspicion we would not otherwise have had, which
 * is a loss in the safe direction, while an unusable base filter would have us
 * probing something we cannot vouch for. So a bad addendum is DROPPED and the
 * base is served alone; a bad filter refuses the whole artifact.
 *
 * The same reasoning covers an addendum whose `baseGeneration` does not match
 * the base we are adopting: it belongs to a different rebuild, so it is dropped
 * and the next manifest refresh re-fetches a matching pair. That is the entire
 * catch-up protocol — there is no chain of increments to walk back through.
 */
export const decodeArtifact = (input: {
  readonly generation: string
  readonly canonicalizerVersion: string
  readonly filters: ReadonlyArray<OfferedFilter>
  readonly addendum?: OfferedAddendum | undefined
}): Artifact | Rejection => {
  if (input.filters.length === 0) return "no-filter-published"

  const decoded: Array<NetworkFilter> = []
  for (const offered of input.filters) {
    if (!isPinned(offered.bytes, offered.sha256)) return "sha256-mismatch"
    const filter = deserializeBinaryFuseFilter(offered.bytes)
    if ("_tag" in filter) return "bytes-unreadable"
    if (filter.fingerprintBits !== 8 && filter.fingerprintBits !== 16 && filter.fingerprintBits !== 32) {
      return "fingerprint-width-unsupported"
    }
    decoded.push({ network: offered.network, filter, keyCount: filter.size })
  }

  const addendum = decodeAddendumOf(input.generation, input.addendum)

  return {
    generation: input.generation,
    canonicalizerVersion: input.canonicalizerVersion,
    filters: decoded,
    addendum: addendum.addendum,
    addendumBaseGeneration: addendum.baseGeneration
  }
}

const decodeAddendumOf = (
  generation: string,
  offered: OfferedAddendum | undefined
): { readonly addendum: Addendum; readonly baseGeneration: string } => {
  if (offered === undefined) return { addendum: emptyAddendum, baseGeneration: "" }
  if (offered.baseGeneration !== generation) return { addendum: emptyAddendum, baseGeneration: "" }
  if (!isPinned(offered.bytes, offered.sha256)) return { addendum: emptyAddendum, baseGeneration: "" }

  const decoded = deserializeAddendum(offered.bytes)
  return "_tag" in decoded
    ? { addendum: emptyAddendum, baseGeneration: "" }
    : { addendum: decoded, baseGeneration: offered.baseGeneration }
}

/**
 * What the index has to say about one Subject.
 *
 * Every filter held is asked, and the Networks that suspect it are collected —
 * so a caller ordering its Lookups can start where the suspicion is. A Network
 * for which no filter is published makes no contribution in either direction,
 * which is exactly why `NotListed` can never mean "there are no Discussions":
 * it means "nothing we hold lists it", and what we hold is at v1 one Network
 * out of three.
 */
export const hintFor = (artifact: Artifact, subject: SubjectUrl): Hint => {
  const key = keyOf(subject)
  const suspects: Array<Network> = []
  for (const held of artifact.filters) {
    if (binaryFuseFilterHasKey(held.filter, key.high, key.low)) suspects.push(held.network)
  }
  if (suspects.length > 0) return possible(suspects)
  // The addendum is not per-Network — it is whatever was added since the base,
  // across everything published — so a hit there suspects every Network we hold
  // a filter for. Over-suspecting costs a Lookup; under-suspecting costs the
  // reader a Discussion.
  if (addendumHas(artifact.addendum, key)) {
    return possible(artifact.filters.map((held) => held.network))
  }
  return artifact.filters.length === 0 ? noIndex : notListed
}
