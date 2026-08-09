/**
 * What Storage has to get right is that bytes come back as the bytes that went
 * in. Everything else it does is a delegation.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { asText, Storage, StorageFault } from "./Storage.ts"
import { makeDouble, WebExt, type WebExtApi } from "./WebExtApi.ts"

const run = <A, E>(work: Effect.Effect<A, E, Storage>, platform: WebExtApi = makeDouble()) =>
  Effect.runPromise(
    Effect.result(
      Effect.provide(work, Storage.layer.pipe(Layer.provide(WebExt.doubleLayer(platform))))
    )
  )

describe("Storage", () => {
  it("returns the exact bytes it was given", async () => {
    // The bytes that broke `storage.local`: a zero, a high byte, and a byte
    // that is not valid UTF-8 on its own. JSON round-tripping mangles or
    // inflates all three.
    const bytes = new Uint8Array([0x00, 0x1f, 0x8b, 0xff, 0x41])

    const out = await run(
      Effect.gen(function*() {
        const storage = yield* Storage
        yield* storage.set("index/fuse", bytes)
        return yield* storage.get("index/fuse")
      })
    )

    expect(Result.isSuccess(out)).toBe(true)
    const held = Result.getOrThrow(out)
    expect(Option.isSome(held)).toBe(true)
    expect([...Option.getOrThrow(held)]).toEqual([0x00, 0x1f, 0x8b, 0xff, 0x41])
  })

  it("stores a string as UTF-8 and reads it back", async () => {
    const out = await run(
      Effect.gen(function*() {
        const storage = yield* Storage
        yield* storage.set("note", "héllo — ok")
        const held = yield* storage.get("note")
        return Option.map(held, asText)
      })
    )

    expect(Result.getOrThrow(out)).toEqual(Option.some("héllo — ok"))
  })

  it("says nothing is held rather than failing", async () => {
    // "Not held" is an answer, not a fault. A store that failed here would put
    // an ordinary miss into every caller's error channel.
    const out = await run(Effect.flatMap(Storage, (storage) => storage.get("absent")))

    expect(Result.getOrThrow(out)).toEqual(Option.none())
  })

  it("keeps keys, membership, removal and clearing consistent", async () => {
    const out = await run(
      Effect.gen(function*() {
        const storage = yield* Storage
        yield* storage.set("a", "1")
        yield* storage.set("b", "2")
        const before = { keys: [...(yield* storage.keys)].sort(), hasA: yield* storage.has("a") }

        yield* storage.remove("a")
        const between = { keys: [...(yield* storage.keys)], hasA: yield* storage.has("a") }

        yield* storage.clear
        return { before, between, after: yield* storage.keys }
      })
    )

    expect(Result.getOrThrow(out)).toEqual({
      before: { keys: ["a", "b"], hasA: true },
      between: { keys: ["b"], hasA: false },
      after: []
    })
  })

  it("turns a platform refusal into a typed StorageFault, not a defect", async () => {
    // Quota exhaustion is the realistic one, and it has to be catchable rather
    // than take down the fiber that happened to be writing.
    const broken = makeDouble()
    const platform: WebExtApi = {
      ...broken,
      store: { ...broken.store, set: () => Promise.reject(new Error("QuotaExceededError")) }
    }

    const out = await run(
      Effect.flatMap(Storage, (storage) => storage.set("index/fuse", "x")),
      platform
    )

    expect(Result.isFailure(out)).toBe(true)
    const fault = Result.getFailure(out)
    expect(Option.isSome(fault)).toBe(true)
    const raised = Option.getOrThrow(fault)
    expect(raised).toBeInstanceOf(StorageFault)
    expect(raised.operation).toBe("set")
    expect(raised.key).toBe("index/fuse")
  })
})
