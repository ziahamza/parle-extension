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
import { discussionKey, nativeText } from "./Network.ts"

/** Permission to issue one X Lookup, carrying what justified it. */
export interface Permit {
  readonly justifiedBy: ReadonlyArray<string>
}

/** Whether this Enquiry began automatically or because the reader asked. */
export type Impetus = "automatic" | "reader-asked"

/**
 * What is known about the Subject itself, as far as this gate is concerned.
 *
 * One case, and it exists because a Linked Mention is not always the evidence
 * the disclosure argument needs. On a site's front door — `facebook.com`, not a
 * page on it — a Linked Mention says a conversation named that ADDRESS, not
 * that it was about a page. Five of them are five different events at one
 * organisation, and none of them makes `facebook.com` newly public in a way
 * that justifies spending the reader's own X session.
 *
 * The carve-out is narrow on purpose. A **fresh** Linked Mention on a front
 * door still discharges the argument in full: if Hacker News was discussing
 * this address this week, the address is demonstrably public right now, which
 * is the whole of what ADR 0001 asks for. Only STALE evidence on a front door
 * is refused, which is the same domain restriction the panel's fold uses — so
 * there is one rule about what a front door's old Discussions may be used for,
 * not two.
 */
export interface Standing {
  /** The Subject is a site's entrance rather than a document on it. */
  readonly frontDoor: boolean
  /**
   * `discussionKey` of every Linked Mention posted inside the freshness
   * horizon. Only consulted when {@link Standing.frontDoor} is true.
   */
  readonly fresh: ReadonlySet<string>
}

/** Nothing known: every Linked Mention counts, which is the prior behaviour. */
export const unjudged: Standing = { frontDoor: false, fresh: new Set() }

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
  impetus: Impetus = "automatic",
  standing: Standing = unjudged
): Result.Result<Permit, WithholdingReason> => {
  if (impetus === "reader-asked") {
    return Result.succeed({ justifiedBy: ["reader-asked"] })
  }

  const linked = mentionsOf(coverage).filter(isLinked)

  // On a front door, only Linked Mentions from inside the freshness horizon
  // discharge the disclosure argument. See {@link Standing}: an old submission
  // of `facebook.com` is evidence that something happened at Facebook once, not
  // that this address is public news today.
  const discharging = standing.frontDoor
    ? linked.filter((m) => standing.fresh.has(discussionKey(m.discussion)))
    : linked

  if (discharging.length > 0) {
    return Result.succeed({
      justifiedBy: discharging.map((m) => nativeText(m.discussion.nativeId))
    })
  }

  // Named for what it is rather than folded into `awaiting-linked-mention`.
  // There ARE Linked Mentions here; they are the wrong ones, and a reader told
  // "nothing links here yet" on a page with four Hacker News threads linking to
  // it would be told something false about their own panel.
  if (standing.frontDoor && linked.length > 0) {
    return Result.fail<WithholdingReason>("front-door")
  }

  // No Linked Mention. Whether the rest has settled changes nothing about the
  // answer — it is a Withholding either way, never an error — but `isSettled`
  // is what the panel needs to distinguish "still looking" from "we looked".
  void isSettled(coverage)
  return Result.fail<WithholdingReason>("awaiting-linked-mention")
}
