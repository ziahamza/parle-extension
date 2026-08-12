/**
 * Codex OAuth — "Log in with ChatGPT", billed to the reader's own subscription.
 *
 * ADR 0004 makes this the headline Provider, because it is the only one that
 * costs the reader nothing they have not already paid for. What is implemented
 * here is the CLIENT: the request shape, the two headers that make it
 * authenticate, the SSE decoding, and the failure taxonomy.
 *
 * WHAT IS NOT IMPLEMENTED, DELIBERATELY: acquiring the token. The flow is
 * genuinely unresolved — Chrome has `identity.launchWebAuthFlow`, Safari's Web
 * Extension API has NO equivalent at all (ADR 0003 makes Safari a first-class
 * target), and the loopback-redirect shape the Codex CLI uses is not available
 * to an extension either. Inventing a flow here would be inventing the part
 * most likely to be wrong. So `CodexAccess` accepts a token from storage and
 * that service is the seam: whatever resolves the flow implements it, and
 * nothing in this file changes.
 *
 * Two details are not obvious and both are required:
 *
 *  - The account the request is billed to is NOT in the URL or the body. It is
 *    the `chatgpt_account_id` inside the `https://api.openai.com/auth` claim of
 *    the access token itself, sent back as the `ChatGPT-Account-Id` header. A
 *    token without that claim is a token that cannot spend anything.
 *  - The token is read per call, never at layer-build time. Access tokens
 *    expire in hours and the layer is memoized for the life of the worker; a
 *    build-time read would make the Provider unbuildable mid-session, which
 *    ADR 0004's "the Digest degrades, the product keeps working" forbids.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import {
  type Chunk,
  Provider,
  ProviderUnavailable,
  type Turn,
  unavailableForStatus
} from "./Provider.ts"
import * as Sse from "./Sse.ts"
import { parseJson } from "@parle/domain/Refine"

/** The Codex backend's streaming endpoint. Not the public API host. */
export const codexResponsesUrl = "https://chatgpt.com/backend-api/codex/responses"

/**
 * A Codex access token, however it was obtained.
 *
 * `token` is an Effect because acquisition is somebody else's problem and
 * because expiry is a call-time fact. A reader who has never connected yields
 * `not-connected`, which is a state the panel renders as an offer rather than
 * as a failure.
 */
export class CodexAccess extends Context.Service<CodexAccess, {
  readonly model: string
  readonly token: Effect.Effect<Redacted.Redacted<string>, ProviderUnavailable>
}>()("parle/ai/CodexAccess") {
  /** A token already in hand — from storage, or from a test. */
  static readonly layerOf = (settings: {
    readonly token: string
    readonly model: string
  }): Layer.Layer<CodexAccess> =>
    Layer.succeed(
      CodexAccess,
      CodexAccess.of({
        model: settings.model,
        token: Effect.succeed(Redacted.make(settings.token))
      })
    )

  /** Nobody has logged in. The layer still builds; every call declines. */
  static readonly layerUnconnected = (model: string): Layer.Layer<CodexAccess> =>
    Layer.succeed(
      CodexAccess,
      CodexAccess.of({
        model,
        token: Effect.fail(
          new ProviderUnavailable({
            reason: "not-connected",
            detail: "no ChatGPT session has been connected"
          })
        )
      })
    )
}

/**
 * The one claim we read out of the access token.
 *
 * Namespaced exactly as OpenAI issues it. Everything else in the token —
 * subject, expiry, plan — is deliberately not read: we do not gate on the
 * reader's plan, and an expiry we checked locally would still race the server's.
 */
const AuthClaim = Schema.Struct({
  "https://api.openai.com/auth": Schema.Struct({
    chatgpt_account_id: Schema.String
  })
})

const readAuthClaim = Schema.decodeUnknownOption(AuthClaim)

const notAuthorized = (detail: string) => new ProviderUnavailable({ reason: "not-authorized", detail })

/**
 * The account id a Codex token spends against.
 *
 * A JWT's payload is base64url, and its signature is the issuer's business —
 * we are reading a claim to address the request correctly, not verifying
 * anything. If the claim is absent the request would be accepted and billed
 * nowhere, so this fails rather than sending it.
 */
export const accountIdOf = (
  token: Redacted.Redacted<string>
): Effect.Effect<string, ProviderUnavailable> =>
  Effect.suspend(() => {
    const segments = Redacted.value(token).split(".")
    const payload = segments.length === 3 ? segments[1] : undefined
    if (payload === undefined) {
      return Effect.fail(notAuthorized("the Codex token is not a three-part JWT"))
    }

    const decoded = Encoding.decodeBase64UrlString(payload)
    if (Result.isFailure(decoded)) {
      return Effect.fail(notAuthorized("the Codex token's payload is not base64url"))
    }

    const parsed = parseJson(decoded.success)
    if (parsed === undefined) {
      return Effect.fail(notAuthorized("the Codex token's payload is not JSON"))
    }

    const claim = readAuthClaim(parsed)
    return Option.isNone(claim)
      ? Effect.fail(notAuthorized("the Codex token carries no chatgpt_account_id"))
      : Effect.succeed(claim.value["https://api.openai.com/auth"].chatgpt_account_id)
  })

