/**
 * The bucket is the thing standing between a reader opening eight tabs and a
 * Network deciding this extension is abusive. It is also the thing that has to
 * be right when nobody is watching: an over-eager bucket produces a 429 storm
 * on the reader's own shared Reddit budget, and an over-cautious one produces a
 * panel that never fills.
 *
 * So: the arithmetic is tested directly, including the cases that only occur
 * under contention, and the header-honouring path is tested against the exact
 * headers ADR 0013 measured.
 */
import { describe, expect, it } from "vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"
import * as TestClock from "effect/testing/TestClock"
import * as Headers from "effect/unstable/http/Headers"
import * as Pace from "./Pace.ts"

const pacing: Pace.Pacing = { perSecond: 1, burst: 3, blindHold: Duration.seconds(60) }

const claims = (count: number, nowMillis = 0, from = Pace.freshBucket(pacing, nowMillis)) => {
  const waits: Array<number> = []
  let bucket = from
  for (let i = 0; i < count; i++) {
    const claim = Pace.claimFrom(bucket, pacing, nowMillis, 1)
    bucket = claim.bucket
    waits.push(claim.waitMillis)
  }
  return { bucket, waits }
}

describe("the token bucket", () => {
  it("forgives a burst and then paces", () => {
    // Three tabs opened at once is the design case; the fourth waits.
    expect(claims(5).waits).toStrictEqual([0, 0, 0, 1000, 2000])
  })

  it("queues rather than colliding when several claims arrive at the same instant", () => {
    // The naive "no token? sleep and look again" bucket hands all three the same
    // wait and then stampedes. Deficit accounting gives each its own slot.
    const { waits } = claims(3, 0, { tokens: 0, atMillis: 0, heldUntilMillis: 0 })
    expect(waits).toStrictEqual([1000, 2000, 3000])
  })

  it("refills over time at exactly the configured rate", () => {
    const spent = claims(5).bucket
    // Five claims against a burst of three leaves two seconds of debt.
    expect(spent.tokens).toBe(-2)
    // Two seconds clears the debt; a third buys the token this claim needs.
    expect(Pace.claimFrom(spent, pacing, 3000, 1).waitMillis).toBe(0)
    // Half a token short is half a second of waiting, not none and not a whole.
    expect(Pace.claimFrom(spent, pacing, 2500, 1).waitMillis).toBe(500)
  })

  it("does not let an idle key bank more than its burst", () => {
    // An hour on a page the reader left open must not buy 3600 requests.
    const idle = Pace.refill(Pace.freshBucket(pacing, 0), pacing, 3_600_000)
    expect(idle.tokens).toBe(pacing.burst)
  })

  it("charges a cost greater than one against the same budget", () => {
    const dear = Pace.claimFrom(Pace.freshBucket(pacing, 0), pacing, 0, 4)
    expect(dear.waitMillis).toBe(1000)
  })
})

