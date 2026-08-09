/**
 * What one HTTP exchange with a Network actually amounts to.
 *
 * The domain says an absence has six causes and gives each its own constructor.
 * This module is the only place that decides which one an HTTP exchange lands
 * on, and it is deliberately TOTAL: every status, every transport failure and
 * every cause maps to exactly one Reception, with no default that quietly means
 * "nothing found".
 *
 * Two distinctions carry the weight, and both were expensive to learn:
 *
 *   - A 200 is not an answer. Algolia mid-reindex returns `{"hits":[]}` for a
 *     page with two submissions, and a Cloudflare interstitial arrives as
 *     `text/html` with a 200. The first is a Silence we may cache; the second is
 *     a Garble that must never be cached, never retried, and never close the X
 *     gate. Status alone cannot tell them apart, so the body decides — see
 *     {@link understandJson}.
 *   - A 403 is not transient. ADR 0013's Reddit tier-1 403 and X's auth 403 are
 *     the ordinary path, not an outage. Retrying them burns the reader's own
 *     quota against their own account to re-learn a fact we already know, so
 *     403 lands on a Refusal that renders, and {@link Transience} keeps it out
 *     of the retry set.
 *
 * A Reception is not a `Consultation` yet, because a connector still has to
 * parse Mentions out of a usable body. {@link asConsultation} is the one-way
 * door into the domain, and it is where an answer carrying zero Mentions
 * becomes a Silence rather than an `Answered` asserting nothing.
 */
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Headers from "effect/unstable/http/Headers"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { Consultation, type Place, type RefusalReason } from "@parle/domain/Coverage"
import type { Mention } from "@parle/domain/Mention"

/**
 * What came back, before anyone has read a body.
 *
 * `Received` is the only case that carries anything, and it carries whatever
 * stage of understanding we have reached — the response itself from
 * {@link receive}, a parsed JSON value from {@link understandJson}, an array of
 * Mentions once a connector has done its work.
 */
export type Reception<A> =
  | Received<A>
  | Silence
  | Refusal
  | Garble

/** An answer we can go on reading. */
export interface Received<out A> {
  readonly _tag: "Received"
  readonly value: A
}

/** The Network answered and had nothing. Evidence about the world. */
export interface Silence {
  readonly _tag: "Silence"
}

/**
 * The Network could not answer, or we could not hear the answer.
 *
 * `reason` is the domain's closed vocabulary; `status` and `detail` keep what
 * the domain has no constructor for, so nothing is lost on the way to a log or
 * a bug report. `waitFor` is whatever the Network told us about when to come
 * back — `retry-after` or `x-ratelimit-reset` — for {@link Pace} to honour.
 */
export interface Refusal {
  readonly _tag: "Refusal"
  readonly reason: RefusalReason
  readonly status: Option.Option<number>
  readonly detail: string
  readonly waitFor: Option.Option<Duration.Duration>
}

/** The Network answered and the answer was not usable. Never retried. */
export interface Garble {
  readonly _tag: "Garble"
  readonly detail: string
}

export const received = <A>(value: A): Reception<A> => ({ _tag: "Received", value })

export const silence = <A = never>(): Reception<A> => ({ _tag: "Silence" })

export const refusal = <A = never>(
  reason: RefusalReason,
  detail: string,
  options?: {
    readonly status?: number | undefined
    readonly waitFor?: Duration.Duration | undefined
  }
): Reception<A> => ({
  _tag: "Refusal",
  reason,
  detail,
  status: Option.fromUndefinedOr(options?.status),
  waitFor: Option.fromUndefinedOr(options?.waitFor)
})

export const garble = <A = never>(detail: string): Reception<A> => ({ _tag: "Garble", detail })

/**
 * Carry a Reception forward one stage of understanding.
 *
 * Only `Received` is touched; a Refusal stays the same Refusal all the way to
 * the panel, which is what makes "it was rate-limited" survivable as a reason
 * rather than degrading into "nothing found".
 */
