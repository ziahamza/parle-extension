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

/**
 * Where we turned for evidence. `Recall` is the reader's own machine.
 *
 * A `Network` Place used to carry a `Question` too — `linked` or `topical` —
 * because we asked each Network twice and the two could fail independently.
 * The title search is gone (see {@link Mention}), so there is one question
 * left: has anyone posted this address. A single-valued field is not a
 * distinction, and keeping it would have left the panel saying "Hacker News ·
 * by address" as though some other kind of asking were still possible.
 */
export const Place = Schema.TaggedUnion({
  Recall: {},
  Network: { network: Network }
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
  "awaiting-linked-mention",
  /**
   * The Subject is a site's front door, and the evidence that would justify
   * this Lookup is stale.
   *
   * Now reachable only from X's disclosure argument: five old submissions of
   * `facebook.com` are five different events at one organisation, and none of
   * them makes that address newly public in a way that justifies spending the
   * reader's own X session. See {@link ../Gate.ts}.
   *
   * It used to withhold the title search on a front door as well — that was
   * its main job, and it went when the title search did. The panel still FOLDS
   * a front door's old Discussions, but a fold is a display decision about
   * answers we have, not a refusal to ask.
   */
  "front-door"
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
 * The Network had more to say than we asked to hear.
 *
 * Set when a Lookup's answer filled the window we requested AND the Network
 * reported more beyond it. It is a fact about OUR request, never about the
 * Network and never about the Subject, and it is the difference between "this
 * is what there is" and "this is what we asked for".
 *
 * It exists because ADR 0005's rule cuts here too. A panel that shows twelve
 * Discussions out of an unknown number, with no mark, tells the reader the list
 * is complete; a Silence derived from a filled window says "nobody discussed
 * this page" when the truth is "none of the first fifty we looked at was this
 * page". Both are silent false negatives — invisible to the reader, and the
 * second is worse because it is CACHED, so one truncated answer becomes the
 * settled account of the page for as long as the Silence keeps.
 *
 * Absent rather than `false` when the answer was whole. Every construction site
 * that predates this field means "the window was not the limit", which is what
 * an absent key already says, and a required boolean would have made 60-odd
 * call sites assert something none of them had measured.
 */
const Windowed = Schema.optionalKey(Schema.Boolean)

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
  Answered: { place: Place, mentions: Schema.Array(Mention), windowed: Windowed },
  /**
   * Answered, with nothing. Evidence about the world — unless `windowed`, in
   * which case it is evidence about the size of our own request and may not be
   * cached.
   */
  Silence: { place: Place, windowed: Windowed },
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

/**
 * True when this Consultation's answer was cut off by the size of our request.
 *
 * One predicate rather than two `_tag` checks scattered about, because the two
 * cases that can carry it have opposite-looking shapes and the same meaning:
 * `Answered` windowed is "at least these", `Silence` windowed is "none of the
 * ones we looked at", and every caller that cares — the panel, the cache — has
 * to treat them alike.
 */
export const isWindowed = (consultation: Consultation): boolean =>
  (consultation._tag === "Answered" || consultation._tag === "Silence") &&
  consultation.windowed === true

/** The Places whose answers were cut off by the size of our request. */
export const windowedPlaces = (coverage: Coverage): ReadonlyArray<Place> =>
  coverage.consultations.filter(isWindowed).map((c) => c.place)
