/**
 * What every connector is, and the one rule none of them may break.
 *
 * `linked` and `topical` return `Stream<Consultation, never, never>`. The
 * `never` is the whole design: a connector has no error channel, so there is no
 * way for a Network's bad day to reach a caller as a failure. Every outcome —
 * a 403, a Cloudflare interstitial served as a 200, a schema that no longer
 * decodes, a worker killed mid-flight — is CLASSIFIED into a Consultation and
 * emitted. That is what lets Coverage promise there is no Place it can fail to
 * mention, and it is why the panel can always say something specific instead of
 * showing an empty list.
 *
 * The classification is the interesting part, because the six outcomes have
 * opposite consequences downstream and the temptation is to collapse them:
 *
 *   - `Silence` is evidence about the world and may be cached. A 200 that
 *     decoded cleanly and held nothing.
 *   - `Refusal` is a fact about the attempt and must never be cached. A 403 is
 *     a Refusal, not a Silence, and per ADR 0013 it is the ORDINARY Reddit
 *     outcome, not an edge case.
 *   - `Garble` is a 200 whose body was not usable. Never retried, never cached,
 *     and — the point of having it — never mistaken for a Silence. A Cloudflare
 *     interstitial arrives as `text/html` with a 200 and every naive parser
 *     files it as "we asked and there was nothing", which closes the X gate on
 *     a promise that was never kept.
 *   - `Withholding` is a Lookup we chose not to issue, inseparable from the
 *     reason the reader is owed.
 *
 * `linked` and `topical` are separate methods rather than one method taking a
 * `Question` because they are physically different requests: different
 * endpoints, independent failure profiles, separate rate-limiter keys and
 * separate cache namespaces. They must be able to fail independently, and a
 * single method makes that unexpressible.
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import {
  Consultation,
  type Place,
  type Question,
  RefusalReason,
  WithholdingReason
} from "@parle/domain/Coverage"
import type { Mention } from "@parle/domain/Mention"
import type { Network } from "@parle/domain/Network"
import type { Alias } from "@parle/domain/Subject"
import type { SubjectUrl } from "@parle/domain/Subject"
import * as HttpClientError from "effect/unstable/http/HttpClientError"

/**
 * One Network's connector.
 *
 * Four distinct service KEYS share this one shape — `parle/source/HackerNews`,
 * `/Reddit`, `/X`, and later `/LocalRecall`. One key with a `Network` field
 * would let a Reddit fake stand in for a Hacker News fake in a test that reads
 * as green, and would make ADR 0001's requirement that X be compiled out
 * entirely a matter of runtime discipline rather than of which layers were
 * built.
 *
 * `linked` takes the whole Alias set rather than one address: a Subject
 * reachable under `www.` and bare, or under an AMP path, is otherwise a
 * systematic STRONG-tier false negative, which is the failure that never shows
 * up in a bug report.
 */
export interface DiscussionSourceShape {
  readonly network: Network
  /**
   * The Places this connector accounts for.
   *
   * Two, not one: a Place carries the Question, and one connector answers both.
   * Coverage is seeded from these so every Place is `Pending` before anything
   * is asked, rather than appearing only once it has something to say.
   */
  readonly places: ReadonlyArray<Place>
  readonly linked: (
    subject: SubjectUrl,
    aliases: ReadonlyArray<Alias>
  ) => Stream.Stream<Consultation, never, never>
  readonly topical: (
    subject: SubjectUrl,
    title: string
  ) => Stream.Stream<Consultation, never, never>
}

/** Where a connector's answer to one Question lands in Coverage. */
export const placeOf = (network: Network, question: Question): Place => ({
  _tag: "Network",
  network,
  question
})

/** Both Places one Network connector accounts for. */
export const placesOf = (network: Network): ReadonlyArray<Place> => [
  placeOf(network, "linked"),
  placeOf(network, "topical")
]

/**
 * The Network answered and the answer was not usable.
 *
 * Separate from a transport failure because the two have opposite handling: a
 * transport failure is worth retrying and a Garble never is, and neither may be
 * cached.
 */
export class Garbled extends Schema.TaggedError<Garbled>()("Garbled", {
  detail: Schema.String
}) {}

/** The Network could not answer, for a reason we already know how to name. */
export class Declined extends Schema.TaggedError<Declined>()("Declined", {
  reason: RefusalReason
}) {}

/** We chose not to issue this Lookup, and owe the reader the reason. */
export class Restrained extends Schema.TaggedError<Restrained>()("Restrained", {
  reason: WithholdingReason
}) {}

/**
 * Everything a connector's internals are allowed to fail with.
 *
 * The union is closed so {@link classify} is total: there is no path from a
 * connector's insides to a caller that does not pass through a Consultation.
 */
