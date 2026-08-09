/**
 * The browser's own model — free, private, and absent more often than not.
 *
 * Chrome ships `LanguageModel` (Gemini Nano) behind a global; Safari ships
 * nothing equivalent, which is why ADR 0004 refuses to let this be the only
 * path. Two consequences shape this file.
 *
 * FIRST: availability is probed when the LAYER is built, not when `chat` is
 * called. An absent model is a fact about the machine, it does not change
 * between one Digest and the next, and discovering it per call would mean every
 * Digest on a Safari device pays a probe to learn the same thing. The probe
 * fails the layer with its own tagged error so that `Layer.catchTag` can
 * substitute a different Provider — the substitution happens during layer
 * construction and the app's error channel never sees it, which is ADR 0004's
 * "the Digest degrades, the product keeps working" made structural.
 *
 * SECOND: `Summarizer` is deliberately not used, even though it is the more
 * obvious fit for v1. It takes one text and returns one summary; it cannot host
 * a conversation, and ADR 0008 requires the Provider seam to be chat-shaped
 * from day one precisely so that v2's fact-check needs no new seam. Wiring
 * `Summarizer` here would satisfy v1 and have to be torn out for v2.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { type Chunk, Provider, ProviderUnavailable, type Turn } from "./Provider.ts"

/** What the browser says about the on-device model. Chrome's own vocabulary. */
export const Availability = Schema.Literals(["available", "downloading", "downloadable", "unavailable"])
export type Availability = typeof Availability.Type

/**
 * Why the on-device Provider could not be built.
 *
 * Distinct from `ProviderUnavailable` on purpose: this one is a LAYER failure,
 * and its whole job is to be caught by `Layer.catchTag` before anything else
 * can observe it.
 */
export class OnDeviceUnavailable extends Schema.TaggedError<OnDeviceUnavailable>()("OnDeviceUnavailable", {
  availability: Availability,
  detail: Schema.String
}) {}

/** One exchange put to the on-device model. */
export interface Exchange {
  /** What we are asking it to be. Chrome takes this as a system prompt. */
  readonly instructions: string
  /** Everything said before the current question. */
  readonly history: ReadonlyArray<{ readonly spoken: boolean; readonly text: string }>
  /** The question itself. */
  readonly prompt: string
}

/**
 * The browser's model, as a service so that it can be faked.
 *
 * `converse` requires a `Scope` because a Chrome session is a resource that
 * holds model context and must be destroyed; `Stream.unwrap` discharges that
 * scope against the stream's own lifetime, so a reader who navigates away
 * mid-Digest releases the session without anyone writing a finalizer.
 */
export class OnDeviceHost extends Context.Service<OnDeviceHost, {
  readonly model: string
  readonly availability: Effect.Effect<Availability>
  readonly converse: (
    exchange: Exchange
  ) => Effect.Effect<AsyncIterable<string>, ProviderUnavailable, Scope.Scope>
}>()("parle/ai/OnDeviceHost") {
  /** The real thing: whatever `globalThis.LanguageModel` turns out to be. */
  static readonly layerFromBrowser: Layer.Layer<OnDeviceHost> = Layer.sync(OnDeviceHost, () =>
    OnDeviceHost.of({
      model: "gemini-nano",

      availability: Effect.suspend(() => {
        const languageModel = browserLanguageModel()
        return languageModel === undefined
          ? Effect.succeed<Availability>("unavailable")
          : Effect.tryPromise({
            try: () => languageModel.availability(),
            catch: () => "unavailable" as const
          }).pipe(
            Effect.map(asAvailability),
            Effect.catch(() => Effect.succeed<Availability>("unavailable"))
          )
      }),

      converse: (exchange) =>
        Effect.suspend(() => {
          const languageModel = browserLanguageModel()
          if (languageModel === undefined) {
            return Effect.fail(
              new ProviderUnavailable({ reason: "no-model", detail: "this browser has no LanguageModel" })
            )
          }

          const open = Effect.tryPromise({
            try: () =>
              languageModel.create({
                initialPrompts: [
                  ...(exchange.instructions === ""
                    ? []
                    : [{ role: "system" as const, content: exchange.instructions }]),
                  ...exchange.history.map((turn) => ({
                    role: turn.spoken ? ("assistant" as const) : ("user" as const),
                    content: turn.text
                  }))
                ]
              }),
            catch: (cause) =>
              new ProviderUnavailable({ reason: "no-model", detail: `could not open a session: ${cause}` })
          })

          return Effect.acquireRelease(open, (session) => Effect.sync(() => session.destroy())).pipe(
            Effect.map((session) => session.promptStreaming(exchange.prompt))
          )
        })
    }))
}

