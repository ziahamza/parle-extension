/**
 * The Local Discussion Cache on disk — and the seam that keeps Harvest's rows
 * apart from a Lookup's.
 *
 * ADR 0012's whole argument for persisting anything is a claim about
 * *provenance*: a cache filled by Harvest holds what the reader saw on pages
 * they had already opened, so it discloses nothing extra; a cache filled by
 * **Lookups** is a durable, plaintext record of everywhere they browsed. The two
 * are the same rows with opposite privacy properties, so the only safe design is
 * one where a Lookup-derived Mention *cannot reach the disk* — not one where it
 * is merely not supposed to.
 *
 * That is what this file is. There is exactly one durable store, {@link LocalCache},
 * and exactly two views onto it:
 *
 *   - {@link LocalCache.kept} — read and write. Provided to the `Recollection`
 *     that {@link @parle/harvest}'s `Harvester` writes through, and to nothing
 *     else. It is the only path in this app by which a Mention reaches disk.
 *   - {@link readThrough} — reads fall through to disk, **writes stay in the
 *     heap**. Provided to the `Recollection` the Enquiry holds. `Enquiry.publish`
 *     calls `remember` on every Lookup answer; through this view that write
 *     lands in a `Map` that dies with the service worker, exactly as it did
 *     before anything was persisted at all.
 *
 * So the separation is not a rule anyone has to follow. A Lookup-derived Mention
 * travelling to disk would require someone to hand the Enquiry the other view,
 * which is a visible change to `app/Pipeline.ts` rather than a slip inside a
 * function.
 *
 * **Removals go both ways, and only removals.** `remove` clears the heap *and*
 * the disk, because ADR 0015's "forget everything" is asked of the store the
 * running worker is holding and must not leave the durable copy behind for the
 * next worker to answer from. A removal can never be a disclosure; it is the
 * only asymmetry here and it points the safe way.
 *
 * **Bounded, and sized for iOS.** ADR 0012 names iOS Safari as the constraining
 * platform for storage, so the bound lives here rather than in a comment about
 * how few Mentions a reader is likely to accumulate. See {@link Bound}.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import { asText, Storage as Bytes } from "@parle/browser/Storage"
import { Storage as Kept, StorageUnavailable } from "@parle/memory/Storage"

/**
 * Everything the reader's own machine holds about Discussions lives under this
 * one root.
 *
 * One root rather than several because it is what makes both clearing controls
 * a prefix sweep: `settings/Forgetting.ts` clears this and the Lookup Record
 * separately, and a fourth store that grew its own root would be cleared by
 * neither and reported by nothing.
 */
export const CACHE_ROOT = "parle/recollection/"

/**
 * How much of the reader's disk the Local Discussion Cache may use.
 *
 * **Entries, not bytes**, because the store this sits on counts keys and not
 * bytes, and a byte budget it could not measure would be a number that looks
 * enforced and is not.
 *
 * The numbers are set for **iOS Safari**, which ADR 0012 names as the
 * constraining platform: a web extension there shares the app's storage budget
 * and is evicted by the system without warning under pressure, so the target is
 * "small enough that nothing else is put at risk", not "as much as Chrome would
 * allow". Four rows are written per harvested page at the very most — a
 * Subject's Mentions, a Discussion's Observation, an alias pointer, a
 * Discussion's title — and each is a short JSON document, so 4,000 entries is
 * roughly 2–4 MB and holds several thousand harvested pages.
 *
 * `entryBytes` is the second bound and the one that stops a single pathological
 * row from spending the whole budget. `Recollection` already caps Mentions per
 * Subject at 100, so a legitimate row is far below this; a row that is not is a
 * bug we would rather drop than persist.
 */
export interface Bound {
  readonly entries: number
  readonly entryBytes: number
}

export const defaultBound: Bound = { entries: 4_000, entryBytes: 64 * 1024 }

/**
 * The durable half of the Local Discussion Cache: a bounded, prefix-enumerable
 * key/value store over `@parle/browser`'s byte store.
 *
 * A `Context.Service` of its own rather than a second `Storage` layer, because
 * two different `Recollection`s are built over it and both would otherwise be
 * asking for the same tag. This one is built once; the views are values.
 */
