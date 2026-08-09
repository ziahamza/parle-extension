/**
 * The parts of a Discussion that do not move, and where a connector puts them.
 *
 * A `Consultation` carries `Mention`s, and a Mention carries a `DiscussionId`
 * and the evidence for the claim — deliberately, because that is all Coverage
 * needs to be true. It is not enough to DRAW anything: a panel row wants the
 * conversation's title and when it started, and a connector that reads those
 * off the wire and drops them makes them unrecoverable without asking the
 * Network a second time.
 *
 * So they leave by the same door {@link ./Observation.ts} uses, and for the same
 * reason: a `Context.Reference` whose `Identifier` is `never`, so reading it
 * adds nothing to the requirement channel and `linked`/`topical` keep the
 * `Stream<Consultation, never, never>` the contract demands. The default
 * discards, so a caller that only wants Coverage is not made to care.
 *
 * The split from `Observation` is the load-bearing part rather than tidiness. A
 * title and a submitted address are stable properties of the conversation and
 * may be overwritten freely. A score and a comment count are one READING of
 * numbers that were true at a moment no Network states, so they are never
 * corrected — only superseded, by receive time. Putting them in one record
 * would make the honest rule for one of them the wrong rule for the other.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { DiscussionId } from "@parle/domain/Network"

/**
 * What a Discussion is, as distinct from how it is currently doing.
 *
 * `submittedUrl` is kept VERBATIM. It is the evidence a Linked Mention is made
 * of, and canonicalizing it here would destroy the very thing being compared.
 *
 * `postedAt` is nullable because some answers do not carry it — `old.reddit.com`
 * renders a relative time and Algolia omits `created_at_i` on some hits — and a
 * zero there would render as "posted in 1970" or, worse, as newer than the
 * reader's Last Look.
 */
export class Discussion extends Schema.Opaque<Discussion, { readonly _brand: "Discussion" }>()(
  Schema.Struct({
    id: DiscussionId,
    title: Schema.String,
    /** The address the Discussion itself was submitted with, where it had one. */
    submittedUrl: Schema.NullOr(Schema.String),
    /** When the Network says the conversation started. Epoch milliseconds. */
    postedAt: Schema.NullOr(Schema.Number),
    author: Schema.NullOr(Schema.String)
  })
) {}

/**
 * Where a connector puts the Discussions its Lookups described.
 *
 * Total by construction, like the Observation sink: a sink that could fail
 * would widen a connector's error channel back out of `never`, so the shape has
 * no error type and an implementation that can fail has to swallow it.
 */
export interface DiscussionSinkShape {
  readonly note: (discussions: ReadonlyArray<Discussion>) => Effect.Effect<void>
}

const discard: DiscussionSinkShape = { note: () => Effect.void }

export const DiscussionSink = Context.Reference<DiscussionSinkShape>(
  "parle/source/DiscussionSink",
  { defaultValue: () => discard }
)
