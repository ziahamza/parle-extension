/**
 * What a link seen on a Network page actually points at.
 *
 * ADR 0012's marquee experience — click a link on X or Reddit, land, and find
 * the Discussion already attached — cannot rest on the referrer: X rewrites
 * every outbound link through `t.co` and Reddit through its own trackers, so
 * the referrer is frequently absent or wrong and *the URL the reader lands on
 * is not the URL they saw*. The only place the two can be joined is at harvest
 * time, before the click, which is why this type exists at all and why it is
 * produced by {@link ../LinkResolver.ts} rather than by whatever runs when the
 * reader arrives.
 *
 * **Resolution is total, and losing is not the same as dropping.** Every case
 * except {@link Resolution.NotASubject} carries a `SubjectUrl`, so a `t.co`
 * that never answered is still stored — keyed on the shortlink, marked
 * unresolved. That is deliberate: a Mention nobody recorded is the invisible
 * false negative this project keeps choosing against, and a Mention on the
 * wrong key can be repaired later when the same shortlink resolves, whereas a
 * Mention that was never written cannot be repaired at all.
 *
 * The three ways a resolution can be lost are the glossary's three, and they
 * are kept apart because the reader is owed different things by each and
 * because they cache differently: a **Refusal** is a fact about the attempt and
 * is worth retrying soon, a **Garble** is an answer we could not use and is
 * never retried, and a **Withholding** is restraint we chose — the cap in ADR
 * 0012's last consequence — and must never be cached at all, or a busy timeline
 * would poison every later harvest of the same links.
 */
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { SubjectUrl } from "@parle/domain/Subject"

/**
 * Why a link's destination is not known.
 *
 * Glossary words on purpose. A caller that wants to render "we did not check
 * this one" needs to tell it apart from "we checked and could not hear", and a
 * cache that treats them alike is a cache that remembers a budget decision as
 * though it were a property of the link.
 */
export const Loss = Schema.Literals(["Refusal", "Garble", "Withholding"])
export type Loss = typeof Loss.Type

/**
 * Where a link goes, as far as we were able to find out.
 *
 * - `Resolved` — we know the destination, having spent `requests` finding out.
 *   That is zero for most links: they were already addresses.
 * - `Unresolved` — we do not, so the Subject is the shortlink itself. The
 *   Mention is kept; it is simply keyed somewhere we may be able to improve.
 * - `NotASubject` — the href is not a page at all: a `javascript:` handler, a
 *   bare fragment, a `mailto:`, an internal hostname. This is the only case
 *   that yields no Mention, and it loses no Discussion because there was never
 *   a page for one to be about.
 */
export const Resolution = Schema.TaggedUnion({
  Resolved: {
    /** The href exactly as it appeared on the Network page. Evidence, kept verbatim. */
    raw: Schema.String,
    /** The canonical destination. This, and never `raw`, is the cache key. */
    subject: SubjectUrl,
    /**
     * Requests spent learning this, which is what ADR 0012's cap counts.
     *
     * Zero for a link that was already an address or was unwrapped out of a
     * tracker, one for a followed shortlink, two where the redirector refused a
     * `HEAD`. Deliberately not "hops": the reader's platform follows the chain
     * itself and never says how long it was, so a hop count here would be a
     * number we made up.
     */
    requests: Schema.Number
  },
  Unresolved: {
    raw: Schema.String,
    /** The shortlink itself, canonicalized — so the Mention has somewhere to live. */
    subject: SubjectUrl,
    why: Loss
  },
  NotASubject: {
    raw: Schema.String
  }
})
export type Resolution = typeof Resolution.Type

export type Resolved = Extract<Resolution, { readonly _tag: "Resolved" }>
export type Unresolved = Extract<Resolution, { readonly _tag: "Unresolved" }>

/** The key a Mention built from this link must be stored under, if any. */
export const subjectOf = (resolution: Resolution): Option.Option<SubjectUrl> =>
  resolution._tag === "NotASubject" ? Option.none() : Option.some(resolution.subject)
