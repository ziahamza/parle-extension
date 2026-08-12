/**
 * The Watermark: what a Digest's Discussions looked like when it was written.
 *
 * INTERNAL MACHINERY ONLY. ADR 0007 was amended on 2026-08-08 to delete the
 * reader-facing Delta and the Last Look horizon outright: a Digest is the
 * current summary of the whole of a Subject's Discussions, rewritten as they
 * grow, and the reader never sees a diff against an earlier one. The Watermark
 * survives because *something* has to decide when a rewrite is worth spending
 * the reader's own Provider quota on. Nothing in this file is rendered,
 * described, or named to the reader, and nothing here should ever grow a method
 * that answers "what is new since…".
 *
 * The comparison reads two numbers, and reads them asymmetrically:
 *
 *   - **Comment count is the material signal.** A Digest summarises what was
 *     said, so more comments means there is more to summarise. This is the
 *     signal that actually justifies a rewrite.
 *   - **Score is only reception.** A thread that doubled in score while gaining
 *     four comments is being read more, not saying more, and rewriting on that
 *     would spend the reader's quota to produce the same Findings. So score has
 *     to move much further before it counts.
 *
 * ADR 0007 names both as the cheap signals available from list endpoints, which
 * is the constraint that matters: deciding staleness must not cost a re-fetch of
 * every comment, or the check is more expensive than the rewrite it avoids.
 */
import { DiscussionId, discussionKey } from "@parle/domain/Network"
import * as Schema from "effect/Schema"
import { isNumber } from "@parle/domain/Refine"

/**
 * The mutable numbers a staleness check reads, and nothing else.
 *
 * Deliberately a structural shape rather than an import of somebody's
 * `Observation`. `@parle/domain` does not model Observations yet, so two
 * packages define their own and they disagree — `@parle/networks` spells the
 * numbers `score: number | null` and `@parle/memory` spells them
 * `score?: number` — and picking one would make this function uncallable by
 * holders of the other. Both satisfy the shape below, which asks only for what
 * ADR 0007 says the check may read. When Observation lands in `@parle/domain`,
 * this becomes an alias and nothing else changes.
 *
 * `present` / `stillListed` is deliberately NOT read. Omission from an answer
 * licenses "withdrawn" and nothing stronger, and a partial reading — one Network
 * refusing while another answers — would otherwise read as every Discussion
 * vanishing and trigger a rewrite from less material than we started with.
 */
export interface Numbers {
  readonly discussion: DiscussionId
  readonly score?: number | null | undefined
  readonly comments?: number | null | undefined
}

/** One Discussion's numbers, as they stood when the Digest was written. */
export const Mark = Schema.Struct({
  discussion: DiscussionId,
  score: Schema.NullOr(Schema.Number),
  comments: Schema.NullOr(Schema.Number)
})

/**
 * The Observations in a Digest's Brief.
 *
 * This DOES outlive the Brief it came from — it is stored beside the Digest so a
 * later Enquiry can decide whether to rewrite. That is why it is a Schema while
 * the Brief is not: it carries public conversations' numbers and no content, so
 * persisting it discloses nothing about what the reader read beyond the Digest
 * already sitting next to it.
 */
export class Watermark extends Schema.Opaque<Watermark, { readonly _brand: "Watermark" }>()(
  Schema.Struct({
    marks: Schema.Array(Mark)
  })
) {}

/** A number we can actually compare, or nothing. A null is never a zero. */
const numberOf = (value: number | null | undefined): number | null =>
  isNumber(value) && Number.isFinite(value) ? value : null

/**
 * Take the Watermark of a Brief's Discussions.
 *
 * Last reading per Discussion wins, because these arrive already reconciled by
 * receive time upstream and a Brief holds one Selected per Discussion anyway.
 */
export const watermarkOf = (numbers: ReadonlyArray<Numbers>): Watermark => {
  const marks = new Map<string, typeof Mark.Type>()
  for (const reading of numbers) {
    marks.set(discussionKey(reading.discussion), {
      discussion: reading.discussion,
      score: numberOf(reading.score),
      comments: numberOf(reading.comments)
    })
  }
  return Watermark.make({ marks: Array.from(marks.values()) })
}

/**
 * How far the material has to move before rewriting is worth it.
 *
 * Absolute AND relative, because neither alone is right at both ends of the
 * range: twenty new comments on a thread of twelve is a different conversation,
 * and twenty new comments on a thread of nine hundred is a Tuesday. Whichever
 * fires first wins.
 */
const commentsGrownBy = 20
const commentsGrownFraction = 0.25

/** Score has to move much further, because it is reception rather than material. */
const scoreMovedBy = 250
const scoreMovedFraction = 1

const grew = (
  before: number | null,
  after: number | null,
  atLeast: number,
  orFraction: number
): boolean => {
  // A missing number on either side is not movement. "The score fell to zero"
  // is a Movement we would have invented out of an absence.
  if (before === null || after === null) return false
  const moved = after - before
  if (moved <= 0) return false
  return moved >= atLeast || (before > 0 && moved >= before * orFraction)
}

/**
 * Whether a Digest written against this Watermark should be rewritten.
 *
 * A Discussion in `current` that the Watermark never saw returns true on its
 * own, and it is the strongest of the three signals: the Digest was written
 * without that conversation existing, so no amount of unchanged numbers
 * elsewhere makes it current.
 *
 * Total and pure — no Clock, no storage, no Provider. Deciding to rewrite must
 * never be the thing that fails.
 */
export const isStale = (watermark: Watermark, current: ReadonlyArray<Numbers>): boolean => {
  const held = new Map(watermark.marks.map((mark) => [discussionKey(mark.discussion), mark]))
  for (const now of current) {
    const then = held.get(discussionKey(now.discussion))
    if (then === undefined) return true
    if (grew(then.comments, numberOf(now.comments), commentsGrownBy, commentsGrownFraction)) {
      return true
    }
    if (grew(then.score, numberOf(now.score), scoreMovedBy, scoreMovedFraction)) return true
  }
  return false
}
