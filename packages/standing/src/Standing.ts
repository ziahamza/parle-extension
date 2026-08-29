/**
 * What named public raters say about a publisher — and who said it.
 *
 * **Standing is never Parle's judgement.** [ADR 0006](../../../docs/adr/0006-the-digest-reports-it-does-not-adjudicate.md)
 * says the product reports rather than adjudicates;
 * [ADR 0009](../../../docs/adr/0009-audience-spread-not-outlet-ratings.md) refuses
 * to assign left/right ratings to publications of our own, and leaves exactly
 * one door open — *"licensed outlet ratings remain a possible independent static
 * artifact"*. This package walks through that door, and
 * [ADR 0022](../../../docs/adr/0022-standing-is-a-static-artifact-of-named-raters.md)
 * is the argument for the terms it walks through on. The load-bearing term is
 * **attributed**: a claim here is always somebody else's, and the type system is
 * arranged so that it cannot be surfaced without saying whose.
 *
 * That is why {@link StandingClaim} carries `origin` *and* `attribution` on
 * every case, rather than leaving the panel to look the wording up. A rendering
 * that shows "Lean Left" with no rater beside it is precisely the thing ADR 0009
 * refused, and it should not be constructible by forgetting a field.
 *
 * The words in {@link RATER_NAMES} and the display maps below are here, in
 * source, rather than in `data/standing.json` — for two reasons. The artifact is
 * 230 KB and every stored English string is bytes the reader downloads; and
 * copy that a reader reads should be reviewable in a diff, not buried in a
 * generated data file where it can change without anyone noticing.
 */
import * as Schema from "effect/Schema"

/**
 * The raters whose published work this build compiles.
 *
 * A closed union, so adding a fifth is a compile error everywhere a claim is
 * rendered or attributed — which is where it should be, because a rater whose
 * name the panel cannot spell is a rater the panel must not quote.
 */
export const RaterOrigin = Schema.Literals(["allsides", "wikipedia-rsp", "iffy", "wikidata"])
export type RaterOrigin = typeof RaterOrigin.Type

/** How each rater is named to a reader. */
export const RATER_NAMES: Record<RaterOrigin, string> = {
  allsides: "AllSides",
  "wikipedia-rsp": "Wikipedia's perennial sources list",
  iffy: "the Iffy Index",
  wikidata: "Wikidata"
}

/** AllSides' five-point scale, spelled as the published data spells it. */
export const Lean = Schema.Literals(["left", "left-center", "center", "right-center", "right"])
export type Lean = typeof Lean.Type

/** AllSides' own display words for its own scale. */
const LEAN_WORDS: Record<Lean, string> = {
  left: "Left",
  "left-center": "Lean Left",
  center: "Center",
  "right-center": "Lean Right",
  right: "Right"
}

/**
 * The five statuses Wikipedia's list uses, kept apart.
 *
 * "No consensus" is not a soft "generally unreliable" and must never be shown as
 * one: it is the community reporting that it could not agree, which is a fact
 * about the discussion rather than about the publisher.
 */
export const Reliability = Schema.Literals([
  "generally-reliable",
  "no-consensus",
  "generally-unreliable",
  "deprecated",
  "blacklisted"
])
export type Reliability = typeof Reliability.Type

const RELIABILITY_WORDS: Record<Reliability, string> = {
  "generally-reliable": "Generally reliable",
  "no-consensus": "No consensus on reliability",
  "generally-unreliable": "Generally unreliable",
  deprecated: "Deprecated as a source",
  blacklisted: "Blacklisted"
}

/**
 * The Iffy Index's factual-reporting grade, MBFC-derived, as Iffy republishes it.
 *
 * `unrated` is a real state and not a missing value: an entry can be *in* the
 * index — which is itself the claim, the index being a list of unreliable
 * sources — without carrying a grade. Collapsing it into absence would delete
 * the listing along with the grade.
 */
export const FactualReporting = Schema.Literals([
  "very-low",
  "low",
  "mixed",
  "mostly-factual",
  "high",
  "very-high",
  "unrated"
])
export type FactualReporting = typeof FactualReporting.Type

const FACTUAL_WORDS: Record<FactualReporting, string> = {
  "very-low": "Listed as unreliable, very low factual reporting",
  low: "Listed as unreliable, low factual reporting",
  mixed: "Listed as unreliable, mixed factual reporting",
  "mostly-factual": "Listed as unreliable, mostly factual reporting",
  high: "Listed as unreliable, high factual reporting",
  "very-high": "Listed as unreliable, very high factual reporting",
  unrated: "Listed as unreliable"
}

