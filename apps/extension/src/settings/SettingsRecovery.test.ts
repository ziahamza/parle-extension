/**
 * What a corrupt settings document costs the reader — found by the torture run
 * (`e2e/torture.e2e.ts`, scenario "storage full / corrupt").
 *
 * The file header's promise is that a storage fault falls back to the last
 * value actually read, never to the defaults, because the defaults are
 * permissive. Before this was pinned down, an UNREADABLE document — garbage
 * bytes at the key, which any crashed write can leave — was quietly treated as
 * a fresh install: `current` decoded it to `firstRun`, poisoned `lastGood`
 * with that, and the reader's Network switches, exclusions and their answer to
 * the first-run question were all un-made in one read. The one saving grace was
 * `decided: false` keeping anything automatic from firing; everything the
 * reader had chosen was still gone.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { Storage } from "@parle/browser/Storage"
import { makeDouble, WebExt, type WebExtApi } from "@parle/browser/WebExtApi"
import {
  firstRun,
  readDocument,
  Settings,
  SETTINGS_KEY,
  withAutomatic,
  withNetwork,
  withPause
} from "./Settings.ts"

const over = (double: WebExtApi): Layer.Layer<Settings | Storage> => {
  const bytes = Storage.layer.pipe(Layer.provide(WebExt.doubleLayer(double)))
  return Layer.mergeAll(Settings.layer.pipe(Layer.provide(bytes)), bytes)
}

/** One worker lifetime over the shared disk. */
const lifetime = <A>(double: WebExtApi, use: Effect.Effect<A, never, Settings | Storage>): Promise<A> =>
  Effect.runPromise(use.pipe(Effect.provide(over(double))))

const corrupt = Effect.gen(function*() {
  const store = yield* Storage
  yield* store.set(SETTINGS_KEY, "{ not a document at all ][").pipe(
    Effect.catch(() => Effect.void)
  )
})

describe("a corrupt settings document", () => {
  it("falls back to the last value actually read, not to the defaults", async () => {
    const double = makeDouble()
    const seen = await lifetime(
      double,
      Effect.gen(function*() {
        const settings = yield* Settings
        // The reader answered the question, switched Reddit off and paused a
        // site — the three kinds of thing a fallback to defaults would undo.
        yield* settings.change((held) => withPause(withNetwork(withAutomatic(held, true), "reddit", false), "example.com"))
        yield* corrupt
        return yield* settings.current
      })
    )

    expect(seen.decided).toBe(true)
    expect(seen.automatic).toBe(true)
    expect(seen.networks.reddit).toBe(false)
    expect(seen.paused).toContain("example.com")
  })

  it("read by a fresh lifetime, degrades to asking nobody — never to permissive defaults", async () => {
    // Across a worker restart there is no last-known-good to fall back to; the
    // floor is `firstRun`, and what makes that floor safe rather than
    // permissive is `decided: false` — nothing automatic runs until the reader
    // is asked again. This test is the record of that judgement.
    const double = makeDouble()
    await lifetime(
      double,
      Effect.gen(function*() {
        const settings = yield* Settings
        yield* settings.change((held) => withAutomatic(held, true))
        yield* corrupt
      })
    )

    const seen = await lifetime(
      double,
      Effect.gen(function*() {
        const settings = yield* Settings
        return yield* settings.current
      })
    )
    expect(seen).toEqual(firstRun)
    expect(seen.decided).toBe(false)
  })

  it("does not stop the reader's next edit from writing a clean document", async () => {
    const double = makeDouble()
    const seen = await lifetime(
      double,
      Effect.gen(function*() {
        const settings = yield* Settings
        yield* corrupt
        yield* settings.change((held) => withAutomatic(held, true))
        return yield* settings.current
      })
    )

    expect(seen.decided).toBe(true)
    expect(seen.automatic).toBe(true)
  })
})

describe("readDocument", () => {
  it("reads a document any build of ours wrote", () => {
    expect(Option.isSome(readDocument(JSON.stringify({ automatic: false, decided: true })))).toBe(true)
    expect(Option.isSome(readDocument("{}"))).toBe(true)
  })

  it("refuses what no build of ours wrote", () => {
    expect(Option.isNone(readDocument("!!! not json"))).toBe(true)
    expect(Option.isNone(readDocument("[1,2,3]"))).toBe(true)
    expect(Option.isNone(readDocument('"a string"'))).toBe(true)
  })
})
