/**
 * The bound, and the seam.
 *
 * These are the two properties `Harvest.test.ts` exercises end to end and
 * cannot pin precisely: eviction needs more rows than a fixture has, and the
 * read-through view's behaviour on a store that refuses is a case no fixture
 * produces at all.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { Storage as Bytes } from "@parle/browser/Storage"
import { makeDouble, WebExt } from "@parle/browser/WebExtApi"
import { CACHE_ROOT, LocalCache, readThrough } from "./LocalCache.ts"

const overDouble = (bound: { entries: number; entryBytes: number }) => {
  const double = makeDouble()
  const layer = LocalCache.layerWith(bound).pipe(
    Layer.provide(Bytes.layer),
    Layer.provide(WebExt.doubleLayer(double))
  )
  return { double, layer }
}

const key = (n: number) => `${CACHE_ROOT}mentions/row-${n}`

describe("the bound the iOS build is sized for", () => {
  it("evicts the oldest harvest first, and never holds more than the bound", async () => {
    const { double, layer } = overDouble({ entries: 3, entryBytes: 1024 })

    await Effect.runPromise(
      // SAFETY: the test layer provides every service the scoped program requires.
      Effect.scoped(Effect.gen(function*() {
        const cache = yield* LocalCache
        for (let n = 0; n < 6; n++) yield* cache.kept.set(key(n), `row ${n}`)
      })).pipe(Effect.provide(layer)) as Effect.Effect<void>
    )

    const held = [...double.held.keys()].filter((k) => k.startsWith(CACHE_ROOT))
    expect(held).toHaveLength(3)
    // FIFO, deliberately, and not LRU: recording an access time means a write on
    // every read, which on the constraining platform makes reading the cache —
    // the free, disclosure-less thing — cost as much as filling it.
    expect(held).toEqual([key(3), key(4), key(5)])
  })

  it("refuses a single row larger than the per-entry bound rather than letting it spend the budget", async () => {
    const { double, layer } = overDouble({ entries: 100, entryBytes: 16 })

    await Effect.runPromise(
      // SAFETY: the test layer provides every service the scoped program requires.
      Effect.scoped(Effect.gen(function*() {
        const cache = yield* LocalCache
        yield* cache.kept.set(key(1), "short")
        yield* cache.kept.set(key(2), "x".repeat(64))
      })).pipe(Effect.provide(layer)) as Effect.Effect<void>
    )

    expect([...double.held.keys()].filter((k) => k.startsWith(CACHE_ROOT))).toEqual([key(1)])
  })

  it("counts what is already on disk, so a restarted worker does not start the bound again", async () => {
    const { double, layer } = overDouble({ entries: 2, entryBytes: 1024 })
    double.held.set(key(0), new TextEncoder().encode("older"))
    double.held.set(key(1), new TextEncoder().encode("older"))

    await Effect.runPromise(
      // SAFETY: the test layer provides every service the scoped program requires.
      Effect.scoped(Effect.gen(function*() {
        const cache = yield* LocalCache
        yield* cache.kept.set(key(2), "new")
      })).pipe(Effect.provide(layer)) as Effect.Effect<void>
    )

    const held = [...double.held.keys()].filter((k) => k.startsWith(CACHE_ROOT))
    expect(held).toHaveLength(2)
    expect(held).toContain(key(2))
    expect(held).not.toContain(key(0))
  })
})

describe("the view the Enquiry gets", () => {
  it("reads what Harvest wrote and writes nothing back to it", async () => {
    const { double, layer } = overDouble({ entries: 100, entryBytes: 1024 })

    const read = await Effect.runPromise(
      // SAFETY: the test layer provides every service the scoped program requires.
      Effect.scoped(Effect.gen(function*() {
        const cache = yield* LocalCache
        yield* cache.kept.set(key(1), "harvested")

        const enquiry = readThrough(cache.kept)
        const before = yield* enquiry.get(key(1))
        yield* enquiry.set(key(2), "looked up")
        const after = yield* enquiry.get(key(2))
        return { before, after }
      })).pipe(Effect.provide(layer)) as Effect.Effect<{
        before: Option.Option<string>
        after: Option.Option<string>
      }>
    )

    // The harvested row is readable through the view...
    expect(Option.getOrNull(read.before)).toBe("harvested")
    // ...the Lookup-derived one is readable only from the heap...
    expect(Option.getOrNull(read.after)).toBe("looked up")
    // ...and it is not on the reader's disk. This assertion is ADR 0012's
    // disclosure argument, stated in bytes.
    expect(double.held.has(key(2))).toBe(false)
    expect(double.held.has(key(1))).toBe(true)
  })

  it("removes through to the disk, because forgetting must be able to forget", async () => {
    const { double, layer } = overDouble({ entries: 100, entryBytes: 1024 })

    await Effect.runPromise(
      // SAFETY: the test layer provides every service the scoped program requires.
      Effect.scoped(Effect.gen(function*() {
        const cache = yield* LocalCache
        yield* cache.kept.set(key(1), "harvested")
        const enquiry = readThrough(cache.kept)
        yield* enquiry.remove(key(1))
        // A removal that only cleared the heap would be undone by the very next
        // read falling through — a "forget" the reader watched work and then
        // saw come back.
        expect(Option.isNone(yield* enquiry.get(key(1)))).toBe(true)
      })).pipe(Effect.provide(layer)) as Effect.Effect<void>
    )

    expect(double.held.has(key(1))).toBe(false)
  })

  it("enumerates both halves, so a scoped forget reaches the rows this worker wrote", async () => {
    const { layer } = overDouble({ entries: 100, entryBytes: 1024 })

    const keys = await Effect.runPromise(
      // SAFETY: the test layer provides every service the scoped program requires.
      Effect.scoped(Effect.gen(function*() {
        const cache = yield* LocalCache
        yield* cache.kept.set(key(1), "harvested")
        const enquiry = readThrough(cache.kept)
        yield* enquiry.set(key(2), "looked up")
        return yield* enquiry.keys(CACHE_ROOT)
      })).pipe(Effect.provide(layer)) as Effect.Effect<ReadonlyArray<string>>
    )

    expect([...keys].sort()).toEqual([key(1), key(2)])
  })
})
