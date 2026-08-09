/**
 * Where a Reading begins.
 *
 * A Reading is "one reader's encounter with one Subject in one **top-level
 * frame**". Two words in that sentence are the entire job of this file, and
 * both are enforced here rather than downstream, because downstream is
 * everywhere.
 *
 * **Top frame only.** A page embedding `youtube-nocookie.com/embed/…` reports a
 * sub-frame navigation that is, structurally, indistinguishable from a page
 * load. Letting one through mints a Subject for a video nobody opened, issues
 * Lookups about it, and — if any of them answers — writes it into the reader's
 * own Local Discussion Cache. Ad and analytics iframes make that continuous.
 * The filter is one line; putting it anywhere but here means it is one line
 * that some future caller forgets.
 *
 * **Until it changes.** The address a tab reports is not stable at the moment
 * it changes. A single click can produce a `t.co` hop, a consent interstitial,
 * a login bounce, and the destination, all inside a second, and each is a
 * Sighting. Minting a Reading per Sighting spends four Lookups to answer a
 * question about one page. So Sightings settle: the latest address for a tab
 * wins after a quiet interval, and the earlier ones are never seen.
 *
 * "Latest wins" is also what recovers the referrer. No background navigation
 * event carries `document.referrer` — only the top-frame content script can
 * report it — and that report necessarily arrives *after* the commit for the
 * same address. Because the settle window keeps the last Sighting rather than
 * the first, the report replaces the commit and the arriving Network survives.
 *
 * Debouncing is **per tab**. A single global debounce would let a background
 * tab finishing a redirect chain silently cancel the foreground tab's Reading,
 * which is invisible in every log.
 */
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { Arrival } from "@parle/domain/Subject"
import { Tabs } from "./Tabs.ts"
import { type Sighting, TabId, TOP_FRAME } from "./WebExtApi.ts"

/**
 * How long a tab's address must hold still before it is a Reading.
 *
 * Chosen against two failures, not for a feel: shorter than this and a redirect
 * chain mints several Readings; longer and the panel is visibly late on a plain
 * page load. It also has to be long enough for the content script's referrer
 * report to land inside the same window as the commit it belongs to.
 */
export const SETTLES_AFTER: Duration.Input = "400 millis"

/**
 * What the platform did to start this Reading.
 *
 * Kept because the causes have different trust: a `loaded` boundary means a
 * document was actually fetched, while `in-page` is a site's own router
 * claiming the address changed, and some sites lie about that on scroll.
 */
export const BoundaryCause = Schema.Literals(["loaded", "in-page", "fragment", "reported"])
export type BoundaryCause = typeof BoundaryCause.Type

/**
 * The start of one Reading.
 *
 * `address` is the raw address, NOT a Subject URL. Only the canonicalizer mints
 * a Subject URL, and it stamps the rules version that minted it; a boundary
 * that pretended to carry one would be a key produced by no rules version at
 * all.
 */
export class ReadingBoundary
  extends Schema.Opaque<ReadingBoundary, { readonly _brand: "ReadingBoundary" }>()(
    Schema.Struct({
      tab: TabId,
      address: Schema.String,
      cause: BoundaryCause,
      /** Which Network the reader came from, where the referrer says so. */
      arrival: Arrival,
      /** Epoch millis, from the Clock, so tests are not at the mercy of one. */
      at: Schema.Number
    })
  )
{}

const causeOf = (sighting: Sighting): BoundaryCause => {
  switch (sighting.cause) {
    case "committed":
    case "tab-updated":
      return "loaded"
    case "history":
      return "in-page"
    case "fragment":
      return "fragment"
    case "reported":
      return "reported"
  }
}

/** The schemes a Subject can live at. Everything else is not a page being read. */
const READABLE_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"])

/**
 * Whether an address could name a Subject at all.
 *
 * Excludes `chrome-extension://`, `about:blank`, `file://` and `data:` — our
 * own panel, the new-tab page, and local files are not pages the internet has
 * said anything about, and two of them are the reader's private business.
 */
export const isReadable = (address: string): boolean => {
  try {
    return READABLE_SCHEMES.has(new URL(address).protocol)
  } catch {
    return false
  }
}

const elsewhere = Arrival.cases.Elsewhere.make({})

const fromNetwork = (network: string, discussion: string) =>
  Arrival.cases.FromNetwork.make({ network, discussion })

/**
 * Which Discussion, if any, the reader came here from.
 *
 * Returns `Elsewhere` whenever the referrer names a Network but not a
 * Discussion — a Hacker News front page, a subreddit listing, an X timeline.
 * That loses real signal and does so deliberately: arriving from a Discussion
 * is evidence for a **Linked** Mention, and a Linked Mention is the only thing
 * that opens the X gate. A `FromNetwork` carrying an empty Discussion id would
 * be a Linked Mention pointing at nothing, which would discharge the disclosure
 * argument ADR 0001 rests on with no disclosure having actually happened.
 */
