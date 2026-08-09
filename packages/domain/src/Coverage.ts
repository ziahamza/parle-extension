/**
 * What came back from everywhere we turned — and what we deliberately did not ask.
 *
 * "Nothing found" has six causes and most codebases give it one word. Here they
 * are six constructors, because they have opposite consequences: a Silence is
 * evidence about the world and may be cached; a Refusal is a fact about the
 * attempt and must never be; a Garble must never be retried nor mistaken for a
 * Silence; a Withholding is restraint that the reader is owed a reason for.
 */
import * as Schema from "effect/Schema"
import { Network } from "./Network.ts"
import { Mention } from "./Mention.ts"

/** Which question we asked a Network. The two fail independently. */
export const Question = Schema.Literals(["linked", "topical"])
export type Question = typeof Question.Type

/** Where we turned for evidence. `recall` is the reader's own machine. */
export const Place = Schema.TaggedUnion({
  Recall: {},
  Network: { network: Network, question: Question }
})
export type Place = typeof Place.Type

/**
 * Why a Lookup was deliberately not issued. Restraint, made visible.
 *
 * The three "switched off" cases are separate literals on purpose. They were
 * briefly one — `kill-switched` — and the panel rendered it as "automatic
 * lookups are off", so a reader who turned Reddit off while leaving automatic
 * lookups ON was told something false about their own settings. It is the same
 * mistake this glossary already corrected once for "nothing found", which had
 * six causes and one word: a reason the reader is owed is not a reason if it
 * names the wrong cause.
 */
export const WithholdingReason = Schema.Literals([
  "excluded",
  "site-paused",
  /** The reader switched this one Network off. Others may still be on. */
  "network-off",
  /** The reader chose manual mode: nothing automatic, for any Network. */
  "manual-only",
  /** We stopped ourselves remotely, without shipping a build. */
  "kill-switched",
  /** This Network is not in this build at all. */
  "compiled-out",
  "over-budget",
  "awaiting-linked-mention"
])
export type WithholdingReason = typeof WithholdingReason.Type

/** Why a Network could not answer. Never cached. */
export const RefusalReason = Schema.Literals([
  "not-signed-in",
  "rate-limited",
  "forbidden",
  "timed-out",
  "interrupted",
  "offline"
])
export type RefusalReason = typeof RefusalReason.Type

/**
 * What one Place had to say on one Enquiry.
 *
 * `Asking` is a real state, not an absence: a panel opened mid-flight must be
 * able to say "still looking" about a specific Place.
 */
export const Consultation = Schema.TaggedUnion({
  /** Not yet begun. */
  Pending: { place: Place },
  /** In flight. */
  Asking: { place: Place },
  /** Answered, with Mentions. */
  Answered: { place: Place, mentions: Schema.Array(Mention) },
  /** Answered, with nothing. Evidence about the world. Cacheable. */
  Silence: { place: Place },
  /** Could not answer. A fact about the attempt. Never cached. */
  Refusal: { place: Place, reason: RefusalReason },
  /** Answered unusably — truncated, unparseable, or an interstitial as success. */
  Garble: { place: Place, detail: Schema.String },
  /** Deliberately not asked. */
  Withholding: { place: Place, reason: WithholdingReason }
})
export type Consultation = typeof Consultation.Type

/**
 * Everywhere we turned on this Enquiry, and what came back from each.
 *
 * Every Place is accounted for at every moment — there is no Place this can
 * fail to mention — so an empty panel always means something specific.
 */
export class Coverage extends Schema.Opaque<Coverage, { readonly _brand: "Coverage" }>()(
  Schema.Struct({
    subject: Schema.String,
    consultations: Schema.Array(Consultation)
  })
) {}

/** Every Mention gathered so far, across every Place that answered. */
export const mentionsOf = (coverage: Coverage): ReadonlyArray<Mention> =>
  coverage.consultations.flatMap((c) => (c._tag === "Answered" ? c.mentions : []))

/**
 * True when every Place has reached a terminal state.
 *
 * `every`-quantified deliberately. An `some(c => c._tag === "Answered")` test
 * reports "settled, and this page is undiscussed" for the routine case where
 * Hacker News answers with a Silence while Reddit is still refusing — which is
 * the ordinary Reddit 403 path, not an edge case.
 */
export const isSettled = (coverage: Coverage): boolean =>
  coverage.consultations.every((c) => c._tag !== "Pending" && c._tag !== "Asking")
