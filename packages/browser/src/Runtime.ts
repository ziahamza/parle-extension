/**
 * The MV3 background service worker's entrypoint.
 *
 * An MV3 background worker is not a process. It is woken to handle an event,
 * and killed — with no notice, no `beforeunload`, and no finalizers — after
 * roughly thirty seconds of quiet. Three consequences shape this module, and
 * all three are the reason a plain `Effect.runPromise` at the top of the worker
 * is wrong:
 *
 *   1. **Listeners must be registered synchronously, in the first turn.** The
 *      browser decides whether to wake the worker for an event by looking at
 *      which listeners were registered during evaluation, and it delivers the
 *      waking event in that same turn. A listener attached after an `await`
 *      belongs to a worker that will not be woken and misses the event that
 *      started it — measured on Chrome 151: 33ms late was late enough.
 *      {@link forBackground} therefore does no async work: `ManagedRuntime`
 *      builds its layer lazily, on first run, so `start` can be called at the
 *      top of the module.
 *
 *      That is necessary and **not sufficient**, and this comment used to stop
 *      here as though it were. A synchronous `forBackground` still leaves every
 *      `addListener` inside a layer build and a `Stream.callback` acquire, tens
 *      of milliseconds later. Attaching listeners is therefore not this
 *      module's job at all: it belongs to `Relay.ts`, which is called before
 *      the runtime exists and holds what arrives until it does.
 *
 *   2. **Nothing may be deferred to teardown.** Finalizers are best-effort at
 *      most; a write that only commits on scope close does not commit. Services
 *      in this package commit eagerly for exactly this reason, and `stop` is
 *      offered for tests and for browsers that do call it, never relied upon.
 *
 *   3. **A killed worker is not a failure.** The fiber running when the worker
 *      dies is simply gone, so `start` logs a defect and moves on rather than
 *      taking anything down. `Refusal` with reason `interrupted` is the domain's
 *      word for what the caller should record.
 *
 * One runtime per worker. Two would build the layer twice and give the reader
 * two Local Discussion Caches, two rate limiters, and two of every daemon.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"

/** The handle a worker entrypoint holds. */
export interface Entrypoint<R, ER> {
  /** The underlying runtime, for anything these three helpers do not cover. */
  readonly runtime: ManagedRuntime.ManagedRuntime<R, ER>
  /**
   * Run long-lived work — a daemon, a subscription to `ReadingWatch.readings`.
   *
   * Returns the fiber so a caller that owns it can interrupt it. Failures are
   * logged rather than thrown: there is nothing above this to catch them, and
   * an unhandled rejection in an MV3 worker is invisible.
   */
  readonly start: <A, E>(work: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E | ER>
  /**
   * Run one event's worth of work and answer with it.
   *
   * The promise is the shape every platform callback wants. It rejects only on
   * a defect; a typed failure is part of `A` if the caller asked for it.
   */
  readonly handle: <A, E>(work: Effect.Effect<A, E, R>) => Promise<A>
  /** Release the layer. For tests, and for hosts that give warning. */
  readonly stop: () => Promise<void>
}

/**
 * Build the worker's runtime from its application Layer.
 *
 * Synchronous by construction — see (1) above. Call it at module scope, then
 * register every platform listener in the same turn.
 */
export const forBackground = <R, ER>(layer: Layer.Layer<R, ER, never>): Entrypoint<R, ER> => {
  const runtime = ManagedRuntime.make(layer)

  return {
    runtime,

    start: (work) =>
      runtime.runFork(
        Effect.onExit(work, (exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : Effect.logError("background work stopped", exit.cause))
      ),

    handle: (work) => runtime.runPromise(work),

    stop: () => runtime.dispose()
  }
}
