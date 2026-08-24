/**
 * "Which trusted references cite this page?" — and the four things that can
 * come back.
 *
 * A Backlink is not a Mention and this package is not a Network connector. A
 * Mention says a *conversation* concerns a Subject; a Backlink says a
 * *reference work* cites it. They are gathered differently, they are worth
 * different things to a reader, and collapsing them would put "Wikipedia" in a
 * list of places people argue.
 *
 * What they share is the house rule that a claim carries its evidence. A
 * Linked Mention records the Alias the submission matched; a Backlink records
 * the Alias the citation matched, for the same reason: a reference source
 * answers about an ADDRESS, and which of our addresses it answered about is
 * the difference between "Wikipedia cites this page" and "Wikipedia cites
 * something on this site".
 *
 * The outcome union is the Source.ts classification, narrowed. There is no
 * error channel: every way of not getting an answer is classified into one of
 * four cases, because the caller has to be able to say something specific and
 * because the four have opposite consequences.
 *
 *   - `Cited` is what we found, and — see {@link Bounded} — at least what we
 *     found, never necessarily all of it.
 *   - `Uncited` is the reference source answering "nothing". Evidence about
 *     the world, and the only case it is ever safe to cache. Unless it is
 *     `bounded`, in which case it is evidence about the size of our own
 *     request and must not be.
 *   - `CouldNotAsk` is a fact about the attempt, never about the Subject, and
 *     never cached. It reuses `@parle/domain`'s `RefusalReason` rather than
 *     minting a parallel vocabulary for the same six situations.
 *   - `Garbled` is a 200 whose body was not usable. Never retried, never
 *     cached, and never mistaken for `Uncited`.
 *
 * There is no `Withholding` case here, and its absence is deliberate rather
 * than an omission: withholding is a decision made by whatever schedules a
 * Lookup, not by the thing that would have issued it, and a source that could
 * report "I chose not to ask myself" invites the reason to be invented at the
 * wrong layer. The integration wave threads Withholding in from the Enquiry.
 */
import * as Schema from "effect/Schema"
import { RefusalReason } from "@parle/domain/Coverage"

/**
 * A reference work whose citations we read.
 *
 * A closed union with one member today. Closed rather than a bare string so
 * adding the second one is a compile error at every site that renders or
 * branches on it — the panel has to name the source, and "some reference work
 * cites this" is not a thing a reader can weigh.
 */
export const ReferenceSource = Schema.Literals(["wikipedia"])
export type ReferenceSource = typeof ReferenceSource.Type

/**
 * The reference source had more to say than we asked to hear.
 *
 * The same field, for the same reason, as `Consultation`'s `windowed` in
 * `@parle/domain` — ADR 0005's rule cuts here too. `eulimit=25` bounds what
 * MediaWiki sends; a list of citing pages shown with no mark tells the reader
 * that is all of them, and an `Uncited` derived from a filled window says
 * "Wikipedia does not cite this page" when the truth is "none of the first
 * twenty-five rows we were sent was this page".
 *
 * The second is the dangerous one because it is the cacheable case, and on
 * this API it is not hypothetical. Verified live 2026-08-24: a namespace-
 * filtered query for `example.com` returned `exturlusage: []` **together with
 * a `continue` token** — an empty answer that is not an answer of nothing.
 * See {@link ./Wikipedia.ts}.
 *
 * Absent rather than `false` when the answer was whole, so that a construction
 * site that has not measured it asserts nothing.
 */
const Bounded = Schema.optionalKey(Schema.Boolean)

/**
 * One reference work's citation of one of our addresses.
 *
 * `matchedUrl` is the evidence and is not decoration: the query went out under
 * one address and the index matches by prefix, so the row that came back has
 * to be re-checked against the Subject's Aliases and the Alias it matched has
 * to survive into what the reader is shown.
 */
export class Backlink extends Schema.Opaque<Backlink, { readonly _brand: "Backlink" }>()(
  Schema.Struct({
    /** Which reference work cites us. */
    reference: ReferenceSource,
    /** The citing page's title, as the reference work spells it. */
    title: Schema.String,
    /** Where a reader can go and read that page. */
    url: Schema.String,
    /** Which of our addresses it cites — the evidence for this Backlink. */
    matchedUrl: Schema.String
  })
) {}

/**
 * What one reference source had to say about one Subject.
 *
 * Every case carries `reference` so a caller holding several of these can tell
 * them apart without tracking which call produced which — the same reason a
 * `Consultation` carries its `Place`.
 */
export const BacklinkAnswer = Schema.TaggedUnion({
  /**
   * It cites us, under at least these pages.
   *
   * "At least" is the whole claim when `bounded` is set, and the naming is
   * chosen so a caller cannot read a total off a bound: there is no `count`
   * field and no `total` field, because MediaWiki reports neither and any
   * number we synthesised would be the size of our own request wearing the
   * clothes of a fact about Wikipedia.
   */
  Cited: { reference: ReferenceSource, backlinks: Schema.Array(Backlink), bounded: Bounded },
  /** It answered, and had nothing. Cacheable — unless `bounded`. */
  Uncited: { reference: ReferenceSource, bounded: Bounded },
  /** It could not answer, or we could not hear it. Never cached. */
  CouldNotAsk: { reference: ReferenceSource, reason: RefusalReason },
  /** It answered unusably — unparseable, truncated, or an interstitial as 200. */
  Garbled: { reference: ReferenceSource, detail: Schema.String }
})
export type BacklinkAnswer = typeof BacklinkAnswer.Type

/**
 * `Cited` only when there is something to cite with.
 *
 * No source constructs `Cited` or `Uncited` by hand. A `Cited` with an empty
 * array reports "a reference work cites this page" and renders as an empty
 * list, which is exactly the state the split exists to make impossible — and
 * `bounded` has to survive into the EMPTY branch, which is the branch where
 * getting it wrong is cached.
 */
export const citedWith = (
  reference: ReferenceSource,
  backlinks: ReadonlyArray<Backlink>,
  bounded = false
): BacklinkAnswer =>
  backlinks.length === 0
    ? BacklinkAnswer.cases.Uncited.make(bounded ? { reference, bounded } : { reference })
    : BacklinkAnswer.cases.Cited.make(
      bounded ? { reference, backlinks, bounded } : { reference, backlinks }
    )

/**
 * True when this answer was cut off by the size of our own request.
 *
 * One predicate rather than two `_tag` checks at every call site: `Cited`
 * bounded means "at least these", `Uncited` bounded means "none of the ones we
 * were sent", and every caller that cares — a panel, a cache — must treat them
 * alike.
 */
export const isBounded = (answer: BacklinkAnswer): boolean =>
  (answer._tag === "Cited" || answer._tag === "Uncited") && answer.bounded === true

/** The Backlinks in an answer, if it had any. */
export const backlinksOf = (answer: BacklinkAnswer): ReadonlyArray<Backlink> =>
  answer._tag === "Cited" ? answer.backlinks : []
