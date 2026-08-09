/**
 * The on-device Provider is the one that is usually absent, so most of what
 * matters is what happens when it is: the substitution has to occur while the
 * layer is being built, and it has to be invisible afterwards.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import { describe, expect, it } from "vitest"
import { type Availability, type Exchange, layer, OnDeviceHost, orElse } from "./OnDevice.ts"
import { Provider, Turn } from "./Provider.ts"
import * as Unconnected from "./Unconnected.ts"

const turns = [
  Turn.make({ speaker: "instruction", text: "Report what the Discussions said." }),
  Turn.make({ speaker: "reader", text: "What did people make of this?" }),
  Turn.make({ speaker: "provider", text: "Two threads, both about the benchmark." }),
  Turn.make({ speaker: "reader", text: "Which one is contested?" })
]

async function* saying(values: ReadonlyArray<string>): AsyncIterable<string> {
  for (const value of values) yield value
}

interface Watched {
  exchange: Exchange | undefined
  sessions: number
  released: number
}

const fakeHost = (availability: Availability, watched: Watched) =>
  Layer.succeed(
    OnDeviceHost,
    OnDeviceHost.of({
      model: "gemini-nano",
      availability: Effect.succeed(availability),
      converse: (exchange) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            watched.exchange = exchange
            watched.sessions = watched.sessions + 1
            return saying(["Commenters dispute", " the benchmark methodology."])
          }),
          () => Effect.sync(() => { watched.released = watched.released + 1 })
        )
    })
  )

const watching = (): Watched => ({ exchange: undefined, sessions: 0, released: 0 })

describe("when the model is there", () => {
  it("streams its deltas and stamps itself as on-device", async () => {
    const watched = watching()
    const spoken = await Effect.gen(function*() {
      const provider = yield* Provider
      const text = yield* Stream.mkString(provider.chat(turns))
      return { text, id: provider.id, model: provider.model }
    }).pipe(Effect.provide(layer.pipe(Layer.provide(fakeHost("available", watched)))), Effect.runPromise)

    expect(spoken).toEqual({
      text: "Commenters dispute the benchmark methodology.",
      id: "on-device",
      model: "gemini-nano"
    })
  })

  it("hands the session the instructions, the history, and the question separately", async () => {
    // Chrome takes prior turns at session-creation time and the question at
    // prompt time. Flattening the conversation into one blob would work today
    // and stop working the moment v2 asks a follow-up.
    const watched = watching()
    await Effect.gen(function*() {
      const provider = yield* Provider
      return yield* Stream.mkString(provider.chat(turns))
    }).pipe(Effect.provide(layer.pipe(Layer.provide(fakeHost("available", watched)))), Effect.runPromise)

    expect(watched.exchange).toEqual({
      instructions: "Report what the Discussions said.",
      history: [
        { spoken: false, text: "What did people make of this?" },
        { spoken: true, text: "Two threads, both about the benchmark." }
      ],
      prompt: "Which one is contested?"
    })
  })

  it("releases the session when the stream ends", async () => {
    // A session holds model context. The scope that owns it is the stream's,
    // so a reader who navigates away mid-Digest releases it without anyone
    // remembering to.
    const watched = watching()
    await Effect.gen(function*() {
      const provider = yield* Provider
      return yield* Stream.mkString(provider.chat(turns))
    }).pipe(Effect.provide(layer.pipe(Layer.provide(fakeHost("available", watched)))), Effect.runPromise)

    expect(watched.sessions).toBe(1)
    expect(watched.released).toBe(1)
  })
})

describe("when the model is not there", () => {
  const unavailable: ReadonlyArray<Availability> = ["unavailable", "downloadable", "downloading"]

  it("refuses to build, rather than failing later on every call", async () => {
    for (const availability of unavailable) {
      const built = await Effect.result(
        Effect.provide(Effect.succeed("built"), layer.pipe(Layer.provide(fakeHost(availability, watching()))))
      ).pipe(Effect.runPromise)

      expect(Result.isFailure(built)).toBe(true)
      expect(Result.isFailure(built) && built.failure._tag).toBe("OnDeviceUnavailable")
    }
  })

  it("does not begin a multi-gigabyte download because a panel was opened", async () => {
    // `downloadable` means the model could be fetched. Building the layer would
    // be the thing that fetches it, and that is not this package's decision.
    const watched = watching()
    const built = await Effect.result(
      Effect.provide(Effect.succeed("built"), layer.pipe(Layer.provide(fakeHost("downloadable", watched))))
    ).pipe(Effect.runPromise)

    expect(Result.isFailure(built)).toBe(true)
    expect(watched.sessions).toBe(0)
  })

  it("substitutes a fallback Provider, and nothing downstream can tell", async () => {
    // The substitution happens during layer construction, so the app's error
    // channel never sees `OnDeviceUnavailable` at all — the type of the layer
    // below has `never` in its error position.
    const substituted: Layer.Layer<Provider> = orElse(Unconnected.layer).pipe(
      Layer.provide(fakeHost("unavailable", watching()))
    )

    const spoken = await Effect.gen(function*() {
      const provider = yield* Provider
      return yield* Stream.mkString(provider.chat(turns))
    }).pipe(Effect.provide(substituted), Effect.result, Effect.runPromise)

    expect(Result.isFailure(spoken) && spoken.failure.reason).toBe("not-connected")
  })
})

describe("the browser host", () => {
  it("reports no model where there is no global to ask", async () => {
    // Safari, every version, and Chrome before 138. Probing must answer rather
    // than throw on a missing global.
    const availability = await Effect.gen(function*() {
      const host = yield* OnDeviceHost
      return yield* host.availability
    }).pipe(Effect.provide(OnDeviceHost.layerFromBrowser), Effect.runPromise)

    expect(availability).toBe("unavailable")
  })
})
