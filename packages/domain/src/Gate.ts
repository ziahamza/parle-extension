/**
 * Whether X may be asked about a Subject.
 *
 * This is the primary control bounding authenticated requests made against the
 * reader's own X account, so it is a TOTAL PURE FUNCTION of accumulated
 * Coverage — not a `Deferred` awaiting a signal. The Deferred formulation
 * deadlocks with no error when the earlier wave settles empty, which is the
 * common case, and it was the shape three independent designs reached for.
 *
 * The warrant is a DISCLOSURE argument: asking X reveals nothing new because
 * the address is already demonstrably public. Only a Linked Mention establishes
 * that. A Topical Mention proves the subject matter was discussed while the
 * address we would send X remains novel — so summing the tiers voids the very
 * argument that makes the request acceptable.
 */
import * as Result from "effect/Result"
import { Coverage, isSettled, mentionsOf, type WithholdingReason } from "./Coverage.ts"
import { isLinked } from "./Mention.ts"

/** Permission to issue one X Lookup, carrying what justified it. */
export interface Permit {
  readonly justifiedBy: ReadonlyArray<string>
}

/** Whether this Enquiry began automatically or because the reader asked. */
export type Impetus = "automatic" | "reader-asked"

/**
 * Decide whether X may be asked, given everything learned so far.
 *
 * Returns a `Withholding` reason rather than `false`, so a declined Lookup
 * always lands in Coverage with something the panel can render.
 *
 * A reader who deliberately opens the extension on a page has asked a direct
 * question, and gets a direct answer: `reader-asked` bypasses the gate. The
 * asymmetry is deliberate and the trade-off is not hidden — the gate's warrant
 * is a disclosure argument rather than a consent one, so consent does not
 * actually discharge it. It is accepted because the toolbar must never say
 * "not applicable", and because the cost of the alternative is a reader who
 * cannot find out what X said about the page in front of them.
 */
export const mayAskX = (
  coverage: Coverage,
  impetus: Impetus = "automatic"
): Result.Result<Permit, WithholdingReason> => {
  if (impetus === "reader-asked") {
    return Result.succeed({ justifiedBy: ["reader-asked"] })
  }

  const linked = mentionsOf(coverage).filter(isLinked)

  if (linked.length > 0) {
    return Result.succeed({
      justifiedBy: linked.map((m) => m.discussion.nativeId as string)
    })
  }

  // No Linked Mention. Whether the rest has settled changes nothing about the
  // answer — it is a Withholding either way, never an error — but `isSettled`
  // is what the panel needs to distinguish "still looking" from "we looked".
  void isSettled(coverage)
  return Result.fail<WithholdingReason>("awaiting-linked-mention")
}
