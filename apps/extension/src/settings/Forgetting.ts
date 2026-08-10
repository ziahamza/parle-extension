/**
 * The two clearing controls ADR 0015 requires, over the store this app actually
 * wires.
 *
 * `@parle/memory` ships a `Forget` service of exactly this shape, and this is
 * not a second implementation of it — it is the same pair of controls expressed
 * over `@parle/browser`'s byte store, which is where this app's rows really
 * live. The reason it cannot simply be `Forget` today is stated in
 * `app/Pipeline.ts`: `Recollection` sits on an in-memory store, so `Forget`
 * would clear a heap that is about to be thrown away anyway while leaving the
 * durable bytes on disk under a key nobody cleared. (`LookupRecord` IS wired
 * now — its `parle/lookup/` keys are real bytes, and the prefix sweep below is
 * what clears them.)
 *
 * So this clears **both** — the durable keys under the two roots, and the heap
 * copy the running worker is serving from — and it will keep being correct when
 * the real stores are wired, because it clears by key prefix rather than by
 * knowing what wrote them.
 *
 * **Order is load-bearing.** The Lookup Record goes first. An MV3 worker being
 * killed part-way through a clear is not exotic, and what must survive a
 * half-finished clear is harvested Mentions — the half that was never a privacy
 * liability. The other order gets that exactly backwards.
 *
 * **Settings survive `everything`.** "Forget everything" is about what we
 * remembered, not about un-saying what the reader told us. A control that
 * silently reset their exclusions, their pauses and their Network switches
 * would be the one destructive action in the product that makes them *less*
 * protected than before they pressed it.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Storage } from "@parle/browser/Storage"
import { Recollection } from "@parle/memory/Recollection"

/**
 * The key roots the two stores write under.
 *
 * They belong to `@parle/memory`, and they are restated here because this app
 * is the integrator that mounts that package's `Storage` onto the browser's —
 * so knowing the shape of the keyspace it produced is this file's business, not
 * a reach into someone else's.
 */
export const LOOKUP_RECORD_ROOT = "parle/lookup/"
export const RECOLLECTION_ROOT = "parle/recollection/"
/** Front-door judgements. Keys concealed; see `@parle/memory/FrontDoorMemory`. */
export const FRONT_DOOR_ROOT = "parle/frontdoor/"

export class Forgetting extends Context.Service<Forgetting, {
  /** The finer control: the record of what we asked, and nothing else. */
  readonly lookupRecord: Effect.Effect<void>
  /** The prominent control: both stores, one action. Settings are not touched. */
  readonly everything: Effect.Effect<void>
}>()("parle/settings/Forgetting") {
  static readonly layer: Layer.Layer<Forgetting, never, Storage | Recollection> = Layer.effect(
    Forgetting,
    Effect.gen(function*() {
      const store = yield* Storage
      const recollection = yield* Recollection

      /**
       * Remove every key under one root.
       *
       * Total, like everything else on this path: a store that will not answer
       * is not a reason to leave the reader looking at a button that reported a
       * failure they can do nothing about. It is also why this enumerates
       * rather than calling `clear` — `clear` would take the settings with it.
       */
      const under = Effect.fn("Forgetting.under")(function*(root: string) {
        const keys = yield* store.keys.pipe(
          Effect.catch(() => Effect.succeed<ReadonlyArray<string>>([]))
        )
        yield* Effect.forEach(
          keys.filter((key) => key.startsWith(root)),
          (key) => store.remove(key).pipe(Effect.catch(() => Effect.void)),
          { discard: true }
        )
      })

      /**
       * The finer control, and it takes two roots rather than one.
       *
       * Front-door judgements belong with the Lookup Record rather than with the
       * Recollection, because they are the same kind of thing: each is written
       * only after Parle looked an address up, so the set of them is a list of
       * sites the reader opened. The settings page names both under this button,
       * so this button has to clear both.
       */
      const lookupRecord = Effect.gen(function*() {
        yield* under(LOOKUP_RECORD_ROOT)
        yield* under(FRONT_DOOR_ROOT)
      })

      const everything = Effect.gen(function*() {
        yield* lookupRecord
        yield* under(RECOLLECTION_ROOT)
        // The heap the running worker is answering from. Without this the
        // panel keeps showing recalled Mentions until MV3 next kills the
        // worker, which the reader would rightly read as the button not having
        // worked.
        yield* recollection.forget({ _tag: "All" })
      })

      return Forgetting.of({ lookupRecord, everything })
    })
  )
}
