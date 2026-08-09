/**
 * The one mutable document. Everything large is immutable and pinned by it.
 *
 * ```
 *   /v1/manifest.json        Cache-Control: public, max-age=900, must-revalidate
 *   /v1/blobs/<sha256>.bin   Cache-Control: public, max-age=31536000, immutable
 * ```
 *
 * Four things live here that could each otherwise have been a build constant,
 * and each of them is here for a stated reason:
 *
 * - **`canonicalizerVersion`** — the anti-divergence clause. A client whose
 *   rules disagree with the builder's must ignore the artifact ENTIRELY. See
 *   ./Key.ts for why a mismatch is worse than no index at all.
 * - **`policy.lookupsEnabled`** — the kill switch, per Network. ADR 0001
 *   requires the X path be switchable off without shipping a build, because it
 *   runs against the reader's own authenticated session and a bad day there is
 *   a bad day for their account, not ours.
 * - **`policy.sharedDigestMinScore`** — ADR 0007's popularity threshold, which
 *   decides where the Shared/Local crossover falls. It is a product tuning
 *   knob, retuned from data, and shipping a build to move it is absurd.
 * - **`filters`** — a MAP, keyed by Network. v1 publishes Hacker News only, and
 *   that must be normal rather than an error: adding Reddit later is then an
 *   added key, not a format change. Ticket 16's "does it record which network"
 *   is answered by construction.
 *
 * **There is no sharding and there will not be.** One file, fetched once,
 * leaking exactly zero bits about what the reader browses. The privacy
 * arithmetic is decisive: at 3.58M keys the whole secret is 21.8 bits, so 256
 * shards would leak 8 of them — 37% of the secret — per page load, to save
 * about 15 KB. Nothing in this schema addresses a shard, and nothing should be
 * added that does.
 *
 * **Unknown fields are ignored and unknown values are refused.** Those are two
 * different rules and both are load-bearing. Ignoring unknown fields is what
 * lets the backend ship a new artifact kind to old clients. Refusing unknown
 * *values* — a schema version, a filter kind, a fingerprint width — is what
 * keeps an old client from probing something it does not understand. The first
 * makes the format extensible; the second makes it safe.
 *
 * Which is why `filters`, `addendum` and `policy` decode as `Unknown` here and
 * are read entry by entry in {@link elect} and the policy accessors, rather than
 * being typed structurally in the document. A schema that insisted every
 * `filters` value be a {@link FilterRef} would make ONE entry of a future family
 * — a ribbon filter with no `fingerprintBits`, say — undecodable, and a document
 * that does not decode takes the whole index down with it, including the Hacker
 * News filter this client can read perfectly well. "The backend can ship ahead
 * of the client" has to survive the backend shipping something genuinely new,
 * not merely a new key of an already-known shape. An entry belonging to a
 * Network this build DOES know is still decoded strictly: unreadable there is a
 * refusal, because that is a filter we were meant to be able to use.
 *
 * A note on one name. The daily increment is called an **addendum** here, not a
 * "delta". `delta` is on the `_Avoid_` list of the glossary's **Watermark**, and
 * the thing it gets reached for — what changed between two Observations — is
 * **Movement**. Neither is a list of new URL hashes. Borrowing a word the
 * glossary has already ruled out, for a third unrelated meaning, is exactly the
 * collapse this codebase's vocabulary discipline exists to prevent.
 */
import { Network } from "@parle/domain/Network"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { Rejection } from "./IndexState.ts"

/** The manifest schema version this build understands. Anything else is refused. */
export const SUPPORTED_SCHEMA_VERSION = 1

/** The filter families this build can read. */
export const SUPPORTED_FILTER_KIND = "binary-fuse"

/** The inner serialization version this build can read. See ./vendor/serialize.ts. */
export const SUPPORTED_SERIALIZATION_VERSION = 1

/** A 64-hex-digit lowercase SHA-256, as the manifest must write it. */
export const Sha256Hex = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)))

/**
 * A pinned artifact.
 *
 * The URL may be relative to the manifest, so a self-hoster who moves the
 * origin does not have to rewrite every blob reference. The `sha256` is the
 * entire trust root: there is no signature in v1, deliberately, because a
 * baked-in verification key would break self-hosting outright — and the
 * security argument that lets us live without one is that no URL ever leaves
 * the device to the index origin, so a hostile index can suppress discovery or
 * waste Lookups but can never learn what the reader reads.
 */
