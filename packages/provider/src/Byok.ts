/**
 * BYOK — the reader's own API key against an OpenAI-compatible endpoint.
 *
 * This is the reference implementation, and it is the one that is complete.
 * The other two are contractually shaky in ways we do not control: Codex OAuth
 * is a token scoped to somebody else's tooling and the precedent for revoking
 * that scope already exists (ADR 0004), and the on-device model does not exist
 * at all on Safari (ADR 0003). A key the reader pasted, against an endpoint
 * they chose, is the only Provider whose continued function is a matter of
 * their contract with their vendor rather than of ours with anyone.
 *
 * The endpoint is `POST {baseUrl}/chat/completions` with `stream: true`, which
 * a dozen vendors and every local runner implement. `baseUrl` is therefore
 * settings, not a constant.
 *
 * The key is read at CALL time, not at layer-build time. Under MV3 the worker
 * dies and respawns constantly while the layer memoizes; a key the reader
 * pasted after the first Digest must work on the second without a reload.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import {
  type Chunk,
  Provider,
  ProviderUnavailable,
  type Speaker,
  type Turn,
  unavailableForStatus
} from "./Provider.ts"
import * as Sse from "./Sse.ts"
import { type Json } from "@parle/domain/Refine"

/** Where an OpenAI-compatible endpoint lives if the reader named no other. */
export const openAiBaseUrl = "https://api.openai.com/v1"

/**
 * What the reader connected: an endpoint, a model name, and a secret.
 *
 * The secret is an Effect and the other two are values, and the split is the
 * point. `model` is stamped into every Digest, so it must be knowable without
 * touching the key at all; the key itself is fetched per request from wherever
 * settings live (`@parle/memory` owns that store, not us) and is `Redacted` so
 * that no log line, span attribute, or error message can carry it.
 */
export class ByokAccess extends Context.Service<ByokAccess, {
  readonly baseUrl: string
  readonly model: string
  readonly apiKey: Effect.Effect<Redacted.Redacted<string>, ProviderUnavailable>
}>()("parle/ai/ByokAccess") {
  /** A reader who has pasted a key. */
  static readonly layerOf = (settings: {
    readonly apiKey: string
    readonly model: string
    readonly baseUrl?: string
  }): Layer.Layer<ByokAccess> =>
    Layer.succeed(
      ByokAccess,
      ByokAccess.of({
        baseUrl: settings.baseUrl ?? openAiBaseUrl,
        model: settings.model,
        apiKey: Effect.succeed(Redacted.make(settings.apiKey))
      })
    )
}

/** How the three Speakers are spelled in the chat-completions wire format. */
const wireRole = (speaker: Speaker): string => {
  switch (speaker) {
    case "instruction":
      return "system"
    case "reader":
      return "user"
    case "provider":
      return "assistant"
  }
}

/**
 * One streamed delta.
 *
 * Every field is optional on purpose. The first event of an OpenAI stream
 * carries a role and no content; keepalive and usage-only events carry neither;
 * several compatible servers send `content: null` rather than omitting it. All
 * of those are "no text yet", not a Garble, and a strict schema would turn the
 * whole class into one — which is exactly how a Provider that works everywhere
 * else fails against one proxy.
 */
const StreamedDelta = Schema.Struct({
  choices: Schema.optionalKey(Schema.Array(Schema.Struct({
    delta: Schema.optionalKey(Schema.Struct({
      content: Schema.optionalKey(Schema.NullOr(Schema.String))
    }))
  })))
})

/**
 * A fault announced inside a 200 response.
 *
 * The key spelling is the vendor's wire format, not our vocabulary. Modelling
 * it is what stops "your account is out of credit", announced mid-stream with a
 * 200, from rendering as a Digest with nothing in it.
 */
const StreamedFault = Schema.Struct({
  error: Schema.Struct({
    message: Schema.optionalKey(Schema.String)
  })
})

const readDelta = Schema.decodeUnknownOption(StreamedDelta)
const readFault = Schema.decodeUnknownOption(StreamedFault)

/** The text a single streamed event contributes, if any. */
const textOf = (payload: Json): string =>
  Option.match(readDelta(payload), {
    onNone: () => "",
    onSome: (delta) =>
      (delta.choices ?? []).reduce(
        (text, choice) => text + (choice.delta?.content ?? ""),
        ""
      )
  })

/** Turn one dispatched SSE event into zero or one Chunk, or a failure. */
const chunksOf = (event: Sse.SseEvent): Stream.Stream<Chunk, ProviderUnavailable> => {
  // The sentinel that ends every OpenAI-compatible stream. Not JSON.
  if (event.data === "[DONE]") return Stream.empty

  const payload = Sse.jsonOf(event)
  if (Option.isNone(payload)) {
    return Stream.fail(
      new ProviderUnavailable({ reason: "garbled", detail: "a streamed event was not JSON" })
    )
  }

  const fault = readFault(payload.value)
  if (Option.isSome(fault)) {
    return Stream.fail(
      new ProviderUnavailable({
        reason: "could-not-answer",
        detail: fault.value.error.message ?? "the endpoint announced a fault mid-stream"
      })
    )
  }

  const text = textOf(payload.value)
  return text === "" ? Stream.empty : Stream.succeed(text)
}

/**
 * The BYOK Provider.
 *
 * Requires an `HttpClient`; the caller decides which one, so per-Provider
 * pacing, timeouts and retry live where the rest of the extension's HTTP policy
 * lives rather than being baked in here.
 */
export const layer: Layer.Layer<Provider, never, HttpClient.HttpClient | ByokAccess> = Layer.effect(
  Provider,
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const access = yield* ByokAccess

    const chat = (turns: ReadonlyArray<Turn>): Stream.Stream<Chunk, ProviderUnavailable> =>
      Stream.unwrap(Effect.gen(function*() {
        const apiKey = yield* access.apiKey

        const request = HttpClientRequest.post(`${access.baseUrl}/chat/completions`).pipe(
          HttpClientRequest.setHeaders({
            authorization: `Bearer ${Redacted.value(apiKey)}`,
            accept: "text/event-stream"
          }),
          HttpClientRequest.bodyJsonUnsafe({
            model: access.model,
            stream: true,
            messages: turns.map((turn) => ({ role: wireRole(turn.speaker), content: turn.text }))
          })
        )

        const response = yield* client.execute(request).pipe(
          Effect.mapError((cause) =>
            new ProviderUnavailable({ reason: "unreachable", detail: `${cause}` })
          )
        )

        if (response.status >= 400) {
          return Stream.fail(
            unavailableForStatus(response.status, `chat/completions answered ${response.status}`)
          )
        }

        return Sse.fromBytes(HttpClientResponse.stream(Effect.succeed(response))).pipe(
          Stream.mapError((cause) =>
            new ProviderUnavailable({ reason: "unreachable", detail: `${cause}` })
          ),
          Stream.flatMap(chunksOf)
        )
      }))

    return Provider.of({ id: "byok", model: access.model, chat })
  })
)
