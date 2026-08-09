/**
 * The one HTTP seam every connector sits on.
 *
 * `@parle/net` exists so that `effect/unstable/http` appears in exactly one
 * package. ADR 0002 treats `unstable/*` as scheduled debt; keeping it behind
 * this module means the day the HTTP surface changes shape, four connectors do
 * not each have to be rewritten, and `@parle/domain` stays free of beta churn
 * entirely.
 *
 * The base client is fetch plus a timeout, and nothing else. Policy — pacing,
 * retrying, credentials — is composed on top per Network, because the policies
 * genuinely differ: Reddit tier 1 needs `credentials: "include"` and a budget
 * shared with the reader's own browsing, X needs a bounded 429 policy because
 * the built-in one retries forever, and Hacker News needs neither.
 *
 * The timeout is here rather than left to callers because a request with no
 * timeout is not a slow request, it is a Consultation stuck on `Asking` — and
 * MV3 will eventually kill the worker underneath it, so the reader is shown a
 * spinner that resolves into nothing at all.
 */
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import type * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { Pace, paced } from "./Pace.ts"
import { defaultPersistence, type Persistence, persisting } from "./Transience.ts"

/**
 * A reader is looking at the page NOW.
 *
 * Eight seconds is already past the point where a rendered Refusal beats a
 * pending one, and every Network here is a search endpoint that normally answers
 * in a few hundred milliseconds.
 */
export const defaultTimeout: Duration.Duration = Duration.seconds(8)

/**
 * Fail a request that has taken too long, as a transport failure the rest of the
 * stack already understands.
 *
 * The `TimeoutError` is planted as the `cause` rather than raised as its own
 * error type, for two reasons that pull the same way: `HttpClient.HttpClient` is
 * by definition `With<HttpClientError>`, so a second error type could not be the
 * service; and `Transience` already treats a `TransportError` as transient,
 * which is the correct verdict for a timeout. `Reception.receiveFault` reads the
 * planted cause back out, so the reader is told "this took too long" rather than
 * "you appear to be offline".
 */
export const withTimeout = (duration: Duration.Input) =>
<E, R>(
  self: HttpClient.HttpClient.With<E, R>
): HttpClient.HttpClient.With<E | HttpClientError.HttpClientError, R> =>
  HttpClient.transform(self, (effect, request) =>
    Effect.timeoutOrElse(effect, {
      duration,
      orElse: () =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Cause.TimeoutError(`no answer within ${Duration.format(Duration.fromInputUnsafe(duration))}`),
              description: "timed out"
            })
          })
        )
    }))

/**
 * Apply fetch options to every request a client makes.
 *
 * This is how ADR 0013's tier 1 gets `credentials: "include"` — the measured
 * difference between a 403 and a 200 on `reddit.com/api/info.json` — without
 * making every other Network send the reader's cookies.
 */
export const withRequestInit = (init: globalThis.RequestInit) =>
<E, R>(
  self: HttpClient.HttpClient.With<E, R>
): HttpClient.HttpClient.With<E, Exclude<R, FetchHttpClient.RequestInit>> =>
  HttpClient.transformResponse(self, Effect.provideService(FetchHttpClient.RequestInit, init))

/** What the base client should do, before any per-Network policy. */
export interface Options {
  readonly timeout?: Duration.Input | undefined
}

/**
 * The base client: fetch, with a timeout. No retrying, no pacing.
 *
 * Deliberately unpolicied. A retry schedule baked in here would apply to
 * redirect resolution and manifest fetches as well as Lookups, and those have
 * different budgets and different consequences for the reader.
 */
export const layerWith = (options?: Options): Layer.Layer<HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function*() {
      const fetched = yield* HttpClient.HttpClient
      return withTimeout(options?.timeout ?? defaultTimeout)(fetched)
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))

export const layer: Layer.Layer<HttpClient.HttpClient> = layerWith()

/** How one Network's client differs from the base one. */
export interface NetworkPolicy {
  /**
   * Which bucket this request spends from. Must separate a Network's `linked`
   * question from its `topical` one — the domain paces and counts them apart
   * because they are physically different requests that fail independently.
   */
  readonly keyOf: (request: HttpClientRequest.HttpClientRequest) => string
  readonly persistence?: Persistence | undefined
  /** Tokens one request costs. Raise it for a Network whose answers are dear. */
  readonly cost?: number | undefined
  readonly requestInit?: globalThis.RequestInit | undefined
}

/**
 * A client tuned for one Network, built once at layer build.
 *
 * The composition order is the whole point and is not interchangeable: pacing
 * goes UNDER retrying, so that each retry takes its own token and a Network that
 * just answered 429 is not stampeded by the attempt meant to recover from it.
 * `Pace` is then discharged into the returned client, so a connector's own
 * requirement channel stays empty and the seam cannot become a way to smuggle a
 * dependency into `@parle/domain`.
 */
export const forNetwork = (
  policy: NetworkPolicy
): Effect.Effect<HttpClient.HttpClient, never, HttpClient.HttpClient | Pace> =>
  Effect.gen(function*() {
    const base = yield* HttpClient.HttpClient
    const pace = yield* Pace
    const dressed = policy.requestInit === undefined ? base : withRequestInit(policy.requestInit)(base)
    const tuned = persisting(policy.persistence ?? defaultPersistence)(
      paced(policy.keyOf, policy.cost ?? 1)(dressed)
    )
    return HttpClient.transformResponse(tuned, Effect.provideService(Pace, pace))
  })
