/**
 * The vertical slice, driven through the graph as it actually ships.
 *
 * Everything between a navigation event and a rendered Panel is real here: the
 * same `ReadingWatch` that settles a redirect chain, the same canonicalization
 * rules that mint a Subject URL, the same `LookupPolicy` that decides whether
 * to ask, the same Hacker News connector, the same Coverage, the same
 * `panelOf`. Only two things are substituted, and both are the platform rather
 * than the product: the WebExtension API is the package's own double, and the
 * wire answers from a recorded Algolia body.
 *
 * That substitution is the whole point of `Pipeline.on` taking its platform and
 * its client as arguments. A test that assembled its own lookalike graph would
 * stay green while the shipped wiring rotted — which is the failure this file
 * exists to make impossible, because every seam it crosses was reconciled
 * between packages written independently and none of them was checked against
 * the others until now.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { isSettled } from "@parle/domain/Coverage"
import { Arrival } from "@parle/domain/Subject"
import { ReadingWatch } from "@parle/browser/ReadingWatch"
import { makeDouble, WebExt } from "@parle/browser/WebExtApi"
import { type Exchange, recording } from "@parle/networks/Recording"
import { hackerNewsLinked, hackerNewsTopical } from "@parle/networks/Recorded"
import { Board } from "../reading/Board.ts"
import type { Reading } from "../reading/Reading.ts"
import { everyNetworkOn, noProvider, type Surroundings } from "../reading/Surroundings.ts"
import { Settings, withAutomatic } from "../settings/Settings.ts"
import { anyRows, badgeOf, type Panel } from "../view/Panel.ts"
import { panelOf } from "../view/panelOf.ts"
import * as Pipeline from "./Pipeline.ts"

/** The page the recorded Algolia bodies are about. */
const ADDRESS = "https://www.nature.com/articles/d41586-024-02012-5"
const TITLE = "Not all 'open source' AI models are open"
const NOW = 1_800_000_000_000

/**
 * A reader who has read the disclosure and said yes.
 *
 * Written out rather than defaulted, because a fresh install is deliberately
 * NOT this: `Settings.firstRun` has `decided: false`, and `Choices.choicesOf`
 * turns that into manual mode, so nothing automatic fires until the answer
 * exists. Every test below that expects a Lookup has to say so — which is the
 * point, and `refuses to look anything up before the reader has been asked`
 * is the test that holds the other side of it.
 */
const AGREED: Surroundings = { decision: "automatic", provider: noProvider, networks: everyNetworkOn, index: { _tag: "Absent" } }

/** Answer the first-run question the way a reader who said yes would. */
const agree = Effect.gen(function*() {
  const settings = yield* Settings
  yield* settings.change((held) => withAutomatic(held, true))
})

const json = (body: string): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "application/json" }
})

/** Algolia answers; nothing else does. Reddit 403s, exactly as it does live here. */
const algolia = (url: string): Exchange => {
  if (!url.includes("hn.algolia.com")) {
    return { status: 403, body: "<html>blocked</html>", headers: { "content-type": "text/html" } }
  }
  return json(url.includes("restrictSearchableAttributes") ? hackerNewsLinked : hackerNewsTopical)
}

interface Run {
  readonly panel: Panel
  readonly asked: ReadonlyArray<string>
  readonly reading: Reading
}

/**
 * Push one navigation at the platform double and read the Panel that comes out.
 *
 * Waits for Coverage to SETTLE rather than for a duration: every Place reaching
 * a terminal state is an observable fact about the pipeline, and a sleep long
 * enough to be reliable on a loaded machine is long enough to hide a hang.
 */
const readingOf = async (
  address: string,
  answer: (url: string) => Exchange = algolia
): Promise<Run> => {
  const double = makeDouble()
  const wire = recording(answer)

  const panel = await Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      const watch = yield* ReadingWatch
      const board = yield* Board
      yield* agree

      const boundaries = yield* Effect.forkScoped(
        Stream.runForEach(watch.readings, (boundary) =>
          board.sight(boundary.tab, boundary.address, TITLE, boundary.arrival))
      )

      yield* Effect.promise(() => double.watched)
      double.sight({ address, tabId: 1 })

      const ref = yield* board.open(1)
      // The Reading only becomes an Enquiry once the boundary has settled, so
      // "settled Coverage" is the single condition that covers both waits.
      const done = yield* SubscriptionRef.changes(ref).pipe(
        Stream.filter((reading) =>
          reading.standing._tag === "Excluded" ||
          (reading.standing._tag === "Enquiring" &&
            isSettled(reading.standing.knowledge.coverage))
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("10 seconds")
      )
      yield* Fiber.interrupt(boundaries)

      const reading = done[0]
      if (reading === undefined) throw new Error("the Reading never settled")
      return { panel: panelOf(reading, NOW, AGREED), asked: wire.asked, reading }
    })).pipe(
      Effect.provide(Pipeline.on(WebExt.doubleLayer(double), wire.layer))
    )
  )

  return panel
}