export const arrivalFrom = (referrer: string | undefined): Arrival => {
  if (referrer === undefined || referrer === "") return elsewhere

  let came: URL
  try {
    came = new URL(referrer)
  } catch {
    return elsewhere
  }

  const host = came.hostname.toLowerCase()

  if (host === "news.ycombinator.com") {
    const item = came.searchParams.get("id")
    return item === null || item === "" ? elsewhere : fromNetwork("hackernews", item)
  }

  if (host === "reddit.com" || host.endsWith(".reddit.com")) {
    // Both `/r/<sub>/comments/<id>/<slug>` and the bare `/comments/<id>`.
    const item = /(?:^|\/)comments\/([a-z0-9]+)/i.exec(came.pathname)?.[1]
    return item === undefined ? elsewhere : fromNetwork("reddit", item)
  }

  if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) {
    // `/<handle>/status/<id>` and the canonical `/i/status/<id>`.
    const item = /\/status(?:es)?\/(\d+)/.exec(came.pathname)?.[1]
    return item === undefined ? elsewhere : fromNetwork("x", item)
  }

  return elsewhere
}

/**
 * The whole of ReadingWatch, as a function of a Sighting stream.
 *
 * Exported separately from the service so the two rules that matter can be
 * driven from an array of Sightings in node, with no browser and no layer
 * wiring. A stream that ends produces a stream that ends — the pending settle
 * is awaited and the boundary stream then closes — which is what makes a test
 * asserting "and nothing else was emitted" expressible at all.
 */
export const boundariesOf = (
  sightings: Stream.Stream<Sighting>,
  settleAfter: Duration.Input
): Stream.Stream<ReadingBoundary> =>
  Stream.callback<ReadingBoundary>((boundaries) =>
    Effect.gen(function*() {
      /** The settle timer currently running for each tab. At most one. */
      const settling = new Map<number, Fiber.Fiber<void>>()
      /**
       * The address most recently made into a Reading, per tab.
       *
       * A Reading runs "until the address changes", so a reload, a repeated
       * report, or a router re-announcing the same address is the same Reading
       * and must not mint a second one.
       *
       * Both Maps grow with tabs seen, and neither is pruned: the platform has
       * no event that reliably says "this tab will never be sighted again", and
       * an MV3 worker is torn down after about thirty seconds of quiet anyway,
       * so the bound is a worker lifetime rather than a browser session.
       */
      const reading = new Map<number, string>()

      const settle = (sighting: Sighting) =>
        Effect.gen(function*() {
          yield* Effect.sleep(settleAfter)
          if (reading.get(sighting.tabId) === sighting.address) return
          reading.set(sighting.tabId, sighting.address)
          const at = yield* Clock.currentTimeMillis
          Queue.offerUnsafe(
            boundaries,
            ReadingBoundary.make({
              tab: sighting.tabId,
              address: sighting.address,
              cause: causeOf(sighting),
              arrival: arrivalFrom(sighting.referrer),
              at
            })
          )
        })

      yield* sightings.pipe(
        Stream.filter((sighting) => sighting.frameId === TOP_FRAME),
        Stream.filter((sighting) => isReadable(sighting.address)),
        Stream.runForEach((sighting) =>
          Effect.gen(function*() {
            const pending = settling.get(sighting.tabId)
            if (pending !== undefined) yield* Fiber.interrupt(pending)
            settling.set(sighting.tabId, yield* Effect.forkScoped(settle(sighting)))
          })
        )
      )

      // The platform stopped talking. Let the last address for each tab settle,
      // then close, so a finite source yields a finite stream.
      yield* Fiber.awaitAll([...settling.values()])
      yield* Queue.end(boundaries)
    })
  )

export class ReadingWatch extends Context.Service<ReadingWatch, {
  readonly readings: Stream.Stream<ReadingBoundary>
}>()("parle/reading/ReadingWatch") {
  /** For tests, and for a platform that wants a different settle window. */
  static readonly settlingAfter = (settleAfter: Duration.Input): Layer.Layer<ReadingWatch, never, Tabs> =>
    Layer.effect(
      ReadingWatch,
      Effect.gen(function*() {
        const tabs = yield* Tabs
        return ReadingWatch.of({ readings: boundariesOf(tabs.sightings, settleAfter) })
      })
    )

  static readonly layer: Layer.Layer<ReadingWatch, never, Tabs> = ReadingWatch.settlingAfter(SETTLES_AFTER)
}
