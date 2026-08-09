/**
 * Harvest, as this app holds it: one door for the content script, one for the
 * reader's own navigation.
 *
 * `@parle/harvest` is a daemon and two seams; this is the whole of what the
 * background needs to know about it. Everything expensive — the throttle, the
 * back-pressured hand-off that must never drop, the request budget, the
 * shortlink cache — is inside that package and is not re-decided here.
 *
 * **`offer` may take a while to return, and that is the guarantee rather than a
 * defect.** The `Harvester`'s hand-off is bounded and suspends its publishers
 * when it is full, because the two ways of not suspending — a sliding or
 * dropping buffer — lose a Discussion with no event, no failure and no log line.
 * The background calls this from the harvest port's own message loop, so the
 * only thing a wait can hold up is the next page *of harvest*: the reader's
 * panel is on a different port and a different fiber.
 *
 * **`arrived` is the click-through case.** ADR 0012's marquee experience is
 * clicking a link on Hacker News, Reddit or X and finding the Discussion already
 * attached — and the reason it needs a demand channel at all is that the link
 * the reader tapped is sitting in a politely throttled queue behind thirty they
 * will never open. `Harvester.prioritise` resolves what is waiting *now*,
 * against a separate allowance, and stops as soon as one of them turns out to be
 * the page they are standing on.
 *
 * **Both doors are shut until the reader has said yes, and this is not a
 * formality.** Harvesting is not free: resolving a `t.co` link means a real
 * `HEAD` to a third party, and the rows it keeps go to the reader's disk. The
 * README's own promise is "nothing automatic happens until the first-run
 * question is answered, and answering *only when I ask* means nothing automatic
 * ever happens" — and a content script that is in the manifest starts running
 * the moment the extension is installed, before any of that has been read.
 * Without the check below, a fresh install that had agreed to nothing sent two
 * requests to `t.co` and wrote twelve rows to disk the first time the reader
 * opened X. `manualOnly` is `!decided || !automatic`, so one predicate covers
 * both the unanswered question and the reader who answered "no".
 *
 * A **paused site** shuts it too, on the Network page's own host. "Pause on
 * x.com" that leaves Parle reading x.com and spending requests on its links is
 * a control that reads as off and is on.
 *
 * Nothing here renders. Harvest runs behind the reader; what it writes is read
 * by the Enquiry's first wave on the *next* page, which is the whole point.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type { Network } from "@parle/domain/Network"
import { Recollection } from "@parle/memory/Recollection"
import { Storage as Kept } from "@parle/memory/Storage"
import { Harvester } from "@parle/harvest/Harvester"
import { LinkResolver } from "@parle/harvest/LinkResolver"
import { DiscussionSink, NetworkPage } from "@parle/harvest/Page"
import { Redirects } from "@parle/harvest/Redirects"
import { ReaderChoices } from "@parle/policy/ReaderChoices"
import { SubjectIdentity } from "@parle/policy/SubjectIdentity"
import { LocalCache } from "./LocalCache.ts"
import { Noted } from "./Noted.ts"

/**
 * The largest page this will read.
 *
 * The content script caps what it sends for the same number and the same
 * reason; this is the second, independent bound, because the first one is on the
 * other side of a boundary where everything is `unknown`. An X timeline the
 * reader has scrolled for ten minutes is several megabytes of markup, and the
 * cost of parsing it is paid on the background's fiber — which is the fiber the
 * reader's panel is derived on.
 */
export const LARGEST_PAGE = 2_000_000

/** The site an address is on, or nothing when it names none. */
const hostOf = (address: string): string | null => {
  try {
    return new URL(address).hostname.toLowerCase()
  } catch {
    return null
  }
}