export const map = <A, B>(self: Reception<A>, f: (a: A) => Reception<B>): Reception<B> =>
  self._tag === "Received" ? f(self.value) : self

/** True only for the case a connector may keep reading. */
export const isReceived = <A>(self: Reception<A>): self is Received<A> => self._tag === "Received"

const secondsHeader = (headers: Headers.Headers, name: string): Option.Option<Duration.Duration> => {
  const raw = headers[name]
  if (raw === undefined) return Option.none()
  const seconds = Number.parseFloat(raw)
  // An HTTP-date `retry-after` parses as NaN. We deliberately do not honour it:
  // guessing a clock skew is worse than falling back to our own pacing.
  if (!Number.isFinite(seconds) || seconds < 0) return Option.none()
  return Option.some(Duration.seconds(seconds))
}

/**
 * How long the Network asked us to wait, if it said anything about it at all.
 *
 * `retry-after` wins over `x-ratelimit-reset` because it is an instruction
 * rather than a description.
 */
export const waitAskedFor = (headers: Headers.Headers): Option.Option<Duration.Duration> =>
  Option.orElse(secondsHeader(headers, "retry-after"), () => secondsHeader(headers, "x-ratelimit-reset"))

/**
 * The total status classifier.
 *
 * Every branch is spelled out, including the ones that look alike, because the
 * consequences differ: a Silence may be cached and closes nothing, a Refusal is
 * never cached, and a Garble is never retried. The `orElse` arm is a Refusal
 * rather than a Silence on purpose — mistaking "we could not hear" for "there
 * is nothing there" is the one direction of this mistake that is unrecoverable,
 * since a cached Silence deterministically re-derives a Withholding.
 */
export const receive = (
  response: HttpClientResponse.HttpClientResponse
): Reception<HttpClientResponse.HttpClientResponse> => {
  const at = (reason: RefusalReason, detail: string): Reception<HttpClientResponse.HttpClientResponse> =>
    refusal(reason, detail, {
      status: response.status,
      waitFor: Option.getOrUndefined(waitAskedFor(response.headers))
    })

  return HttpClientResponse.matchStatus(response, {
    // Answered, with nothing to read. Evidence about the world.
    204: () => silence<HttpClientResponse.HttpClientResponse>(),
    // We do not send conditional requests, so this is a proxy inventing one.
    304: () => garble<HttpClientResponse.HttpClientResponse>("a conditional answer we never asked for"),
    401: () => at("not-signed-in", "the Network requires a signed-in session"),
    // ADR 0013: the ordinary Reddit tier-1 and X auth outcome. Never retried.
    403: () => at("forbidden", "the Network refused this request outright"),
    407: () => at("not-signed-in", "a proxy requires authentication"),
    408: () => at("timed-out", "the Network gave up waiting for the request"),
    429: () => at("rate-limited", "we are over the Network's rate budget"),
    "2xx": (ok) => received(ok),
    // The fetch client follows redirects; one arriving here was not followable.
    "3xx": (r) => garble<HttpClientResponse.HttpClientResponse>(`a redirect (${r.status}) that could not be followed`),
    // The domain's RefusalReason list is closed and has no "not found" or
    // "server error" constructor, so 4xx collapses onto `forbidden` and 5xx onto
    // `timed-out`. The status is kept alongside so nothing is actually lost.
    "4xx": (r) => at("forbidden", `the Network rejected this request (${r.status})`),
    "5xx": (r) => at("timed-out", `the Network failed to answer (${r.status})`),
    orElse: (r) => at("timed-out", `an unrecognised status (${r.status})`)
  })
}

/**
 * The total transport classifier.
 *
 * A timeout is distinguished from a dead network by the `cause` our own timeout
 * transformer plants on the `TransportError` — see `Client.withTimeout`. The
 * reader is told different things by "you appear to be offline" and "this took
 * too long", and both are true statements about the attempt.
 */
