/**
 * These tests exist because the retry policy is the one piece of this package
 * whose mistakes are expensive in someone else's currency.
 *
 * Retrying a 403 spends the reader's own Reddit budget — shared with their own
 * browsing — and, on X, requests against their own authenticated account, to
 * re-learn something the first answer already told us. So the assertion that
 * matters is a count, not a status: exactly one request must leave the machine.
 */
import { describe, expect, it } from "vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { persisting, type Persistence, transientStatuses } from "./Transience.ts"

/** Fast enough that the whole suite stays in single-digit milliseconds. */
const brisk: Persistence = {
  firstDelay: Duration.millis(1),
  longestDelay: Duration.millis(4),
  retries: 2
}

/** A client that counts what it was actually asked to do. */
const counting = (statuses: ReadonlyArray<number>) => {
  const attempts: Array<number> = []
  const client = HttpClient.makeWith(
    (request: Effect.Effect<HttpClientRequest.HttpClientRequest>) =>
      Effect.map(request, (made) => {
        const status = statuses[Math.min(attempts.length, statuses.length - 1)] ?? 200
        attempts.push(status)
        return HttpClientResponse.fromWeb(made, new Response("{}", { status }))
      }),
    // SAFETY: the test client has no preprocess; Effect.succeed is the identity preprocess.
    Effect.succeed as HttpClient.HttpClient.Preprocess<never, never>
  )
  return { attempts, client }
}

const askOnce = (statuses: ReadonlyArray<number>) =>
  Effect.gen(function*() {
    const { attempts, client } = counting(statuses)
    const response = yield* persisting(brisk)(client).execute(
      HttpClientRequest.get("https://example.com/search")
    )
    return { attempts: attempts.length, status: response.status }
  })

describe("what is worth asking again", () => {
  it("does NOT retry a 403", async () => {
    // ADR 0013's Reddit tier-1 outcome and X's auth outcome. One request, then
    // a rendered Refusal.
    const outcome = await Effect.runPromise(askOnce([403]))
    expect(outcome).toStrictEqual({ attempts: 1, status: 403 })
  })

  it("does NOT retry a 401 or a 404", async () => {
    for (const status of [401, 404]) {
      const outcome = await Effect.runPromise(askOnce([status]))
      expect(outcome.attempts).toBe(1)
    }
  })

  it("retries a 503 up to the cap and then gives up with the answer", async () => {
    const outcome = await Effect.runPromise(askOnce([503]))
    expect(outcome).toStrictEqual({ attempts: 1 + brisk.retries, status: 503 })
  })

  it("retries a 429, because the pacing will have widened by the next attempt", async () => {
    const outcome = await Effect.runPromise(askOnce([429]))
    expect(outcome.attempts).toBe(1 + brisk.retries)
  })

  it("stops as soon as an answer arrives", async () => {
    const outcome = await Effect.runPromise(askOnce([503, 200]))
    expect(outcome).toStrictEqual({ attempts: 2, status: 200 })
  })

  it("keeps 401, 403 and 404 out of the transient set by construction", () => {
    // Belt and braces on the count assertions above: the set itself is the
    // documentation, so a future edit that adds 403 fails here too.
    for (const status of [400, 401, 403, 404, 410, 451, 501]) {
      expect(transientStatuses.has(status)).toBe(false)
    }
  })
})
