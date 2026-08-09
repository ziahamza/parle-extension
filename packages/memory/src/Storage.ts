/**
 * The narrow slice of browser storage the reader's two stores actually need.
 *
 * `@parle/browser` owns the real `Storage` — the Cache API layer that ADR 0003's
 * no-direct-`chrome.*` rule requires, and that ticket 13 forced (`storage.local`
 * JSON-stringifies a `Uint8Array` and blows the quota). This module deliberately
 * restates the *smallest* interface this package can be written against, so the
 * two can be built in parallel and the integrator wires one to the other.
 *
 * Four effects, and the fourth is the one that is easy to leave out and
 * impossible to add later: {@link Storage.keys} — enumeration under a prefix.
 * Without it neither store can honour a scoped `forget`, and `forget` is not a
 * convenience here, it is the clause ADR 0012 promises the reader. `KeyValueStore`
 * in `effect/unstable/persistence` has `get`/`set`/`remove`/`clear` but *no*
 * enumeration, so an adapter over it cannot implement this interface — the real
 * layer must reach the underlying store's own key listing.
 *
 * Every operation is fallible. Callers in this package are not: both stores
 * convert a `StorageUnavailable` into a logged nothing, because MV3 kills the
 * service worker without running finalizers and a store that widened the error
 * channel would take an Enquiry down with it.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

/**
 * Storage could not be read or written.
 *
 * Carries the operation and key rather than the underlying cause, because the
 * only consumer is a log line: no caller in this package branches on it, and
 * none of them may propagate it.
 */
export class StorageUnavailable extends Schema.TaggedError<StorageUnavailable>()("StorageUnavailable", {
  operation: Schema.String,
  key: Schema.String,
  detail: Schema.String
}) {}

/**
 * A string-keyed, string-valued store with prefix enumeration.
 *
 * Values are strings, not bytes: everything either store holds is a small JSON
 * document, and keeping bytes out of the interface keeps the quota hazard that
 * motivated the Cache API from re-entering through this seam.
 */
export class Storage extends Context.Service<Storage, {
  readonly get: (key: string) => Effect.Effect<Option.Option<string>, StorageUnavailable>
  readonly set: (key: string, value: string) => Effect.Effect<void, StorageUnavailable>
  readonly remove: (key: string) => Effect.Effect<void, StorageUnavailable>
  /** Every key beginning with `prefix`. Scoped `forget` is written on top of this. */
  readonly keys: (prefix: string) => Effect.Effect<ReadonlyArray<string>, StorageUnavailable>
}>()("parle/memory/Storage") {
  /**
   * An in-process store.
   *
   * Not only a test double: a Safari extension can be denied persistent storage
   * outright, and a reader whose Recollection lives for one worker lifetime is
   * strictly better off than one whose panel fails to render.
   *
   * The backing map is caller-supplied so a test can inspect exactly what was
   * written — which is how this package proves the Lookup Record's keys carry no
   * plaintext.
   */
  static readonly memory = (backing: Map<string, string> = new Map()): Layer.Layer<Storage> =>
    Layer.succeed(Storage)(Storage.of({
      get: (key) => Effect.sync(() => Option.fromNullishOr(backing.get(key))),
      set: (key, value) => Effect.sync(() => backing.set(key, value)).pipe(Effect.asVoid),
      remove: (key) => Effect.sync(() => backing.delete(key)).pipe(Effect.asVoid),
      keys: (prefix) => Effect.sync(() => Array.from(backing.keys()).filter((k) => k.startsWith(prefix)))
    }))

  /**
   * A store where every operation fails.
   *
   * The interesting layer, not the degenerate one: it is what proves the
   * totality claim — that a reader whose disk is full or whose storage was
   * revoked still gets a rendered panel rather than a failed Enquiry.
   */
  static readonly unavailable = (detail = "storage denied"): Layer.Layer<Storage> =>
    Layer.succeed(Storage)(Storage.of({
      get: (key) => Effect.fail(new StorageUnavailable({ operation: "get", key, detail })),
      set: (key) => Effect.fail(new StorageUnavailable({ operation: "set", key, detail })),
      remove: (key) => Effect.fail(new StorageUnavailable({ operation: "remove", key, detail })),
      keys: (key) => Effect.fail(new StorageUnavailable({ operation: "keys", key, detail }))
    }))
}

/**
 * Run a storage operation for its effect only, logging and discarding any way it
 * can go wrong.
 *
 * Catches the whole `Cause`, not just the typed failure: a real Cache API layer
 * that throws rather than failing would otherwise turn a full disk into a defect
 * that kills the fiber that was writing, and in MV3 that fiber is usually the one
 * holding the reader's Enquiry.
 */
export const swallow = <A, E, R>(
  self: Effect.Effect<A, E, R>,
  what: string
): Effect.Effect<void, never, R> =>
  self.pipe(
    Effect.asVoid,
    Effect.catchCause((cause) => Effect.logWarning(`${what} could not be written`, cause))
  )

/**
 * Run a storage write, logging any way it can go wrong and reporting whether it
 * landed.
 *
 * {@link swallow} is right almost everywhere: a write that did not happen costs
 * the reader a cache hit and nothing else. It is wrong in the one place where a
 * *later* step destroys what the failed write was supposed to have copied — a
 * merge — because there the swallowed failure turns "this write did not happen"
 * into "these Mentions no longer exist anywhere". A caller that is about to
 * delete something must be able to see whether the copy succeeded.
 */
export const attempted = <A, E, R>(
  self: Effect.Effect<A, E, R>,
  what: string
): Effect.Effect<boolean, never, R> =>
  self.pipe(
    Effect.as(true),
    Effect.catchCause((cause) => Effect.logWarning(`${what} could not be written`, cause).pipe(Effect.as(false)))
  )

/**
 * Run a storage read, logging and substituting a value for any way it can go
 * wrong.
 *
 * The substitute is always the *empty* answer — no Mentions, no Lookup Record
 * entry. That is the honest reading of an unreadable store, and it is also the
 * safe one for Recollection. It is deliberately the *unsafe* direction for the
 * Lookup Record, where it means "we have no evidence we asked" and a Lookup that
 * was already issued may be issued again; see the note there.
 */
export const substitute = <A, E, R>(
  self: Effect.Effect<A, E, R>,
  fallback: A,
  what: string
): Effect.Effect<A, never, R> =>
  self.pipe(
    Effect.catchCause((cause) => Effect.logWarning(`${what} could not be read`, cause).pipe(Effect.as(fallback)))
  )