export const receiveFault = <A = never>(error: HttpClientError.HttpClientError): Reception<A> => {
  switch (error.reason._tag) {
    case "StatusCodeError":
      return map(receive(error.reason.response), () => received(undefined as A))
    case "TransportError":
      return Cause.isTimeoutError(error.reason.cause)
        ? refusal("timed-out", error.message)
        : refusal("offline", error.message)
    case "DecodeError":
      return garble(error.message)
    case "EmptyBodyError":
      return garble("the Network answered with no body at all")
    // We never managed to ask. The domain has no constructor for our own bug,
    // and `offline` is the one whose consequence — no request reached the
    // Network — is exactly right.
    case "EncodeError":
    case "InvalidUrlError":
      return refusal("offline", error.message)
  }
}

/**
 * The total failure classifier, for a connector's final `Stream.catchCause`.
 *
 * MV3 kills the service worker without running finalizers, so "we were asking
 * and will never find out" is a routine state rather than an edge case. It is an
 * `interrupted` Refusal — a fact about the attempt — and emphatically not a
 * Silence.
 */
export const receiveCause = <E, A = never>(cause: Cause.Cause<E>): Reception<A> => {
  if (Cause.hasInterruptsOnly(cause)) {
    return refusal("interrupted", "the attempt was interrupted before it settled")
  }
  const failure = Cause.findErrorOption(cause)
  if (Option.isSome(failure)) {
    const error = failure.value
    if (HttpClientError.isHttpClientError(error)) return receiveFault(error)
    if (Cause.isTimeoutError(error)) return refusal("timed-out", "the Network did not answer in time")
  }
  return refusal("offline", Cause.pretty(cause))
}

/** Markup where a payload was expected — the interstitial-as-success shape. */
const looksLikeMarkup = (body: string): boolean => body.startsWith("<")

/**
 * Read a body that was supposed to be JSON, and say honestly what it was.
 *
 * This is where a 200 stops being a promise. An empty body, a Cloudflare or
 * consent interstitial, and a truncated payload are all Garbles: the Network
 * answered and the answer is not usable. None of them is a Silence, so none of
 * them may be cached, retried, or allowed to settle a Place.
 *
 * Total by construction — the returned Effect has no error channel, because a
 * connector's whole point is that its failures are already data.
 */
export const understandJson = (
  response: HttpClientResponse.HttpClientResponse
): Effect.Effect<Reception<unknown>> =>
  Effect.gen(function*() {
    const status = receive(response)
    if (!isReceived(status)) return status as Reception<unknown>

    const read = yield* Effect.result(status.value.text)
    if (read._tag === "Failure") {
      return garble(`the body could not be read: ${read.failure.message}`)
    }

    const body = read.success.trim()
    if (body.length === 0) return garble("the answer had an empty body")
    if (looksLikeMarkup(body)) {
      return garble("markup was served where a payload was expected — an interstitial as success")
    }

    try {
      return received(JSON.parse(body) as unknown)
    } catch (thrown) {
      return garble(`the payload did not parse: ${thrown instanceof Error ? thrown.message : String(thrown)}`)
    }
  })

/**
 * The one-way door into the domain.
 *
 * An answer carrying no Mentions becomes a **Silence**, not an `Answered` with
 * an empty array. The domain distinguishes them for a reason: `Answered []`
 * would render as a panel that found something and shows nothing, and would let
 * a caller that folds over `mentions` treat "we asked and there was nothing" as
 * a state it never has to name.
 */
export const asConsultation = (
  place: Place,
  reception: Reception<ReadonlyArray<Mention>>
): Consultation => {
  switch (reception._tag) {
    case "Received":
      return reception.value.length === 0
        ? Consultation.cases.Silence.make({ place })
        : Consultation.cases.Answered.make({ place, mentions: reception.value })
    case "Silence":
      return Consultation.cases.Silence.make({ place })
    case "Refusal":
      return Consultation.cases.Refusal.make({ place, reason: reception.reason })
    case "Garble":
      return Consultation.cases.Garble.make({ place, detail: reception.detail })
  }
}
