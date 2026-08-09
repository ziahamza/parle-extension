/**
 * The three volume controls that are not the reader's and not the Exclusion
 * List's: the build flag, the kill switch, and the budget.
 *
 * They are one service because they share a property nothing else in this
 * package has — they are answers about US rather than about the address, and a
 * Lookup must be re-tested against all three every single time.
 *
 * **The build flag is synchronous and total.** ADR 0001 requires a build in
 * which X session search is compiled out entirely, so that a store which
 * rejects broad `x.com` host permissions can still receive a shippable binary.
 * That is a fact fixed at bundle time, so it is a plain function: an `Effect`
 * would imply it could change, and something would eventually await it.
 *
 * **The kill switch is an `Effect`, read fresh, and never captured.** It is
 * fetched from the static artifacts on a schedule so that X access can be
 * disabled without shipping a build. The failure mode to design against is the
 * refresh failing and the gate falling OPEN, so the intended implementation
 * holds last-known-good and this signature makes "read it again inside the
 * retry loop" the natural thing to write rather than a discipline.
 *
 * **The budget is per Network and per question**, because the two questions are
 * physically different requests with separate pacing and separate limits — X
 * gets stricter limits than any other Network, and asking for a title search is
 * not the same spend as asking who submitted an address.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { Question } from "@parle/domain/Coverage"
import type { Network } from "@parle/domain/Network"

export class Controls extends Context.Service<Controls, {
  /** Fixed at bundle time. True means the code to ask is not in this binary. */
  readonly compiledOut: (network: Network) => boolean
  /**
   * The reader turned this one Network off. Their decision, and undoable by them.
   *
   * Separate from {@link killSwitched} because the two produce opposite things
   * to say: one is something the reader did and can undo, the other is
   * emphatically not. They were briefly the same call, and the panel told a
   * reader who had switched Reddit off that "automatic lookups are off".
   */
  readonly switchedOffByReader: (network: Network) => Effect.Effect<boolean>
  /**
   * We stopped ourselves, remotely, without shipping a build.
   *
   * Remotely updatable, so it must be read inside the retry loop, never before
   * it — a kill switch that is only consulted once is not a kill switch.
   */
  readonly killSwitched: (network: Network) => Effect.Effect<boolean>
  /** Whether one more Lookup of this shape fits the pacing budget. */
  readonly affords: (network: Network, question: Question) => Effect.Effect<boolean>
}>()("parle/policy/Controls") {
  /**
   * Build a Controls from whichever parts differ from permissive.
   *
   * Permissive is the right default for tests and for the ordinary build: the
   * things that close these gates — a rejected store, a broken X endpoint, a
   * reader at their limit — are all exceptional, and a default that withheld
   * everything would make every test pass for the wrong reason.
   */
  static readonly layerOf = (overrides: {
    readonly compiledOut?: (network: Network) => boolean
    readonly switchedOffByReader?: (network: Network) => Effect.Effect<boolean>
    readonly killSwitched?: (network: Network) => Effect.Effect<boolean>
    readonly affords?: (network: Network, question: Question) => Effect.Effect<boolean>
  }) =>
    Layer.succeed(
      Controls,
      Controls.of({
        compiledOut: overrides.compiledOut ?? (() => false),
        switchedOffByReader: overrides.switchedOffByReader ?? (() => Effect.succeed(false)),
        killSwitched: overrides.killSwitched ?? (() => Effect.succeed(false)),
        affords: overrides.affords ?? (() => Effect.succeed(true))
      })
    )

  /** Nothing compiled out, nothing killed, everything affordable. */
  static readonly layer = Controls.layerOf({})

  /** The build ADR 0001 requires for a store that refuses `x.com` permissions. */
  static readonly withoutX = Controls.layerOf({ compiledOut: (network) => network === "x" })
}
