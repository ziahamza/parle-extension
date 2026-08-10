/**
 * The two properties that make ADR 0001's "at most once per long TTL" real:
 * intent survives a worker that dies mid-flight, and an intent nobody ever
 * settles stops counting.
 *
 * Time is the `TestClock`'s, because both properties are entirely about
 * durations and neither is worth a flaky sleep.
 */
import { describe, expect, it } from "vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as TestClock from "effect/testing/TestClock"
import { Consultation, Place } from "@parle/domain/Coverage"
import { SubjectUrl } from "@parle/domain/Subject"
import { defaultRetention, LookupRecord } from "./LookupRecord.ts"
import { OpaqueKeys } from "./OpaqueKeys.ts"
import { PublishedAt } from "./SilenceTtl.ts"
import { Storage } from "./Storage.ts"

const subject = SubjectUrl.make("https://example.com/patients/94213")
const elsewhere = SubjectUrl.make("https://other.test/story")

/**
 * The clock starts at zero, so every age test first moves "now" somewhere a page
 * can plausibly have been published *before*.
 */
const today = Duration.toMillis(Duration.days(400))

const onX = Place.cases.Network.make({ network: "x" })

const withRecord = <A>(
  storage: Layer.Layer<Storage>,
  use: (record: LookupRecord["Service"]) => Effect.Effect<A>
): Promise<A> => {
  const keys = Layer.provide(OpaqueKeys.layer, storage)
  const record = Layer.provide(LookupRecord.layer, Layer.mergeAll(storage, keys))
  return Effect.runPromise(
    Effect.gen(function*() {
      return yield* use(yield* LookupRecord)
    }).pipe(Effect.provide(record), Effect.provide(TestClock.layer()))
  )
}

describe("intent is recorded before the request", () => {
  it("answers 'already asked' for a Lookup that is still in flight", async () => {
    // Two tabs on one Subject. Without this, the second tab spends the X budget
    // the first tab is already spending.
    const asked = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        yield* record.intend(subject, "x")
        return yield* record.asked(subject, "x")
      }))

    expect(Option.isSome(asked)).toBe(true)
  })

  it("survives the worker that wrote it", async () => {
    // The whole point: a service worker killed between `intend` and `settle`
    // leaves the record behind, because it was written first. The second
    // `withRecord` is a second worker lifetime over the same disk.
    const backing = new Map<string, string>()
    await withRecord(Storage.memory(backing), (record) => record.intend(subject, "x"))

    const asked = await withRecord(Storage.memory(backing), (record) => record.asked(subject, "x"))
    expect(Option.isSome(asked)).toBe(true)
  })


  it("keeps Networks apart", async () => {
    const asked = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        yield* record.intend(subject, "hackernews")
        return yield* record.asked(subject, "x")
      }))

    expect(Option.isNone(asked)).toBe(true)
  })
})

describe("a lease that is never settled expires", () => {
  it("stops counting once the window passes, so a crash does not block forever", async () => {
    const seen = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        yield* record.intend(subject, "x")
        const during = yield* record.asked(subject, "x")
        yield* TestClock.adjust(Duration.toMillis(defaultRetention.lease) + 1)
        const after = yield* record.asked(subject, "x")
        return { during, after }
      }))

    expect(Option.isSome(seen.during)).toBe(true)
    expect(Option.isNone(seen.after)).toBe(true)
  })
})

