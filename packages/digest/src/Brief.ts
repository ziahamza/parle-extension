/**
 * The Brief — the exact material a Digest is written from.
 *
 * The glossary defines it as "the Discussions selected, the comments taken from
 * them, and their Observations at that moment", and that is what lives here.
 * `@parle/domain` already declares a `Brief` too, but a deliberately narrower
 * one: a Context service answering exactly two questions, `subject` and
 * `contains`. That narrowness is the whole point — the decoder must be able to
 * ask "were you actually given this Discussion?" without being able to hand out
 * a single word of content, or a Provider could mine the invariant that is
 * supposed to be checking it. It is imported below as {@link BriefService}, and
 * the alias is only to keep this module's own `Brief` — the material itself —
 * spelled the way the glossary spells it.
 *
 * A Brief is a plain interface rather than a `Schema`, and that is a statement
 * about its lifetime. It is never stored and never transmitted: it is built from
 * the reader's own browsing, handed to their own Provider, and dropped. Giving
 * it a codec would be building the door through which it could become a durable
 * record of what they read, which is the one thing ADR 0012 exists to prevent.
 * What DOES outlive it is the {@link Watermark}, which carries numbers about
 * public conversations and no content at all.
 */
import { Brief as BriefService } from "@parle/domain/Digest"
import type { DiscussionId } from "@parle/domain/Network"
import { discussionKey } from "@parle/domain/Network"
import type { SubjectUrl } from "@parle/domain/Subject"
import * as Layer from "effect/Layer"
import type { Watermark } from "./Watermark.ts"

/**
 * One comment taken from a Discussion, as the Provider will see it.
 *
 * `id` is the Network's own identifier for the comment and is the string a
 * Citation must carry back verbatim. It is not optional: a comment we cannot
 * point at is a comment a Finding cannot be held to, and including it would
 * invite exactly the unciteable output ADR 0006 calls a bug.
 *
 * `score` is nullable rather than zero-defaulted, for the same reason
 * Observations are: Hacker News comment hits and suppressed Reddit counts carry
 * no number, and a zero there is a claim we cannot support.
 */
export interface Comment {
  readonly id: string
  readonly author: string | null
  readonly score: number | null
  readonly text: string
}

/** What one Discussion actually says, as far as we were able to read it. */
export interface Contents {
  readonly title: string
  readonly score: number | null
  /** How many comments the Network says it has — not how many we took. */
  readonly commentCount: number | null
  readonly comments: ReadonlyArray<Comment>
}

/** One Discussion selected into a Brief, with the comments taken from it. */
export interface Selected extends Contents {
  readonly discussion: DiscussionId
}

/** The exact material a Digest is written from. */
export interface Brief {
  readonly subject: SubjectUrl
  readonly selected: ReadonlyArray<Selected>
  /**
   * What these Discussions' numbers looked like at this moment. Internal
   * machinery: it decides when the Digest it produced is stale enough to
   * rewrite, and is never shown to the reader.
   */
  readonly watermark: Watermark
}

/**
 * The narrow view of a Brief that the decoder is given.
 *
 * Keyed through `discussionKey`, never on the bare native id: a Reddit
 * permalink and a Hacker News item can share a base-36 string, and keying on
 * the id alone was demonstrated to accept a fabricated Citation against the
 * wrong Network's material.
 */
export const serviceOf = (brief: Brief): BriefService["Service"] => {
  const known = new Set(brief.selected.map((s) => discussionKey(s.discussion)))
  return BriefService.of({
    subject: brief.subject,
    contains: (id: DiscussionId) => known.has(discussionKey(id))
  })
}

/** The Brief as the layer `admit` requires. There is no other way in. */
export const layerOf = (brief: Brief): Layer.Layer<BriefService> =>
  Layer.succeed(BriefService, serviceOf(brief))

/**
 * A key for one (Discussion, comment) pair, or for a Discussion cited whole.
 *
 * The separator is a NUL, which appears in no Network's identifier alphabet, so
 * no two distinct pairs can collide on it.
 */
const commentKey = (discussion: DiscussionId, comment: string | undefined): string =>
  `${discussionKey(discussion)}\u0000${comment ?? ""}`

/**
 * Every comment pointer this Brief can actually resolve.
 *
 * This is a STRENGTHENING of the domain invariant, never a substitute for it.
 * `admit` proves a Citation names a Discussion we were given; it does not prove
 * the comment inside that Discussion exists, because the domain Brief cannot see
 * comments at all. A Provider that cites a real Discussion and invents a comment
 * id inside it produces a Finding whose link goes nowhere — which is the same
 * failure ADR 0006 is about, one level down. So the pointers are checked here,
 * where the material is, and a Finding that fails is dropped exactly as a
 * fabricated Discussion citation is.
 */
export const pointersOf = (brief: Brief): ReadonlySet<string> => {
  const pointers = new Set<string>()
  for (const selected of brief.selected) {
    pointers.add(commentKey(selected.discussion, undefined))
    for (const comment of selected.comments) {
      pointers.add(commentKey(selected.discussion, comment.id))
    }
  }
  return pointers
}

/**
 * Whether a Brief can resolve one Citation's (Discussion, comment) pointer.
 *
 * An EMPTY comment id is not the same thing as no comment id, and conflating
 * them was demonstrated to launder a fabricated pointer: `"comment": ""` keyed
 * identically to "cited whole", so a model that emitted the prompt's example
 * field with nothing in it got a Citation the reader cannot follow, accepted as
 * if it had cited the Discussion deliberately. No Network issues an empty
 * comment id, so it resolves to nothing.
 */
export const resolves = (
  pointers: ReadonlySet<string>,
  citation: { readonly discussion: DiscussionId; readonly comment?: string | undefined }
): boolean =>
  citation.comment === "" ? false : pointers.has(commentKey(citation.discussion, citation.comment))

/**
 * Whether a Citation points at one identified comment rather than a whole thread.
 *
 * Not a synonym for `resolves`: both are needed, and they answer different
 * questions. This one is what ADR 0006's contested flag is held to — see
 * {@link ./Digests.ts}.
 */
export const citesAComment = (
  citation: { readonly comment?: string | undefined }
): boolean => citation.comment !== undefined && citation.comment !== ""

/** How many comments a Brief carries in total. Used to size the ask. */
export const commentsTaken = (brief: Brief): number =>
  brief.selected.reduce((total, selected) => total + selected.comments.length, 0)
