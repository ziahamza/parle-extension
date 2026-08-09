/**
 * A platform event source attached NOW and read later.
 *
 * MV3 decides whether to wake a killed service worker for an event by looking
 * at which listeners were attached during the worker's *initial evaluation*.
 * A listener attached after an `await` belongs to a worker the browser will not
 * wake again — and, worse, the very event that woke this worker is delivered
 * during that first turn and is simply dropped if nothing is listening yet.
 * Measured on Chrome 151: a registration 33ms late missed the navigation that
 * started its own worker.
 *
 * Everything in this codebase that consumes a platform event does so through a
 * `Stream`, and a `Stream` is lazy by construction: `Stream.callback`'s acquire
 * effect runs when the stream is first *run*, which is a layer build and a
 * fiber schedule away — 20 to 50 milliseconds, measured. The two requirements
 * are therefore in direct conflict, and this is the seam that resolves it:
 *
 *   - `relay(attach)` calls `attach` **synchronously, at construction**, so the
 *     raw `addListener` happens in whatever turn the caller is in. Call it in
 *     the worker's first turn and the listener is a first-turn listener.
 *   - Events that arrive before anyone is reading are held, and handed over in
 *     order the moment a reader appears. Nothing is dropped in the gap.
 *
 * The buffer is unbounded, for the same reason `Tabs.sightings` is: these
 * sources are inherently low-rate, the gap this covers is milliseconds, and a
 * bounded buffer that silently discarded an offer would reintroduce exactly the
 * invisible false negative the seam exists to remove.
 *
 * Nothing here detaches the raw listener, and that is deliberate rather than an
 * omission — see `Runtime.ts`: an MV3 worker is killed with no notice and no
 * finalizers, so a listener's lifetime IS the worker's. `watch` returns a way
 * to stop *reading*, which is what a closing surface needs; the underlying
 * registration stays, which is what the browser needs in order to wake us.
 */
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"

/** Stop reading. The underlying platform listener stays attached. */
export type Unwatch = () => void

export interface Relay<A> {
  /**
   * Take everything held since arming, then everything after it, then the end.
   *
   * `end` fires only for sources that finish — a port that disconnects. A
   * source like `webNavigation.onCommitted` never calls it.
   */
  readonly watch: (take: (value: A) => void, end?: () => void) => Unwatch
}

/**
 * Attach a platform listener right now and relay what it reports.
 *
 * `attach` is called before this function returns. Whatever turn the caller is
 * in is the turn the listener is registered in, which is the whole point.
 */
export const relay = <A>(
  attach: (emit: (value: A) => void, close: () => void) => void
): Relay<A> => {
  const held: Array<A> = []
  const readers = new Set<{ take: (value: A) => void; end: (() => void) | undefined }>()
  let ended = false

  attach(
    (value) => {
      if (ended) return
      if (readers.size === 0) {
        held.push(value)
        return
      }
      for (const reader of readers) reader.take(value)
    },
    () => {
      if (ended) return
      ended = true
      for (const reader of readers) reader.end?.()
    }
  )

  return {
    watch: (take, end) => {
      const reader = { take, end }
      readers.add(reader)
      // Spliced out before delivery: a reader that emits back into this relay
      // while draining must not see its own backlog twice.
      if (held.length > 0) {
        for (const value of held.splice(0, held.length)) take(value)
      }
      if (ended) end?.()
      return () => {
        readers.delete(reader)
      }
    }
  }
}

/**
 * The relay as a Stream.
 *
 * `Stream.callback` is still lazy — this does not change that and does not need
 * to. By the time anything runs this, the listener has been attached for
 * however long the runtime took to come up, and the backlog is waiting.
 */
export const streamOf = <A>(source: Relay<A>): Stream.Stream<A> =>
  Stream.callback<A>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        source.watch(
          (value) => {
            Queue.offerUnsafe(queue, value)
          },
          () => {
            Queue.endUnsafe(queue)
          }
        )
      ),
      (unwatch) => Effect.sync(unwatch)
    )
  )