describe("intended: the lease alone, never a settled answer", () => {
  it("reports an unexpired lease, from a second lifetime over the same disk", async () => {
    // The crash-loop guard: a worker killed mid-flight leaves the lease behind,
    // and the worker that replaces it must see it — otherwise ten kills in a
    // row are ten fresh request budgets.
    const backing = new Map<string, string>()
    await withRecord(Storage.memory(backing), (record) => record.intend(subject, "hackernews"))

    const held = await withRecord(Storage.memory(backing), (record) =>
      record.intended(subject, "hackernews"))
    expect(held).toBe(true)
  })

  it("stops reporting once the lease expires", async () => {
    const seen = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        yield* record.intend(subject, "hackernews")
        const during = yield* record.intended(subject, "hackernews")
        yield* TestClock.adjust(Duration.toMillis(defaultRetention.lease) + 1)
        const after = yield* record.intended(subject, "hackernews")
        return { during, after }
      }))

    expect(seen.during).toBe(true)
    expect(seen.after).toBe(false)
  })

  it("never reports a settled answer — that is asked's business, not this one's", async () => {
    // ADR 0005: a caller gating on `intended` declines to pay twice for a
    // request already in flight; it must never be handed a settled answer it
    // would then withhold a Lookup on the strength of.
    const seen = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        const lease = yield* record.intend(subject, "hackernews")
        yield* record.settle(lease, { _tag: "Silence" })
        return {
          intended: yield* record.intended(subject, "hackernews"),
          asked: yield* record.asked(subject, "hackernews")
        }
      }))

    expect(seen.intended).toBe(false)
    expect(Option.isSome(seen.asked)).toBe(true)
  })
})

describe("what settling does", () => {
  it("remembers a Silence far past the lease window", async () => {
    // A Silence is the only Lookup outcome that is evidence about the world, and
    // the only one it is ever safe to remember.
    const asked = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        const lease = yield* record.intend(subject, "hackernews")
        yield* record.settle(lease, { _tag: "Silence" })
        yield* TestClock.adjust(Duration.toMillis(defaultRetention.lease) * 10)
        return yield* record.asked(subject, "hackernews")
      }))

    expect(Option.isSome(asked)).toBe(true)
  })

  it("forgets a Refusal immediately, because it is a fact about the attempt", async () => {
    const asked = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        const lease = yield* record.intend(subject, "reddit")
        yield* record.settle(lease, { _tag: "Refusal", reason: "forbidden" })
        return yield* record.asked(subject, "reddit")
      }))

    expect(Option.isNone(asked)).toBe(true)
  })

  it("forgets a Garble too, and never mistakes it for a Silence", async () => {
    const asked = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        const lease = yield* record.intend(subject, "hackernews")
        yield* record.settle(lease, { _tag: "Garble" })
        return yield* record.asked(subject, "hackernews")
      }))

    expect(Option.isNone(asked)).toBe(true)
  })

  it("lets an answer expire when its retention runs out", async () => {
    const asked = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        const lease = yield* record.intend(subject, "hackernews")
        yield* record.settle(lease, { _tag: "Answered", mentions: 2 })
        yield* TestClock.adjust(Duration.toMillis(defaultRetention.asked.hackernews) + 1)
        return yield* record.asked(subject, "hackernews")
      }))

    expect(Option.isNone(asked)).toBe(true)
  })

  it("does not let a racing tab's fresh intent shorten a settled answer", async () => {
    // Otherwise the second tab replaces a seven-day X record with a two-minute
    // lease, and its own crash reopens the window the first tab had closed.
    const asked = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        const lease = yield* record.intend(subject, "x")
        yield* record.settle(lease, { _tag: "Silence" })
        yield* record.intend(subject, "x")
        yield* TestClock.adjust(Duration.toMillis(defaultRetention.lease) + 1)
        return yield* record.asked(subject, "x")
      }))

    expect(Option.isSome(asked)).toBe(true)
  })
})

