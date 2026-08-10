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
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { Arrival } from "@parle/domain/Subject"
import { Tabs } from "./Tabs.ts"
import { type Sighting, type SightingCause, TabId, TOP_FRAME } from "./WebExtApi.ts"

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
 * How much longer an address that names ANOTHER address must hold still.
 *
 * P1 in the 2026-08-10 battery: a consent-shaped redirect chain whose hops were
 * slower than one settle window minted a Reading at
 * `consent?continue=%2Freal%2Fdoc` — ten Lookups for one navigation, about an
 * address the reader never read, and the `continue=` parameter it disclosed is
 * where publishers put the reader's destination. The settle window alone cannot
 * catch that: by its own rule, an address that holds for 400 ms IS being read.
 *
 * The discriminating signal is the address's own shape. A page whose query
 * string carries another address — `continue=`, `next=`, `url=`, whatever the
 * parameter is called, the VALUE is a URL or a path — is a page built to take
 * the reader somewhere else: a consent wall, a login bounce, a link decorator.
 * Those are exactly the addresses whose query strings are dangerous to
 * disclose, so they are exactly the ones that must earn their Lookup by dwell:
 * the reader has to actually stay on one before we will ask anyone about it.
 * Five settle windows (2 s under {@link SETTLES_AFTER}) is longer than any hop
 * of a redirect chain that is merely slow, and far shorter than the time a
 * reader spends on a consent wall they are genuinely reading and answering.
 * A next navigation inside that dwell interrupts the pending settle — the
 * mechanism this file already has — and the interstitial is then never seen.
 *
 * ADR 0005 bounds this from the other side: it may only DELAY, never withhold.
 * A carrier-shaped address the reader stays on — a real document behind a
 * `?redirect_from=` parameter, a search results page — still settles and still
 * gets its Lookup, one and a half seconds later than an ordinary page. The
 * residual, recorded honestly: an interstitial that auto-redirects SLOWER than
 * this dwell is indistinguishable from a page being read and will be Looked
 * up, and a plain-address interstitial (no carried address) still settles at
 * the ordinary window — but it also discloses nothing beyond its own address.
 */
const CARRIER_SETTLE_FACTOR = 5

/**
 * Whether this address carries another address in its own query string.
 *
 * Judged by the parameter VALUES, never by a list of parameter names: `u=`,
 * `q=`, `dest=` and `continue=` all appear in the wild, and a name list is a
 * treadmill. A value that is an absolute URL, a scheme-relative URL, or an
 * absolute path is an address; bare words, ids and numbers are not.
 */
export const carriesAnAddress = (address: string): boolean => {
  try {
    for (const value of new URL(address).searchParams.values()) {
      if (/^(?:https?:\/\/|\/\/|\/|www\.)/i.test(value)) return true
    }
    return false
  } catch {
    return false
  }
}

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
 * How many superseded addresses one boundary may carry.
 *
 * A redirect chain is two or three hops; anything longer is a consent wall
 * bouncing, and keeping all of it would make an unbounded per-tab buffer out of
 * something a hostile page can drive. The oldest are dropped first, because the
 * address the reader actually asked for is the first one and it is the one
 * worth keeping.
 */
const KEEPS_TRAVERSED = 4

/**
 * How long a navigation may stay in flight before its starting address is
 * disbelieved.
 *
 * A server redirect produces exactly two Sightings — `intended` at the origin,
 * a commit at the destination, which never gets an `intended` of its own — so
 * the time between them is the WHOLE network round-trip: DNS, TLS, the 301,
 * the second request. Bounding that gap by the settle window made the Front
 * Door fold flicker with the network weather (F1 in the 2026-08-10 battery:
 * `en.wikipedia.org/` folded both visits in one run and neither in the next,
 * because a cold-profile HTTPS navigation under load crosses 400 ms). The
 * origin of a navigation that COMMITTED belongs to that navigation however
 * slow the wire was; what makes an `intended` hop stale is being ABANDONED,
 * and abandonment is visible in the chain itself — a genuinely new navigation
 * always announces its own `intended` first.
 *
 * This cap is therefore not the discriminator, only a backstop for event
 * sequences the chain logic does not model (a commit whose `onBeforeNavigate`
 * the platform never delivered). Thirty seconds is far above any observed
 * redirect (the battery's misses were 0.4–2 s) and at the scale of an MV3
 * worker's own idle lifetime, beyond which the chain does not survive anyway.
 */