export type Unanswered = Garbled | Declined | Restrained | HttpClientError.HttpClientError

/**
 * The Refusal reason for an HTTP status.
 *
 * Total, and deliberately not clever. 403 is the load-bearing case: ADR 0013
 * measured `www.reddit.com/api/info.json` returning 403 without cookies from a
 * good consumer IP, and ADR 0001 expects the same from X when the session is
 * cold. Both must fail FAST into a rendered state — 403 is outside Effect's
 * transient set, so it is never retried, and it must never be softened into a
 * Silence.
 *
 * `forbidden` carries the residue. `RefusalReason` is closed and lives in
 * `@parle/domain`, so a 502 has nowhere better to go; it is the honest reading
 * of "the Network would not answer us" and the panel copy is the same either
 * way.
 */
export const refusalForStatus = (status: number): typeof RefusalReason.Type => {
  if (status === 401) return "not-signed-in"
  if (status === 408 || status === 504) return "timed-out"
  if (status === 429) return "rate-limited"
  return "forbidden"
}

/** Turn one of those into the Consultation it means. */
export const classify = (place: Place, trouble: Unanswered): Consultation => {
  if (HttpClientError.isHttpClientError(trouble)) {
    const reason = trouble.reason
    switch (reason._tag) {
      case "StatusCodeError":
        return Consultation.cases.Refusal.make({
          place,
          reason: refusalForStatus(reason.response.status)
        })
      case "TransportError":
      case "InvalidUrlError":
        // The request never landed. That is a fact about our side of the wire,
        // so it is `offline` rather than anything about the Network.
        return Consultation.cases.Refusal.make({ place, reason: "offline" })
      default:
        return Consultation.cases.Garble.make({ place, detail: reason._tag })
    }
  }
  switch (trouble._tag) {
    case "Garbled":
      return Consultation.cases.Garble.make({ place, detail: trouble.detail })
    case "Declined":
      return Consultation.cases.Refusal.make({ place, reason: trouble.reason })
    case "Restrained":
      return Consultation.cases.Withholding.make({ place, reason: trouble.reason })
  }
}

/**
 * Whatever remains once {@link Unanswered} is handled: defects, and
 * interruption.
 *
 * Interruption is not an aside. MV3 kills the service worker without running
 * finalizers, so "we were asking and will never find out" is a routine end for
 * a Lookup, and it is a Refusal about the attempt — never a Silence, and never
 * cached. A defect is our bug, which the reader experiences as the Network
 * being unusable, so it lands as a Garble carrying the squashed cause.
 */
export const classifyCause = (place: Place, cause: Cause.Cause<never>): Consultation =>
  Cause.hasInterruptsOnly(cause)
    ? Consultation.cases.Refusal.make({ place, reason: "interrupted" })
    : Consultation.cases.Garble.make({ place, detail: String(Cause.squash(cause)) })

/**
 * `Answered` only when there is something to answer with.
 *
 * A connector that returns `Answered` with an empty array reports "we found
 * Mentions" and renders as an empty panel. That is precisely the state the
 * Silence/Answered split exists to make impossible, so no connector constructs
 * either case by hand.
 */
export const answeredWith = (place: Place, mentions: ReadonlyArray<Mention>): Consultation =>
  mentions.length === 0
    ? Consultation.cases.Silence.make({ place })
    : Consultation.cases.Answered.make({ place, mentions })

/**
 * The envelope every Lookup is issued in.
 *
 * Emits `Asking` before the request and exactly one terminal Consultation
 * after it — always both, always in that order, whatever happened. `Asking` is
 * a real state and not an absence: a panel opened mid-flight has to be able to
 * say "still looking" about a specific Place, and it can only do that if the
 * connector said so before it went quiet.
 *
 * `Stream.catchCause` is the outer layer rather than the inner one so that a
 * defect thrown while BUILDING the request — not only while awaiting it — is
 * still classified. That is the difference between a broken connector
 * degrading and a broken connector taking the Enquiry's error channel with it.
 */
export const asking = (
  place: Place,
  answer: Effect.Effect<Consultation, Unanswered>
): Stream.Stream<Consultation, never, never> =>
  Stream.suspend(() =>
    Stream.concat(
      Stream.succeed(Consultation.cases.Asking.make({ place })),
      Stream.fromEffect(
        answer.pipe(Effect.catch((trouble) => Effect.succeed(classify(place, trouble))))
      )
    )
  ).pipe(Stream.catchCause((cause) => Stream.succeed(classifyCause(place, cause))))

/** A Lookup we decided not to issue. No `Asking`, because we never asked. */
export const withheld = (
  place: Place,
  reason: typeof WithholdingReason.Type
): Stream.Stream<Consultation, never, never> =>
  Stream.succeed(Consultation.cases.Withholding.make({ place, reason }))
