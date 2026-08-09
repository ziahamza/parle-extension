/**
 * The AI seam: one key, one method, three implementations behind it.
 *
 * The method is `chat`, and it streams. That is ADR 0008's obligation — the
 * panel hosts a conversation rather than a document from day one — discharged
 * at zero cost: v1 collapses the stream with `Stream.mkString`, and v2's
 * fact-check runs `Stream.runForEach` over the very same layer. There is
 * deliberately no one-shot `summarize`, because adding one would let v1 harden
 * around a shape v2 cannot use.
 *
 * There is also deliberately NO structured-output method. Structured generation
 * is a decode concern and it lives in `@parle/domain`'s `admit`, where the
 * Brief is supplied out of band. A `generateObject` here would make ADR 0006's
 * citation guarantee depend on which Provider happens to be connected — which
 * is exactly what ADR 0004 forbids, since the whole point of the Provider seam
 * is that no caller branches on which one is active.
 *
 * `id` and `model` exist so a Digest can be STAMPED with what wrote it. Nothing
 * branches on them; they are recorded, not consulted.
 */
import { DigestOrigin } from "@parle/domain/Digest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"

/**
 * Who is speaking in a Turn.
 *
 * `instruction` is us, `reader` is the person, `provider` is the model's own
 * prior answer. Named for the conversation rather than for any vendor's wire
 * format, because three vendors spell those three roles three different ways
 * and each implementation translates at its own edge.
 */
export const Speaker = Schema.Literals(["instruction", "reader", "provider"])
export type Speaker = typeof Speaker.Type

/** One utterance in the exchange a Provider is asked to continue. */
export class Turn extends Schema.Opaque<Turn, { readonly _brand: "Turn" }>()(
  Schema.Struct({
    speaker: Speaker,
    text: Schema.String
  })
) {}

/**
 * One contiguous piece of a Provider's answer, in arrival order.
 *
 * Deliberately a bare `string` rather than a struct. `Stream.mkString` is the
 * whole of v1's consumption of this service, and it takes a `Stream<string>`;
 * wrapping the text in an envelope would buy a field nobody reads and cost
 * every caller an unwrap. Chunk boundaries carry no meaning — they are wherever
 * the transport happened to flush — so a consumer may re-chunk freely.
 */
export type Chunk = string

/**
 * Why the connected Provider could not answer.
 *
 * The Network vocabulary (Refusal, Garble, Withholding) is deliberately NOT
 * reused here: those are facts about a Network's answer about a Subject and
 * they land in Coverage. This is a fact about the reader's own AI connection,
 * and it lands in the Digest's own failure path. The distinctions are kept for
 * the same reason, though — "you are not signed in" and "your key has no quota"
 * and "the answer arrived unusable" want different copy and different offers.
 */
export const UnavailableReason = Schema.Literals([
  /** No key, no token: the reader has connected nothing. Not a failure. */
  "not-connected",
  /** The credential was rejected — expired, revoked, or wrong. */
  "not-authorized",
  /** Asked too fast. Retryable, later. */
  "rate-limited",
  /** The credential is good and the account cannot pay for this. */
  "over-quota",
  /** The Provider accepted the request and then said it had failed. */
  "could-not-answer",
  /** We never got an answer at all — offline, DNS, TLS, 5xx. */
  "unreachable",
  /** An answer arrived and was not usable. Never retried. */
  "garbled",
  /** The on-device model is absent or was never downloaded. */
  "no-model"
])
export type UnavailableReason = typeof UnavailableReason.Type

/**
 * The only failure a Provider may produce.
 *
 * One error type across all three implementations is what lets ADR 0004 hold:
 * the Digest path handles "no AI right now" once, and connecting a different
 * Provider is the whole of the recovery story.
 */
export class ProviderUnavailable extends Schema.TaggedError<ProviderUnavailable>()("ProviderUnavailable", {
  reason: UnavailableReason,
  /** For the log and for a support thread. Never rendered as blame. */
  detail: Schema.String
}) {}

/**
 * A source of AI capability the reader has connected.
 *
 * Exactly one is active. The layers are interchangeable at this key and no
 * caller may branch on which one built it.
 */
export class Provider extends Context.Service<Provider, {
  /** Which implementation answered. Stamped into a Digest, never consulted. */
  readonly id: string
  /** Which model answered, as the Provider itself names it. */
  readonly model: string
  readonly chat: (turns: ReadonlyArray<Turn>) => Stream.Stream<Chunk, ProviderUnavailable>
}>()("parle/ai/Provider") {}

/**
 * The stamp a Digest carries to record who wrote it.
 *
 * This is the only thing `id` and `model` are for. The Digest is Local by
 * construction — a Digest written through this seam ran on the reader's machine
 * against their own Provider and never left it — so there is no branch here and
 * no way for a caller to claim otherwise.
 */
export const stampOf = (provider: Provider["Service"]): DigestOrigin =>
  DigestOrigin.cases.Local.make({ providerId: provider.id, model: provider.model })

/**
 * Keep what a Provider said before it died — a CONSUMER policy, never applied here.
 *
 * A Provider dying mid-Digest must not throw away the Findings it already
 * produced: `Stream.mkString` over a failed stream collapses the whole exchange
 * to that failure, and ~1800 tokens of the reader's own subscription — including
 * complete, correctly-cited Findings — would be discarded and blamed on their
 * model. This turns a post-first-Chunk failure into an ordinary end of stream.
 *
 * **It is deliberately NOT applied inside `chat`.** It used to be, in all three
 * Provider layers, and that was a real defect: converting the failure to an
 * empty stream at the seam destroys the only evidence that anything went wrong,
 * so a consumer cannot distinguish "the Provider finished" from "the Provider
 * died after speaking" — and `@parle/digest` recorded `completeness: "complete"`
 * for a truncated answer. Writing the rule out downstream of the thing that
 * erased the signal cannot reconstruct it.
 *
 * So `chat` reports failure honestly, and whoever consumes it decides what a
 * partial answer is worth. `@parle/digest` does exactly that, and marks the
 * Digest partial — which it could not do while this ran here.
 *
 * Kept exported because the policy is right; only its location was wrong.
 *
 * `catchTag` rather than `catchCause` is load-bearing — interruption and
 * defects must still propagate, or a cancelled Reading would look like a
 * complete short answer.
 */
export const keepWhatArrived = <R>(
  chunks: Stream.Stream<Chunk, ProviderUnavailable, R>
): Stream.Stream<Chunk, ProviderUnavailable, R> =>
  Stream.unwrap(Effect.map(Ref.make(false), (spoke) =>
    chunks.pipe(
      Stream.tap(() => Ref.set(spoke, true)),
      Stream.catchTag("ProviderUnavailable", (unavailable) =>
        Stream.unwrap(Effect.map(
          Ref.get(spoke),
          (hasSpoken): Stream.Stream<Chunk, ProviderUnavailable> =>
            hasSpoken ? Stream.empty : Stream.fail(unavailable)
        )))
    )))

/**
 * What an HTTP status means for a Provider.
 *
 * Shared by BYOK and Codex because both speak to OpenAI-shaped endpoints and
 * both must distinguish "your credential is bad" from "your account cannot pay"
 * from "we could not reach anyone" — three different things to tell the reader.
 */
export const unavailableForStatus = (status: number, detail: string): ProviderUnavailable =>
  new ProviderUnavailable({
    reason: status === 401 || status === 403
      ? "not-authorized"
      : status === 402
      ? "over-quota"
      : status === 429
      ? "rate-limited"
      : status >= 500
      ? "unreachable"
      : "garbled",
    detail
  })
