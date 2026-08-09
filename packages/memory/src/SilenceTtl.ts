/**
 * How long a Silence about a Subject is worth believing, derived from the
 * Subject's own age.
 *
 * A Silence is the only Lookup outcome that is evidence about the world rather
 * than about us, so it is the only one it is ever safe to keep. How long it stays
 * true, though, is not a property of the Lookup — it is a property of the page.
 * ADR 0015 states the case plainly: a twenty-minute-old post that had nothing at
 * 09:00 can be on the Hacker News front page by 09:38, while a 2019 post that had
 * nothing at 09:00 will still have nothing at 10:15. A single fixed TTL is wrong
 * in **both directions at once** — it either re-asks about a decade-old page all
 * day, or it caches "nobody is talking about this" straight through the hour the
 * page was actually being discussed.
 *
 * That second failure is the one that matters, because it is silent and it
 * compounds: a Silence trusted too long re-derives the X gate's decision from
 * stale evidence, and the gate then reads "no Linked Mention", closes, and stays
 * closed deterministically. This module exists so the staleness cannot outlive the
 * page's own volatility.
 *
 * **An unknown publication date takes the shortest rung, not a convenient one.**
 * Not knowing how old a page is means not knowing whether it is volatile — and
 * the conservative reading of "I do not know" is "assume it might be moving".
 * {@link shortest} is computed from the ladder rather than written down twice, so
 * it cannot drift away from the table when a rung is retuned.
 *
 * The ladder is data, not a chain of `if`s, so a test can walk it and assert it is
 * monotone: an older Subject must never get a *shorter* TTL than a younger one.
 * That is the property the whole module claims, and it is the one a hand-tuned
 * cascade quietly loses on the third edit.
 */
import * as Duration from "effect/Duration"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

/**
 * When the Subject itself was published, in epoch milliseconds.
 *
 * Branded because the two numbers in this module are both milliseconds and mean
 * opposite things: a publication *instant* and an *age*. Passing one where the
 * other is wanted typechecks perfectly and produces a TTL off by fifty-six years,
 * which reads, at the call site, as a cache that simply never expires.
 */
export const PublishedAt = Schema.Number.pipe(Schema.brand("PublishedAt"))
export type PublishedAt = typeof PublishedAt.Type

/** A Subject younger than {@link Rung.younger} keeps a Silence for {@link Rung.ttl}. */
export interface Rung {
  readonly younger: Duration.Duration
  readonly ttl: Duration.Duration
}

/**
 * The ladder, shortest rung first.
 *
 * The last rung's bound is infinity, so the table is total over every age: there
 * is no age this can fail to answer, and no fall-through default to disagree with
 * it. The numbers are a judgement about how quickly a page of a given age can
 * *become* discussed, not about how quickly discussion of it changes — a page
 * published an hour ago has its whole submission window ahead of it, and a page
 * published in 2019 has had its.
 */
export const ladder: ReadonlyArray<Rung> = [
  { younger: Duration.hours(24), ttl: Duration.minutes(30) },
  { younger: Duration.days(7), ttl: Duration.hours(6) },
  { younger: Duration.days(30), ttl: Duration.days(1) },
  { younger: Duration.days(365), ttl: Duration.days(7) },
  { younger: Duration.infinity, ttl: Duration.days(30) }
]

/**
 * The shortest TTL the ladder can produce, and what an unknown age gets.
 *
 * Derived rather than declared: retuning a rung downwards must move this with it,
 * or "fall back to the most conservative TTL" silently becomes "fall back to a
 * number that used to be conservative".
 */
export const shortest: Duration.Duration = ladder.reduce(
  (a, rung) => Duration.min(a, rung.ttl),
  Duration.infinity
)

/**
 * The longest TTL the ladder can produce, and what an age past every rung gets.
 *
 * Derived for the same reason {@link shortest} is, and it exists so the loop
 * below has somewhere monotone to fall through to. `shortest` was the obvious
 * thing to write there and it is exactly backwards: the fall-through is reached
 * only by an age *older* than every rung, so answering it with the freshest
 * page's TTL inverts the one property this module claims.
 */
export const longest: Duration.Duration = ladder.reduce(
  (a, rung) => Duration.max(a, rung.ttl),
  Duration.zero
)

/**
 * How long to honour a Silence about a Subject of this age.
 *
 * `Option.none` is "we do not know how old this page is" and is answered with
 * {@link shortest}. It is deliberately the same answer as "published in the last
 * few hours": both are cases where re-asking sooner costs one Lookup and not
 * re-asking costs the reader the discussion.
 *
 * An age that is `NaN` is answered the same way, and for the same reason. It is
 * not a small age or a large one — it is a publication date that did not parse,
 * arriving as arithmetic rather than as an absence, and "we do not know" is the
 * honest reading of it. Note that every comparison against `NaN` is false, so
 * without this it would reach the fall-through and be answered as though it were
 * the oldest page we had ever seen.
 */
export const silenceTtl = (age: Option.Option<Duration.Duration>): Duration.Duration => {
  if (Option.isNone(age)) return shortest
  const millis = Duration.toMillis(age.value)
  if (Number.isNaN(millis)) return shortest
  const clamped = Math.max(0, millis)
  for (const rung of ladder) {
    if (clamped < Duration.toMillis(rung.younger)) return rung.ttl
  }
  // Older than every rung. Unreachable while the last rung is unbounded, and
  // {@link longest} rather than {@link shortest} so that the day someone bounds
  // it the table stays monotone instead of wrapping round to thirty minutes.
  return longest
}

/**
 * The Subject's age at a given moment, where its publication date is known.
 *
 * Clamped at zero: a publication date in the future is clock skew or a page that
 * post-dates itself, and the honest reading of both is "as fresh as it gets",
 * which is also the safest.
 *
 * A publication instant that is not a finite number is answered as *no* age
 * rather than as some age. `PublishedAt` is a branded `Schema.Number` and
 * `Date.parse` of a malformed date is `NaN`, so the value a caller has to hand is
 * one arithmetic step from being a number that is not a time. Reporting it as an
 * unknown age routes it to {@link shortest}, which is what ADR 0015 asks for when
 * the date is absent, and it is no less absent for having arrived as `NaN`.
 */
export const ageOf = (
  published: Option.Option<PublishedAt>,
  now: number
): Option.Option<Duration.Duration> => {
  if (Option.isNone(published)) return Option.none()
  if (!Number.isFinite(published.value) || !Number.isFinite(now)) return Option.none()
  return Option.some(Duration.millis(Math.max(0, now - published.value)))
}