export class Harvesting extends Context.Service<Harvesting, {
  /**
   * Read one Network page the reader was already on.
   *
   * Suspends rather than discarding when the pipeline is full. Total: a page
   * that cannot be read is a `Breakage` in the log, never a failed Enquiry.
   *
   * Does nothing at all until the reader has answered the first-run question
   * with "yes", and nothing on a site they have paused. See the file header.
   */
  readonly offer: (
    network: Network,
    url: string,
    markup: string
  ) => Effect.Effect<void>
  /**
   * The reader has landed somewhere. Resolve anything pending that might be it.
   *
   * Takes the raw address and canonicalizes it here, through the same
   * `SubjectIdentity` every other key in the system is minted by. A caller that
   * passed its own `SubjectUrl` would be passing a key from whatever rules
   * version it happened to hold, and the failure would be silent: a perfectly
   * populated cache that never hits.
   *
   * Cheap and idempotent, so it is safe on every Reading boundary: with nothing
   * waiting it does no work and spends nothing.
   */
  readonly arrived: (address: string) => Effect.Effect<void>
  /** How many sightings are still waiting on a destination. Observability, and a test hook. */
  readonly waiting: Effect.Effect<number>
}>()("parle/extension/harvest/Harvesting") {
  static readonly layer: Layer.Layer<
    Harvesting,
    never,
    Harvester | SubjectIdentity | ReaderChoices
  > = Layer.effect(
    Harvesting,
    Effect.gen(function*() {
      const harvester = yield* Harvester
      const identity = yield* SubjectIdentity
      const choices = yield* ReaderChoices

      /**
       * Whether harvesting may run at all right now.
       *
       * Read fresh on every page rather than captured, for the reason every
       * other reader decision in this build is read fresh: the service worker
       * outlives the settings page, and a value taken at layer build would hold
       * the answer the reader gave before they changed their mind.
       *
       * The paused test is `LookupPolicy`'s, spelled the same way, because two
       * spellings of "is this site paused" is how one control ends up covering
       * three of the four things it appears to.
       */
      const permitted = Effect.fn("Harvesting.permitted")(function*(url: string) {
        const chosen = yield* choices.current
        if (chosen.manualOnly) return false
        const host = hostOf(url)
        if (host === null) return true
        return !chosen.paused.some((paused) => host === paused || host.endsWith(`.${paused}`))
      })

      const offer = Effect.fn("Harvesting.offer")(function*(
        network: Network,
        url: string,
        markup: string
      ) {
        if (markup.length === 0) return
        if (!(yield* permitted(url))) return
        yield* harvester.offer(
          NetworkPage.make({
            network,
            url,
            markup: markup.length > LARGEST_PAGE ? markup.slice(0, LARGEST_PAGE) : markup
          })
        )
      })

      const arrived = Effect.fn("Harvesting.arrived")(function*(address: string) {
        // Resolving what is waiting costs requests to a shortener, so this is
        // governed by the same answer `offer` is. The paused test is not applied
        // here: the address is where the reader LANDED, and what would be
        // resolved was harvested from a Network page that already passed it.
        const chosen = yield* choices.current
        if (chosen.manualOnly) return
        const subject = yield* identity.identify(address)
        // Not a page at all — a `chrome://` surface, an internal hostname. There
        // is nothing for a harvested link to have pointed at.
        if (Option.isNone(subject)) return
        yield* harvester.prioritise(subject.value)
      })

      return Harvesting.of({ offer, arrived, waiting: harvester.waiting })
    })
  )
}

/**
 * The whole harvest subgraph, over the one durable store this app has.
 *
 * Assembled here rather than in `app/Pipeline.ts` for the reason the connectors
 * are assembled there: what a caller should have to supply is the seam that
 * cannot be built outside a browser, and everything else should be a decision
 * this file is accountable for. There are three of those:
 *
 * **`Recollection` over the read-write view.** This layer, and nothing else in
 * the app, is given `LocalCache.kept`. It is therefore the only path by which a
 * Mention reaches the reader's disk, which is ADR 0012's separation made
 * structural rather than remembered — see `LocalCache.ts`.
 *
 * **`Redirects.fetching`, not `Redirects.none`.** ADR 0012 is explicit that
 * keying on the tracking URL is the way this feature fails, so the requests are
 * the feature. They are capped by `LinkResolver`'s rolling budget, deduped per
 * page, and cached with a time to live read off the answer; and they are
 * disclosed in the README, because they are traffic the reader did not ask for.
 * They are also the reason `Harvesting` takes {@link ReaderChoices}: this is the
 * only outbound traffic in the build that a *content script's* existence causes,
 * so it is the only one that could start before the reader has read anything.
 *
 * **Titles go to `Noted`, and only there.** `Gathered` is the heap store rows
 * are drawn from during a Lookup, and pointing harvest at it as well would give
 * a harvested Discussion two homes that can disagree — and hide, in every test
 * on a warm worker, that the durable one is the one the click-through case
 * actually reads from.
 */
export const harvestOn = (
  cache: Layer.Layer<LocalCache>,
  /**
   * The reader's own decisions, as one layer shared with `LookupPolicy`.
   *
   * Passed in rather than built here so that it is the SAME memoized instance
   * the Lookup path decides against. Two `ReaderChoices` over one document is
   * the version of this where the settings page looks right and half the
   * controls are inert.
   */
  choices: Layer.Layer<ReaderChoices>
): Layer.Layer<Harvesting | Noted> => {
  const noted = Noted.layer.pipe(Layer.provide(cache))

  const kept = Layer.effect(
    Kept,
    Effect.map(LocalCache, (held) => Kept.of(held.kept))
  ).pipe(Layer.provide(cache))

  const recollection = Recollection.layer.pipe(Layer.provide(kept))

  const resolver = LinkResolver.layer.pipe(
    Layer.provide(Layer.mergeAll(SubjectIdentity.layer, Redirects.fetching()))
  )

  /**
   * The sink, provided INTO the Harvester's layer rather than merged beside it.
   *
   * `DiscussionSink` is a `Context.Reference`, and the Harvester reads it while
   * its own layer is being built. A Reference merged at the top of the graph is
   * in the runtime's context but not in a sibling layer's build context, so the
   * Harvester would find the default — which discards — and every harvested
   * title would be lost in a way nothing reports. `app/Pipeline.ts` merges the
   * connectors' two sinks at the top precisely because those are read per call
   * instead; the difference is when, not which kind of thing.
   */
  const sink = Layer.unwrap(
    Effect.map(Noted, (held) => Layer.succeed(DiscussionSink, { note: held.note }))
  ).pipe(Layer.provide(noted))

  const harvester = Harvester.layer.pipe(
    Layer.provide(Layer.mergeAll(resolver, recollection, sink))
  )

  return Layer.mergeAll(
    Harvesting.layer.pipe(
      Layer.provide(Layer.mergeAll(harvester, SubjectIdentity.layer, choices))
    ),
    noted
  )
}
