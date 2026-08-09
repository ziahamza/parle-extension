/**
 * The whole product, against the real internet. Opt in with `PARLE_LIVE=1`.
 *
 * Skipped by default: a suite that goes red when a third party has a bad
 * afternoon teaches everyone to ignore red. It is kept because everything else
 * in this app is checked against a recorded body, and a recording can only ever
 * prove we still read the fields we recorded. This is what would catch Algolia
 * renaming one, or changing its URL-search semantics — neither of which breaks
 * a schema, and both of which render as a panel that quietly finds nothing.
 *
 * Hacker News is the only Network this can be done for, and that is not an
 * accident of our test setup: Algolia is keyless and CORS-open to every origin,
 * Reddit answers 403 to any datacenter IP (which is the whole reason ADR 0013's
 * tier chain exists), and X needs the reader's own session.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { isSettled } from "@parle/domain/Coverage"
import { ReadingWatch } from "@parle/browser/ReadingWatch"
import { makeDouble, WebExt } from "@parle/browser/WebExtApi"
import * as Client from "@parle/net/Client"
import { Board } from "../reading/Board.ts"
import { everyNetworkOn, noProvider, type Surroundings } from "../reading/Surroundings.ts"
import { Settings, withAutomatic } from "../settings/Settings.ts"
import { panelOf } from "../view/panelOf.ts"
import * as Pipeline from "./Pipeline.ts"

declare const process: { readonly env: Record<string, string | undefined> } | undefined

const live = typeof process !== "undefined" && process.env["PARLE_LIVE"] === "1"

/** A reader who has read the disclosure and said yes. Nothing fires without it. */
const AGREED: Surroundings = { decision: "automatic", provider: noProvider, networks: everyNetworkOn, index: { _tag: "Absent" } }

const agree = Effect.gen(function*() {
  const settings = yield* Settings
  yield* settings.change((held) => withAutomatic(held, true))
})

/** A page with several Hacker News submissions and a stable address. */
const ADDRESS = "https://www.nature.com/articles/d41586-024-02012-5"
const TITLE = "Not all 'open source' AI models are open"

describe.skipIf(!live)("against the real Hacker News", () => {
  it("renders real Discussions for a real page", { timeout: 60_000 }, async () => {
    const double = makeDouble()

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
        double.sight({ address: ADDRESS, tabId: 1 })

        const ref = yield* board.open(1)
        const done = yield* SubscriptionRef.changes(ref).pipe(
          Stream.filter((reading) =>
            reading.standing._tag === "Enquiring" &&
            isSettled(reading.standing.knowledge.coverage)
          ),
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("45 seconds")
        )
        yield* Fiber.interrupt(boundaries)

        const reading = done[0]
        if (reading === undefined) throw new Error("the Reading never settled")
        return panelOf(reading, Date.now(), AGREED)
        // The client is the one the extension ships with, pacing and all — so a
        // bucket sized too small for the alias fan-out shows up here as a test
        // that times out rather than as an extension that feels slow.
      })).pipe(Effect.provide(Pipeline.on(WebExt.doubleLayer(double), Client.layer)))
    )

    expect(panel.linked.length).toBeGreaterThan(0)
    for (const row of panel.linked) {
      expect(row.title.length).toBeGreaterThan(0)
      expect(row.permalink).toMatch(/^https:\/\/news\.ycombinator\.com\/item\?id=\d+$/)
      expect(row.age).not.toBe("")
    }

    // Hacker News answering at all is the bar. Reddit refusing from a
    // datacenter IP is the expected outcome and must read as a Refusal.
    const hackerNews = panel.accounts.filter((a) => a.place.startsWith("Hacker News"))
    expect(hackerNews.some((a) => a.tone === "found")).toBe(true)
    expect(panel.stillLooking).toBe(false)
  })

  it("is quiet, not broken, about a page nobody has discussed", { timeout: 60_000 }, async () => {
    const double = makeDouble()
    const nowhere = `https://example.com/parle/${Date.now()}/nothing-here`

    const panel = await Effect.runPromise(
      Effect.scoped(Effect.gen(function*() {
        const watch = yield* ReadingWatch
        const board = yield* Board
        yield* agree
        const boundaries = yield* Effect.forkScoped(
          Stream.runForEach(watch.readings, (boundary) =>
            board.sight(boundary.tab, boundary.address, "nothing at all", boundary.arrival))
        )
        yield* Effect.promise(() => double.watched)
        double.sight({ address: nowhere, tabId: 1 })
        const ref = yield* board.open(1)
        const done = yield* SubscriptionRef.changes(ref).pipe(
          Stream.filter((reading) =>
            reading.standing._tag === "Enquiring" &&
            isSettled(reading.standing.knowledge.coverage)
          ),
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("45 seconds")
        )
        yield* Fiber.interrupt(boundaries)
        const reading = done[0]
        if (reading === undefined) throw new Error("the Reading never settled")
        return panelOf(reading, Date.now(), AGREED)
      })).pipe(Effect.provide(Pipeline.on(WebExt.doubleLayer(double), Client.layer)))
    )

    const hackerNews = panel.accounts.filter((a) => a.place.startsWith("Hacker News"))
    // Quiet, and specifically quiet: "nothing" is evidence about the world and
    // is the only outcome we would ever be allowed to cache. It must not be
    // reachable from a Refusal or a Garble.
    expect(hackerNews.some((a) => a.tone === "quiet")).toBe(true)
    expect(panel.linked).toHaveLength(0)
  })
})