export const BlobRef = Schema.Struct({
  url: Schema.String,
  sha256: Sha256Hex,
  bytes: Schema.optionalKey(Schema.Number)
})
export type BlobRef = typeof BlobRef.Type

/** One published filter. */
export const FilterRef = Schema.Struct({
  kind: Schema.String,
  fingerprintBits: Schema.Number,
  serializationVersion: Schema.Number,
  keyCount: Schema.Number,
  url: Schema.String,
  sha256: Sha256Hex,
  bytes: Schema.optionalKey(Schema.Number)
})
export type FilterRef = typeof FilterRef.Type

/** The cumulative increment published between base rebuilds. */
export const AddendumRef = Schema.Struct({
  kind: Schema.String,
  baseGeneration: Schema.String,
  keyCount: Schema.Number,
  url: Schema.String,
  sha256: Sha256Hex,
  bytes: Schema.optionalKey(Schema.Number)
})
export type AddendumRef = typeof AddendumRef.Type

/**
 * The knobs ADR 0001 and ADR 0007 require be tunable without shipping a build.
 *
 * `lookupsEnabled` is the kill switch, keyed by Network rather than being a
 * single X flag. ADR 0001 asks only for X — "a remotely-updatable flag in the
 * static artifacts can disable X access without shipping a new build, for when
 * X changes its defences" — but `@parle/policy`'s `Controls.killSwitched` is
 * already per-Network, and a defence change at Reddit is not less likely than
 * one at X. Keyed by `Schema.String` for the same forward-skew reason as
 * `filters`.
 *
 * Both fields are optional, and absence is NOT a default of "on". A client that
 * could not reach the manifest, or reached an older one, must not thereby
 * enable an authenticated request against the reader's own account. Consumers
 * read `Option.none` as "no instruction" and keep their own conservative
 * default — which is why these are exposed through {@link lookupsEnabledFor}
 * and {@link sharedDigestMinScore} rather than as bare fields with a `?? true`
 * waiting to be written next to them.
 */
export const Policy = Schema.Struct({
  lookupsEnabled: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  sharedDigestMinScore: Schema.optionalKey(Schema.Unknown)
})
export type Policy = typeof Policy.Type

/**
 * The manifest.
 *
 * `filters` is keyed by `Schema.String`, not by `Network`, precisely so that a
 * future `"lemmy"` key does not make the whole document undecodable on an old
 * client. Keys that are not Networks this build knows are dropped at election
 * time (see {@link elect}).
 */
export const Manifest = Schema.Struct({
  schemaVersion: Schema.Number,
  /** The moment the base artifacts were built. An opaque token; only equality matters. */
  generation: Schema.String,
  canonicalizerVersion: Schema.String,
  filters: Schema.Record(Schema.String, Schema.Unknown),
  addendum: Schema.optionalKey(Schema.Unknown),
  exclusionList: Schema.optionalKey(BlobRef),
  policy: Schema.optionalKey(Policy),
  digests: Schema.optionalKey(Schema.Struct({ baseUrl: Schema.String }))
})
export type Manifest = typeof Manifest.Type

/**
 * Read a manifest, or say it was unreadable.
 *
 * Total, and the `try` is not decoration. This is applied to whatever a URL
 * returned — on a captive portal, an HTML login page served with a 200 — and to
 * whatever an integrator hands `Shelf.offer`, whose parameter is `unknown` by
 * design. Decoding walks properties of a value nobody has vouched for, and a
 * value can define a property that throws when read; the decoder surfaces that
 * as a defect rather than as a schema issue, and it would land in whichever
 * fiber happened to be refreshing the index. `Shelf.offer` promises never to
 * throw, and the promise has to be kept here, where the untrusted value is
 * first touched.
 */
export const readManifest = (raw: unknown): Manifest | Rejection => {
  try {
    const decoded = Schema.decodeUnknownOption(Manifest)(raw)
    return Option.isSome(decoded) ? decoded.value : "manifest-unreadable"
  } catch {
    return "manifest-unreadable"
  }
}

/**
 * Run one of the decoders below over one untrusted value.
 *
 * Same argument as {@link readManifest}'s `try`, one level down: the values in
 * `filters` are `unknown`, and reading a property of an unknown value can throw.
 */
const decodeOrUndefined = <A>(decode: (raw: unknown) => Option.Option<A>, raw: unknown): A | undefined => {
  try {
    return Option.getOrUndefined(decode(raw))
  } catch {
    return undefined
  }
}

const decodeNetwork = Schema.decodeUnknownOption(Network)
const decodeFilterRef = Schema.decodeUnknownOption(FilterRef)
const decodeAddendumRef = Schema.decodeUnknownOption(AddendumRef)