describe("how long a Silence is believed depends on the Subject's age", () => {
  /** Settle a Silence about a Subject published at `publishedAt`, then wait. */
  const afterSilence = (
    publishedAt: number | undefined,
    wait: Duration.Duration
  ) =>
    withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        yield* TestClock.adjust(today)
        const lease = yield* record.intend(subject, "hackernews")
        yield* record.settle(
          lease,
          publishedAt === undefined
            ? { _tag: "Silence" }
            : { _tag: "Silence", publishedAt: PublishedAt.make(publishedAt) }
        )
        yield* TestClock.adjust(wait)
        return yield* record.asked(subject, "hackernews")
      }))

  it("goes stale within the hour for a page published this morning", async () => {
    // 09:00 nothing, 09:38 the Hacker News front page. A Silence still believed
    // at 10:00 is how a reader misses the discussion of the thing they are
    // reading, and nothing anywhere reports it.
    expect(Option.isNone(await afterSilence(today, Duration.hours(1)))).toBe(true)
  })

  it("survives that same hour for a page from 2019", async () => {
    // Published on day zero, asked on day four hundred. It had nothing at 09:00
    // and it will still have nothing at 10:15; re-asking is pure waste.
    expect(Option.isSome(await afterSilence(0, Duration.hours(1)))).toBe(true)
  })

  it("survives a week for that 2019 page, which is the whole point of varying it", async () => {
    expect(Option.isSome(await afterSilence(0, Duration.days(7)))).toBe(true)
  })

  it("falls back to the short end when the publication date is unknown", async () => {
    // Deliberately the same answer as "published this morning". Not knowing the
    // age is not knowing whether the page is volatile, and ADR 0015 says the
    // fallback is the most conservative TTL, not the most convenient one.
    expect(Option.isNone(await afterSilence(undefined, Duration.hours(1)))).toBe(true)
    expect(Option.isSome(await afterSilence(undefined, Duration.minutes(10)))).toBe(true)
  })

  it("still honours X's long TTL for a page published this morning", async () => {
    // The one thing that overrides the ladder, and it overrides it *upwards*.
    // ADR 0001's terms are that a Subject URL is searched on X at most once per
    // long TTL; a freshly published page does not relax that, because the cost
    // there is the reader's own account and their disclosure, not our patience.
    const seen = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        yield* TestClock.adjust(today)
        const lease = yield* record.intend(subject, "x")
        yield* record.settle(lease, { _tag: "Silence", publishedAt: PublishedAt.make(today) })
        yield* TestClock.adjust(Duration.days(6))
        const within = yield* record.asked(subject, "x")
        yield* TestClock.adjust(Duration.days(2))
        const beyond = yield* record.asked(subject, "x")
        return { within, beyond }
      }))

    expect(Option.isSome(seen.within)).toBe(true)
    expect(Option.isNone(seen.beyond)).toBe(true)
  })
})

describe("a Withholding is never stored", () => {
  it("cannot round-trip: settling one leaves nothing behind at all", async () => {
    // ADR 0015's small, load-bearing clause. A stored Withholding re-derives the
    // X gate's own decision — the gate reads back its "no Linked Mention yet",
    // closes, and stays closed deterministically on every future visit. So the
    // entry is removed, and the reason is recomputed from current Coverage.
    const backing = new Map<string, string>()
    const asked = await withRecord(Storage.memory(backing), (record) =>
      Effect.gen(function*() {
        const lease = yield* record.intend(subject, "x")
        yield* record.settleFrom(
          lease,
          Consultation.cases.Withholding.make({ place: onX, reason: "awaiting-linked-mention" })
        )
        return yield* record.asked(subject, "x")
      }))

    expect(Option.isNone(asked)).toBe(true)
    expect(Array.from(backing.keys()).filter((k) => k.startsWith("parle/lookup/"))).toEqual([])
  })

  it("does not even leave the intent standing, which would read as 'asked'", async () => {
    const asked = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        const lease = yield* record.intend(subject, "reddit")
        yield* record.settleFrom(
          lease,
          Consultation.cases.Withholding.make({
            place: Place.cases.Network.make({ network: "reddit" }),
            reason: "over-budget"
          })
        )
        yield* TestClock.adjust(Duration.millis(1))
        return yield* record.asked(subject, "reddit")
      }))

    expect(Option.isNone(asked)).toBe(true)
  })

  it("stores nothing for a Lookup that has not finished either", async () => {
    // `Pending` and `Asking` are not outcomes. Treating them as one would write
    // an answer for a request nobody has heard back from.
    const asked = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        const lease = yield* record.intend(subject, "x")
        yield* record.settleFrom(lease, Consultation.cases.Asking.make({ place: onX }))
        return yield* record.asked(subject, "x")
      }))

    expect(Option.isNone(asked)).toBe(true)
  })

  it("still stores a Silence arriving by the same door", async () => {
    // Otherwise the previous three tests would pass on a `settleFrom` that
    // simply never writes anything.
    const asked = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        yield* TestClock.adjust(today)
        const lease = yield* record.intend(subject, "hackernews")
        yield* record.settleFrom(
          lease,
          Consultation.cases.Silence.make({
            place: Place.cases.Network.make({ network: "hackernews" })
          }),
          PublishedAt.make(0)
        )
        yield* TestClock.adjust(Duration.days(7))
        return yield* record.asked(subject, "hackernews")
      }))

    expect(Option.isSome(asked)).toBe(true)
  })

  it("removes the entry for a Refusal arriving by the same door", async () => {
    const asked = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        const lease = yield* record.intend(subject, "reddit")
        yield* record.settleFrom(
          lease,
          Consultation.cases.Refusal.make({
            place: Place.cases.Network.make({ network: "reddit" }),
            reason: "forbidden"
          })
        )
        return yield* record.asked(subject, "reddit")
      }))

    expect(Option.isNone(asked)).toBe(true)
  })
})

