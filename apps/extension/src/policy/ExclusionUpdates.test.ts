/**
 * The feed's whole contract: nothing before consent, at most one fetch a day,
 * garbage held or served degrades to the seed, and what one worker fetches
 * the next worker decides over.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Storage as Kept } from "@parle/memory/Storage"
import { type Exchange, recording } from "@parle/networks/Recording"
import { describe, expect, it } from "vitest"
import { firstRun, type ReaderSettings, Settings } from "../settings/Settings.ts"
import { ExclusionUpdates, FEED_URL, HELD_KEY } from "./ExclusionUpdates.ts"

const settingsOf = (decided: boolean): Layer.Layer<Settings> =>
  Layer.succeed(Settings)(Settings.of({
    current: Effect.succeed({ ...firstRun, decided } as ReaderSettings),
    change: () => Effect.succeed({ ...firstRun, decided } as ReaderSettings)
  }))

const artifact = { version: 1, entries: [{ domain: "missed.example", category: "banking" }] }
const served: Exchange = {
  status: 200,
  body: JSON.stringify(artifact),
  headers: { "content-type": "application/json" }
}

const run = async (
  decided: boolean,
  backing: Map<string, string>,
  answer: (url: string) => Exchange = () => served
) => {
  const wire = recording(answer)
  const feed = ExclusionUpdates.layer.pipe(
    Layer.provide(Layer.mergeAll(Kept.memory(backing), wire.layer, settingsOf(decided)))
  )
  const held = await Effect.runPromise(
    Effect.gen(function*() {
      const updates = yield* ExclusionUpdates
      yield* updates.freshen
      return yield* updates.held
    }).pipe(Effect.provide(feed))
  )
  return { held, asked: [...wire.asked] }
}

describe("ExclusionUpdates", () => {
  it("does not ask the network anything before the first-run question is answered", async () => {
    const { asked, held } = await run(false, new Map())
    expect(asked).toEqual([])
    expect(held).toBeUndefined()
  })

  it("fetches once consent exists, and the fetched artifact is held for the next worker", async () => {
    const backing = new Map<string, string>()
    const { asked, held } = await run(true, backing)
    expect(asked).toEqual([FEED_URL])
    expect(held).toEqual(artifact)
    expect(backing.has(HELD_KEY)).toBe(true)
  })

  it("a fresh held copy means no request at all", async () => {
    const backing = new Map([[
      HELD_KEY,
      JSON.stringify({ fetchedAt: Date.now(), artifact })
    ]])
    const { asked, held } = await run(true, backing)
    expect(asked).toEqual([])
    expect(held).toEqual(artifact)
  })

  it("a stale held copy is refreshed", async () => {
    const backing = new Map([[
      HELD_KEY,
      JSON.stringify({
        fetchedAt: Date.now() - 25 * 60 * 60 * 1000,
        artifact: { version: 0, entries: [] }
      })
    ]])
    const { asked, held } = await run(true, backing)
    expect(asked).toEqual([FEED_URL])
    expect(held).toEqual(artifact)
  })

  it("a refused fetch and a garbage body both leave what was already held", async () => {
    const refusals: ReadonlyArray<Exchange> = [
      { status: 503, body: "", headers: {} },
      { status: 200, body: "<!doctype html>an interstitial", headers: { "content-type": "text/html" } }
    ]
    for (const refusal of refusals) {
      const backing = new Map<string, string>()
      const { held } = await run(true, backing, () => refusal)
      expect(held).toBeUndefined()
      expect(backing.has(HELD_KEY)).toBe(false)
    }
  })

  it("garbage on disk reads as no artifact rather than failing", async () => {
    const backing = new Map([[HELD_KEY, "{corrupt"]])
    const { held } = await run(true, backing)
    // The corrupt copy also fails the freshness read, so the fetch ran and
    // wrote a good one over it.
    expect(held).toEqual(artifact)
  })
})