describe("a page with Discussions", () => {
  it("goes from a navigation event to rows the panel can draw", async () => {
    const { panel } = await readingOf(ADDRESS)

    expect(anyRows(panel)).toBe(true)
    // The strong tier, and only from hits whose own submitted URL matched.
    //
    // Hacker News really did take this article five times: one thread with 18
    // comments, one with 3, and three postings nobody replied to at all. That
    // is the ordinary shape of a Hacker News answer rather than a curiosity of
    // this fixture, and drawing five rows made the reader sort them. The three
    // silent ones are folded into a count on the loudest — the fact of the
    // repetition survives, and neither conversation does.
    expect(panel.linked.length).toBe(2)
    expect(panel.linked.every((row) => row.commentCount > 0)).toBe(true)
    expect(panel.linked[0]?.alsoSubmitted).toBe(3)
    expect(panel.linked[1]?.alsoSubmitted).toBe(0)
    expect(panel.linked[0]?.title).toBe(
      "Not all 'open source' AI models are open: here's a ranking"
    )
    expect(panel.linked[0]?.score).toBe(127)
    expect(panel.linked[0]?.commentCount).toBe(18)
    expect(panel.linked[0]?.permalink).toBe("https://news.ycombinator.com/item?id=40786237")
    // An age at all means `created_at_i` survived the connector, the sink, the
    // Gathered store and the fold. A blank one means it did not.
    expect(panel.linked[0]?.age).not.toBe("")
    expect(badgeOf(panel)).not.toBe("")
  })

  it("accounts for every Place, including the ones nobody answered", async () => {
    const { panel } = await readingOf(ADDRESS)

    // Recall, plus two Questions each for Hacker News, Reddit and X.
    expect(panel.accounts).toHaveLength(7)
    expect(panel.accounts.every((account) => account.standing !== "")).toBe(true)
    expect(panel.stillLooking).toBe(false)
  })

  it("says Reddit refused rather than showing it as nothing found", async () => {
    // A 403 from Reddit is the ORDINARY outcome, not an edge case, and the one
    // thing it must never become is a Silence — a Silence is evidence about the
    // world and is the only outcome we are allowed to cache.
    const { panel } = await readingOf(ADDRESS)
    const reddit = panel.accounts.filter((account) => account.place.startsWith("Reddit"))

    expect(reddit).toHaveLength(2)
    expect(reddit.every((account) => account.tone === "refused")).toBe(true)
  })

  it("never asks X, and says why in the panel", async () => {
    // ADR 0001: X is compiled out of this build, so the request path is not in
    // the artifact at all. The reader is still owed the reason.
    const { panel, asked } = await readingOf(ADDRESS)

    expect(asked.some((url) => url.includes("x.com") || url.includes("twitter"))).toBe(false)
    const x = panel.accounts.filter((account) => account.place.startsWith("X"))
    expect(x).toHaveLength(2)
    expect(x.every((account) => account.tone === "withheld")).toBe(true)
    expect(x[0]?.standing).toMatch(/not in this build/)
  })

  it("asks about the canonicalized address, not the one with the tracking on it", async () => {
    // The Subject URL is what gets sent to a third party. A campaign parameter
    // riding along is both a worse cache key and more disclosure than the page
    // itself requires.
    const { asked } = await readingOf(`${ADDRESS}?utm_source=newsletter&utm_medium=email`)
    const searches = asked.filter((url) => url.includes("hn.algolia.com"))

    expect(searches.length).toBeGreaterThan(0)
    expect(searches.some((url) => url.includes("utm_source"))).toBe(false)
    expect(searches.some((url) => url.includes("utm_medium"))).toBe(false)
    // The canonical form drops `www.` as well, so this is the article path
    // rather than the address the reader's tab was showing.
    expect(searches.some((url) => url.includes("d41586-024-02012-5"))).toBe(true)
  })
})

describe("a page we do not look up", () => {
  it("asks nobody about an address that is not a public web page", async () => {
    const { panel, asked } = await readingOf("http://192.168.1.1/admin")

    expect(asked).toHaveLength(0)
    expect(panel.restraint).not.toBeNull()
    expect(badgeOf(panel)).toBe("")
  })

  it("still mints a Subject for an EXCLUDED page, and says why per Place", async () => {
    // The difference matters: an excluded page is one the reader can override,
    // so it has to have a Subject, a Coverage and a rendered reason. Collapsing
    // it to "not a page" would make the restraint invisible and unoverridable,
    // which is the failure mode ADR 0005 is written against.
    const { panel, asked } = await readingOf("https://mail.proton.me/u/0/inbox")

    expect(asked).toHaveLength(0)
    expect(panel.accounts).toHaveLength(7)
    expect(panel.accounts.filter((account) => account.tone === "withheld")).toHaveLength(6)
    expect(panel.restraint?.kind).toBe("excluded")
  })
})