export class LocalCache extends Context.Service<LocalCache, {
  /** Read and write. The Harvest-filled half, and the only path to disk. */
  readonly kept: Kept["Service"]
}>()("parle/extension/harvest/LocalCache") {
  static readonly layerWith = (bound: Bound): Layer.Layer<LocalCache, never, Bytes> =>
    Layer.effect(
      LocalCache,
      Effect.gen(function*() {
        const bytes = yield* Bytes

        /**
         * The keys under {@link CACHE_ROOT}, oldest write first.
         *
         * A `Map` used as an insertion-ordered set, filled lazily on the first
         * write from the store's own key order — which the Cache API defines as
         * insertion order, so a worker that has just started evicts in the same
         * order the one before it would have.
         *
         * **FIFO, deliberately, and not LRU.** Recording an access time means a
         * write on every read, and on the platform this bound exists for that is
         * the wrong trade twice over: it doubles the store's traffic and it makes
         * reading the cache — the free, disclosure-less thing — cost as much as
         * filling it. Oldest-harvest-first is also the right order on the merits:
         * what falls off is the pages the reader saw longest ago.
         */
        const order = yield* Ref.make<Map<string, true> | null>(null)

        const known = Effect.gen(function*() {
          const held = yield* Ref.get(order)
          if (held !== null) return held
          const all = yield* bytes.keys.pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("the Local Discussion Cache could not be enumerated", cause).pipe(
                Effect.as<ReadonlyArray<string>>([])
              )
            )
          )
          const made = new Map<string, true>()
          for (const key of all) if (key.startsWith(CACHE_ROOT)) made.set(key, true)
          yield* Ref.set(order, made)
          return made
        })

        const fault = (operation: string, key: string, detail: string) =>
          new StorageUnavailable({ operation, key, detail })

        const get = (key: string) =>
          bytes.get(key).pipe(
            Effect.map(Option.map(asText)),
            Effect.catch((cause) => Effect.fail(fault("get", key, String(cause.cause))))
          )

        /**
         * Write, evicting whatever no longer fits.
         *
         * Eviction happens BEFORE the write rather than after it, so the store
         * never transiently holds more than the bound — which is the moment a
         * platform under pressure would choose to evict the whole thing rather
         * than one row of it.
         */
        const set = Effect.fn("LocalCache.set")(function*(key: string, value: string) {
          if (value.length > bound.entryBytes) {
            yield* Effect.logWarning(
              `the Local Discussion Cache refused a ${value.length}-byte row`
            ).pipe(Effect.annotateLogs({ key }))
            return
          }
          const held = yield* known
          if (!held.has(key)) {
            while (held.size >= bound.entries) {
              const oldest = held.keys().next()
              if (oldest.done === true) break
              held.delete(oldest.value)
              yield* bytes.remove(oldest.value).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("the Local Discussion Cache could not evict a row", cause)
                )
              )
            }
          }
          yield* bytes.set(key, value).pipe(
            Effect.catch((cause) => Effect.fail(fault("set", key, String(cause.cause))))
          )
          // Recorded only once the write landed. A key counted for a write that
          // failed is a slot the bound spends on nothing.
          held.delete(key)
          held.set(key, true)
        })

        const remove = Effect.fn("LocalCache.remove")(function*(key: string) {
          const held = yield* known
          held.delete(key)
          yield* bytes.remove(key).pipe(
            Effect.catch((cause) => Effect.fail(fault("remove", key, String(cause.cause))))
          )
        })

        const keys = Effect.fn("LocalCache.keys")(function*(prefix: string) {
          const all = yield* bytes.keys.pipe(
            Effect.catch((cause) => Effect.fail(fault("keys", prefix, String(cause.cause))))
          )
          return all.filter((key) => key.startsWith(prefix))
        })

        return LocalCache.of({ kept: Kept.of({ get, set, remove, keys }) })
      })
    )

  static readonly layer: Layer.Layer<LocalCache, never, Bytes> = LocalCache.layerWith(defaultBound)
}

/**
 * The view the Enquiry gets: everything the disk holds is readable, and nothing
 * it writes reaches the disk.
 *
 * `set` lands in a heap `Map` that shadows the durable row for as long as this
 * service worker lives. That is not a compromise on the cache's behalf — it is
 * exactly what the previous build did with every Mention, and it is the whole of
 * ADR 0012's disclosure argument: a Lookup-derived Mention is a record of a page
 * the reader *visited*, and it may live in the worker's heap and nowhere else.
 *
 * Shadowing is also what makes `Recollection.remember` correct across the seam
 * without knowing about it. It reads the row, folds the arriving Mentions into
 * whatever was already there — harvested rows included — and writes the whole
 * row back; the heap copy then answers with the union, and the durable copy is
 * untouched underneath it.
 *
 * `remove` is the one operation that reaches through, for the reason in the file
 * header: forgetting must be able to forget.
 */
export const readThrough = (beneath: Kept["Service"]): Kept["Service"] => {
  const heap = new Map<string, string>()
  /** Keys this view has deleted, so a removal is not undone by a fall-through read. */
  const dropped = new Set<string>()

  return Kept.of({
    get: (key) =>
      Effect.suspend(() => {
        const held = heap.get(key)
        if (held !== undefined) return Effect.succeed(Option.some(held))
        if (dropped.has(key)) return Effect.succeed(Option.none<string>())
        return beneath.get(key)
      }),
    set: (key, value) =>
      Effect.sync(() => {
        heap.set(key, value)
        dropped.delete(key)
      }),
    remove: (key) =>
      Effect.suspend(() => {
        heap.delete(key)
        dropped.add(key)
        return beneath.remove(key)
      }),
    keys: (prefix) =>
      Effect.map(
        // A failure to enumerate the durable half must not hide the heap half:
        // the heap is where this worker's own writes are, and a scoped `forget`
        // that skipped them would report success having cleared nothing the
        // reader can currently see.
        beneath.keys(prefix).pipe(Effect.catch(() => Effect.succeed<ReadonlyArray<string>>([]))),
        (durable) => {
          const all = new Set(durable.filter((key) => !dropped.has(key)))
          for (const key of heap.keys()) if (key.startsWith(prefix)) all.add(key)
          return [...all]
        }
      )
  })
}
