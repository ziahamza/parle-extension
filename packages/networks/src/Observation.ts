/**
 * One reading of a Discussion's mutable numbers, stamped with OUR receive time.
 *
 * `@parle/domain` does not model this yet — the glossary names it, the package
 * stops at `Mention`. It is defined here rather than left out because a
 * connector that reads `points` and `num_comments` off the wire and drops them
 * is the connector that makes Movement, Delta, and "what's new since you last
 * looked" unbuildable later. Move it into `@parle/domain` when that package
 * next opens; nothing here depends on it living locally.
 *
 * `receivedAt` is deliberately not taken from the Network. Verified live
 * against Algolia on 2026-08-08: a hit carries `points: 127`, `created_at:
 * "2024-06-25"` — when the THREAD was posted — and `updated_at: "2024-09-20"`,
 * Algolia's own reindex, months later and unrelated to the score. There is no
 * as-of time for `points` anywhere in the payload, so the only honest stamp is
 * the moment we received it, read from `Clock` rather than `Date.now()` so the
 * reconciliation that consumes these is testable.
 *
 * `score` and `comments` are nullable rather than defaulted to zero: an
 * Algolia comment hit and an old.reddit result with the count suppressed both
 * carry no number, and a zero there is a claim we cannot support — it would
 * later render as "the score fell to 0", which is a Movement we invented.
 */
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { DiscussionId } from "@parle/domain/Network"

/**
 * A Discussion's numbers as of the moment we received them.
 *
 * Never corrected, only superseded — so nothing here is optional-and-mutable;
 * a later reading is a new Observation, not an edit to this one.
 */
export class Observation extends Schema.Opaque<Observation, { readonly _brand: "Observation" }>()(
  Schema.Struct({
    discussion: DiscussionId,
    /** Milliseconds since the epoch, from `Clock` — when WE received these numbers. */
    receivedAt: Schema.Number,
    /** The Network's score, where it gave one. */
    score: Schema.NullOr(Schema.Number),
    /** The Network's reply count, where it gave one. */
    comments: Schema.NullOr(Schema.Number),
    /** Whether the Discussion still appeared in the answer. Only ever `true` here. */
    present: Schema.Boolean
  })
) {}

/**
 * Where a connector puts the Observations its Lookups produced.
 *
 * A `Context.Reference` and not a `Context.Service` on purpose: its `Identifier`
 * is `never`, so reading it adds nothing to the requirement channel and
 * `linked`/`topical` keep the `Stream<Consultation, never, never>` the contract
 * demands. The default discards, so no caller is forced to care about
 * Observations to use a connector, and a test can supply a recording sink
 * without a layer.
 *
 * Total by construction: a sink that fails would widen a connector's error
 * channel back out of `never`, so the shape has no error type at all and an
 * implementation that can fail must swallow it.
 */
export interface ObservationSink {
  readonly observe: (observations: ReadonlyArray<Observation>) => Effect.Effect<void>
}

const discard: ObservationSink = { observe: () => Effect.void }

export const ObservationSink = Context.Reference<ObservationSink>(
  "parle/source/ObservationSink",
  { defaultValue: () => discard }
)

/** Stamp a Discussion's numbers with the current `Clock` time. */
export const observeNow = Effect.fn("Observation.observeNow")(function*(
  discussion: DiscussionId,
  numbers: { readonly score: number | null; readonly comments: number | null }
) {
  const receivedAt = yield* Clock.currentTimeMillis
  return Observation.make({
    discussion,
    receivedAt,
    score: numbers.score,
    comments: numbers.comments,
    present: true
  })
})