describe("the boundary itself", () => {
  it("collapses a redirect chain into one Reading at the destination", async () => {
    const double = makeDouble()
    const wire = recording(algolia)

    const asked = await Effect.runPromise(
      Effect.scoped(Effect.gen(function*() {
        const watch = yield* ReadingWatch
        const board = yield* Board
        yield* agree
        const boundaries = yield* Effect.forkScoped(
          Stream.runForEach(watch.readings, (boundary) =>
            board.sight(boundary.tab, boundary.address, TITLE, boundary.arrival))
        )

        yield* Effect.promise(() => double.watched)
        // One click: a shortener, a consent interstitial, then the article.
        double.sight({ address: "https://t.co/xY7abc", tabId: 1 })
        double.sight({ address: "https://www.nature.com/consent?next=/articles", tabId: 1 })
        double.sight({ address: ADDRESS, tabId: 1 })

        const ref = yield* board.open(1)
        yield* SubscriptionRef.changes(ref).pipe(
          Stream.filter((reading) =>
            reading.standing._tag === "Enquiring" &&
            isSettled(reading.standing.knowledge.coverage)
          ),
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("10 seconds")
        )
        yield* Fiber.interrupt(boundaries)
        return wire.asked
      })).pipe(Effect.provide(Pipeline.on(WebExt.doubleLayer(double), wire.layer)))
    )

    // Three Lookups for one page view — one per hop — is three times the
    // disclosure the reader agreed to, and two of the three are about pages
    // they never saw.
    // `t.co` on its own is a substring of `reddit.com`; the shortcode is not.
    expect(asked.some((url) => url.includes("xY7abc"))).toBe(false)
    expect(asked.some((url) => url.includes("consent"))).toBe(false)
    expect(asked.some((url) => url.includes("d41586-024-02012-5"))).toBe(true)
  })

  it("mints nothing for a sub-frame", async () => {
    const double = makeDouble()
    const wire = recording(algolia)

    const standing = await Effect.runPromise(
      Effect.scoped(Effect.gen(function*() {
        const watch = yield* ReadingWatch
        const board = yield* Board
        yield* agree
        const boundaries = yield* Effect.forkScoped(
          Stream.runForEach(watch.readings, (boundary) =>
            board.sight(boundary.tab, boundary.address, TITLE, boundary.arrival))
        )
        yield* Effect.promise(() => double.watched)
        double.sight({ address: "https://www.youtube-nocookie.com/embed/dQw4", frameId: 3, tabId: 1 })
        yield* Effect.sleep("900 millis")
        yield* Fiber.interrupt(boundaries)
        const ref = yield* board.open(1)
        const reading = yield* SubscriptionRef.get(ref)
        return reading.standing._tag
      })).pipe(Effect.provide(Pipeline.on(WebExt.doubleLayer(double), wire.layer)))
    )

    expect(standing).toBe("Unopened")
    expect(wire.asked).toHaveLength(0)
  })
})

describe("two tabs on one page", () => {
  it("share one Enquiry rather than each paying for their own", async () => {
    // The Enquiry belongs to the Subject, not to the tab. Two tabs open on the
    // same article — an ordinary thing a reader does — must not double the
    // disclosure, and `RcMap` keyed on the Subject URL is what makes that
    // structural rather than a deduplication anyone can forget.
    const double = makeDouble()
    const wire = recording(algolia)

    await Effect.runPromise(
      Effect.scoped(Effect.gen(function*() {
        const watch = yield* ReadingWatch
        const board = yield* Board
        yield* agree
        const boundaries = yield* Effect.forkScoped(
          Stream.runForEach(watch.readings, (boundary) =>
            board.sight(boundary.tab, boundary.address, TITLE, boundary.arrival))
        )

        yield* Effect.promise(() => double.watched)
        double.sight({ address: ADDRESS, tabId: 1 })
        double.sight({ address: ADDRESS, tabId: 2 })

        const settledIn = (tabId: number) =>
          Effect.flatMap(board.open(tabId), (ref) =>
            SubscriptionRef.changes(ref).pipe(
              Stream.filter((reading) =>
                reading.standing._tag === "Enquiring" &&
                isSettled(reading.standing.knowledge.coverage)
              ),
              Stream.take(1),
              Stream.runCollect,
              Effect.timeout("10 seconds")
            ))

        yield* Effect.all([settledIn(1), settledIn(2)], { concurrency: 2, discard: true })
        yield* Fiber.interrupt(boundaries)
      })).pipe(Effect.provide(Pipeline.on(WebExt.doubleLayer(double), wire.layer)))
    )

    const searches = wire.asked.filter((url) => url.includes("hn.algolia.com"))
    expect(searches.length).toBeGreaterThan(0)
    // Every distinct question asked exactly once. Two tabs each running their
    // own Enquiry would ask each of them twice, which is the bug this is here
    // to catch and which nothing else in the product would report.
    expect(searches.length).toBe(new Set(searches).size)
  })

  it("does not let one tab's arrival evidence leak into another's", async () => {
    const { reading } = await readingOf(ADDRESS)
    expect(reading.arrival).toEqual(Arrival.cases.Elsewhere.make({}))
  })
})
