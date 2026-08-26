/**
 * Reading `data/standing.json`, and answering one question about it.
 *
 * **Pure, and offline by construction.** Nothing in this file can issue a
 * request; there is no fetch, no I/O, and no service. The artifact is compiled
 * on a developer's machine by `../tools/build.ts` and shipped inside the build,
 * which is the entire privacy argument for the feature: a rating a reader looks
 * up locally discloses nothing, and a rating fetched per page discloses what
 * they are reading to whoever answers.
 *
 * ## The on-disk shape is not the returned shape
 *
 * On disk a publisher is a small record keyed by rater —
 * `{"name":"Fox News","allsides":"right","wikipediaRsp":"no-consensus"}` — so
 * that the origin of a claim is the *key* rather than a string repeated 6,000
 * times. At 2,800 publishers, storing `"origin":"allsides"` per claim costs
 * ~90 KB of the 250 KB budget to say something the position already says.
 *
 * What comes back out of {@link standingOf} is the opposite: a flat list of
 * {@link StandingClaim}s, each carrying its `origin` and a ready-to-show
 * `attribution`, because a caller holding a claim must never have to remember
 * where it came from. The compaction lives here and nowhere else.
 *
 * ## Failing closed
 *
 * {@link readStanding} returns `undefined` for anything it cannot decode, and
 * the schema refuses unknown *values* — a lean, a status or a grade this build
 * does not know is a decode failure rather than a shrug. That is the same rule
 * `@parle/index-codec`'s `Manifest` follows and for the same reason: an old
 * client that half-understands an artifact shows a reader something confidently
 * wrong, and a wrong rating attributed to a named third party is a worse thing
 * to ship than no rating at all.
 *
 * Unknown *keys* are likewise refused rather than ignored, and that differs from
 * `Manifest` deliberately: the manifest is served by a backend that may ship
 * ahead of the client, whereas this artifact is compiled by the same commit that
 * reads it. There is no forward-compatibility to preserve, so the strict reading
 * is free — and it makes `schemaVersion` mean something.
 */
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { lookupCandidates, normalizeHost } from "./Registrable.ts"
import {
  alignmentClaim,
  countryClaim,
  credibilityClaim,
  FactualReporting,
  foundedClaim,
  Lean,
  leanClaim,
  ownerClaim,
  RaterOrigin,
  RATER_NAMES,
  Reliability,
  reliabilityClaim,
  type Standing,
  type StandingClaim
} from "./Standing.ts"

/** The artifact version this build understands. Anything else is refused. */
export const SUPPORTED_SCHEMA_VERSION = 1

/**
 * How a layer reached the artifact.
 *
 * `mirror` is the honest word for AllSides: allsides.com refuses automated
 * clients, so the ratings come from a community republication of them. A reader
 * looking at a credits screen is entitled to know that, and a maintainer
 * deciding whether to trust a number is entitled to know it sooner.
 * `unavailable` means the build could not reach the source at all and shipped
 * without that layer — recorded rather than hidden, because an artifact silently
 * missing a rater looks exactly like a publisher nobody rated.
 */
export const Obtained = Schema.Literals(["direct", "mirror", "unavailable"])
export type Obtained = typeof Obtained.Type

/**
 * One rater's provenance: who, under what licence, from where, when.
 *
 * Every field is an obligation rather than a convenience. CC BY, CC BY-SA and
 * CC BY-NC all require attribution naming the source and its licence, so
 * `name`, `license`, `licenseUrl` and `sourceUrl` are the licence terms made
 * structural — see {@link licenceNotices}. `fetchedAt` is the staleness the
 * reader is owed: this artifact is only as current as the release that carries
 * it, and a rating that moved last month is still the old one here.
 */
export const Rater = Schema.Struct({
  name: Schema.String,
  license: Schema.String,
  licenseUrl: Schema.String,
  sourceUrl: Schema.String,
  fetchedAt: Schema.String,
  obtained: Obtained,
  entries: Schema.Number,
  note: Schema.optionalKey(Schema.String)
})
export type Rater = typeof Rater.Type

/** Wikidata's publisher facts. Every field optional: most publishers carry some. */
export const WikidataFacts = Schema.Struct({
  alignment: Schema.optionalKey(Schema.String),
  founded: Schema.optionalKey(Schema.String),
  owner: Schema.optionalKey(Schema.String),
  country: Schema.optionalKey(Schema.String)
})

/**
 * One publisher, keyed by rater.
 *
 * Every field is optional and an entry with none of them is legal but useless —
 * {@link standingOf} declines to construct a Standing from it rather than
 * returning an empty one, so "we have nothing on this publisher" and "this
 * publisher has an entry" cannot be confused by a caller checking for
 * `undefined`.
 */
export const PublisherEntry = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  allsides: Schema.optionalKey(Lean),
  wikipediaRsp: Schema.optionalKey(Reliability),
  iffy: Schema.optionalKey(FactualReporting),
  wikidata: Schema.optionalKey(WikidataFacts)
})
export type PublisherEntry = typeof PublisherEntry.Type

/** The shipped artifact, whole. */
export const StandingArtifact = Schema.Struct({
  schemaVersion: Schema.Number,
  builtAt: Schema.String,
  raters: Schema.Record(RaterOrigin, Rater),
  publishers: Schema.Record(Schema.String, PublisherEntry)
})
export type StandingArtifact = typeof StandingArtifact.Type

const decode = Schema.decodeUnknownOption(StandingArtifact)