describe("a Consultation only settles the Lease it answers", () => {
  /**
   * Coverage holds every Place in one array, so `settleFrom` is one index slip
   * from writing somewhere else's answer under this Lease's key. Nothing about
   * the types catches it — both sides are a `Consultation`, and the Lease carries
   * no address to compare against — and the cost is not a mis-filed row: X's
   * retention is seven days, so `asked` then reports X as already asked for a
   * week on evidence that never came from X. That is a gate held shut by a record
   * of a Lookup nobody issued, which is the failure ADR 0015's Withholding clause
   * exists to prevent, reached by a different road.
   */
  const settledWith = (consultation: Consultation) =>
    withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        const lease = yield* record.intend(subject, "x")
        yield* record.settleFrom(lease, consultation)
        yield* TestClock.adjust(Duration.toMillis(defaultRetention.lease) + 1)
        return yield* record.asked(subject, "x")
      }))

  it("does not let the reader's own machine answer for X", async () => {
    // A `Recall` is not a Lookup at all. Recording one as X's answer says we
    // sent an address to a Network we never contacted.
    const asked = await settledWith(
      Consultation.cases.Answered.make({ place: Place.cases.Recall.make({}), mentions: [] })
    )
    expect(Option.isNone(asked)).toBe(true)
  })

  it("does not let Hacker News's Silence answer for X", async () => {
    const asked = await settledWith(
      Consultation.cases.Silence.make({
        place: Place.cases.Network.make({ network: "hackernews" })
      })
    )
    expect(Option.isNone(asked)).toBe(true)
  })


  it("still settles the Consultation that does answer this Lease", async () => {
    // Otherwise the three above would pass on a `settleFrom` that never writes.
    const asked = await settledWith(Consultation.cases.Silence.make({ place: onX }))
    expect(Option.isSome(asked)).toBe(true)
  })

  it("does not remember a Silence that came off a filled window", async () => {
    // ADR 0018. This is the whole reason `windowed` exists on `Silence`. The
    // Network answered, the window we asked for filled, and none of what came
    // back was this page — which says how far we looked and nothing about
    // whether anyone has been here. Stored, it becomes "nobody discussed this
    // page" for as long as `silenceTtl` allows: a silent false negative that is
    // then durable, which ADR 0005 refuses. Measured on `github.com`, where
    // fifty hits arrive out of 1,973,692.
    const asked = await settledWith(
      Consultation.cases.Silence.make({ place: onX, windowed: true })
    )
    expect(Option.isNone(asked)).toBe(true)
  })

  it("still remembers an Answered that came off a filled window", async () => {
    // Not symmetric, and deliberately. A windowed `Answered` found real
    // Discussions and their absence is not what would be re-derived from it;
    // asking again would spend the reader's budget to learn what we already
    // show. Only the Silence is a claim about the world.
    const asked = await settledWith(
      Consultation.cases.Answered.make({ place: onX, mentions: [], windowed: true })
    )
    expect(Option.isSome(asked)).toBe(true)
  })
})

