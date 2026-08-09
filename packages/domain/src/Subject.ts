/**
 * The page being read, and the addresses that point at it.
 *
 * A Subject URL is minted only by the canonicalization rules, and carries the
 * version of the rules that minted it. Two components running different rule
 * versions produce different keys for the same page, and the failure is silent
 * — so the version travels with the artifact contract rather than being assumed.
 */
import * as Schema from "effect/Schema"

/**
 * The canonicalized address elected to represent a Subject. The key everywhere.
 *
 * Branded so a raw `string` cannot be passed where a canonicalized address is
 * required — the mistake this prevents is a Lookup keyed on the tracking URL
 * the reader clicked rather than the destination it resolved to.
 */
export const SubjectUrl = Schema.String.pipe(Schema.brand("SubjectUrl"))
export type SubjectUrl = typeof SubjectUrl.Type

/** The version of the canonicalization rules that minted a Subject URL. */
export const RulesVersion = Schema.Number.pipe(Schema.brand("RulesVersion"))
export type RulesVersion = typeof RulesVersion.Type

/**
 * Why we believe an address points at a Subject.
 *
 * Deliberately excludes a page's self-declared `rel=canonical`: a page
 * asserting its own identity is not evidence we observed, and trusting it lets
 * a publisher merge or split Subjects at will.
 */
export const AliasEvidence = Schema.TaggedUnion({
  /** Our own canonicalization rules produced this address. */
  Canonicalized: { rulesVersion: RulesVersion },
  /** The reader's own browser traversed a redirect to get here. */
  Redirected: { from: Schema.String },
  /** A Network's own submitted URL for a Discussion resolved here. */
  Submitted: { network: Schema.String }
})
export type AliasEvidence = typeof AliasEvidence.Type

/** One address believed to point at a Subject, with the evidence for it. */
export class Alias extends Schema.Opaque<Alias, { readonly _brand: "Alias" }>()(
  Schema.Struct({
    url: Schema.String,
    evidence: AliasEvidence
  })
) {}

/** What caused a Reading to begin. */
export const Arrival = Schema.TaggedUnion({
  /** The reader followed a link from a Network we read. */
  FromNetwork: { network: Schema.String, discussion: Schema.String },
  /** The reader got here some other way, or we could not tell. */
  Elsewhere: {}
})
export type Arrival = typeof Arrival.Type
