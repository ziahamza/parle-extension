/**
 * The MV3 worker has nothing above it. Anything that escapes `start` escapes
 * into an unhandled rejection that no user, log, or crash reporter will see.
 */
import { describe, expect, it, vi } from "vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { forBackground } from "./Runtime.ts"

class Ledger extends Context.Service<Ledger, {
  readonly note: (what: string) => Effect.Effect<void>
  readonly noted: () => ReadonlyArray<string>
}>()("parle/browser/test/Ledger") {
  static readonly layer = Layer.effect(
    Ledger,
    Effect.sync(() => {
      const noted: Array<string> = []
      return Ledger.of({
        note: (what) => Effect.sync(() => void noted.push(what)),
        noted: () => noted
      })
    })
  )
}

class Broke extends Schema.TaggedError<Broke>()("Broke", {}) {}

describe("the background entrypoint", () => {
  it("builds its layer once, lazily, and shares it across runs", async () => {
    // Two runtimes would give the reader two Local Discussion Caches and two of
    // every daemon. Building at construction would also break the rule that a
    // worker registers its listeners before its first await.
    let built = 0
    const counted = Layer.effect(
      Ledger,
      Effect.suspend(() => {
        built += 1
        return Effect.map(Layer.build(Ledger.layer), (context) => Context.get(context, Ledger))
      })
    )

    const worker = forBackground(counted)
    expect(built).toBe(0)

    await worker.handle(Effect.flatMap(Ledger, (ledger) => ledger.note("first")))
    await worker.handle(Effect.flatMap(Ledger, (ledger) => ledger.note("second")))
    const noted = await worker.handle(Effect.map(Ledger, (ledger) => ledger.noted()))

    expect(built).toBe(1)
    expect(noted).toEqual(["first", "second"])
    await worker.stop()
  })

  it("reports work that dies, and keeps the worker usable", async () => {
    // A background task that fails must not escape as an unhandled rejection —
    // invisible in an MV3 worker — and must not take the runtime with it.
    const said = [console.log, console.error].map((_, index) =>
      vi.spyOn(console, index === 0 ? "log" : "error").mockImplementation(() => {})
    )
    const worker = forBackground(Ledger.layer)

    const stopped = await Effect.runPromise(Fiber.await(worker.start(Effect.fail(new Broke()))))
    const spoken = said.reduce((total, spy) => total + spy.mock.calls.length, 0)
    said.forEach((spy) => spy.mockRestore())

    expect(stopped._tag).toBe("Failure")
    expect(spoken).toBeGreaterThan(0)

    // Still alive afterwards.
    await worker.handle(Effect.flatMap(Ledger, (ledger) => ledger.note("after")))
    expect(await worker.handle(Effect.map(Ledger, (ledger) => ledger.noted()))).toEqual(["after"])
    await worker.stop()
  })
})
