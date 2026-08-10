/**
 * The `no-title` correction path, driven through the graph as it ships.
 *
 * P3 of the 2026-08-10 battery: the Topical Lookup is keyed on the tab title,
 * `webNavigation.onCommitted` fires before `<title>` parses, and the title a
 * tab reports until then is the browser's placeholder — the page's own address.
 * Battery 1 recorded `title: youtube.com/watch?v=dQw4w9WgXcQ&t=42s` reaching
 * Algolia as a search query, re-leaking the parameter the canonicalizer had
 * stripped from every address query. The wire guard in `@parle/networks` stops
 * the leak; what THIS file holds is the other half of ADR 0005's bargain — the
 * withholding is "not yet", never "not at all":
 *
 *   - a placeholder title withholds the Topical Lookups as `no-title`, with
 *     nothing on the wire, and the state RENDERS rather than hangs;
 *   - the real title arriving re-asks exactly those Places — and does not
 *     re-pay for the Linked Lookups that already answered;
 *   - a second placeholder re-asks nothing;
 *   - a reader's insist with the title still missing re-asks everything else
 *     and still sends no address-shaped "title" anywhere.
 *
 * Same substitutions as `Pipeline.test.ts` and only those: the platform double
 * and a recorded wire. Everything between — ReadingWatch, canonicalization,
 * LookupPolicy, the Enquiry's waves, Coverage, panelOf — is the shipped graph.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { type Consultation, isSettled } from "@parle/domain/Coverage"
import { ReadingWatch } from "@parle/browser/ReadingWatch"
import { makeDouble, WebExt } from "@parle/browser/WebExtApi"
import { type Exchange, recording } from "@parle/networks/Recording"
import { hackerNewsLinked, hackerNewsTopical } from "@parle/networks/Recorded"
import { Board } from "../reading/Board.ts"
import type { Reading } from "../reading/Reading.ts"
import { everyNetworkOn, noProvider, type Surroundings } from "../reading/Surroundings.ts"
import { Settings, withAutomatic } from "../settings/Settings.ts"
import { panelOf } from "../view/panelOf.ts"
import * as Pipeline from "./Pipeline.ts"

const ADDRESS = "https://www.nature.com/articles/d41586-024-02012-5"
const TITLE = "Not all 'open source' AI models are open"
/**
 * Chrome's placeholder, as the battery actually recorded it: the page's own
 * address with the scheme dropped. The harder of the two placeholder shapes —
 * the with-scheme form is caught by a plain URL parse; this one is only
 * recognisable as a placeholder because it is THIS page's own host.
 */
const PLACEHOLDER = "www.nature.com/articles/d41586-024-02012-5"
const NOW = 1_800_000_000_000

const AGREED: Surroundings = {
  decision: "automatic",
  provider: noProvider,
  networks: everyNetworkOn,
  index: { _tag: "Absent" },
  everyDiscussion: false
}

const agree = Effect.gen(function*() {
  const settings = yield* Settings
  yield* settings.change((held) => withAutomatic(held, true))
})

const json = (body: string): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "application/json" }
})

/** Algolia answers; Reddit 403s, exactly as it does live from this box. */
const algolia = (url: string): Exchange => {
  if (!url.includes("hn.algolia.com")) {
    return { status: 403, body: "<html>blocked</html>", headers: { "content-type": "text/html" } }
  }
  return json(url.includes("restrictSearchableAttributes") ? hackerNewsLinked : hackerNewsTopical)
}

/** The two Questions, told apart the way the wire tells them apart. */
const linkedAsks = (asked: ReadonlyArray<string>): ReadonlyArray<string> =>
  asked.filter((u) => u.includes("hn.algolia.com") && u.includes("restrictSearchableAttributes"))
const topicalAsks = (asked: ReadonlyArray<string>): ReadonlyArray<string> =>
  asked.filter((u) => u.includes("hn.algolia.com") && !u.includes("restrictSearchableAttributes"))

const hnTopicalOf = (reading: Reading): Consultation | undefined =>
  reading.standing._tag === "Enquiring"
    ? reading.standing.knowledge.coverage.consultations.find((c) =>
      c.place._tag === "Network" && c.place.network === "hackernews" && c.place.question === "topical"
    )
    : undefined

/** Wait for a Reading state, through the same ref the panel reads. */
const readingWhen = (
  ref: SubscriptionRef.SubscriptionRef<Reading>,
  accept: (reading: Reading) => boolean
) =>
  Effect.gen(function*() {
    const found = yield* SubscriptionRef.changes(ref).pipe(
      Stream.filter(accept),
      Stream.take(1),
      Stream.runCollect,
      Effect.timeout("10 seconds"),
      // A test that outwaits this is broken, not degraded: die rather than
      // widen every caller's error channel with a TimeoutError nothing handles.
      Effect.orDie
    )
    const reading = found[0]
    if (reading === undefined) throw new Error("the Reading never reached the awaited state")
    return reading
  })

const settled = (reading: Reading): boolean =>
  reading.standing._tag === "Enquiring" && isSettled(reading.standing.knowledge.coverage)

/**
 * One tab sighted under a given title, through the real boundary machinery,
 * held open so the test can keep driving the same Board.
 */
const opened = <A>(
  body: (given: {
    readonly board: Board["Service"]
    readonly ref: SubscriptionRef.SubscriptionRef<Reading>
    readonly asked: ReadonlyArray<string>
  }) => Effect.Effect<A>,
  sightTitle: string = PLACEHOLDER
): Promise<A> => {
  const double = makeDouble()
  const wire = recording(algolia)
  return Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      const watch = yield* ReadingWatch
      const board = yield* Board
      yield* agree
      const boundaries = yield* Effect.forkScoped(
        Stream.runForEach(watch.readings, (boundary) =>
          board.sight(boundary.tab, boundary.address, sightTitle, boundary.arrival))
      )
      yield* Effect.promise(() => double.watched)
      double.sight({ address: ADDRESS, tabId: 1 })
      const ref = yield* board.open(1)
      yield* readingWhen(ref, settled)
      yield* Fiber.interrupt(boundaries)
      return yield* body({ board, ref, asked: wire.asked })
    })).pipe(Effect.provide(Pipeline.on(WebExt.doubleLayer(double), wire.layer)))
  )
}

