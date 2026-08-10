/**
 * The three switches `LookupPolicy` reads, as this build actually implements them.
 *
 * `@parle/policy` ships a permissive `Controls.layer` — nothing compiled out,
 * nothing switched off, everything affordable — which is right for a package
 * that cannot know what artifact it ends up in. The real values are a property
 * of the build, so they are decided here.
 *
 * **`compiledOut` is a literal, not configuration.** ADR 0001 requires a flag
 * that compiles X out *entirely*, so that a store rejection delays one Network
 * rather than the whole release. A literal `false` lets the bundler fold the
 * branch and drop the request path from the artifact, which makes the claim
 * checkable by reading the shipped file. An environment variable would leave
 * the code in the bundle and turn a verifiable property into a promise.
 *
 * **`switchedOffByReader` is the reader's own per-Network switch; `killSwitched`
 * is ours, and this build has no backend to hear it from.** They were one call
 * until the panel started telling readers who had switched Reddit off that
 * "automatic lookups are off" — opposite facts, one the reader did and can
 * undo, one they did not. ADR 0011's remote switch wants
 * `Resource.auto(fetchManifest, …)` holding last-known-good, so a failed
 * refresh leaves the previous answer rather than opening the gate. There is
 * nothing to refresh from here, so it stays honestly `false` rather than
 * pretending: a switch reporting `true` on a fetch failure would disable the
 * product on every offline start.
 *
 * Both are checked BEFORE the `initiative === "automatic"` branch, which is the
 * detail that matters: a Network the reader switched off stays off even when
 * they open the toolbar. Routing it through the Exclusion List or manual mode
 * instead would let an explicit Ask override it, and "off" would quietly mean
 * "off until you click". ADR 0014 requires each Network's ambient access to be
 * switchable off in one click and to STAY off; this is where that is true.
 *
 * The cost is stated plainly: `WithholdingReason` has one literal for "a switch
 * turned this off", so the panel says "it is switched off" without saying whose
 * switch. That is a gap in the shared vocabulary of `@parle/domain`, not a
 * decision taken here, and it is the same conflation manual mode already lives
 * with.
 *
 * **`affords` is a stop on one runaway worker lifetime, and says so.** MV3
 * restarts the worker freely, so this is not a daily cap and does not pretend
 * to be one. The thing that would make "at most once per long TTL" true across
 * lifetimes is the Lookup Record paired with a persisted Local Discussion
 * Cache; see the README for why neither is wired yet.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import type { Network } from "@parle/domain/Network"
import { Controls } from "@parle/policy/Controls"
import { Settings } from "../settings/Settings.ts"

/**
 * Whether the code that asks X is in this binary.
 *
 * A literal so a bundler can fold it. Nothing branches on it except
 * `LookupPolicy`, which turns it into a Withholding the reader can see.
 */
export const X_LOOKUP_COMPILED_IN = false

/**
 * How many Lookups one service-worker lifetime may issue, per Network.
 *
 * Counted per Network rather than in one pool so that a page which sends Reddit
 * into a retry storm cannot spend Hacker News' allowance — Hacker News is the
 * Network that has to work, and it is the cheapest to ask.
 */
export const LOOKUPS_PER_LIFETIME = 120

export const layer: Layer.Layer<Controls, never, Settings> = Layer.unwrap(
  Effect.gen(function*() {
    const settings = yield* Settings
    const spent = yield* Ref.make<Readonly<Record<string, number>>>({})

    const affords = Effect.fn("Controls.affords")(function*(
      network: Network
    ) {
      const key = network
      const used = yield* Ref.updateAndGet(spent, (all) => ({
        ...all,
        [key]: (all[key] ?? 0) + 1
      }))
      return (used[key] ?? 0) <= LOOKUPS_PER_LIFETIME
    })

    /**
     * Read on every decision, never captured here.
     *
     * A value read at layer build would hold the switch in whatever position it
     * was in when the service worker started, across the whole session the
     * switch exists to end.
     */
    const switchedOffByReader = Effect.fn("Controls.switchedOffByReader")(
      function*(network: Network) {
        const chosen = yield* settings.current
        return !chosen.networks[network]
      }
    )

    return Controls.layerOf({
      compiledOut: (network) => network === "x" && !X_LOOKUP_COMPILED_IN,
      switchedOffByReader,
      affords
    })
  })
)