/**
 * The on-device Provider, or a layer failure that says why not.
 *
 * `downloadable` is treated as unavailable rather than as an invitation:
 * building the layer would then begin a multi-gigabyte download because the
 * reader opened a panel, which is not a decision this package gets to make.
 */
export const layer: Layer.Layer<Provider, OnDeviceUnavailable, OnDeviceHost> = Layer.effect(
  Provider,
  Effect.gen(function*() {
    const host = yield* OnDeviceHost
    const availability = yield* host.availability

    if (availability !== "available") {
      return yield* new OnDeviceUnavailable({
        availability,
        detail: availability === "unavailable"
          ? "this browser has no on-device model"
          : "the on-device model has not been downloaded"
      })
    }

    const chat = (turns: ReadonlyArray<Turn>): Stream.Stream<Chunk, ProviderUnavailable> =>
      Stream.unwrap(Effect.gen(function*() {
        const exchange = exchangeOf(turns)
        if (exchange.prompt === "") {
          return Stream.fail(
            new ProviderUnavailable({ reason: "could-not-answer", detail: "there was nothing to ask" })
          )
        }

        const deltas = yield* host.converse(exchange)
        return Stream.fromAsyncIterable(
          deltas,
          (cause) => new ProviderUnavailable({ reason: "could-not-answer", detail: `${cause}` })
        )
      }))

    return Provider.of({ id: "on-device", model: host.model, chat })
  })
)

/**
 * Build the on-device Provider, falling back when the machine has no model.
 *
 * The fallback is applied at the layer level, so the substitution is invisible
 * to every caller and no code anywhere branches on which Provider it got.
 */
export const orElse = <E, R>(
  fallback: Layer.Layer<Provider, E, R>
): Layer.Layer<Provider, E, R | OnDeviceHost> =>
  layer.pipe(Layer.catchTag("OnDeviceUnavailable", () => fallback))

/** Split the conversation into what Chrome's session API wants. */
const exchangeOf = (turns: ReadonlyArray<Turn>): Exchange => {
  const instructions = turns
    .filter((turn) => turn.speaker === "instruction")
    .map((turn) => turn.text)
    .join("\n\n")

  const spoken = turns.filter((turn) => turn.speaker !== "instruction")
  const last = spoken.at(-1)

  return {
    instructions,
    history: spoken.slice(0, -1).map((turn) => ({ spoken: turn.speaker === "provider", text: turn.text })),
    prompt: last === undefined ? instructions : last.text
  }
}

const asAvailability = (raw: string): Availability => {
  switch (raw) {
    case "available":
    case "downloading":
    case "downloadable":
      return raw
    default:
      return "unavailable"
  }
}

/**
 * Chrome's global, as much of it as we use.
 *
 * TypeScript ships no types for it, so these are ours. `promptStreaming`
 * returns a `ReadableStream` that Chrome has made async-iterable since 124;
 * both halves are declared because the DOM lib only carries the iterable half
 * behind a separate `lib` entry, and requiring that entry of every consumer of
 * this package would be a strange thing to inflict for one method.
 */
interface BrowserSession {
  readonly promptStreaming: (input: string) => AsyncIterable<string>
  readonly destroy: () => void
}

interface BrowserLanguageModel {
  readonly availability: () => Promise<string>
  readonly create: (options: {
    readonly initialPrompts: ReadonlyArray<{ readonly role: "system" | "user" | "assistant"; readonly content: string }>
  }) => Promise<BrowserSession>
}

const browserLanguageModel = (): BrowserLanguageModel | undefined =>
  (globalThis as { LanguageModel?: BrowserLanguageModel }).LanguageModel
