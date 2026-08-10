/**
 * The claim that a Discussion concerns a Subject.
 *
 * The tier is a property of the EVIDENCE, never of the Discussion — the same
 * thread can be a Linked Mention of one Subject and a Passing Mention of
 * another. The tiers are a tagged union whose cases carry structurally
 * different fields, which is load-bearing rather than stylistic: opaque brands
 * over identical fields win at compile time and lose at runtime
 * (`Equal.equals` returns true, and a HashSet keyed on them silently keeps
 * whichever arrived first).
 *
 * There was a third tier, `Topical` — a keyword search on the Subject's title.
 * It was removed rather than improved. Its evidence was "something with a
 * similar title exists", which on `example.com` produced nine results
 * including "Ask HN: Best registrar only and why" and "Examples of Domain
 * Specific Languages in Clojure". The panel had to caption it "matched by
 * title — not provably this page", and a caption apologising for the rows
 * beneath it is the product admitting the rows should not be there. It also
 * cost a request per Network per page, was the sole reason a Lookup ever
 * needed the page's TITLE (and so the only thing that could leak one), and was
 * the only question the front-door rule existed to withhold. Deleting it
 * removed all four.
 */
import * as Schema from "effect/Schema"
import { DiscussionId } from "./Network.ts"
import { SubjectUrl } from "./Subject.ts"

/**
 * A Mention, tiered by what evidences it.
 *
 * - `Linked` — the Discussion's own submitted URL matched one of the Subject's
 *   Aliases, or the reader arrived here from it. The strong tier, and the ONLY
 *   tier that discharges the disclosure argument permitting an X Lookup.
 * - `Passing` — the Subject's address appears inside a Discussion that is about
 *   something else.
 *
 * Both tiers now rest on the same kind of evidence: somebody wrote this
 * address down. That is the whole claim the product makes.
 */
export const Mention = Schema.TaggedUnion({
  Linked: {
    subject: SubjectUrl,
    discussion: DiscussionId,
    /** Which of the Subject's Aliases the Discussion's submitted URL matched. */
    viaAlias: Schema.String
  },
  Passing: {
    subject: SubjectUrl,
    discussion: DiscussionId,
    /** Where inside the Discussion the address appeared. */
    inComment: Schema.optionalKey(Schema.String)
  }
})
export type Mention = typeof Mention.Type

export type LinkedMention = Extract<Mention, { readonly _tag: "Linked" }>

/** True only for the strong tier. Used by the X gate; do not inline it. */
export const isLinked = (m: Mention): m is LinkedMention => m._tag === "Linked"

export const discussionOf = (m: Mention): DiscussionId => m.discussion
export const subjectOf = (m: Mention): SubjectUrl => m.subject