describe("the Network's own counters win", () => {
  const heed = (bucket: Pace.Bucket, headers: Record<string, string>, nowMillis = 0) =>
    Pace.heedFrom(bucket, pacing, nowMillis, Headers.fromInput(headers))

  it("lowers the balance to what the Network says is left", () => {
    // The budget is shared with the reader's own browsing (ADR 0013), so our
    // local count is always an overestimate of what we may still spend.
    const clamped = heed(Pace.freshBucket(pacing, 0), { "x-ratelimit-remaining": "2" })
    expect(clamped.tokens).toBe(2)
  })

  it("never RAISES the balance on a generous header", () => {
    // The measured Reddit response is `remaining: 94`. Believing it would let a
    // stale header undo pacing we imposed for our own reasons.
    const spent = claims(5).bucket
    const heeded = heed(spent, { "x-ratelimit-used": "6", "x-ratelimit-remaining": "94", "x-ratelimit-reset": "190" })
    expect(heeded.tokens).toBe(spent.tokens)
  })

  it("parks the key until reset when the budget is exhausted", () => {
    const parked = heed(Pace.freshBucket(pacing, 0), { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "190" })
    expect(Pace.claimFrom(parked, pacing, 0, 1).waitMillis).toBe(190_000)
  })

  it("stands down for the blind hold when the Network will not say when", () => {
    const parked = heed(Pace.freshBucket(pacing, 0), { "x-ratelimit-remaining": "0" })
    expect(Pace.claimFrom(parked, pacing, 0, 1).waitMillis).toBe(Duration.toMillis(pacing.blindHold))
  })

  it("honours retry-after even with a full bucket", () => {
    const parked = heed(Pace.freshBucket(pacing, 0), { "retry-after": "30", "x-ratelimit-remaining": "5" })
    expect(Pace.claimFrom(parked, pacing, 0, 1).waitMillis).toBe(30_000)
  })

  it("ignores headers it cannot read rather than inventing a hold", () => {
    const untouched = heed(Pace.freshBucket(pacing, 0), { "x-ratelimit-remaining": "unknown" })
    expect(Pace.claimFrom(untouched, pacing, 0, 1).waitMillis).toBe(0)
  })

  it("keeps the longest hold in force when a second one is shorter", () => {
    const long = Pace.holdFrom(Pace.freshBucket(pacing, 0), pacing, 0, Duration.seconds(120))
    const short = Pace.holdFrom(long, pacing, 0, Duration.seconds(5))
    expect(Pace.claimFrom(short, pacing, 0, 1).waitMillis).toBe(120_000)
  })
})

describe("the Pace service", () => {
  const run = <A>(effect: Effect.Effect<A, never, Pace.Pace>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(Pace.Pace.layerWith({ everywhere: pacing })),
        Effect.provide(TestClock.layer())
      )
    )

  it("keeps a bucket per key, so one Network cannot starve another", async () => {
    // The domain paces a Network's `linked` and `topical` questions apart
    // because they are physically different requests that fail independently.
    const waits = await run(Effect.gen(function*() {
      const pace = yield* Pace.Pace
      const mine: Array<number> = []
      for (const key of ["hackernews:linked", "hackernews:linked", "hackernews:linked", "hackernews:linked"]) {
        mine.push(Duration.toMillis(yield* pace.claim(key)))
      }
      mine.push(Duration.toMillis(yield* pace.claim("hackernews:topical")))
      return mine
    }))
    expect(waits).toStrictEqual([0, 0, 0, 1000, 0])
  })

  it("spends a claim whether or not the caller waits", async () => {
    // Otherwise two callers are each told the same token is theirs, which is
    // precisely the state a rate limiter exists to prevent.
    const waits = await run(Effect.gen(function*() {
      const pace = yield* Pace.Pace
      const first = yield* pace.claim("x:linked", 3)
      const second = yield* pace.claim("x:linked", 1)
      return [Duration.toMillis(first), Duration.toMillis(second)]
    }))
    expect(waits).toStrictEqual([0, 1000])
  })

  it("folds a rate header back into the bucket", async () => {
    const wait = await run(Effect.gen(function*() {
      const pace = yield* Pace.Pace
      yield* pace.heed("reddit:linked", Headers.fromInput({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "190" }))
      return Duration.toMillis(yield* pace.claim("reddit:linked"))
    }))
    expect(wait).toBe(190_000)
  })

  it("makes reserve actually wait out the deficit", async () => {
    const seen = await run(Effect.gen(function*() {
      const pace = yield* Pace.Pace
      const arrived = yield* Ref.make(false)
      // Drain the burst, so the reserve below is owed a full second.
      yield* pace.claim("hackernews:linked", pacing.burst)
      const fiber = yield* Effect.forkChild(
        Effect.flatMap(pace.reserve("hackernews:linked"), () => Ref.set(arrived, true))
      )
      yield* TestClock.adjust(Duration.millis(900))
      const early = yield* Ref.get(arrived)
      yield* TestClock.adjust(Duration.millis(200))
      yield* Fiber.join(fiber)
      return { early, late: yield* Ref.get(arrived) }
    }))
    expect(seen).toStrictEqual({ early: false, late: true })
  })
})
