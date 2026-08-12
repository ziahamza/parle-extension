/**
 * Background ↔ panel and background ↔ content script, over `chrome.runtime`.
 *
 * Deliberately not `effect/unstable/rpc`. It fits this problem beautifully and
 * costs roughly 135 kB gzip **on each side of the boundary** — background and
 * panel both — which on Safari for iOS, the constraining platform of ADR 0003,
 * is not a rounding error. The whole surface a browser extension needs is "send
 * a note, maybe get one back, and be told when one arrives", so that is the
 * whole surface here.
 *
 * The transport is untyped because the platform's is: `runtime.sendMessage`
 * structured-clones whatever it is handed, from any surface, including other
 * extensions and any content script the reader has installed. Typing is
 * therefore applied at the receiving edge, by {@link decoded}, which decodes
 * with a Schema and **drops** what does not decode. Dropping is the point: a
 * panel that failed on a stray note would be taken down by an unrelated
 * extension's broadcast.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { type Correspondent, type Delivery, type TabId, WebExt } from "./WebExtApi.ts"
import { type Json } from "@parle/domain/Refine"

/**
 * A note could not be delivered.
 *
 * Overwhelmingly this is "the other side is not there": the panel is closed, or
 * the MV3 worker has been torn down and not yet woken. That is ordinary, not
 * exceptional, which is why it is a typed failure rather than a defect.
 */
export class MessagingFault extends Schema.TaggedError<MessagingFault>()("MessagingFault", {
  to: Schema.NullOr(Schema.Number),
  cause: Schema.Defect()
}) {}

/** One inbound note that decoded, and the channel back to its sender. */
export interface Note<A> {
  readonly note: A
  readonly from: Correspondent
  readonly reply: (note: Json) => Effect.Effect<void>
}

export class Messaging extends Context.Service<Messaging, {
  /** Send and forget the reply. `to` absent means the extension's own pages. */
  readonly tell: (note: Json, to?: TabId) => Effect.Effect<void, MessagingFault>
  /** Send and keep the reply. The reply is unknown; decode it. */
  readonly ask: (note: Json, to?: TabId) => Effect.Effect<unknown, MessagingFault>
  /**
   * Every note the extension is handed, undecoded.
   *
   * Unbounded, for the same reason as `Tabs.sightings`: the platform hands
   * notes to a synchronous callback, and a bounded queue would refuse one with
   * no failure anywhere.
   */
  readonly deliveries: Stream.Stream<Delivery>
}>()("parle/browser/Messaging") {
  static readonly layer = Layer.effect(
    Messaging,
    Effect.gen(function*() {
      const platform = yield* WebExt

      const send = (note: Json, to: TabId | undefined) =>
        Effect.tryPromise({
          try: () => platform.messages.send(note, to),
          catch: (cause) => new MessagingFault({ to: to ?? null, cause })
        })

      const tell = Effect.fn("Messaging.tell")(function*(note: Json, to?: TabId) {
        yield* send(note, to)
      })

      const ask = Effect.fn("Messaging.ask")(function*(note: Json, to?: TabId) {
        return yield* send(note, to)
      })

      const deliveries = Stream.callback<Delivery>((inbox) =>
        Effect.acquireRelease(
          Effect.sync(() =>
            platform.messages.watch((delivery) => {
              Queue.offerUnsafe(inbox, delivery)
            })
          ),
          (unwatch) => Effect.sync(unwatch)
        )
      )

      return Messaging.of({ tell, ask, deliveries })
    })
  )
}

/**
 * The typed edge: decode inbound notes, drop what does not belong to us.
 *
 * `Schema.decodeUnknownOption` rather than the Effect form on purpose — a note
 * we do not recognise is not a failure to report, and routing it through an
 * error channel would make every consumer write the same `catch` that throws it
 * away.
 */
export const decoded = <A, I, RE>(
  deliveries: Stream.Stream<Delivery>,
  note: Schema.Codec<A, I, never, RE>
): Stream.Stream<Note<A>> => {
  const decode = Schema.decodeUnknownOption(note)
  return deliveries.pipe(
    Stream.filterMap((delivery: Delivery) =>
      Option.match(decode(delivery.note), {
        onNone: () => Result.fail(delivery),
        onSome: (decodedNote): Result.Result<Note<A>, Delivery> =>
          Result.succeed({
            note: decodedNote,
            from: delivery.from,
            reply: (answer: Json) => Effect.sync(() => delivery.reply(answer))
          })
      })
    )
  )
}
