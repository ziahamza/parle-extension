/**
 * Byte storage for the extension, over the Cache API rather than `storage.local`.
 *
 * The choice is measured, not stylistic. `storage.local` serialises through
 * structured-clone-to-JSON, which turns a `Uint8Array` into `{"0":31,"1":139,…}`
 * — roughly an order of magnitude larger than the bytes, and enough to blow the
 * quota on the shipped Discussion Index alone. The Cache API stores a response
 * body verbatim, has a far larger budget, and exists on every target including
 * Safari on iOS.
 *
 * The interface is deliberately `KeyValueStore`-shaped — six effects, no
 * transactions, no queries — so `Recollection` and the `Lookup Record` can sit
 * on it without either learning what a Cache is, and so a different backing
 * store is a layer swap rather than a rewrite.
 *
 * Values are bytes in both directions. A store that returned `string` would
 * have every binary caller round-trip through base64 (a third larger, and a
 * copy), and a store that guessed would eventually guess wrong. `set` accepts a
 * string as a convenience and encodes as UTF-8; {@link asText} decodes back.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { WebExt } from "./WebExtApi.ts"

/**
 * Storage did not do what it was asked.
 *
 * Carries the operation and the key because the interesting failures — quota
 * exhausted, the Cache API absent, the service worker torn down mid-write —
 * are indistinguishable from the call site otherwise.
 */
export class StorageFault extends Schema.TaggedError<StorageFault>()("StorageFault", {
  operation: Schema.Literals(["get", "set", "remove", "clear", "keys", "has"]),
  key: Schema.String,
  cause: Schema.Defect()
}) {}

export class Storage extends Context.Service<Storage, {
  /** `Option.none` is "not held", which is not a failure. */
  readonly get: (key: string) => Effect.Effect<Option.Option<Uint8Array>, StorageFault>
  readonly set: (key: string, value: Uint8Array | string) => Effect.Effect<void, StorageFault>
  readonly remove: (key: string) => Effect.Effect<void, StorageFault>
  readonly clear: Effect.Effect<void, StorageFault>
  readonly keys: Effect.Effect<ReadonlyArray<string>, StorageFault>
  /** Answers without reading the value, so a membership test is cheap. */
  readonly has: (key: string) => Effect.Effect<boolean, StorageFault>
}>()("parle/browser/Storage") {
  static readonly layer = Layer.effect(
    Storage,
    Effect.gen(function*() {
      const platform = yield* WebExt
      const store = platform.store

      const faulting = <A>(
        operation: StorageFault["operation"],
        key: string,
        attempt: () => Promise<A>
      ) =>
        Effect.tryPromise({
          try: attempt,
          catch: (cause) => new StorageFault({ operation, key, cause })
        })

      const get = Effect.fn("Storage.get")(function*(key: string) {
        const held = yield* faulting("get", key, () => store.get(key))
        return Option.fromUndefinedOr(held)
      })

      const set = Effect.fn("Storage.set")(function*(key: string, value: Uint8Array | string) {
        yield* faulting("set", key, () => store.set(key, asBytes(value)))
      })

      const remove = Effect.fn("Storage.remove")(function*(key: string) {
        yield* faulting("remove", key, () => store.remove(key))
      })

      const has = Effect.fn("Storage.has")(function*(key: string) {
        return yield* faulting("has", key, () => store.has(key))
      })

      return Storage.of({
        get,
        set,
        remove,
        has,
        clear: faulting("clear", "", () => store.clear()),
        keys: faulting("keys", "", () => store.keys())
      })
    })
  )
}

/** UTF-8, in the direction storage wants. */
export const asBytes = (value: Uint8Array | string): Uint8Array =>
  typeof value === "string" ? new TextEncoder().encode(value) : value

/** UTF-8, in the direction a caller wants. */
export const asText = (value: Uint8Array): string => new TextDecoder().decode(value)