const REDIRECT_PATIENCE_MS = 30_000

/**
 * The causes that prove a document was actually fetched and ran at an address
 * — the platform committing a navigation, or the page's own content script
 * announcing itself. `history` and `fragment` are a site's account of itself,
 * and `intended` proves nothing was fetched at all.
 */
const loads = (cause: SightingCause): boolean =>
  cause === "committed" || cause === "tab-updated" || cause === "reported"

/**
 * One address in a tab's in-flight chain.
 *
 * `born` is the cause that FIRST put the address in the chain, and it is what
 * tells a server redirect apart from an abandoned navigation: a commit-born
 * hop had no `onBeforeNavigate` of its own, which only a redirect destination
 * can be. `loaded` records whether a document ever ran here — a later commit
 * of the same address upgrades it — so a client-redirect interstitial the
 * reader actually sat on is never mistaken for a redirect origin.
 */
interface Hop {
  readonly url: string
  readonly at: number
  readonly born: SightingCause
  loaded: boolean
}

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
      /**
       * The addresses this Reading passed through on the way to `address`,
       * oldest first — the redirect chain the reader's own browser traversed.
       *
       * ADR 0015 admits exactly three kinds of evidence that two addresses are
       * one Subject, and this is one of them. It is kept because the *shape* of
       * the address the reader asked for is information the destination has
       * destroyed: `en.wikipedia.org/` is a site's front door and
       * `en.wikipedia.org/wiki/Main_Page` is indistinguishable from an article.
       *
       * Empty on an ordinary page load, which is the overwhelming majority: 57
       * of 732 corpus addresses redirect anywhere at all.
       */
      traversed: Schema.Array(Schema.String),
      /** Epoch millis, from the Clock, so tests are not at the mercy of one. */
      at: Schema.Number
    })
  )
{}

/**
 * A Sighting that may become the address of a Reading.
 *
 * `intended` is excluded in the type rather than filtered in a branch, so
 * "an address the browser had not yet fetched became a Reading" is a thing the
 * compiler refuses rather than a thing a test has to catch. That failure would
 * be a Lookup issued for a page the reader never arrived at — a cancelled
 * navigation, a link that turned out to be a download — which is exactly the
 * class of mistake the top-frame filter in this file already exists to prevent.
 */
type Settling = Sighting & { readonly cause: Exclude<SightingCause, "intended"> }

const settles = (sighting: Sighting): sighting is Settling => sighting.cause !== "intended"

