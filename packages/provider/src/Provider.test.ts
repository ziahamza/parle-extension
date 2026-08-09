/**
 * The salvage rule, tested on its own, because every Provider depends on it and
 * because getting it wrong is silent: the reader sees a Digest that failed
 * rather than a Digest that is short.
 */
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import { describe, expect, it } from "vitest"
import { keepWhatArrived, Provider, ProviderUnavailable, stampOf } from "./Provider.ts"

const lost = new ProviderUnavailable({ reason: "unreachable", detail: "connection reset" })

const spoken = <A>(chunks: Stream.Stream<A, ProviderUnavailable>) =>
  Effect.runSync(Effect.result(Stream.runCollect(chunks)))

describe("a Provider that has already spoken", () => {
  it("ends the stream rather than failing it", () => {
    const partial = keepWhatArrived(
      Stream.make("Commenters dispute", " the benchmark").pipe(
        Stream.concat(Stream.fail(lost))
      )
    )

    expect(spoken(partial)).toEqual(Result.succeed(["Commenters dispute", " the benchmark"]))
  })

  it("collapses to the text it managed to produce", async () => {
    // This is the shape v1 actually consumes it in. Without the rule, the
    // whole exchange — including complete, correctly-cited Findings — becomes
    // one failure.
    const text = await Effect.runPromise(
      Stream.mkString(keepWhatArrived(Stream.make("half a ", "Digest").pipe(Stream.concat(Stream.fail(lost)))))
    )

    expect(text).toBe("half a Digest")
  })
})

describe("a Provider that never spoke", () => {
  it("fails, so that an empty answer is never reported as a complete one", () => {
    const nothing = keepWhatArrived(Stream.fail(lost))

    expect(spoken(nothing)).toEqual(Result.fail(lost))
  })
})

describe("what salvage must not swallow", () => {
  it("lets a defect through untouched", () => {
    // `catchCause` here would turn a bug in our own decoding into a short but
    // apparently successful answer, which is the least debuggable outcome
    // available.
    const broken = keepWhatArrived(
      Stream.make("some text").pipe(Stream.concat(Stream.die(new Error("bug in the decoder"))))
    )

    expect(() => Effect.runSync(Stream.runCollect(broken))).toThrow()
  })
})

describe("the stamp a Digest carries", () => {
  it("records which Provider and which model wrote it, as a Local origin", () => {
    const origin = stampOf(
      Provider.of({ id: "codex", model: "gpt-5", chat: () => Stream.empty })
    )

    expect(origin).toMatchObject({ _tag: "Local", providerId: "codex", model: "gpt-5" })
  })
})
