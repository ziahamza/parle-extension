/**
 * What actually goes to the model, and why it is not the top of the thread.
 *
 * A 2,000-comment Reddit post does not fit a context window, so something has to
 * choose. The obvious choice — take the highest-scoring N — is the one that
 * systematically destroys the thing most worth reading, and it does so in two
 * independent ways.
 *
 * **1. Score ranking over-represents consensus.** Voting on a thread is
 * self-reinforcing: early agreement accumulates the votes, and a well-argued
 * objection arriving an hour later can be the single most useful comment in the
 * thread and still sit at rank twelve. Take the top ten and every one of them
 * agrees; the Digest then reports unanimity that the thread does not actually
 * have. The fix here is to STRATIFY BEFORE RANKING: comments carrying explicit
 * marks of disagreement are ranked in their own band, and the two bands are
 * interleaved into the slots, so objections get every other slot rather than
 * whatever is left after consensus has taken its fill. Ranking still decides
 * *which* objection — the strongest one wins its band — it just no longer
 * decides *whether* an objection appears at all.
 *
 * **2. Score ranking over-represents the biggest Network.** Reception differs by
 * community — that is the whole of what Spread is about — and the strongest
 * objection to a page is very often on the smaller thread on the other Network.
 * Ranking Discussions globally by size gives every slot to Hacker News and drops
 * the one Reddit thread where the argument happened. So Discussions are chosen
 * ROUND-ROBIN ACROSS NETWORKS: every Network that has anything gets a slot
 * before any Network gets a second.
 *
 * The stance test below is crude on purpose and its crudeness is bounded. It is
 * a SLOT ALLOCATION heuristic, not a judgement about truth, and it cannot leak
 * into the output: whether a Finding may say "contested" is decided by ADR 0006
 * and enforced by the citation invariant, not by which band a comment was
 * ranked in. A miscategorised comment costs at most one slot.
 */
import type { Network } from "@parle/domain/Network"
import type { Comment } from "./Brief.ts"

/** How much material one Digest is written from. */
export interface Limits {
  /** How many Discussions are read at all. Each read costs a request. */
  readonly discussions: number
  /** How many comments are taken from each Discussion. */
  readonly commentsPerDiscussion: number
  /** Where a single comment is clipped. Characters, as a rough proxy for tokens. */
  readonly charactersPerComment: number
}

/**
 * Sized for the weakest Provider we support rather than the strongest.
 *
 * ADR 0004 makes the on-device model a first-class Provider, and it has the
 * smallest window of the three. A Brief tuned to a frontier context window would
 * make the Digest silently better for readers who pay and unusable for readers
 * who do not, which is the dependency ADR 0004 forbids.
 */
export const defaultLimits: Limits = {
  discussions: 6,
  commentsPerDiscussion: 12,
  charactersPerComment: 900
}

/**
 * Marks of explicit disagreement.
 *
 * Deliberately excludes "but", "however" and "actually". They are the most
 * common discourse markers in English and they classify most of a thread as
 * objection, which collapses the two bands back into one and loses the
 * consensus the reader also needs. What is left is narrow and high-precision:
 * phrases people use when they are contradicting a claim rather than qualifying
 * one.
 */
const disagreement =
  /(?:disagree|incorrect|not correct|not true|isn't true|is false|misleading|nonsense|flawed|bogus|debunk|dispute|skeptic|sceptic|overstated|overblown|citation needed|counterpoint|this is wrong|that's wrong|simply wrong|just wrong|fails to|ignores the|misses the|doesn't hold|does not hold|no,\s)/i

/** Whether a comment reads as contradicting rather than agreeing. */
export const objects = (comment: Comment): boolean => disagreement.test(comment.text)

/** Comments with nothing in them — deleted, removed, or whitespace. */
const empty = (comment: Comment): boolean => {
  const text = comment.text.trim()
  return text.length === 0 || text === "[deleted]" || text === "[removed]"
}

/**
 * Highest score first, missing scores last, ties broken by id.
 *
 * The id tie-break is not cosmetic: without it a Brief built twice from the same
 * material can differ, and then so can the Digest, and a reader who reopens the
 * panel sees the summary change for no reason they can perceive.
 */
const byScore = (a: Comment, b: Comment): number => {
  const left = a.score ?? Number.NEGATIVE_INFINITY
  const right = b.score ?? Number.NEGATIVE_INFINITY
  if (left !== right) return right - left
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Clip a long comment, marking the clip so nothing reads as a complete quote. */
const clip = (comment: Comment, characters: number): Comment => {
  const text = comment.text.trim()
  if (text.length <= characters) return { ...comment, text }
  return { ...comment, text: `${text.slice(0, characters)}…` }
}

/**
 * Choose the comments one Discussion contributes.
 *
 * Slot one always goes to the highest-scoring comment, whichever band it is in —
 * that comment is usually what the conversation was actually about, and a Digest
 * that omitted it would read as being about a different thread. From slot two
 * the bands alternate, so an objection is never more than one slot away, and a
 * band that runs out yields its slots to the other rather than wasting them.
 */
export const selectComments = (
  comments: ReadonlyArray<Comment>,
  limits: Limits
): ReadonlyArray<Comment> => {
  const usable = comments.filter((c) => !empty(c)).sort(byScore)
  const objecting = usable.filter(objects)
  const agreeing = usable.filter((c) => !objects(c))

  const taken: Array<Comment> = []
  let next = 0
  let dissenting = 0
  // The first slot is whichever band the single strongest comment is in; after
  // that we alternate starting with the band it did NOT come from.
  const topObjection = objecting[0]
  const topAgreement = agreeing[0]
  let wantObjection = topObjection !== undefined && topAgreement !== undefined &&
    byScore(topObjection, topAgreement) < 0

  while (taken.length < limits.commentsPerDiscussion) {
    const first = wantObjection ? objecting[dissenting] : agreeing[next]
    const fallback = wantObjection ? agreeing[next] : objecting[dissenting]
    const chosen = first ?? fallback
    if (chosen === undefined) break
    if (chosen === objecting[dissenting]) dissenting += 1
    else next += 1
    taken.push(clip(chosen, limits.charactersPerComment))
    wantObjection = !wantObjection
  }
  return taken
}

/**
 * Choose which Discussions are read at all, round-robin across Networks.
 *
 * Order within a Network is the order the Mentions arrived, because nothing
 * cheaper is available: ranking Discussions by size would require reading all of
 * them first, and reading all of them is the cost this cap exists to bound.
 */
export const selectDiscussions = <A>(
  candidates: ReadonlyArray<A>,
  networkOf: (candidate: A) => Network,
  limit: number
): ReadonlyArray<A> => {
  const byNetwork = new Map<Network, Array<A>>()
  for (const candidate of candidates) {
    const network = networkOf(candidate)
    const held = byNetwork.get(network)
    if (held === undefined) byNetwork.set(network, [candidate])
    else held.push(candidate)
  }

  const queues = Array.from(byNetwork.values())
  const chosen: Array<A> = []
  let round = 0
  while (chosen.length < limit) {
    let added = false
    for (const queue of queues) {
      if (chosen.length >= limit) break
      const candidate = queue[round]
      if (candidate === undefined) continue
      chosen.push(candidate)
      added = true
    }
    if (!added) break
    round += 1
  }
  return chosen
}