describe("a page sighted under the browser's placeholder title", () => {
  it("withholds the Topical Lookups as no-title, with nothing on the wire, and still settles", async () => {
    await opened(({ asked, ref }) =>
      Effect.gen(function*() {
        const reading = yield* SubscriptionRef.get(ref)
        const topical = hnTopicalOf(reading)
        expect(topical?._tag).toBe("Withholding")
        if (topical?._tag === "Withholding") expect(topical.reason).toBe("no-title")
        // The decisive half: no title search left the machine at all, so
        // nothing address-shaped was sent as a query. (The Linked Lookups —
        // Hacker News' and Reddit's — legitimately carry the address; that is
        // their question.) The withhold sits UPSTREAM of every connector, so
        // Reddit's title search is held back by the same check on the same
        // path, not by a per-connector guard it might lack.
        expect(topicalAsks(asked)).toHaveLength(0)
        expect(linkedAsks(asked).length).toBeGreaterThan(0)
      }))
  })

  it("renders the withholding as words, not as a hang", async () => {
    await opened(({ ref }) =>
      Effect.gen(function*() {
        const reading = yield* SubscriptionRef.get(ref)
        const panel = panelOf(reading, NOW, AGREED)
        expect(panel.stillLooking).toBe(false)
        const account = panel.accounts.find((a) => a.place === "Hacker News · by title")
        expect(account?.standing).toBe("not asked — still reading the page's title")
      }))
  })

  it("RE-FIRES the Topical Lookup when the real title lands, and only that", async () => {
    await opened(({ asked, board, ref }) =>
      Effect.gen(function*() {
        const linkedBefore = linkedAsks(asked).length
        // The correction, exactly as `background.ts` delivers it off the
        // `retitled` stream: same tab, same address, the parsed title.
        yield* board.retitle(1, ADDRESS, TITLE)
        const after = yield* readingWhen(ref, (reading) => {
          const topical = hnTopicalOf(reading)
          return topical !== undefined && topical._tag !== "Withholding" &&
            topical._tag !== "Pending" && topical._tag !== "Asking"
        })
        // The re-ask went out, keyed on the real title.
        const topical = topicalAsks(asked)
        expect(topical.length).toBeGreaterThan(0)
        expect(topical.some((u) => u.includes(encodeURIComponent("open source").replace(/%20/g, "+")) || u.includes("open+source"))).toBe(true)
        // And on NOTHING address-shaped.
        expect(topical.some((u) => u.includes("nature.com"))).toBe(false)
        // The Linked Lookups that already answered were not paid for again.
        expect(linkedAsks(asked)).toHaveLength(linkedBefore)
        // The Place now carries the answer the reader was owed.
        expect(hnTopicalOf(after)?._tag).toBe("Answered")
      }))
  })

  it("re-asks nothing when the 'correction' is another placeholder", async () => {
    await opened(({ asked, board }) =>
      Effect.gen(function*() {
        yield* board.retitle(1, ADDRESS, "nature.com/articles/d41586-024-02012-5")
        yield* board.retitle(1, ADDRESS, ADDRESS)
        yield* board.retitle(1, ADDRESS, "   ")
        yield* Effect.sleep("300 millis")
        expect(topicalAsks(asked)).toHaveLength(0)
      }))
  })

  it("re-asks nothing when the title was real all along and the Topical already answered", async () => {
    await opened(
      ({ asked, board }) =>
        Effect.gen(function*() {
          const before = topicalAsks(asked).length
          expect(before).toBeGreaterThan(0)
          yield* board.retitle(1, ADDRESS, TITLE)
          yield* Effect.sleep("300 millis")
          // The Place is settled at an answer; a correction has nothing to do.
          expect(topicalAsks(asked)).toHaveLength(before)
        }),
      TITLE
    )
  })

  it("keeps the address out of the title query even when the reader insists", async () => {
    await opened(({ asked, board, ref }) =>
      Effect.gen(function*() {
        // ADR 0005: insisting re-runs the withheld Places. With the title still
        // missing, the Topical Places must re-withhold — visibly — rather than
        // send the placeholder to a Network.
        yield* board.insist(1)
        yield* Effect.sleep("400 millis")
        expect(topicalAsks(asked)).toHaveLength(0)
        const reading = yield* SubscriptionRef.get(ref)
        expect(hnTopicalOf(reading)?._tag).toBe("Withholding")
      }))
  })

  it("a second tab arriving with the real title corrects the shared Enquiry", async () => {
    await opened(({ asked, board }) =>
      Effect.gen(function*() {
        const linkedBefore = linkedAsks(asked).length
        // A reader opens the same article in another tab once the page has a
        // title — the ordinary shape of a warm rejoin. The shared Enquiry's
        // withheld Topical is re-asked; its answered Linked Lookups are not.
        yield* board.sight(2, ADDRESS, TITLE, { _tag: "Elsewhere" } as Reading["arrival"])
        const ref2 = yield* board.open(2)
        yield* readingWhen(ref2, (reading) => {
          const topical = hnTopicalOf(reading)
          return topical !== undefined && topical._tag === "Answered"
        })
        expect(topicalAsks(asked).length).toBeGreaterThan(0)
        expect(linkedAsks(asked)).toHaveLength(linkedBefore)
      }))
  })
})