/**
 * Whether the manifest says a Network may be asked.
 *
 * `None` means the manifest has no opinion, which is a different thing from
 * `Some(true)` and must not collapse into it: an absent instruction leaves the
 * caller's own default standing, and for X that default is conservative.
 * `Some(false)` is ADR 0001's kill switch thrown.
 */
export const lookupsEnabledFor = (manifest: Manifest, network: Network): Option.Option<boolean> => {
  const stated = manifest.policy?.lookupsEnabled?.[network]
  // Anything that is not a boolean is not an instruction. A future value — a
  // schedule, a percentage, an object — must read as `None` and leave the
  // caller's conservative default standing, never as truthiness.
  return typeof stated === "boolean" ? Option.some(stated) : Option.none()
}

/**
 * ADR 0007's popularity threshold: the score at which a Subject becomes worth a
 * Shared Digest. Retuned from data, so it lives here rather than in a build.
 */
export const sharedDigestMinScore = (manifest: Manifest): Option.Option<number> => {
  const stated = manifest.policy?.sharedDigestMinScore
  return typeof stated === "number" && Number.isFinite(stated) ? Option.some(stated) : Option.none()
}

/** One filter this client has decided it can and will use. */
export interface Elected {
  readonly network: Network
  readonly filter: FilterRef
}

/**
 * What a client should fetch, having read a manifest — or why it should not.
 *
 * Separated from adoption so the fetcher knows what to ask for before it has
 * any bytes. The shelf re-runs this on its own inputs rather than trusting a
 * caller's election, so nothing can be adopted by claiming it was elected.
 */
export type Election =
  | { readonly _tag: "Fetch"; readonly filters: ReadonlyArray<Elected>; readonly addendum: Option.Option<AddendumRef> }
  | { readonly _tag: "Ignore"; readonly rejection: Rejection }

const ignore = (rejection: Rejection): Election => ({ _tag: "Ignore", rejection })

/**
 * Decide what, if anything, of this manifest is usable by this client.
 *
 * `clientCanonicalizerVersion` is checked FIRST and refuses the whole document.
 * That ordering is deliberate: on a mismatch there is nothing here worth
 * examining, and examining it invites someone to later add a "well, the filter
 * itself is fine" exception.
 */
export const elect = (manifest: Manifest, clientCanonicalizerVersion: string): Election => {
  if (manifest.canonicalizerVersion !== clientCanonicalizerVersion) {
    return ignore("canonicalizer-mismatch")
  }
  if (manifest.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return ignore("schema-version-unsupported")
  }

  const elected: Array<Elected> = []
  let sawKind: Rejection | undefined
  let sawWidth: Rejection | undefined
  let sawUnreadable: Rejection | undefined

  for (const [name, raw] of Object.entries(manifest.filters)) {
    const network = decodeOrUndefined(decodeNetwork, name)
    // A Network this build does not know. Skipped WHATEVER SHAPE its entry has:
    // this is where "the backend ships a new artifact family" is survived, and
    // survival means not looking at it, not failing to parse it.
    if (network === undefined) continue

    // A Network this build does know, so its entry is read strictly. An entry
    // we were meant to be able to use and cannot is a refusal, not a shrug.
    const filter = decodeOrUndefined(decodeFilterRef, raw)
    if (filter === undefined) {
      sawUnreadable = "manifest-unreadable"
      continue
    }
    if (filter.kind !== SUPPORTED_FILTER_KIND || filter.serializationVersion !== SUPPORTED_SERIALIZATION_VERSION) {
      sawKind = "filter-kind-unsupported"
      continue
    }
    if (filter.fingerprintBits !== 8 && filter.fingerprintBits !== 16 && filter.fingerprintBits !== 32) {
      sawWidth = "fingerprint-width-unsupported"
      continue
    }
    elected.push({ network, filter })
  }

  if (elected.length === 0) {
    return ignore(sawUnreadable ?? sawKind ?? sawWidth ?? "no-filter-published")
  }

  // An addendum this build cannot read is DROPPED, not refused: the base serves
  // alone and the next refresh re-fetches a matching pair. Losing an addendum
  // costs suspicion we would not otherwise have had, which is the safe
  // direction; losing the base costs the whole index.
  return {
    _tag: "Fetch",
    filters: elected,
    addendum: Option.fromNullishOr(
      manifest.addendum === undefined ? undefined : decodeOrUndefined(decodeAddendumRef, manifest.addendum)
    )
  }
}
