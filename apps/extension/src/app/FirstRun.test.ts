/**
 * A fresh install, driven through the graph as it actually ships.
 *
 * The claim this file exists to make checkable is the one the whole product
 * rests on: **before the reader has been shown what Parle sends and answered,
 * no address leaves the browser.** Everything else about the first-run screen
 * is copy, and copy over a decision already taken is not a disclosure.
 *
 * It is asserted on `wire.asked` — what actually went out — and not on what the
 * panel drew, for the same reason `Controls.test.ts` is: a screen that says
 * nothing is being looked up while requests are in flight is worse than no
 * screen, because it is a lie the reader has no way to catch.
 *
 * Only the platform and the wire are substituted. The settings document is read
 * through the same `Storage` seam the browser uses, and a fresh double holds no
 * document at all — which is exactly the state a newly installed extension is
 * in, rather than a state constructed to make the point.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { isSettled } from "@parle/domain/Coverage"
import { ReadingWatch } from "@parle/browser/ReadingWatch"
import { makeDouble, WebExt } from "@parle/browser/WebExtApi"
import { hackerNewsLinked, hackerNewsTopical } from "@parle/networks/Recorded"
import { type Exchange, recording } from "@parle/networks/Recording"
import { Board } from "../reading/Board.ts"
import type { Reading } from "../reading/Reading.ts"
import { noProvider, surroundingsOf } from "../reading/Surroundings.ts"
import { Settings, withAutomatic } from "../settings/Settings.ts"
import type { Panel } from "../view/Panel.ts"
import { panelOf } from "../view/panelOf.ts"
import * as Pipeline from "./Pipeline.ts"

const ADDRESS = "https://www.nature.com/articles/d41586-024-02012-5"
const OTHER = "https://www.nature.com/articles/d41586-024-99999-9"
const TITLE = "Not all 'open source' AI models are open"
const NOW = 1_800_000_000_000

const algolia = (url: string): Exchange =>
  url.includes("hn.algolia.com")
    ? {
      status: 200,
      body: url.includes("restrictSearchableAttributes") ? hackerNewsLinked : hackerNewsTopical,
      headers: { "content-type": "application/json" }
    }
    : { status: 403, body: "<html>blocked</html>", headers: { "content-type": "text/html" } }

const settled = (reading: Reading): boolean =>
  reading.standing._tag === "Excluded" ||
  (reading.standing._tag === "Enquiring" && isSettled(reading.standing.knowledge.coverage))

interface Run {
  readonly panel: Panel
  readonly asked: ReadonlyArray<string>
}

/**
 * Open pages as a reader who has just installed this, optionally answering the
 * first-run question partway through.
 *
 * `answerAfterFirst` is where the interesting case lives: the same worker, the
 * same store, one page browsed before the answer and one after.
 */
const firstRunWith = async (
  options: { readonly answerAfterFirst?: boolean } = {}
): Promise<{ readonly before: Run; readonly after: Run | null }> => {
  const double = makeDouble()
  const wire = recording(algolia)

  return await Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      const watch = yield* ReadingWatch
      const board = yield* Board
      const settings = yield* Settings

      const boundaries = yield* Effect.forkScoped(
        Stream.runForEach(watch.readings, (boundary) =>
          board.sight(boundary.tab, boundary.address, TITLE, boundary.arrival))
      )

      const open = (address: string, tabId: number) =>
        Effect.gen(function*() {
          double.sight({ address, tabId })
          const ref = yield* board.open(tabId)
          const done = yield* SubscriptionRef.changes(ref).pipe(
            Stream.filter(settled),
            Stream.take(1),
            Stream.runCollect,
            Effect.timeout("10 seconds")
          )
          const reading = done[0]
          if (reading === undefined) throw new Error("the Reading never settled")
          const around = surroundingsOf(yield* settings.current, { _tag: "Absent" }, noProvider)
          return { panel: panelOf(reading, NOW, around), asked: [...wire.asked] }
        })

      yield* Effect.promise(() => double.watched)
      const before = yield* open(ADDRESS, 1)

      if (options.answerAfterFirst !== true) {
        yield* Fiber.interrupt(boundaries)
        return { before, after: null }
      }

      yield* settings.change((held) => withAutomatic(held, true))
      const after = yield* open(OTHER, 2)
      yield* Fiber.interrupt(boundaries)
      return { before, after }
    })).pipe(Effect.provide(Pipeline.on(WebExt.doubleLayer(double), wire.layer)))
  )
}

describe("an install nobody has answered for yet", () => {
  it("sends nothing, anywhere, about a page the reader opens", async () => {
    const { before } = await firstRunWith()
    expect(before.asked).toHaveLength(0)
  })

  it("says so on the page, rather than looking like a page with nothing on it", async () => {
    const { before } = await firstRunWith()
    expect(before.panel.restraint?.kind).toBe("undecided")
    // Where the address would go, named before it goes, and that nothing has.
    expect(before.panel.restraint?.says).toMatch(/Hacker News and Reddit/)
    expect(before.panel.restraint?.says).toMatch(/has not started yet/)
    expect(before.panel.automatic).toBe(false)
  })

  it("accounts for every place it did not ask, so the claim is checkable", async () => {
    // The reader is owed the list even here — especially here. An install that
    // asks nothing and shows a blank panel is indistinguishable from one that
    // is broken.
    const { before } = await firstRunWith()
    expect(before.panel.accounts).toHaveLength(4)
    expect(before.panel.accounts.every((account) => account.standing !== "")).toBe(true)
  })
})

describe("once the reader has answered", () => {
  it("starts looking pages up, which is what makes the question meaningful", async () => {
    const { before, after } = await firstRunWith({ answerAfterFirst: true })

    expect(before.asked).toHaveLength(0)
    expect(after?.asked.some((url) => url.includes("hn.algolia.com"))).toBe(true)
    expect(after?.panel.restraint).toBeNull()
    expect(after?.panel.automatic).toBe(true)
  })

  it("does not go back and ask about the page it was told not to ask about", async () => {
    // Answering "yes" is permission for what happens next. It is not a
    // retroactive one covering pages already open in other tabs, which the
    // reader never asked about and may have forgotten are there.
    const { after } = await firstRunWith({ answerAfterFirst: true })
    expect(after?.asked.some((url) => url.includes("d41586-024-02012-5"))).toBe(false)
    expect(after?.asked.some((url) => url.includes("d41586-024-99999-9"))).toBe(true)
  })
})