/**
 * One thing one rater says about one publisher.
 *
 * Seven cases rather than a `{ kind, value }` pair, because the cases are not
 * interchangeable and the panel must not be able to treat them as though they
 * were. A `Lean` is a contested judgement about politics; a `Founded` is a date
 * anyone can check; a `Credibility` is a listing on an index of unreliable
 * sites. Rendering them through one code path is how a founding date ends up
 * displayed with the visual weight of an accusation.
 *
 * `attribution` is a full sentence fragment ready to show — "Lean Left — per
 * AllSides" — rather than a formatting hint, so that the naming cannot be lost
 * between here and the DOM.
 */
export const StandingClaim = Schema.TaggedUnion({
  /** Where a rater places the publisher on a left/right scale. */
  Lean: { origin: RaterOrigin, value: Lean, attribution: Schema.String },
  /** What Wikipedia's editors concluded about using the publisher as a source. */
  Reliability: { origin: RaterOrigin, value: Reliability, attribution: Schema.String },
  /** That the publisher appears on an index of unreliable sites, and its grade there. */
  Credibility: { origin: RaterOrigin, value: FactualReporting, attribution: Schema.String },
  /** A political alignment a publisher is recorded as having. Free text: it is somebody's label. */
  Alignment: { origin: RaterOrigin, value: Schema.String, attribution: Schema.String },
  /** The year the publisher began. */
  Founded: { origin: RaterOrigin, value: Schema.String, attribution: Schema.String },
  /** Who owns it. */
  Owner: { origin: RaterOrigin, value: Schema.String, attribution: Schema.String },
  /** Where it is based. */
  Country: { origin: RaterOrigin, value: Schema.String, attribution: Schema.String }
})
export type StandingClaim = typeof StandingClaim.Type

/** "…— per AllSides". The one shape every attribution takes. */
const perRater = (words: string, origin: RaterOrigin): string => `${words} — per ${RATER_NAMES[origin]}`

export const leanClaim = (value: Lean, origin: RaterOrigin = "allsides"): StandingClaim =>
  StandingClaim.cases.Lean.make({ origin, value, attribution: perRater(LEAN_WORDS[value], origin) })

export const reliabilityClaim = (value: Reliability, origin: RaterOrigin = "wikipedia-rsp"): StandingClaim =>
  StandingClaim.cases.Reliability.make({ origin, value, attribution: perRater(RELIABILITY_WORDS[value], origin) })

export const credibilityClaim = (value: FactualReporting, origin: RaterOrigin = "iffy"): StandingClaim =>
  StandingClaim.cases.Credibility.make({ origin, value, attribution: perRater(FACTUAL_WORDS[value], origin) })

export const alignmentClaim = (value: string, origin: RaterOrigin = "wikidata"): StandingClaim =>
  StandingClaim.cases.Alignment.make({ origin, value, attribution: perRater(`Political alignment: ${value}`, origin) })

export const foundedClaim = (value: string, origin: RaterOrigin = "wikidata"): StandingClaim =>
  StandingClaim.cases.Founded.make({ origin, value, attribution: perRater(`Founded ${value}`, origin) })

export const ownerClaim = (value: string, origin: RaterOrigin = "wikidata"): StandingClaim =>
  StandingClaim.cases.Owner.make({ origin, value, attribution: perRater(`Owned by ${value}`, origin) })

export const countryClaim = (value: string, origin: RaterOrigin = "wikidata"): StandingClaim =>
  StandingClaim.cases.Country.make({ origin, value, attribution: perRater(`Based in ${value}`, origin) })

/**
 * What one publisher's raters say, and which address the answer was found under.
 *
 * `matchedHost` is evidence rather than decoration, and it is the same discipline
 * as a Linked Mention recording the Alias it matched. A reader on
 * `blogs.example.com` shown a rating that was actually filed against
 * `example.com` is owed that fact: the raters rated the publication, not the
 * subdomain, and `matchedOn: "parent-domain"` is what lets the panel say so
 * instead of implying a precision nobody has.
 */
export interface Standing {
  /** The address as the reader's page presented it, normalised. */
  readonly host: string
  /** The address the artifact actually holds an entry for. */
  readonly matchedHost: string
  readonly matchedOn: "exact" | "parent-domain"
  /** The publisher's name as a rater spells it, when any rater bothered to. */
  readonly name: string | undefined
  /** Never empty: a Standing with nothing to say is not constructed. */
  readonly claims: ReadonlyArray<StandingClaim>
}
