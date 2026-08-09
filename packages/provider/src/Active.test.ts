/**
 * One key, four layers, and a choice that exists in exactly one place.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { describe, expect, it } from "vitest"
import { ActiveConnection, type Connection, layer } from "./Active.ts"
import { ByokAccess } from "./Byok.ts"
import { CodexAccess } from "./Codex.ts"
import { OnDeviceHost } from "./OnDevice.ts"
import { Provider } from "./Provider.ts"
import * as Fake from "./recorded/Fake.ts"
import * as Recorded from "./recorded/Wire.ts"

/** Every seam, all four connected, exactly as an application would wire them. */
const seams = Layer.mergeAll(
  Layer.succeed(HttpClient.HttpClient, Fake.saying(Recorded.openAiComplete).client),
  ByokAccess.layerOf({ apiKey: "sk-recorded", model: "gpt-4o-mini" }),
  CodexAccess.layerOf({ token: Recorded.codexToken, model: "gpt-5" }),
  OnDeviceHost.layerFromBrowser
)

const whoAnswered = (connection?: Connection) =>
  Effect.gen(function*() {
    const provider = yield* Provider
    return provider.id
  }).pipe(
    Effect.provide(layer.pipe(Layer.provide(seams))),
    connection === undefined
      ? (self) => self
      : Effect.provideService(ActiveConnection, connection),
    Effect.runPromise
  )

describe("the active connection", () => {
  it("is nothing until the reader connects something", async () => {
    // The default has to be a working layer, not a missing one: discovery must
    // run on an install where nobody ever opens the AI settings.
    expect(await whoAnswered()).toBe("unconnected")
  })

  it("puts the reader's own key behind the key", async () => {
    expect(await whoAnswered("byok")).toBe("byok")
  })

  it("puts their ChatGPT subscription behind it", async () => {
    expect(await whoAnswered("codex")).toBe("codex")
  })

  it("falls back rather than failing when the machine has no model", async () => {
    // There is no `LanguageModel` global under the test runner, which is also
    // the situation on every Safari device.
    expect(await whoAnswered("on-device")).toBe("unconnected")
  })
})

describe("what the caller can tell", () => {
  it("nothing, beyond a stamp it does not read", async () => {
    // Two different connections, one identical call, one identical type. The
    // only difference that reaches the caller is the value of `id`, which
    // exists to be recorded on a Digest and never to be branched on.
    const answer = (connection: Connection) =>
      Effect.gen(function*() {
        const provider = yield* Provider
        return yield* Effect.result(Stream.mkString(provider.chat([])))
      }).pipe(
        Effect.provide(layer.pipe(Layer.provide(seams))),
        Effect.provideService(ActiveConnection, connection),
        Effect.runPromise
      )

    expect((await answer("byok"))._tag).toBe("Success")
    expect((await answer("none"))._tag).toBe("Failure")
  })
})
