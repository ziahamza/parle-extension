/**
 * How fast we are willing to ask a Network anything.
 *
 * A hand-rolled token bucket over `Ref` + `Clock`, and hand-rolled on purpose:
 * `effect/unstable/persistence/RateLimiter` is roughly 35 kB gzipped because its
 * error types drag `SchemaAST` in behind them, and this code ships inside a
 * browser extension where the whole bundle is the product's install cost. The
 * arithmetic below is forty lines and has no dependencies beyond `Clock`.
 *
 * Two properties are load-bearing and neither is the obvious implementation:
 *
 *   - **Tokens go negative.** The naive bucket spins — "no token, sleep a bit,
 *     look again" — which under three concurrent Lookups on one key is a
 *     thundering herd with no ordering. Letting the balance go into deficit and
 *     returning the exact wait that deficit implies turns the bucket into a
 *     queue: each claim is scheduled at the instant it becomes due, and claims
 *     come due in the order they were made.
 *   - **The Network's own counters win.** ADR 0013 measured Reddit returning
 *     `x-ratelimit-remaining: 94` on a budget SHARED WITH THE READER'S OWN
 *     BROWSING. Our local count of what we spent is therefore always an
 *     underestimate, so {@link heedFrom} only ever lowers the balance, never
 *     raises it, and a `retry-after` parks the key outright.
 *
 * Everything here is per-key. The keys a connector uses are its own business,
 * but they must separate a Network's `linked` question from its `topical` one:
 * the domain says those two are paced and counted separately because they are
 * physically different requests that fail independently.
 */
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import type * as Headers from "effect/unstable/http/Headers"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { waitAskedFor } from "./Reception.ts"

/** How fast one key may be asked, and how much of that may be spent at once. */
export interface Pacing {
  /** Tokens added per second. One token is one request, by default. */
  readonly perSecond: number
  /** The most tokens that can accumulate — how large a burst is forgiven. */
  readonly burst: number
  /**
   * How long to stand down when a Network says it is out of budget but does not
   * say when the budget returns.
   */
  readonly blindHold: Duration.Duration
}

/**
 * Politeness, not throughput. One request per Subject per Network is the design
 * (ADR 0013: "one request per page view, hard-cached"), so the bucket exists to
 * absorb a reader opening six tabs at once, not to sustain a crawl.
 */
export const defaultPacing: Pacing = {
  perSecond: 1,
  burst: 3,
  blindHold: Duration.seconds(60)
}

/** One key's balance, and until when it is parked. */
export interface Bucket {
  /** May be negative: a deficit is a queue of claims already promised. */
  readonly tokens: number
  /** When `tokens` was last brought up to date. */
  readonly atMillis: number
  /** A hard floor on the next claim, set by the Network's own instructions. */
  readonly heldUntilMillis: number
}

/** A key we have never asked on starts full, so the first Lookup is immediate. */
export const freshBucket = (pacing: Pacing, nowMillis: number): Bucket => ({
  tokens: pacing.burst,
  atMillis: nowMillis,
  heldUntilMillis: 0
})

/**
 * Bring a bucket up to date.
 *
 * The cap applies to the accrual, not to the deficit: a key that owes four
 * tokens climbs back through zero at exactly `perSecond`, which is what makes
 * the queueing in {@link claimFrom} honest.
 */
export const refill = (bucket: Bucket, pacing: Pacing, nowMillis: number): Bucket => {
  const elapsedMillis = Math.max(0, nowMillis - bucket.atMillis)
  const accrued = bucket.tokens + (elapsedMillis * pacing.perSecond) / 1000
  return {
    tokens: Math.min(pacing.burst, accrued),
    atMillis: nowMillis,
    heldUntilMillis: bucket.heldUntilMillis
  }
}

/** A claim taken against a bucket: the new balance, and when it comes due. */
export interface Claim {
  readonly bucket: Bucket
  /** Milliseconds the claimant must wait. Zero means now. */
  readonly waitMillis: number
}

/**
 * Take `cost` from a bucket, whether or not it can afford it.
 *
 * The claim always succeeds — what varies is when it comes due. That is the
 * whole trick: a caller cannot be told "no", only "not yet", so there is no
 * retry loop to get wrong and no ordering to lose.
 *
 * A hold set by the Network outranks the arithmetic. If they said come back in
 * thirty seconds, thirty seconds is the answer even with a full bucket.
 */
export const claimFrom = (bucket: Bucket, pacing: Pacing, nowMillis: number, cost: number): Claim => {
  const current = refill(bucket, pacing, nowMillis)
  const tokens = current.tokens - cost
  const deficitMillis = tokens >= 0 ? 0 : Math.ceil((-tokens * 1000) / pacing.perSecond)
  const holdMillis = Math.max(0, current.heldUntilMillis - nowMillis)
  return {
    bucket: { tokens, atMillis: nowMillis, heldUntilMillis: current.heldUntilMillis },
    waitMillis: Math.max(deficitMillis, holdMillis)
  }
}

/** Park a key until a stated moment, keeping the longest hold already in force. */
export const holdFrom = (
  bucket: Bucket,
  pacing: Pacing,
  nowMillis: number,
  forDuration: Duration.Duration
): Bucket => {
  const current = refill(bucket, pacing, nowMillis)
  return {
    ...current,
    heldUntilMillis: Math.max(current.heldUntilMillis, nowMillis + Duration.toMillis(forDuration))
  }
}

const remainingHeader = (headers: Headers.Headers): Option.Option<number> => {
  const raw = headers["x-ratelimit-remaining"]
  if (raw === undefined) return Option.none()
  const remaining = Number.parseFloat(raw)
  return Number.isFinite(remaining) ? Option.some(remaining) : Option.none()
}

