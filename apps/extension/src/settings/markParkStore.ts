/**
 * Persistence for where the reader parked the on-page mark.
 *
 * Its own document rather than a field on {@link ReaderSettings}: parking the
 * mark is furniture, not a privacy decision, and the settings document is the
 * one place every Lookup reads. A drag must not rewrite that document.
 *
 * Built as a service over the same Cache-API {@link Storage} Settings uses, and
 * merged into the Pipeline so the background can read it without reaching for
 * a store that the outer context never exposes.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { asText, Storage } from "@parle/browser/Storage"
import {
  DEFAULT_MARK_PARK,
  type MarkPark,
  parkOf,
  readPark
} from "../view/MarkPark.ts"

export const MARK_PARK_KEY = "parle/mark-park"

export class MarkParkStore extends Context.Service<
  MarkParkStore,
  {
    readonly current: Effect.Effect<MarkPark>
    readonly save: (park: MarkPark) => Effect.Effect<MarkPark>
  }
>()("parle/MarkParkStore") {
  static readonly layer = Layer.effect(
    MarkParkStore,
    Effect.gen(function*() {
      const store = yield* Storage

      const current = Effect.gen(function*() {
        const held = yield* store.get(MARK_PARK_KEY).pipe(
          Effect.catch(() => Effect.succeed(Option.none<Uint8Array>()))
        )
        if (Option.isNone(held)) return DEFAULT_MARK_PARK
        return readPark(asText(held.value)) ?? DEFAULT_MARK_PARK
      })

      const save = Effect.fn("MarkParkStore.save")(function*(park: MarkPark) {
        const next = parkOf(park.x, park.y)
        yield* store.set(MARK_PARK_KEY, JSON.stringify(next)).pipe(
          Effect.catch(() => Effect.void)
        )
        return next
      })

      return MarkParkStore.of({ current, save })
    })
  )
}