describe("the store holds no address", () => {
  it("puts no fragment of the Subject in any key or any value", async () => {
    const backing = new Map<string, string>()
    await withRecord(Storage.memory(backing), (record) =>
      Effect.gen(function*() {
        const lease = yield* record.intend(subject, "x")
        yield* record.settle(lease, { _tag: "Answered", mentions: 1 })
      }))

    const written = Array.from(backing.entries())
      .filter(([key]) => key.startsWith("parle/lookup/"))
      .flat()
      .join(" ")

    expect(written.length).toBeGreaterThan(0)
    for (const fragment of ["example.com", "patients", "94213", "https", "linked"]) {
      expect(written).not.toContain(fragment)
    }
  })
})

describe("forgetting", () => {
  it("clears one origin and leaves another's record standing", async () => {
    const seen = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        const one = yield* record.intend(subject, "hackernews")
        const two = yield* record.intend(elsewhere, "hackernews")
        yield* record.settle(one, { _tag: "Silence" })
        yield* record.settle(two, { _tag: "Silence" })
        yield* record.forget({ _tag: "Origin", origin: "https://example.com" })
        return {
          cleared: yield* record.asked(subject, "hackernews"),
          kept: yield* record.asked(elsewhere, "hackernews")
        }
      }))

    expect(Option.isNone(seen.cleared)).toBe(true)
    expect(Option.isSome(seen.kept)).toBe(true)
  })

  it("clears that origin however the caller had it to hand", async () => {
    // The keys are built from `originOf`, so a scope spelled any other way
    // conceals to a different bucket and sweeps nothing — and `forget` returns
    // `void`, so nothing anywhere reports that the reader's data is still there.
    for (const spelling of ["https://example.com/", "https://example.com/patients/94213", "example.com"]) {
      const seen = await withRecord(Storage.memory(), (record) =>
        Effect.gen(function*() {
          const one = yield* record.intend(subject, "hackernews")
          const two = yield* record.intend(elsewhere, "hackernews")
          yield* record.settle(one, { _tag: "Silence" })
          yield* record.settle(two, { _tag: "Silence" })
          yield* record.forget({ _tag: "Origin", origin: spelling })
          return {
            cleared: yield* record.asked(subject, "hackernews"),
            kept: yield* record.asked(elsewhere, "hackernews")
          }
        }))

      expect(Option.isNone(seen.cleared), `cleared for ${spelling}`).toBe(true)
      expect(Option.isSome(seen.kept), `kept for ${spelling}`).toBe(true)
    }
  })

  it("clears everything", async () => {
    const asked = await withRecord(Storage.memory(), (record) =>
      Effect.gen(function*() {
        const lease = yield* record.intend(subject, "x")
        yield* record.settle(lease, { _tag: "Silence" })
        yield* record.forget({ _tag: "All" })
        return yield* record.asked(subject, "x")
      }))

    expect(Option.isNone(asked)).toBe(true)
  })
})

describe("a storage failure is swallowed, not propagated", () => {
  it("still hands back a Lease, and answers 'not asked'", async () => {
    // The caller is about to issue a request either way. Failing `intend` would
    // mean a full disk stops the reader seeing Hacker News, which is a far worse
    // trade than losing the record of having looked.
    const seen = await withRecord(Storage.unavailable("quota exceeded"), (record) =>
      Effect.gen(function*() {
        const lease = yield* record.intend(subject, "x")
        yield* record.settle(lease, { _tag: "Silence" })
        yield* record.forget({ _tag: "All" })
        return { lease, asked: yield* record.asked(subject, "x") }
      }))

    expect(seen.lease.network).toBe("x")
    expect(Option.isNone(seen.asked)).toBe(true)
  })
})