/**
 * Believe the Network's counters over our own.
 *
 * Only ever lowers the balance. Raising it on a generous `remaining` would let
 * one stale header undo a hold, and the budget is shared with the reader's own
 * browsing anyway, so a high number is not a promise.
 *
 * `retry-after` is an instruction and parks the key. `x-ratelimit-remaining: 0`
 * is a description and parks it until `x-ratelimit-reset`, or for `blindHold` if
 * the Network did not say when.
 */
export const heedFrom = (
  bucket: Bucket,
  pacing: Pacing,
  nowMillis: number,
  headers: Headers.Headers
): Bucket => {
  const current = refill(bucket, pacing, nowMillis)
  const remaining = remainingHeader(headers)
  const asked = waitAskedFor(headers)

  if (Option.isSome(remaining) && remaining.value <= 0) {
    return holdFrom(current, pacing, nowMillis, Option.getOrElse(asked, () => pacing.blindHold))
  }
  if (headers["retry-after"] !== undefined && Option.isSome(asked)) {
    return holdFrom(current, pacing, nowMillis, asked.value)
  }
  if (Option.isSome(remaining)) {
    return { ...current, tokens: Math.min(current.tokens, remaining.value) }
  }
  return current
}

/**
 * The pacing seam.
 *
 * `claim` and `reserve` are the same decision; they differ only in who does the
 * waiting. A connector that would rather record a Withholding than stall an
 * Enquiry calls `claim` and looks at the number.
 */
export class Pace extends Context.Service<Pace, {
  /**
   * Take a claim and be told how long it is until due. The claim is SPENT
   * whether or not the caller honours the wait — that is what stops two callers
   * being told the same token is theirs.
   */
  readonly claim: (key: string, cost?: number) => Effect.Effect<Duration.Duration>
  /** Take a claim and sleep until it is due. */
  readonly reserve: (key: string, cost?: number) => Effect.Effect<void>
  /** Fold a Network's own rate headers back into the bucket. */
  readonly heed: (key: string, headers: Headers.Headers) => Effect.Effect<void>
  /** Stand down on a key for a stated time. */
  readonly hold: (key: string, forDuration: Duration.Duration) => Effect.Effect<void>
}>()("parle/net/Pace") {
  static readonly make = (options?: Pace.Options): Effect.Effect<Pace["Service"]> =>
    Effect.gen(function*() {
      const everywhere = options?.everywhere ?? defaultPacing
      const byKey = options?.byKey ?? {}
      const pacingFor = (key: string): Pacing => byKey[key] ?? everywhere

      const buckets = yield* Ref.make<Readonly<Record<string, Bucket>>>({})

      const claim = Effect.fn("Pace.claim")(function*(key: string, cost = 1) {
        const nowMillis = yield* Clock.currentTimeMillis
        const pacing = pacingFor(key)
        const waitMillis = yield* Ref.modify(buckets, (all) => {
          const claimed = claimFrom(all[key] ?? freshBucket(pacing, nowMillis), pacing, nowMillis, cost)
          return [claimed.waitMillis, { ...all, [key]: claimed.bucket }] as const
        })
        return Duration.millis(waitMillis)
      })

      const reserve = Effect.fn("Pace.reserve")(function*(key: string, cost = 1) {
        const wait = yield* claim(key, cost)
        if (Duration.toMillis(wait) > 0) yield* Effect.sleep(wait)
      })

      const heed = Effect.fn("Pace.heed")(function*(key: string, headers: Headers.Headers) {
        const nowMillis = yield* Clock.currentTimeMillis
        const pacing = pacingFor(key)
        yield* Ref.update(buckets, (all) => ({
          ...all,
          [key]: heedFrom(all[key] ?? freshBucket(pacing, nowMillis), pacing, nowMillis, headers)
        }))
      })

      const hold = Effect.fn("Pace.hold")(function*(key: string, forDuration: Duration.Duration) {
        const nowMillis = yield* Clock.currentTimeMillis
        const pacing = pacingFor(key)
        yield* Ref.update(buckets, (all) => ({
          ...all,
          [key]: holdFrom(all[key] ?? freshBucket(pacing, nowMillis), pacing, nowMillis, forDuration)
        }))
      })

      return Pace.of({ claim, reserve, heed, hold })
    })

  static readonly layerWith = (options: Pace.Options): Layer.Layer<Pace> =>
    Layer.effect(Pace, Pace.make(options))

  static readonly layer: Layer.Layer<Pace> = Layer.effect(Pace, Pace.make())
}

export declare namespace Pace {
  /** Per-key pacing, with one default for every key not named. */
  export interface Options {
    readonly everywhere?: Pacing | undefined
    readonly byKey?: Readonly<Record<string, Pacing>> | undefined
  }
}

/**
 * Pace a client, keyed by whatever the caller says this request is.
 *
 * Applied BELOW the retry transformer, so each retry re-enters the bucket — a
 * retry is another request against the same budget, and a Network that just
 * answered 429 must not be stampeded by the attempt that answers it.
 */
export const paced = (keyOf: (request: HttpClientRequest.HttpClientRequest) => string, cost = 1) =>
<E, R>(self: HttpClient.HttpClient.With<E, R>): HttpClient.HttpClient.With<E, R | Pace> =>
  HttpClient.transform(self, (effect, request) =>
    Effect.gen(function*() {
      const pace = yield* Pace
      const key = keyOf(request)
      yield* pace.reserve(key, cost)
      const response = yield* effect
      yield* pace.heed(key, response.headers)
      return response
    }))
