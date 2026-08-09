/**
 * Which tab the reader is in, what is in its top frame, and when that changes.
 *
 * This service reports; it does not judge. Everything here is the platform's
 * account of itself, including sub-frame Sightings and `chrome-extension://`
 * addresses. The decision about what counts as a Reading belongs to
 * `ReadingWatch`, one layer up, where it is a pure function of a Sighting
 * stream and can therefore be tested against the double.
 *
 * `topFrameAddress` exists as its own method rather than a field on `Tab`
 * because the two answer different questions at different moments: `current`
 * answers "which tab is the reader looking at", and its address may already be
 * stale by the time a Lookup returns.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { type Sighting, type Tab, type TabId, WebExt } from "./WebExtApi.ts"

/** The platform would not answer a question about tabs. */
export class TabsFault extends Schema.TaggedError<TabsFault>()("TabsFault", {
  operation: Schema.Literals(["current", "topFrameAddress"]),
  cause: Schema.Defect()
}) {}

export class Tabs extends Context.Service<Tabs, {
  /** The tab the reader is looking at, if the window has one. */
  readonly current: Effect.Effect<Option.Option<Tab>, TabsFault>
  /** The top-frame address of a tab; `Option.none` once the tab is gone. */
  readonly topFrameAddress: (id: TabId) => Effect.Effect<Option.Option<string>, TabsFault>
  /**
   * Every navigation the platform reports, in every frame, unfiltered.
   *
   * Unbounded rather than a bounded buffer: `Stream.callback` can only offer
   * synchronously from a platform callback, and a full bounded queue would
   * discard the offer with no failure and no log — the invisible false negative
   * this project keeps choosing against. Navigation is inherently low-rate, and
   * the MV3 worker is torn down long before an unbounded queue could grow.
   */
  readonly sightings: Stream.Stream<Sighting>
}>()("parle/browser/Tabs") {
  static readonly layer = Layer.effect(
    Tabs,
    Effect.gen(function*() {
      const platform = yield* WebExt

      const current = Effect.tryPromise({
        try: () => platform.tabs.active(),
        catch: (cause) => new TabsFault({ operation: "current", cause })
      }).pipe(Effect.map(Option.fromUndefinedOr))

      const topFrameAddress = Effect.fn("Tabs.topFrameAddress")(function*(id: TabId) {
        const address = yield* Effect.tryPromise({
          try: () => platform.tabs.topFrameAddress(id),
          catch: (cause) => new TabsFault({ operation: "topFrameAddress", cause })
        })
        return Option.fromUndefinedOr(address)
      })

      const sightings = Stream.callback<Sighting>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() =>
            platform.navigation.watch((sighting) => {
              Queue.offerUnsafe(queue, sighting)
            })
          ),
          (unwatch) => Effect.sync(unwatch)
        )
      )

      return Tabs.of({ current, topFrameAddress, sightings })
    })
  )
}
