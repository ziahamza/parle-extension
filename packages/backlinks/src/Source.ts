/**
 * What every reference source is, and the one rule none of them may break.
 *
 * `citing` returns `Effect<BacklinkAnswer, never, never>`. The `never` is the
 * whole design, and it is `packages/networks/src/Source.ts`'s design applied to
 * a different kind of place: a source has no error channel, so there is no way
 * for Wikipedia's bad day to reach a caller as a failure. Every outcome — a
 * 429 from a shared IP, a captive portal served as a 200, a schema that no
 * longer decodes, a service worker killed mid-flight — is CLASSIFIED and
 * returned. That is what lets a panel say something specific instead of
 * showing an empty list, and it is what will let Coverage account for a
 * reference source the way it accounts for a Network.
 *
 * The shape exists ahead of a second source rather than after one because the
 * point of the exercise is that adding the second must not reshape the caller.
 * A second source is a second service KEY implementing this shape — not a
 * `reference` field on one key. One key with a field would let a fake for
 * source B stand in for source A in a test that reads as green, which is the
 * mistake the Network connectors already refused to make.
 *
 * `citing` takes the whole Alias set rather than one address. It ASKS about
 * one — the budget is two requests per Lookup, see {@link ./Wikipedia.ts} —
 * but it VERIFIES against all of them, because a Subject reachable under
 * `www.` and bare, or under an AMP path, is otherwise a systematic false
 * negative, which is the failure that never shows up in a bug report.
 */
import * as Cause from "effect/Cause"
import type * as Effect from "effect/Effect"
import type { Alias, SubjectUrl } from "@parle/domain/Subject"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import { BacklinkAnswer, type ReferenceSource } from "./Backlink.ts"
import { refusalForStatus, type Unanswered } from "./Wire.ts"

/** One reference work's source. */
export interface BacklinkSourceShape {
  readonly reference: ReferenceSource
  readonly citing: (
    subject: SubjectUrl,
    aliases: ReadonlyArray<Alias>
  ) => Effect.Effect<BacklinkAnswer, never, never>
}

/** Turn one of this package's internal failures into the answer it means. */
export const classify = (
  reference: ReferenceSource,
  trouble: Unanswered
): BacklinkAnswer => {
  if (HttpClientError.isHttpClientError(trouble)) {
    const reason = trouble.reason
    switch (reason._tag) {
      case "StatusCodeError":
        return BacklinkAnswer.cases.CouldNotAsk.make({
          reference,
          reason: refusalForStatus(reason.response.status)
        })
      case "TransportError":
      case "InvalidUrlError":
        // The request never landed. A fact about our side of the wire, so
        // `offline` rather than anything about the reference work.
        return BacklinkAnswer.cases.CouldNotAsk.make({ reference, reason: "offline" })
      default:
        return BacklinkAnswer.cases.Garbled.make({ reference, detail: reason._tag })
    }
  }
  switch (trouble._tag) {
    case "Unusable":
      return BacklinkAnswer.cases.Garbled.make({ reference, detail: trouble.detail })
    case "Refused":
      return BacklinkAnswer.cases.CouldNotAsk.make({ reference, reason: trouble.reason })
  }
}

/**
 * Whatever remains once {@link Unanswered} is handled: defects, and
 * interruption.
 *
 * Interruption is not an aside. MV3 kills the service worker without running
 * finalizers, so "we were asking and will never find out" is a routine end for
 * a Lookup — a fact about the attempt, never an `Uncited`, and never cached. A
 * defect is our bug, which the reader experiences as the source being
 * unusable, so it lands as a `Garbled` carrying the squashed cause.
 */
export const classifyCause = (
  reference: ReferenceSource,
  cause: Cause.Cause<never>
): BacklinkAnswer =>
  Cause.hasInterruptsOnly(cause)
    ? BacklinkAnswer.cases.CouldNotAsk.make({ reference, reason: "interrupted" })
    : BacklinkAnswer.cases.Garbled.make({ reference, detail: String(Cause.squash(cause)) })

/**
 * Every address we will accept as evidence that a citation is about this
 * Subject, in the order the caller gave them.
 *
 * `SubjectIdentity` puts the elected address first, and that ordering is what
 * decides which address a Backlink records when a citation matches more than
 * one Alias.
 */
export const candidateAddresses = (
  subject: SubjectUrl,
  aliases: ReadonlyArray<Alias>
): ReadonlyArray<string> => {
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const address of [subject as string, ...aliases.map((alias) => alias.url)]) {
    if (seen.has(address)) continue
    seen.add(address)
    out.push(address)
  }
  return out
}