/**
 * Read the artifact, or say nothing.
 *
 * Total, and the `try` is not decoration — the same argument as
 * `Manifest.readManifest`, one package over. This is applied to whatever a
 * bundler handed us, and decoding walks properties of a value nobody has
 * vouched for; a property that throws when read would otherwise surface as a
 * defect in whichever fiber happened to be opening the panel.
 *
 * A version mismatch is refused *before* the publishers are looked at, so that
 * nobody can later add a "well, the entries themselves are fine" exception.
 */
export const readStanding = (raw: unknown): StandingArtifact | undefined => {
  try {
    const decoded = decode(raw)
    if (Option.isNone(decoded)) return undefined
    const artifact = decoded.value
    if (artifact.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return undefined
    // A `Record` keyed by a literal union *drops* keys outside it rather than
    // refusing them, so the rater names are checked against the value as it
    // arrived. This is the refusal that matters most: an artifact carrying a
    // fifth rater is an artifact this build cannot attribute, and an
    // unattributable rating is the one thing ADR 0022 says must never reach a
    // reader. It is a licence question too — every layer is aboard under a named
    // licence, and a layer whose name we do not know is a layer whose terms we
    // have not agreed to. Refusing the whole document rather than the stray key
    // is deliberate: a silently thinner artifact is the shape of bug that ships.
    const declared = (raw as { raters?: Record<string, unknown> }).raters ?? {}
    for (const origin of Object.keys(declared)) {
      if (!(origin in RATER_NAMES)) return undefined
    }
    return artifact
  } catch {
    return undefined
  }
}

/** Flatten one publisher's record into attributed claims, in reading order. */
const claimsOf = (entry: PublisherEntry): ReadonlyArray<StandingClaim> => {
  const claims: Array<StandingClaim> = []
  // Ordered by what a reader most needs and least: where a rater places it,
  // then whether it is usable as a source, then whether it is on a list of
  // unreliable sites, then the publisher facts that give the rest context.
  if (entry.allsides !== undefined) claims.push(leanClaim(entry.allsides))
  if (entry.wikipediaRsp !== undefined) claims.push(reliabilityClaim(entry.wikipediaRsp))
  if (entry.iffy !== undefined) claims.push(credibilityClaim(entry.iffy))
  const facts = entry.wikidata
  if (facts !== undefined) {
    if (facts.alignment !== undefined) claims.push(alignmentClaim(facts.alignment))
    if (facts.founded !== undefined) claims.push(foundedClaim(facts.founded))
    if (facts.owner !== undefined) claims.push(ownerClaim(facts.owner))
    if (facts.country !== undefined) claims.push(countryClaim(facts.country))
  }
  return claims
}

/**
 * What the raters say about the publisher of a page on `host` — or nothing.
 *
 * `undefined` means one of four things and deliberately does not distinguish
 * them: the host is not a publisher host, no rater rated it, the artifact was
 * unreadable, or the entry was empty. All four are *absence of Standing*, and
 * absence is the only safe direction here — unlike a Lookup, where ADR 0005
 * insists a silent nothing be explained, there is no request to account for and
 * nothing was withheld. The panel simply says less.
 *
 * The artifact is passed in rather than reached for, because this package holds
 * no state and loads no files: whoever ships the build decides how the JSON gets
 * here, and a test can hand it a three-line one.
 */
export const standingOf = (artifact: StandingArtifact, host: string): Standing | undefined => {
  const normalized = normalizeHost(host)
  if (normalized === undefined) return undefined

  for (const candidate of lookupCandidates(normalized)) {
    const entry = artifact.publishers[candidate]
    if (entry === undefined) continue
    const claims = claimsOf(entry)
    if (claims.length === 0) continue
    return {
      host: normalized,
      matchedHost: candidate,
      matchedOn: candidate === normalized ? "exact" : "parent-domain",
      name: entry.name,
      claims
    }
  }
  return undefined
}

/**
 * The attribution the licences require, one line per rater, ready to show.
 *
 * CC BY 4.0, CC BY-SA 4.0 and CC BY-NC 4.0 each require the source and the
 * licence be named wherever the material is used. Parle's use is a compiled
 * derivative shipped to readers, so the obligation is discharged on a credits
 * surface rather than beside every rating — which is why this is a separate
 * export rather than something folded into {@link StandingClaim}. **The
 * integration wave must render it somewhere a reader can reach.** ADR 0022
 * records that as a shipping condition, not a nicety: the licences are the only
 * reason we are allowed to ship this data at all.
 */
export const licenceNotices = (artifact: StandingArtifact): ReadonlyArray<string> =>
  (Object.keys(artifact.raters) as ReadonlyArray<RaterOrigin>)
    .map((origin) => artifact.raters[origin])
    .filter((rater): rater is Rater => rater !== undefined)
    .map((rater) => `${rater.name} — ${rater.license} (${rater.licenseUrl}), from ${rater.sourceUrl}, compiled ${rater.fetchedAt.slice(0, 10)}.`)

/**
 * The one licence term that binds the project rather than the artifact.
 *
 * AllSides publishes under CC BY-**NC**. While its ratings are aboard, a
 * commercial Parle is a licence breach — so this string exists to be read by a
 * human before anyone monetises anything, and ADR 0022 carries the argument.
 *
 * The sentence is drawn on the settings page, so it is held to `CONTEXT.md`'s
 * Standing `_Avoid_` list: "Media Bias Ratings" is AllSides' own product name,
 * quoted with their name attached, and the only form in which a word from that
 * list may appear in the product.
 */
export const NONCOMMERCIAL_NOTICE =
  "AllSides' Media Bias Ratings data is licensed CC BY-NC 4.0. While it ships inside Parle, Parle may not be used commercially."
