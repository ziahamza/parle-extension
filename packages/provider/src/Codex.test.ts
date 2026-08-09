/**
 * Two things are worth testing here and they are not the streaming.
 *
 * The first is the account id: a Codex request that authenticates but names no
 * account is billed to nobody and comes back as a failure the reader cannot
 * act on, so it must never leave. The second is the body: the Responses API
 * distinguishes text the model was GIVEN from text it PRODUCED by content type,
 * and getting that wrong only shows up on the second turn — which is v2's
 * first turn.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { describe, expect, it } from "vitest"
import { accountIdOf, CodexAccess, codexResponsesUrl, layer } from "./Codex.ts"
import { Provider, type ProviderUnavailable, Turn } from "./Provider.ts"
import * as Fake from "./recorded/Fake.ts"
import * as Recorded from "./recorded/Wire.ts"

const turns = [
  Turn.make({ speaker: "instruction", text: "Report what the Discussions said." }),
  Turn.make({ speaker: "reader", text: "What did people make of this?" }),
  Turn.make({ speaker: "provider", text: "Two threads, both about the benchmark." }),
  Turn.make({ speaker: "reader", text: "Which one is contested?" })
]

const connected = CodexAccess.layerOf({ token: Recorded.codexToken, model: "gpt-5" })

const speaking = (recording: Fake.Recording, access = connected) =>
  Effect.gen(function*() {
    const provider = yield* Provider
    return yield* Stream.mkString(provider.chat(turns))
  }).pipe(
    Effect.provide(
      layer.pipe(
        Layer.provide(Layer.mergeAll(Layer.succeed(HttpClient.HttpClient, recording.client), access))
      )
    ),
    Effect.result,
    Effect.runPromise
  )

const reasonOf = (spoken: Result.Result<string, ProviderUnavailable>) =>
  Result.isFailure(spoken) ? spoken.failure.reason : "(it succeeded)"

const accountOf = (token: string) =>
  Effect.runSync(Effect.result(accountIdOf(Redacted.make(token))))

describe("the account a Codex token spends against", () => {
  it("comes out of the namespaced auth claim, not the subject", () => {
    expect(accountOf(Recorded.codexToken)).toEqual(Result.succeed("acct-9f1c"))
  })

  it("refuses a token that authenticates but names no account", () => {
    const found = accountOf(Recorded.codexTokenWithoutAccount)

    expect(Result.isFailure(found)).toBe(true)
    expect(Result.isFailure(found) && found.failure.reason).toBe("not-authorized")
  })

  it("refuses anything that is not a JWT at all", () => {
    // An opaque session token would authenticate against some endpoints and be
    // unbillable here; failing on the shape says so before a request goes out.
    expect(Result.isFailure(accountOf("sess-opaque-token"))).toBe(true)
    expect(Result.isFailure(accountOf("one.two"))).toBe(true)
    expect(Result.isFailure(accountOf("one.!!!not-base64url!!!.three"))).toBe(true)
  })
})

describe("the request", () => {
  it("carries the bearer and the account id, and asks for nothing to be stored", async () => {
    const recording = Fake.saying(Recorded.codexComplete)
    await speaking(recording)

    const asked = recording.asked[0]
    expect(asked?.url).toBe(codexResponsesUrl)
    expect(asked?.headers["authorization"]).toBe(`Bearer ${Recorded.codexToken}`)
    expect(asked?.headers["chatgpt-account-id"]).toBe("acct-9f1c")

    // The Brief is built from what the reader has been reading. Asking OpenAI
    // to retain it would put their browsing in a third party's storage.
    expect(Fake.bodyOf(asked!)).toMatchObject({ store: false, stream: true, model: "gpt-5" })
  })

  it("lifts instructions out of the conversation and types replayed answers as output", async () => {
    const recording = Fake.saying(Recorded.codexComplete)
    await speaking(recording)

    expect(Fake.bodyOf(recording.asked[0]!)).toMatchObject({
      instructions: "Report what the Discussions said.",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "What did people make of this?" }] },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Two threads, both about the benchmark." }]
        },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Which one is contested?" }] }
      ]
    })
  })

  it("is never issued when nobody has logged in", async () => {
    const recording = Fake.saying(Recorded.codexComplete)
    const spoken = await speaking(recording, CodexAccess.layerUnconnected("gpt-5"))

    expect(reasonOf(spoken)).toBe("not-connected")
    expect(recording.asked).toHaveLength(0)
  })
})

describe("the answer", () => {
  it("takes the text deltas and ignores the lifecycle events around them", async () => {
    const spoken = await speaking(Fake.saying(Recorded.codexComplete))

    expect(spoken).toEqual(Result.succeed(
      "Commenters dispute the benchmark methodology. Several report the same regression on ARM."
    ))
  })

  it("keeps the delta that completed when the stream is cut mid-event", async () => {
    const spoken = await speaking(Fake.saying(Recorded.codexTruncated))

    expect(spoken).toEqual(Result.succeed("Commenters dispute the benchmark methodology."))
  })

  it("reports a response the endpoint itself gave up on", async () => {
    const spoken = await speaking(Fake.saying(Recorded.codexFailed))

    expect(reasonOf(spoken)).toBe("could-not-answer")
  })

  it("reports an expired token as unauthorized rather than as a network problem", async () => {
    const spoken = await speaking(Fake.saying("", 401))

    expect(reasonOf(spoken)).toBe("not-authorized")
  })
})