const causeOf = (sighting: Settling): BoundaryCause => {
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
      /**
       * The addresses seen for a tab lately, oldest first, each stamped with
       * when it arrived — a redirect chain in progress.
       *
       * Bounded three ways, and each bound is load-bearing rather than tidy:
       *
       * - **By the settle window**, at the moment a Reading settles — for hops
       *   where a document actually ran. Anything older is by this file's own
       *   definition a *different* Reading, so including it would let the page
       *   the reader was on a minute ago decide what the page they are on now
       *   is. That is the failure this bound exists for: `traversed` widens
       *   what the Front Door rule may judge, and a stale rootish hop in it
       *   would fold a real document. A hop where nothing ever ran — a pure
       *   `intended` — is bounded by SUCCESSION instead: it is stale when a
       *   new navigation superseded it, not when the wire was slow. See the
       *   filter in {@link settle} and {@link REDIRECT_PATIENCE_MS} for why
       *   the clock is the wrong judge of a server redirect's origin.
       * - **By {@link KEEPS_TRAVERSED}**, so a consent wall bouncing in a loop
       *   cannot grow it without limit.
       * - **By the next Reading**, which clears it. It never outlives the
       *   navigation it describes and nothing persists it.
       */
      const passing = new Map<number, Array<Hop>>()
      const settleMillis = Duration.toMillis(Duration.fromInputUnsafe(settleAfter))

      const settle = (sighting: Settling) =>
        Effect.gen(function*() {
          // A redirect-carrier address must earn its Reading by dwell; see
          // CARRIER_SETTLE_FACTOR. The next sighting for this tab interrupts
          // this fiber, which is how an interstitial flashed past — however
          // slowly — is never seen, while a page the reader stays on settles
          // late rather than never (ADR 0005).
          yield* Effect.sleep(
            carriesAnAddress(sighting.address)
              ? Duration.millis(settleMillis * CARRIER_SETTLE_FACTOR)
              : settleAfter
          )
          const seen = passing.get(sighting.tabId) ?? []
          passing.delete(sighting.tabId)
          if (reading.get(sighting.tabId) === sighting.address) return
          reading.set(sighting.tabId, sighting.address)
          const at = yield* Clock.currentTimeMillis
          // Measured from when the settling sighting itself arrived, not from
          // now: `now` is one settle window later by construction, and mixing
          // the two would make the bound depend on the sleep rather than on the
          // chain. A hop more than one window older than the sighting that
          // settled is, by this file's own definition, a different Reading —
          // with one exception, carried by the second clause below.
          //
          // The exception is the origin of a slow server redirect. Such a
          // navigation is two events with the whole network round-trip between
          // them: `intended` at the origin, then a commit at the destination,
          // which never gets an `intended` of its own. Judged by the clock
          // alone, the origin Alias survived only when DNS + TLS + the 301 all
          // fit inside one settle window, and ADR 0019's fold flickered with
          // the network weather (F1, 2026-08-10 battery). What actually makes
          // an `intended` hop stale is ABANDONMENT, and abandonment is visible
          // in the chain: a genuinely new navigation announces its own
          // `intended` before it can commit, so a pure-intended hop followed
          // DIRECTLY by a commit-born hop can only be the address that
          // navigation started from. That hop is kept however slow the wire
          // was, under {@link REDIRECT_PATIENCE_MS} as a backstop. A hop where
          // a document ever ran keeps the strict window — a page the reader
          // sat on is a different Reading, not a redirect origin.
          const settledAt = seen.find((hop) => hop.url === sighting.address)?.at ?? at
          const traversed = seen
            .filter((hop, index) => {
              if (hop.url === sighting.address) return false
              if (hop.at >= settledAt - settleMillis) return true
              if (hop.loaded) return false
              const next = seen[index + 1]
              return next !== undefined && loads(next.born) &&
                next.at - hop.at <= REDIRECT_PATIENCE_MS
            })
            .map((hop) => hop.url)
          Queue.offerUnsafe(
            boundaries,
            ReadingBoundary.make({
              tab: sighting.tabId,
              address: sighting.address,
              cause: causeOf(sighting),
              arrival: arrivalFrom(sighting.referrer),
              traversed,
              at
            })
          )
        })

      yield* sightings.pipe(
        Stream.filter((sighting) => sighting.frameId === TOP_FRAME),
        Stream.filter((sighting) => isReadable(sighting.address)),
        Stream.runForEach((sighting) =>
          Effect.gen(function*() {
            const now = yield* Clock.currentTimeMillis
            const seen = passing.get(sighting.tabId) ?? []
            const tail = seen[seen.length - 1]
            if (tail?.url === sighting.address) {
              // The same address again — a commit after its own `intended`, or
              // a content script's report after the commit. Not a new hop, but
              // "a document ran here" is new evidence, and it is what stops a
              // client-redirect interstitial being read as a redirect origin.
              if (loads(sighting.cause)) tail.loaded = true
            } else {
              seen.push({
                url: sighting.address,
                at: now,
                born: sighting.cause,
                loaded: loads(sighting.cause)
              })
            }
            passing.set(sighting.tabId, seen.slice(-KEEPS_TRAVERSED))
            // An address the browser has not fetched yet is evidence about the
            // chain, never about where the reader is. It restarts nothing and
            // settles as nothing; a cancelled navigation is simply discarded
            // with the rest of the chain at the next Reading.
            if (!settles(sighting)) return
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
