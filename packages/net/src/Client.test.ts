/**
 * The composition order in `forNetwork` is a claim, not a preference: pacing
 * sits UNDER retrying, so a retry is another request against the same budget.
 * Get it the other way round and the client politely takes one token and then
 * hammers a Network that has just said 429 — which is the exact behaviour rate
 * limiting exists to prevent, arrived at by way of a rate limiter.
 *
 * That is invisible in every unit test of the parts, so it is tested here.
 */
import { describe, expect, it } from "vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import * as Client from "./Client.ts"
import { Pace, type Pacing } from "./Pace.ts"

const pacing: Pacing = { perSecond: 1, burst: 3, blindHold: Duration.seconds(60) }

const brisk = { firstDelay: Duration.millis(1), longestDelay: Duration.millis(4), retries: 2 }

/** A stand-in for the fetch layer that always answers with one status. */
const answering = (status: number, headers: Record<string, string> = {}) => {
  const attempts: Array<number> = []
  const client = HttpClient.makeWith(
    (request: Effect.Effect<HttpClientRequest.HttpClientRequest, HttpClientError.HttpClientError>) =>
      Effect.map(request, (made) => {
        attempts.push(status)
        return HttpClientResponse.fromWeb(made, new Response("{}", { status, headers }))
      }),
    Effect.succeed as HttpClient.HttpClient.Preprocess<HttpClientError.HttpClientError, never>
  )
  return { attempts, layer: Layer.succeed(HttpClient.HttpClient, client) }
}

const ask = (status: number, headers: Record<string, string> = {}) =>
  Effect.gen(function*() {
    const { attempts, layer } = answering(status, headers)

    const spent = yield* Effect.gen(function*() {
      const tuned = yield* Client.forNetwork({ keyOf: () => "hackernews:linked", persistence: brisk })
      yield* tuned.execute(HttpClientRequest.get("https://hn.algolia.com/api/v1/search"))
      const pace = yield* Pace
      // What a fresh claim now costs tells us how much the exchange consumed.
      return Duration.toMillis(yield* pace.claim("hackernews:linked"))
    }).pipe(
      Effect.provide(Pace.layerWith({ everywhere: pacing })),
      Effect.provide(layer)
    )

    return { attempts: attempts.length, waitAfter: spent }
  })

describe("a client tuned for one Network", () => {
  it("takes a token for every retry, not one for the whole exchange", async () => {
    // Three attempts against a burst of three leaves the bucket empty, so the
    // next claim is a whole second away. One token for the exchange would leave
    // two in hand and the assertion below would read 0.
    const outcome = await Effect.runPromise(ask(503))
    expect(outcome.attempts).toBe(3)
    // A whole second, less however many real milliseconds the retries took.
    expect(outcome.waitAfter).toBeGreaterThan(900)
  })

  it("spends exactly one token on a 403, because it does not ask twice", async () => {
    const outcome = await Effect.runPromise(ask(403))
    expect(outcome.attempts).toBe(1)
    expect(outcome.waitAfter).toBe(0)
  })

  it("stands the key down when the Network says its budget is gone", async () => {
    // The 403 path, but carrying the measured Reddit rate headers. The next
    // Lookup on this key must wait for the reset rather than the bucket.
    const outcome = await Effect.runPromise(
      ask(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "190" })
    )
    expect(outcome.attempts).toBe(1)
    expect(outcome.waitAfter).toBeGreaterThan(189_000)
  })

  it("builds the real fetch-backed layer without touching the network", async () => {
    const built = await Effect.runPromise(
      Effect.provide(
        Effect.map(HttpClient.HttpClient, HttpClient.isHttpClient),
        Client.layer
      )
    )
    expect(built).toBe(true)
  })
})
