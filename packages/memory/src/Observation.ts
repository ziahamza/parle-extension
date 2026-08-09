/**
 * One reading of a Discussion's mutable numbers.
 *
 * This belongs in `@parle/domain` and is not there yet, so it is defined here and
 * should move when domain gains it. Nothing else in this package depends on
 * where it lives.
 *
 * `receivedAt` is *our* receive time, and the field name says so on purpose. No
 * Network supplies an as-of time for its numbers: Hacker News via Algolia returns
 * `points`, a `created_at` naming when the thread was posted, and an `updated_at`
 * naming when Algolia last reindexed — which can be years later and has nothing
 * to do with when the score was true. Calling this field `observedAt` invites
 * exactly the reading the data cannot support, so it does not.
 *
 * `stillListed` is the third number and the one that is not a number: whether the
 * Discussion still appeared in the answer we were reading. It records what we
 * saw, never what it means — omission from an answer licenses "withdrawn" and
 * nothing stronger, and that judgement is a Movement's to make, not an
 * Observation's.
 */
import * as Schema from "effect/Schema"
import { DiscussionId } from "@parle/domain/Network"

/**
 * A Discussion's mutable numbers as we received them.
 *
 * Observations are never corrected, only superseded — so there is no `update`
 * anywhere, and {@link Recollection}'s `observe` refuses to let an older reading
 * displace a newer one.
 */
export class Observation extends Schema.Opaque<Observation, { readonly _brand: "Observation" }>()(
  Schema.Struct({
    discussion: DiscussionId,
    /** Absent where the Network does not publish one, never defaulted to zero. */
    score: Schema.optionalKey(Schema.Number),
    comments: Schema.optionalKey(Schema.Number),
    /** Whether the Discussion still appeared in the answer we were reading. */
    stillListed: Schema.Boolean,
    /** When *we* received these numbers, in epoch milliseconds. */
    receivedAt: Schema.Number
  })
) {}