/** Instruction Turns become the Responses API's top-level `instructions`. */
const instructionsOf = (turns: ReadonlyArray<Turn>): string =>
  turns.filter((turn) => turn.speaker === "instruction").map((turn) => turn.text).join("\n\n")

/**
 * The rest become `input` items.
 *
 * The Responses API distinguishes text the model is being GIVEN from text the
 * model PRODUCED, by content type rather than by role, so a Turn we replay from
 * an earlier answer has to be spelled `output_text` or the request is rejected.
 */
const inputOf = (turns: ReadonlyArray<Turn>) =>
  turns
    .filter((turn) => turn.speaker !== "instruction")
    .map((turn) => {
      const spoken = turn.speaker === "provider"
      return {
        type: "message",
        role: spoken ? "assistant" : "user",
        content: [{ type: spoken ? "output_text" : "input_text", text: turn.text }]
      }
    })

/**
 * One streamed Responses event.
 *
 * The event's own `type` field is read rather than the SSE `event:` name: both
 * carry it, and the payload is the one the endpoint is contractually specific
 * about.
 */
const StreamedEvent = Schema.Struct({
  type: Schema.String,
  delta: Schema.optionalKey(Schema.String)
})

const readEvent = Schema.decodeUnknownOption(StreamedEvent)

/** Turn one dispatched SSE event into zero or one Chunk, or a failure. */
const chunksOf = (event: Sse.SseEvent): Stream.Stream<Chunk, ProviderUnavailable> => {
  if (event.data === "[DONE]") return Stream.empty

  const payload = Sse.jsonOf(event)
  if (Option.isNone(payload)) {
    return Stream.fail(
      new ProviderUnavailable({ reason: "garbled", detail: "a streamed event was not JSON" })
    )
  }

  const streamed = readEvent(payload.value)
  if (Option.isNone(streamed)) {
    // An event of a shape we do not model — reasoning summaries, item lifecycle,
    // usage. Not text, and not a fault.
    return Stream.empty
  }

  switch (streamed.value.type) {
    case "response.output_text.delta": {
      const delta = streamed.value.delta ?? ""
      return delta === "" ? Stream.empty : Stream.succeed(delta)
    }
    case "response.failed":
    case "response.incomplete":
      return Stream.fail(
        new ProviderUnavailable({
          reason: "could-not-answer",
          detail: `the Codex endpoint reported ${streamed.value.type}`
        })
      )
    default:
      return Stream.empty
  }
}

/**
 * The Codex Provider.
 *
 * `store: false` is not a detail. The Brief is built from the reader's own
 * browsing, and asking OpenAI to retain it server-side would put what they read
 * into a third party's storage, which is the one thing ADR 0012's whole design
 * exists to avoid.
 */
export const layer: Layer.Layer<Provider, never, HttpClient.HttpClient | CodexAccess> = Layer.effect(
  Provider,
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const access = yield* CodexAccess

    const chat = (turns: ReadonlyArray<Turn>): Stream.Stream<Chunk, ProviderUnavailable> =>
      Stream.unwrap(Effect.gen(function*() {
        const token = yield* access.token
        const accountId = yield* accountIdOf(token)

        const request = HttpClientRequest.post(codexResponsesUrl).pipe(
          HttpClientRequest.setHeaders({
            authorization: `Bearer ${Redacted.value(token)}`,
            "chatgpt-account-id": accountId,
            accept: "text/event-stream",
            "openai-beta": "responses=experimental",
            originator: "parle"
          }),
          HttpClientRequest.bodyJsonUnsafe({
            model: access.model,
            instructions: instructionsOf(turns),
            input: inputOf(turns),
            stream: true,
            store: false
          })
        )

        const response = yield* client.execute(request).pipe(
          Effect.mapError((cause) =>
            new ProviderUnavailable({ reason: "unreachable", detail: `${cause}` })
          )
        )

        if (response.status >= 400) {
          return Stream.fail(
            unavailableForStatus(response.status, `the Codex endpoint answered ${response.status}`)
          )
        }

        return Sse.fromBytes(HttpClientResponse.stream(Effect.succeed(response))).pipe(
          Stream.mapError((cause) =>
            new ProviderUnavailable({ reason: "unreachable", detail: `${cause}` })
          ),
          Stream.flatMap(chunksOf)
        )
      }))

    return Provider.of({ id: "codex", model: access.model, chat })
  })
)
