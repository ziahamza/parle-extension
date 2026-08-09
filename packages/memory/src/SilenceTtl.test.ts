/**
 * The ladder's two claims: an older Subject is never trusted for *less* time than
 * a younger one, and an unknown age is trusted for the least time of all.
 *
 * Both are properties of the whole table rather than of any rung, so they are
 * tested by walking it. A per-rung assertion passes happily on a table whose
 * third edit made a page from 2019 more volatile than one from this morning.
 */
import { describe, expect, it } from "vitest"
import * as Duration from "effect/Duration"
import * as Option from "effect/Option"
import { ageOf, ladder, longest, PublishedAt, shortest, silenceTtl } from "./SilenceTtl.ts"

const ttlMillis = (age: Duration.Duration) => Duration.toMillis(silenceTtl(Option.some(age)))

describe("the TTL follows the Subject's age", () => {
  it("gives a page published today minutes and a page from 2019 days", async () => {
    // The two cases ADR 0015 names. A single fixed TTL cannot serve both: it
    // either re-asks about a decade-old page all day, or it caches "nobody is
    // talking about this" through the hour the page is on the front page.
    const today = ttlMillis(Duration.minutes(20))
    const from2019 = ttlMillis(Duration.days(7 * 365))

    expect(today).toBeLessThan(Duration.toMillis(Duration.hours(1)))
    expect(from2019).toBeGreaterThan(Duration.toMillis(Duration.days(1)))
    expect(from2019).toBeGreaterThan(today)
  })

  it("never shortens as the Subject gets older", async () => {
    // Monotonicity is the property the ladder exists to have. Walk every rung's
    // boundary and just inside it, so a rung inserted out of order fails here
    // rather than in a reader's closed X gate.
    const probes = ladder.flatMap((rung) =>
      Duration.toMillis(rung.younger) === Number.POSITIVE_INFINITY
        ? [Duration.days(10_000)]
        : [Duration.millis(Duration.toMillis(rung.younger) - 1), rung.younger]
    )

    let previous = 0
    for (const age of probes) {
      const ttl = ttlMillis(age)
      expect(ttl).toBeGreaterThanOrEqual(previous)
      previous = ttl
    }
  })

  it("puts a twenty-minute-old post's Silence out of date well before the hour", async () => {
    // 09:00 nothing, 09:38 the Hacker News front page. Anything at or past an
    // hour would have missed it.
    expect(ttlMillis(Duration.minutes(20))).toBeLessThanOrEqual(Duration.toMillis(Duration.minutes(45)))
  })
})

describe("the ages the ladder is not walked with", () => {
  it("does not invert at the top, where the last rung is unbounded", async () => {
    // The monotonicity walk above substitutes a large finite age for the
    // unbounded rung, so the fall-through arm below the loop is the one input
    // the test replaces. Reaching it answered `shortest` — the *freshest* page's
    // TTL for the oldest possible Subject, which is the exact inversion the
    // ladder exists to make impossible.
    expect(Duration.toMillis(silenceTtl(Option.some(Duration.infinity))))
      .toBeGreaterThanOrEqual(ttlMillis(Duration.days(10_000)))
    expect(Duration.toMillis(silenceTtl(Option.some(Duration.infinity))))
      .toBe(Duration.toMillis(longest))
  })

  it("treats an age that is not a number as an age we do not know", async () => {
    // `Date.parse` of a malformed publication date is `NaN`, and every
    // comparison against `NaN` is false — so an unparsed date walks off the end
    // of the ladder and is answered as though it were the oldest page we had
    // ever seen. It is not old; it is unknown, and ADR 0015 says unknown gets
    // the shortest rung.
    expect(Duration.toMillis(silenceTtl(Option.some(Duration.millis(Number.NaN)))))
      .toBe(Duration.toMillis(shortest))
  })

  it("reports no age at all for a publication instant that is not a time", async () => {
    expect(Option.isNone(ageOf(Option.some(PublishedAt.make(Number.NaN)), 1_000))).toBe(true)
    expect(Option.isNone(ageOf(Option.some(PublishedAt.make(Number.NEGATIVE_INFINITY)), 1_000))).toBe(true)
  })
})

describe("an unknown publication date", () => {
  it("falls back to the shortest TTL, not the most convenient one", async () => {
    expect(Duration.toMillis(silenceTtl(Option.none()))).toBe(Duration.toMillis(shortest))
  })

  it("is answered no more generously than the freshest page the ladder knows", async () => {
    // The point of "most conservative": not knowing the age is not knowing
    // whether the page is volatile, and the safe reading of that is "assume it
    // is". If any rung were shorter than the fallback this would fail.
    for (const rung of ladder) {
      expect(Duration.toMillis(silenceTtl(Option.none()))).toBeLessThanOrEqual(Duration.toMillis(rung.ttl))
    }
  })
})

describe("age", () => {
  it("is nothing when the publication date is nothing", async () => {
    expect(Option.isNone(ageOf(Option.none(), 1_000))).toBe(true)
  })

  it("clamps a future publication date to zero rather than going negative", async () => {
    // Clock skew, or a page that post-dates itself. A negative age would fall
    // through every rung; the honest reading is "as fresh as it gets".
    const age = ageOf(Option.some(PublishedAt.make(5_000)), 1_000)
    expect(Option.isSome(age) ? Duration.toMillis(age.value) : -1).toBe(0)
  })
})
