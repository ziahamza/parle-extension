/**
 * Reading the Archive's answers without letting a 200 lie about what it is.
 *
 * The same two rules `@parle/networks`' `Wire.ts` keeps, for the same reasons,
 * against a host that breaks both of them routinely:
 *
 * 1. **The status match is total.** No `filterStatusOk`, no generic thrown
 *    status error. Every status becomes a named outcome here. `429` in
 *    particular becomes a fast, final `rate-limited` — see {@link ./Archive.ts}
 *    for why it is never retried.
 *
 * 2. **A 200 must also be the right KIND of thing.** `archive.org` answered
 *    this development box `429 Too Many Requests` with an HTML body on
 *    2026-08-24, and its WAF serves HTML interstitials with 200s as well. An
 *    HTML page read as JSON yields zero captures, which is indistinguishable
 *    from "never archived" unless the content type is checked FIRST.
 *
 * Duplicated from the networks package rather than shared, deliberately: the
 * Archive is not a Network, this package must not depend on one, and the two
 * files answer to different unions (`Unanswered` there, {@link Trouble} here).
 * A shared seam would have to be generic over both, which is more coupling than
 * eighty lines is worth.
 */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Cause from "effect/Cause"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { RefusalReason } from "@parle/domain/Coverage"
import { Holding } from "./Holding.ts"

/** The Archive answered and the answer was not usable. */
export class Unreadable extends Schema.TaggedError<Unreadable>()("Unreadable", {
  detail: Schema.String
}) {}

/** The Archive would not answer, for a reason we can already name. */
export class Declined extends Schema.TaggedError<Declined>()("Declined", {
  reason: RefusalReason
}) {}

/**
 * Everything the service's internals may fail with.
 *
 * Closed, so {@link classify} is total: there is no path from inside this
 * package to a caller that does not pass through a {@link Holding}.
 */
export type Trouble = Unreadable | Declined | HttpClientError.HttpClientError

/**
 * The Refusal reason an Archive status implies.
 *
 * `429` is the load-bearing case and the reason this function is not `if
 * (!ok) return "forbidden"`. The Wayback CDX endpoint is understood to allow
 * roughly 60 requests per minute per IP and to answer sustained abuse with an
 * hour-long firewall ban; the reader's IP is the one being banned, and a ban
 * takes every other Archive Lookup on that machine down with it. Naming it
 * exactly is what lets the caller be sure it never retries.
 *
 * `503` is likewise not lumped in with `forbidden` by accident — the Archive is
 * a nonprofit that goes down, and the reader is owed "we could not reach them"
 * rather than "they said no". `RefusalReason` is closed and lives in
 * `@parle/domain`, so `forbidden` carries the residue.
 */
export const refusalForStatus = (status: number): typeof RefusalReason.Type => {
  if (status === 401) return "not-signed-in"
  if (status === 408 || status === 504) return "timed-out"
  if (status === 429) return "rate-limited"
  if (status >= 500) return "offline"
  return "forbidden"
}

const contentType = (response: HttpClientResponse.HttpClientResponse): string =>
  (response.headers["content-type"] ?? "").toLowerCase()

const refuse = (
  response: HttpClientResponse.HttpClientResponse
): Effect.Effect<never, Trouble> =>
  Effect.fail(new Declined({ reason: refusalForStatus(response.status) }))

/**
 * Decode a successful JSON body, or say precisely why it was not one.
 *
 * The empty-body branch is not defensiveness. `/cdx/search/cdx` answers a URL
 * it has never captured with `200 application/json` and **zero bytes** — not
 * `[]`. `JSON.parse("")` throws, so without this the most ordinary answer the
 * Archive gives about an unarchived page would be filed as a Garble, and the
 * one thing we are allowed to cache would never be reached. Empty means "no
 * rows", which is what {@link ./Archive.ts} does with `[]`.
 */
export const expectJson = <T, E>(schema: Schema.Codec<T, E, never, never>) => {
  const decode = Schema.decodeUnknownEffect(schema)
  const empty: unknown = []
  return (response: HttpClientResponse.HttpClientResponse): Effect.Effect<T, Trouble> => {
    if (response.status < 200 || response.status >= 300) return refuse(response)
    const type = contentType(response)
    if (type !== "" && !type.includes("json")) {
      return Effect.fail(
        new Unreadable({ detail: `expected JSON, the Archive answered 200 with ${type}` })
      )
    }
    return response.text.pipe(
      Effect.mapError(() => new Unreadable({ detail: "the body could not be read" })),
      Effect.flatMap((body) =>
        body.trim() === ""
          ? Effect.succeed(empty)
          : Effect.try({
            try: () => JSON.parse(body) as unknown,
            catch: () => new Unreadable({ detail: "the body was not JSON" })
          })
      ),
      Effect.flatMap((json) =>
        decode(json).pipe(
          Effect.mapError(
            (issue) => new Unreadable({ detail: `the answer did not decode: ${issue.message}` })
          )
        )
      )
    )
  }
}

/** Turn one of those into the Holding it means. */
export const classify = (trouble: Trouble): Holding => {
  if (HttpClientError.isHttpClientError(trouble)) {
    const reason = trouble.reason
    switch (reason._tag) {
      case "StatusCodeError":
        return Holding.cases.CouldNotAsk.make({
          reason: refusalForStatus(reason.response.status)
        })
      case "TransportError":
      case "InvalidUrlError":
        // The request never landed, which is a fact about our side of the wire.
        return Holding.cases.CouldNotAsk.make({ reason: "offline" })
      default:
        return Holding.cases.Garbled.make({ detail: reason._tag })
    }
  }
  switch (trouble._tag) {
    case "Unreadable":
      return Holding.cases.Garbled.make({ detail: trouble.detail })
    case "Declined":
      return Holding.cases.CouldNotAsk.make({ reason: trouble.reason })
  }
}

/**
 * Whatever is left once {@link Trouble} is handled: interruption, and defects.
 *
 * Interruption is routine rather than exotic. MV3 kills the service worker
 * without running finalizers, so "we were asking and will never find out" is an
 * ordinary end for a Lookup — and it is a fact about the attempt, so it is a
 * `CouldNotAsk` and must never be cached as `NothingArchived`. A defect is our
 * own bug, which the reader experiences as the Archive being unusable, so it
 * lands as a Garble carrying the squashed cause.
 */
export const classifyCause = (cause: Cause.Cause<never>): Holding =>
  Cause.hasInterruptsOnly(cause)
    ? Holding.cases.CouldNotAsk.make({ reason: "interrupted" })
    : Holding.cases.Garbled.make({ detail: String(Cause.squash(cause)) })
