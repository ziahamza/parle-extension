/**
 * BYOK is the reference Provider, so this is the file that has to be
 * exhaustive: the request it builds, the answer it assembles, and — most of it
 * — the five different ways an answer can go wrong and the five different
 * things the reader is owed for each.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { describe, expect, it } from "vitest"
import { ByokAccess, layer } from "./Byok.ts"
import { keepWhatArrived, Provider, ProviderUnavailable, Turn } from "./Provider.ts"
import * as Fake from "./recorded/Fake.ts"
import * as Recorded from "./recorded/Wire.ts"

const turns = [
  Turn.make({ speaker: "instruction", text: "Report what the Discussions said." }),
  Turn.make({ speaker: "reader", text: "What did people make of this?" })
]

/**
 * `policy` is what a consumer chooses to do with the stream. It defaults to
 * doing nothing, because `chat` now reports failure honestly and salvaging a
 * partial answer is the caller's decision rather than this layer's.
 */
const speaking = (
  recording: Fake.Recording,
  access = ByokAccess.layerOf({ apiKey: "sk-recorded", model: "gpt-4o-mini" }),
  policy: (
    s: Stream.Stream<string, ProviderUnavailable>
  ) => Stream.Stream<string, ProviderUnavailable> = (s) => s
) =>
  Effect.gen(function*() {
    const provider = yield* Provider
    return yield* Stream.mkString(policy(provider.chat(turns)))
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

describe("the request", () => {
  it("asks the reader's own endpoint, with their key and a streaming body", async () => {
    const recording = Fake.saying(Recorded.openAiComplete)
    await speaking(recording, ByokAccess.layerOf({
      apiKey: "sk-recorded",
      model: "llama-3.3-70b",
      baseUrl: "http://localhost:1234/v1"
    }))

    const asked = recording.asked[0]
    expect(asked?.url).toBe("http://localhost:1234/v1/chat/completions")
    expect(asked?.headers["authorization"]).toBe("Bearer sk-recorded")
    expect(asked?.headers["accept"]).toBe("text/event-stream")
    expect(Fake.bodyOf(asked!)).toEqual({
      model: "llama-3.3-70b",
      stream: true,
      messages: [
        { role: "system", content: "Report what the Discussions said." },
        { role: "user", content: "What did people make of this?" }
      ]
    })
  })

  it("is never issued at all when no key has been connected", async () => {
    // Reading the key is what fails, before anything is sent. A request that
    // went out with an empty bearer would be a 401 the reader has to interpret.
    const recording = Fake.saying(Recorded.openAiComplete)
    const spoken = await speaking(
      recording,
      Layer.succeed(
        ByokAccess,
        ByokAccess.of({
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          apiKey: Effect.fail(
            new ProviderUnavailable({ reason: "not-connected", detail: "no key" })
          )
        })
      )
    )

    expect(reasonOf(spoken)).toBe("not-connected")
    expect(recording.asked).toHaveLength(0)
  })
})

describe("the answer", () => {
  it("assembles the deltas in arrival order and stops at the sentinel", async () => {
    const spoken = await speaking(Fake.saying(Recorded.openAiComplete))

    expect(spoken).toEqual(Result.succeed(
      "Commenters dispute the benchmark methodology. Several report the same regression on ARM."
    ))
  })

  it("ignores the opening role-only delta rather than emitting an empty Chunk", async () => {
    // The first event of every OpenAI stream carries `content: ""`. A Chunk of
    // no text is not a Chunk.
    const chunks = await Effect.gen(function*() {
      const provider = yield* Provider
      return yield* Stream.runCollect(provider.chat(turns))
    }).pipe(
      Effect.provide(
        layer.pipe(
          Layer.provide(Layer.mergeAll(
            Layer.succeed(HttpClient.HttpClient, Fake.saying(Recorded.openAiComplete).client),
            ByokAccess.layerOf({ apiKey: "sk-recorded", model: "gpt-4o-mini" })
          ))
        )
      ),
      Effect.runPromise
    )

    expect(chunks).toHaveLength(2)
  })
})

describe("a Provider that dies mid-Digest", () => {
  it("keeps what it already said when the body simply stops", async () => {
    const spoken = await speaking(Fake.saying(Recorded.openAiTruncated))

    expect(spoken).toEqual(Result.succeed(
      "Commenters dispute the benchmark methodology. Several report the same regression on ARM."
    ))
  })

  it("reports the transport failure rather than swallowing it", async () => {
    // Bytes, then a transport failure. This layer used to convert that into an
    // ordinary end of stream, which threw away the only evidence anything went
    // wrong — a consumer could not tell "the Provider finished" from "the
    // Provider died after speaking", and `@parle/digest` therefore recorded a
    // truncated answer as `complete`.
    //
    // Keeping what arrived is still the right POLICY; it just belongs to
    // whoever consumes the stream and has to decide what a partial answer is
    // worth. See `keepWhatArrived`, and the test below that applies it.
    const spoken = await speaking(Fake.saying(Fake.cutOff(Recorded.openAiTruncated)))

    expect(Result.isFailure(spoken)).toBe(true)
  })

  it("yields what arrived once a consumer applies keepWhatArrived", async () => {
    const spoken = await speaking(
      Fake.saying(Fake.cutOff(Recorded.openAiTruncated)),
      undefined,
      keepWhatArrived
    )

    expect(spoken).toEqual(Result.succeed(
      "Commenters dispute the benchmark methodology. Several report the same regression on ARM."
    ))
  })

  it("still fails when it died before saying anything", async () => {
    // Nothing was salvaged, so there is nothing to salvage, and reporting
    // success with an empty answer would render as a Digest that said nothing.
    const spoken = await speaking(Fake.saying(Fake.cutOff("data: {\"choices\"")))

    expect(reasonOf(spoken)).toBe("unreachable")
  })
})

describe("what the reader is told", () => {
  it("distinguishes a rejected key from a spent account from a busy endpoint", async () => {
    const rejected = await speaking(Fake.saying("", 401))
    const spent = await speaking(Fake.saying("", 402))
    const busy = await speaking(Fake.saying("", 429))
    const broken = await speaking(Fake.saying("", 503))

    expect([reasonOf(rejected), reasonOf(spent), reasonOf(busy), reasonOf(broken)]).toEqual([
      "not-authorized",
      "over-quota",
      "rate-limited",
      "unreachable"
    ])
  })

  it("reports a fault announced inside a 200, with the endpoint's own words", async () => {
    const spoken = await speaking(Fake.saying(Recorded.openAiFaultFirst))

    expect(reasonOf(spoken)).toBe("could-not-answer")
    expect(Result.isFailure(spoken) && spoken.failure.detail).toBe("You exceeded your current quota")
  })

  it("calls an interstitial served as an event stream garbled, not unreachable", async () => {
    // A 200 that parses as HTML is not a network problem and must never be
    // retried: retrying is how a captive portal becomes an infinite loop.
    const spoken = await speaking(Fake.saying(Recorded.openAiNotJson))

    expect(reasonOf(spoken)).toBe("garbled")
  })
})
