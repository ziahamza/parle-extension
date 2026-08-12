/**
 * The service worker: one ManagedRuntime, and the Enquiry lifetime it owns.
 *
 * `forBackground` is the whole bridge between MV3's callback world and the
 * Effect world. Its runtime is built once at worker start and never rebuilt, so
 * every surface that attaches during this lifetime shares one `Board`, one set
 * of Enquiries, and one budget. When MV3 kills the worker the runtime dies with
 * it and the next one starts cold — which is a real, unavoidable property of
 * the platform, not a bug to paper over, and it is why anything that must
 * survive a restart belongs in a store rather than in a fiber.
 *
 * Two rules govern the shape of `main` and `serve`, and both were learned from
 * the same bug — an extension that loaded, started, and then did nothing at all
 * on any navigation, in silence, while 880 tests passed:
 *
 *   1. **Every listener is attached in `main`'s own turn**, by `armExtension`,
 *      before the runtime exists. MV3 wakes a worker from the listeners it saw
 *      during initial evaluation and delivers the waking event in that turn.
 *   2. **The subscriptions are the body of `serve`, never forked off the end of
 *      it.** A scope closes when the effect it wraps completes, and closing it
 *      interrupts the children — so a `serve` that returns is a `serve` that
 *      tears down everything it just started. See the `Effect.all` below.
 *
 * The four things this file arranges:
 *
 *   - **The disclosure, on a fresh install, before the reader has browsed a
 *     single page with this running.** It is not the *enforcement* — that is
 *     `Choices.choicesOf`, which holds whether or not this tab was ever opened
 *     — but a rule enforced and never explained is not a disclosure either, and
 *     Chrome's Limited Use policy requires it in the product's interface rather
 *     than only in the store listing.
 *   - **Reading boundaries** from the top frame only, so an embedded video
 *     cannot mint a Subject.
 *   - **The pill, injected only where there is something to show** — never
 *     preemptively into every page the reader opens. That is the difference
 *     between an extension that watches you read and one that answers when
 *     there is an answer.
 *   - **Surfaces subscribing to state.** Each connected panel or pill gets the
 *     current Reading immediately and every subsequent one, from a
 *     `SubscriptionRef` — so opening the panel late is not a different code
 *     path from opening it early, it is the same one.
 */
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { defineBackground } from "wxt/utils/define-background"
import { Arrival } from "@parle/domain/Subject"
import { arrivalFrom, ReadingWatch } from "@parle/browser/ReadingWatch"
import { forBackground } from "@parle/browser/Runtime"
import { connectionOf, isConnected, PROVIDER_NAMES } from "../ai/Connected.ts"
import { ParleLayer } from "../app/Parle.ts"
import { Harvesting } from "../harvest/Harvesting.ts"
import { armExtension, Extension, type Wireup } from "../platform/Extension.ts"
import { Board } from "../reading/Board.ts"
import type { Reading } from "../reading/Reading.ts"
import type { ProviderStanding } from "../reading/Surroundings.ts"
import { shippedIndex, type Surroundings, surroundingsOf } from "../reading/Surroundings.ts"
import { Forgetting } from "../settings/Forgetting.ts"
import { MarkParkStore } from "../settings/markParkStore.ts"
import type { ReaderSettings } from "../settings/Settings.ts"
import { Settings, withAutomatic, withoutPause, withPause } from "../settings/Settings.ts"
import { anyRows, badgeOf, foundCount, type Panel } from "../view/Panel.ts"
import { panelOf } from "../view/panelOf.ts"
import {
  ASIDE_PORT,
  AsideVisibility,
  DISCLOSURE_PORT,
  hearAsk,
  PILL_PORT,
  Standing,
  Told
} from "../wire/Wire.ts"

/** How long before we will try injecting a pill into the same tab again. */
const PILL_PATIENCE_MS = 5_000

/**
 * Where the settings page lands in the built artifact.
 *
 * WXT emits `entrypoints/options/index.html` here. It is a literal rather than
 * a `browser.runtime.getURL` at the call site because ADR 0003 keeps every
 * extension API inside `src/platform` — `openPage` is what knows how to resolve
 * it, and this is the only thing the caller is allowed to know.
 */
const SETTINGS_PAGE = "/options.html"

/**
 * The page that says what Parle sends and to whom, and asks the one question.
 *
 * WXT emits `entrypoints/welcome/index.html` here. Same reasoning as
 * {@link SETTINGS_PAGE}: the caller knows a path, `openPage` knows the API.
 */
const DISCLOSURE_PAGE = "/welcome.html"

/**
 * The toolbar button's tooltip: the whole status, in one line, on hover.
 *
 * It carries the restraint's own sentence rather than a generic "not looked up"
 * for the same reason the panel does — ADR 0011's degraded states are only
 * states if each says something specific — and the panel behind the button is
 * where the account of every place we asked is read in full.
 */
const hintOf = (panel: Panel): string => {
  if (panel.restraint !== null) return `Parle — ${panel.restraint.says}`
  const found = foundCount(panel)
  if (found > 0) return `Parle — ${found} discussion${found === 1 ? "" : "s"}`
  // A front door with nothing fresh wears no badge, so the tooltip is the only
  // thing on the toolbar that can say why. "nothing found" there would be false
  // about a page with six Hacker News threads linking to it, and the reader
  // would have no reason to open the panel that is holding them.
  if (panel.folded !== null) {
    const held = panel.folded.rows.length
    return `Parle — site front page, ${held} older discussion${held === 1 ? "" : "s"}`
  }
  if (panel.stillLooking) return "Parle — looking…"
  // A page where NOWHERE answered is not a page nobody discussed, and the
  // tooltip must not collapse the two — the popup's own summary keeps them
  // apart for exactly this reason, and the tooltip is the only account a
  // reader who never opens it will see. Found by the torture run's offline
  // scenario: every Place refused (the machine was offline) and the tooltip
  // said "nothing found", which is a claim about the world the extension had
  // no way to have learned.
  if (panel.couldNotAsk) return "Parle — could not find out"
  return "Parle — nothing found"
}

const serve = Effect.gen(function*() {
  const extension = yield* Extension
  const watch = yield* ReadingWatch
  const board = yield* Board
  // The reader's own decisions, and the two controls that throw memory away.
  // Held here rather than reached for per message: they are services, and the
  // values behind them are read fresh on every call anyway.
  const settings = yield* Settings
  const forgetting = yield* Forgetting
  const parks = yield* MarkParkStore
  // ADR 0012's crawl, and the demand channel the click-through case needs.
  const harvesting = yield* Harvesting
  // The worker's own scope. Per-tab work is forked into THIS, never into the
  // scope of whichever surface happened to ask first — a usher forked from a
  // popup dies when the popup closes, and the toolbar then silently stops
  // telling the truth about that tab.
  const forever = yield* Effect.scope

  /**
   * The install-wide facts every panel is derived against, alongside its tab's
   * own Reading.
   *
   * A `SubscriptionRef` rather than a plain variable because a change to it has
   * to redraw every attached surface: the reader answers the first-run question
   * in one tab, and the panel sitting open in another is describing a world
   * that no longer exists until it is told.
   */
  /**
   * Which Provider is connected, as one sentence the panel can say.
   *
   * Read off the same document as everything else, and re-read by `refresh`, so
   * a key pasted into the settings page reaches every open panel in one
   * message. `@parle/provider` itself is never consulted here — this is the
   * reader's own setting, not a probe.
   */
  const providerStanding = (held: ReaderSettings): ProviderStanding => ({
    connected: isConnected(held),
    name: PROVIDER_NAMES[connectionOf(held)]
  })

  const surroundings = yield* SubscriptionRef.make<Surroundings>(
    yield* Effect.map(settings.current, (held) =>
      surroundingsOf(held, shippedIndex(Date.now()), providerStanding(held)))
  )

  /**
   * Where the reader last parked the on-page mark.
   *
   * Its own ref rather than a field on surroundings: parking the mark is not a
   * fact about Lookups, and a drag must not look like a settings change.
   */
  const markPark = yield* SubscriptionRef.make(yield* parks.current)

  /**
   * Re-read the one document that decides it. Called after every write —
   * including the ones made by the settings page, which writes to the store
   * directly and tells us afterwards.
   *
   * It re-reads rather than taking a value, so a write this worker did not make
   * is picked up the same way as one it did. The `index` is left alone because
   * it is a fact about the build, not about the reader.
   */
  const refresh = Effect.gen(function*() {
    const held = yield* settings.current
    yield* SubscriptionRef.update(surroundings, (was) =>
      surroundingsOf(held, was.index, providerStanding(held)))
  })

  const frameOf = (reading: Reading, around: Surroundings): Panel =>
    panelOf(reading, Date.now(), around)

  /**
   * Every frame a surface watching this tab should draw.
   *
   * Three sources, merged, because a panel goes out of date for three unrelated
   * reasons: what we learned about the page changed, what the reader decided
   * changed, or where they parked the mark. Merging them here means no surface
   * needs to know there are three, and none can end up subscribed to only one —
   * which is the version of this bug where turning automatic lookups on leaves
   * every open panel insisting they are off.
   *
   * `changes` hands over the current value first on both sides, so a surface
   * that attached three seconds into an Enquiry is correct on its first frame.
   */
  const framesFor = (tabId: number) =>
    Effect.gen(function*() {
      const ref = yield* board.open(tabId)
      return Stream.merge(
        SubscriptionRef.changes(ref),
        Stream.mapEffect(
          Stream.merge(
            SubscriptionRef.changes(surroundings),
            SubscriptionRef.changes(markPark)
          ),
          () => SubscriptionRef.get(ref)
        )
      )
    })

  /** Tabs whose pill is attached right now, by its own port's word. */
  const pillsLive = new Set<number>()
  const pillPosts = new Map<number, Wireup["post"]>()
  let asideConnections = 0
  const pillsAskedAt = new Map<number, number>()
  const ushers = new Map<number, Fiber.Fiber<void>>()
  /** Claimed before anything suspends, so two callers cannot both start one. */
  const ushered = new Set<number>()

  /**
   * Draw one frame's worth of furniture for a tab: the toolbar account, and
   * the pill where there is something to show.
   *
   * Named so it has two callers — the usher below, and the load-completion
   * redraw — and cannot drift between them.
   */
  const draw = Effect.fn("background.draw")(function*(tabId: number, reading: Reading) {
    const panel = frameOf(reading, yield* SubscriptionRef.get(surroundings))
    yield* extension.mark(tabId, badgeOf(panel), hintOf(panel))

    if (!anyRows(panel) || pillsLive.has(tabId)) return
    const asked = pillsAskedAt.get(tabId) ?? 0
    if (Date.now() - asked < PILL_PATIENCE_MS) return
    pillsAskedAt.set(tabId, Date.now())
    yield* extension.showPill(tabId)
  })

  /**
   * Watch one tab's Reading and keep the toolbar and the page in step with it.
   *
   * One fiber per tab, started at the tab's first Reading and never restarted:
   * the Reading `SubscriptionRef` survives navigation within the tab, so this
   * does not need to know that navigation happened.
   */
  const usher = Effect.fn("background.usher")(function*(tabId: number) {
    if (ushered.has(tabId)) return
    ushered.add(tabId)
    const frames = yield* framesFor(tabId)
    const fiber = yield* Effect.forkIn(
      Stream.runForEach(frames, (reading) => draw(tabId, reading)),
      forever
    )
    ushers.set(tabId, fiber)
  })

  const attend = Effect.fn("background.attend")(function*(wireup: Wireup) {
    if (wireup.name === PILL_PORT && wireup.tabId !== null) {
      pillsLive.add(wireup.tabId)
      pillPosts.set(wireup.tabId, wireup.post)
      if (asideConnections > 0) yield* wireup.post(AsideVisibility(true))
    }
    if (wireup.name === ASIDE_PORT) {
      asideConnections += 1
      yield* Effect.forEach(
        pillPosts.values(),
        (post) => post(AsideVisibility(true)),
        { discard: true }
      )
    }

    /**
     * The first-run page watches the decision, and nothing else.
     *
     * A stream rather than one answer, for the same reason the panel gets one:
     * a reader with the disclosure open in one tab and the settings page in
     * another must not be able to see two different accounts of what they have
     * agreed to.
     */
    if (wireup.name === DISCLOSURE_PORT) {
      yield* Effect.forkScoped(
        Stream.runForEach(
          SubscriptionRef.changes(surroundings),
          (around) => wireup.post(Told(around.decision))
        )
      )
    }

    let watching: number | null = null
    let watcher: Fiber.Fiber<void> | null = null

    const watch = Effect.fn("background.watch")(function*(tabId: number) {
      if (watching === tabId) return
      watching = tabId
      if (watcher !== null) yield* Fiber.interrupt(watcher)
      yield* usher(tabId)
      const frames = yield* framesFor(tabId)
      watcher = yield* Effect.forkScoped(
        Stream.runForEach(frames, (reading) =>
          Effect.gen(function*() {
            const around = yield* SubscriptionRef.get(surroundings)
            const park = yield* SubscriptionRef.get(markPark)
            yield* wireup.post(
              Standing(tabId, frameOf(reading, around), extension.aside, park)
            )
          }))
      )
    })

    /**
     * A surface with no tab of its own follows whatever the reader is reading.
     *
     * The popup could not tell the difference — it is destroyed the moment the
     * reader looks anywhere else, so resolving the active tab once was the same
     * thing as following it. The panel beside the page is the surface that
     * breaks that equivalence: measured on Chrome 151, it is per-WINDOW, its
     * document is not reloaded on a tab switch, and it is told nothing when one
     * happens. Left pinned, it would sit beside the reader's second article
     * still showing the first one's Discussions — the failure that looks least
     * like a bug and misleads most.
     *
     * So `Watch(null)` now means what its own doc comment always said it meant.
     * The one-off sight is still here and still first: `extension.activated`
     * reports the NEXT switch, and a panel opened on a tab that was activated
     * before this worker woke has to be right immediately rather than at the
     * reader's next click.
     */
    let following = false
    const follow = Effect.gen(function*() {
      const active = yield* extension.activeTab
      if (Option.isSome(active)) {
        yield* board.sight(
          active.value.tabId,
          active.value.address,
          active.value.title,
          Arrival.cases.Elsewhere.make({})
        )
        yield* watch(active.value.tabId)
      }
      if (following) return
      following = true
      // Forked into this surface's own scope, so it dies with the port. Safe
      // for the reason the file header gives: `attend` goes on blocking on
      // `wireup.asks` after this returns, so the scope stays open.
      //
      // `retitled` is merged in for one measured reason: a tab the reader
      // OPENS (rather than switches to) fires `onActivated` while `tabs.get`
      // can still report an empty address, and that emission is dropped — so
      // for a brand-new tab the next thing that names the active tab is its
      // title arriving. Re-targeting which tab this surface renders is not a
      // sighting: `watch` only re-points the frames, and the Reading itself is
      // still minted solely by the settle discipline. (Before the
      // activated/retitled split, title events rode `activated` and covered
      // this by accident; the split made the coverage explicit.)
      yield* Effect.forkScoped(
        Stream.runForEach(
          Stream.merge(extension.activated, extension.retitled),
          (tab) => watch(tab.tabId)
        )
      )
    })

    yield* Stream.runForEach(wireup.asks, (raw) =>
      Effect.gen(function*() {
        const ask = hearAsk(raw)
        if (ask === null) return

        switch (ask._tag) {
          case "Watch": {
            const named = ask.tabId ?? wireup.tabId
            if (named !== null) {
              /**
               * A named tab that has never been sighted is resolved once,
               * before watching. The popup opened as a page is the ordinary
               * case: its port carries its own tab, whose address
               * (`chrome-extension://…`) no boundary can ever sight —
               * `isReadable` refuses it — and whose activation snapshot races
               * `tabs.get` against the address landing, and can lose. Before
               * the activated/retitled split, the popup's own title event
               * re-sighted it by accident; the split removed that cover, and
               * this surface then watched an `unopened` Reading forever —
               * "Still looking." over a tab nothing would ever look up.
               *
               * Ask-driven on purpose, the same class of act as `follow`'s
               * active-tab resolution just below and the pill's `Sighted`: a
               * surface's gesture may resolve where the reader is NOW, while
               * events may only correct (the invariant the split exists for).
               * At most once per tab — an existing Reading, whatever its
               * standing, is left exactly as the settle discipline minted it —
               * and for a readable address the sight this performs is ADR
               * 0005's own rule: opening the extension on a page performs a
               * Lookup.
               */
              const before = yield* SubscriptionRef.get(yield* board.open(named))
              if (before.standing._tag === "Unopened") {
                const tab = yield* extension.tabAddress(named)
                if (Option.isSome(tab)) {
                  yield* board.sight(
                    named,
                    tab.value.address,
                    tab.value.title,
                    Arrival.cases.Elsewhere.make({})
                  )
                }
              }
              yield* watch(named)
              return
            }
            yield* follow
            return
          }
          case "Sighted": {
            if (wireup.tabId === null) return
            yield* board.sight(
              wireup.tabId,
              ask.address,
              ask.title,
              arrivalFrom(ask.referrer)
            )
            return
          }
          case "OpenOut": {
            yield* extension.openOut(ask.address)
            return
          }
          /**
           * The reader asked for this page on purpose.
           *
           * ADR 0005: the toolbar never says "not applicable". This re-runs the
           * Places that were held back — excluded, paused, manual mode, or
           * ADR 0001's X gate — on the reader's own initiative, and leaves the
           * ones that already answered alone.
           */
          case "LookAnyway": {
            const named = watching ?? wireup.tabId
            if (named !== null) {
              yield* board.insist(named)
              return
            }
            const active = yield* extension.activeTab
            if (Option.isSome(active)) yield* board.insist(active.value.tabId)
            return
          }
          /**
           * The reader asked for a Digest of this page's Discussions.
           *
           * The one path in the extension that reads comment BODIES, and the
           * only thing that spends the reader's own Provider quota. It is here
           * and nowhere else: no navigation, no panel opening, and no change of
           * settings reaches `board.summarise`. The panel says what it is about
           * to fetch and where it will be sent before this Ask can be made.
           */
          case "ReadDiscussion": {
            const named = watching ?? wireup.tabId
            if (named !== null) {
              yield* board.readDiscussion(named, ask.key)
              return
            }
            const active = yield* extension.activeTab
            if (Option.isSome(active)) {
              yield* board.readDiscussion(active.value.tabId, ask.key)
            }
            return
          }
          case "Summarise": {
            const named = watching ?? wireup.tabId
            if (named !== null) {
              yield* board.summarise(named)
              return
            }
            const active = yield* extension.activeTab
            if (Option.isSome(active)) yield* board.summarise(active.value.tabId)
            return
          }
          /**
           * Pausing, from wherever the reader happens to be.
           *
           * Written straight through to the settings document, which is where
           * the settings page reads it from and where `LookupPolicy` re-reads it
           * on the next decision — so a pause set in the panel is in force
           * immediately and visible on the settings page without a restart.
           */
          case "PauseSite": {
            yield* settings.change((held) => withPause(held, ask.host))
            yield* refresh
            return
          }
          case "ResumeSite": {
            yield* settings.change((held) => withoutPause(held, ask.host))
            yield* refresh
            return
          }
          /**
           * The answer to the first-run question, or a later change of mind.
           *
           * It deliberately does NOT re-run the tabs already open. Turning
           * automatic lookups on is permission for what happens next, not a
           * retroactive one covering every page currently sitting in a
           * background tab — those the reader never asked about. The page in
           * front of them has a one-click "look this page up" for exactly that.
           */
          case "Decide": {
            yield* settings.change((held) => withAutomatic(held, ask.automatic))
            yield* refresh
            return
          }
          case "OpenDisclosure": {
            yield* extension.openPage(DISCLOSURE_PAGE)
            return
          }
          /**
           * Already done, in a turn this fiber cannot reach.
           *
           * **This arm is not dead code and must not be deleted.** The panel
           * beside the page was opened by `platform/Extension.ts`'s raw port
           * listener, synchronously, in the turn the reader's click arrived —
           * because `chrome.sidePanel.open()` is refused anywhere later, and
           * "later" starts at the first microtask. By the time this fiber runs,
           * the reader's transient activation is spent. Moving the open here
           * would compile, would pass every test in `vitest`, and would break
           * the mark; `e2e/parle.e2e.ts` is what would catch it.
           *
           * What remains is the honest record that the surface said this, so
           * `hearAsk` stays total over the wire and a reader of this switch
           * meets the reason rather than an unexplained gap.
           */
          case "OpenAside": {
            return
          }
          case "OpenSettings": {
            yield* extension.openPage(SETTINGS_PAGE)
            return
          }
          /**
           * The settings page changed the document under us.
           *
           * It owns its own layer over the same store, so there is nothing to
           * write here — only to re-read, so that every panel currently open is
           * describing the switches the reader can now see set. Enforcement was
           * never at risk: `LookupPolicy` reads the document on every decision.
           */
          case "SettingsChanged": {
            yield* refresh
            return
          }
          /**
           * The two clearing controls, done HERE because this is the only
           * context holding the live stores. A settings page that cleared bytes
           * on its own would leave this worker answering from a memory the
           * reader was told had gone.
           */
          case "Forget": {
            yield* ask.scope === "everything"
              ? forgetting.everything
              : forgetting.lookupRecord
            return
          }
          /**
           * A Network page the reader was already on — ADR 0012's crawl.
           *
           * Awaited rather than forked, and that is the point. `Harvester.offer`
           * suspends its caller when the pipeline is full instead of discarding
           * a sighting, so waiting here IS the back-pressure: the harvest port's
           * message loop stops reading, and the content script's next `say`
           * finds a port that is not keeping up rather than a queue that has
           * quietly started losing Discussions. Nothing the reader can see is on
           * this fiber — the panel is a different port.
           */
          case "Harvested": {
            yield* harvesting.offer(ask.network, ask.address, ask.markup)
            return
          }
          case "ParkMark": {
            const next = yield* parks.save(ask.park)
            yield* SubscriptionRef.set(markPark, next)
            return
          }
        }
      }))

    // The stream ended, which means the port disconnected — the panel closed,
    // or the page the pill was on went away.
    if (wireup.name === PILL_PORT && wireup.tabId !== null) {
      if (pillPosts.get(wireup.tabId) === wireup.post) {
        pillsLive.delete(wireup.tabId)
        pillPosts.delete(wireup.tabId)
      }
    }
    if (wireup.name === ASIDE_PORT) {
      asideConnections = Math.max(0, asideConnections - 1)
      if (asideConnections === 0) {
        yield* Effect.forEach(
          pillPosts.values(),
          (post) => post(AsideVisibility(false)),
          { discard: true }
        )
      }
    }
  })

  /**
   * The one moment at which showing the disclosure is a disclosure.
   *
   * On install, before a single page has been opened with this running. What
   * makes it more than a formality is that the answer is load-bearing:
   * `Choices.choicesOf` reports manual mode until it arrives, so a reader who
   * closes this tab unread gets an extension that looks nothing up and says so
   * on every page, rather than one that quietly proceeds.
   */
  const disclosing = Stream.runForEach(
    extension.installed,
    () => extension.openPage(DISCLOSURE_PAGE)
  )

  /**
   * Every Reading boundary the platform reported, filtered to the tab in front.
   *
   * ADR 0005 requires an offline prefilter — the Discussion Index — before any
   * Network Lookup, and `@parle/index-codec` does not exist yet. Until it does,
   * this is the standing restraint in its place: without it, every page opened
   * in a background tab, every link opened to read later, and every session
   * restore issues real requests about pages the reader never looked at. It is
   * a stopgap to be REPLACED by the real prefilter, not deleted.
   *
   * The title comes from the tab rather than from the boundary because no
   * navigation event carries one — `onCommitted` fires before the document has
   * parsed a `<title>` — and `Extension.retitled` carries the correction when
   * it lands, through `board.retitle`, which refuses to treat it as a
   * sighting.
   */
  const sighting = Stream.runForEach(watch.readings, (boundary) =>
    Effect.gen(function*() {
      const tab = yield* extension.tabAddress(boundary.tab)
      if (Option.isNone(tab) || !tab.value.active) return
      yield* board.sight(boundary.tab, boundary.address, tab.value.title, boundary.arrival, boundary.traversed)
      yield* usher(boundary.tab)
      // ADR 0012's marquee case: the reader tapped a link on Hacker News,
      // Reddit or X and is standing on it now, while the sighting that would
      // attach the Discussion sits in a politely throttled queue behind thirty
      // links they will never open. This jumps that queue, on its own small
      // allowance, and stops the moment it finds this page.
      //
      // Forked so a shortlink that will not answer cannot delay the next
      // navigation, into the WORKER's scope rather than this stream's turn.
      yield* Effect.forkIn(harvesting.arrived(boundary.address), forever)
    }))

  const following = Stream.runForEach(extension.activated, (tab) =>
    Effect.gen(function*() {
      yield* board.sight(tab.tabId, tab.address, tab.title, Arrival.cases.Elsewhere.make({}))
      yield* usher(tab.tabId)
    }))

  /**
   * Redraw what the browser wiped, and NOTHING else — no sighting, no Lookup.
   *
   * Chrome clears a tab's per-tab badge and title on every navigation commit.
   * Ordinarily the boundary that follows redraws them — but a back/forward
   * landing on the address the tab already had is the SAME Reading, correctly
   * produces no boundary, and therefore no frame: measured in the torture
   * run's rapid-navigation scenario, twenty flips left the toolbar carrying
   * the default title over a page with two Discussions, indefinitely.
   *
   * Guarded three ways, each load-bearing: only tabs already ushered (a tab
   * never sighted has no account to restore), only when the settled Reading's
   * address IS the loaded address (mid-navigation to a genuinely new page, the
   * boundary about to arrive owns the redraw — restoring the old page's count
   * over the new page would be the panel lying), and through `draw`, so the
   * pill comes back under exactly the rules a frame would apply.
   */
  const redrawing = Stream.runForEach(extension.loaded, (tab) =>
    Effect.gen(function*() {
      if (!ushered.has(tab.tabId)) return
      const reading = yield* SubscriptionRef.get(yield* board.open(tab.tabId))
      if (reading.address !== tab.address) return
      yield* draw(tab.tabId, reading)
    }))

  const closing = Stream.runForEach(extension.closed, (tabId) =>
    Effect.gen(function*() {
      const fiber = ushers.get(tabId)
      ushered.delete(tabId)
      if (fiber !== undefined) {
        ushers.delete(tabId)
        yield* Fiber.interrupt(fiber)
      }
      pillsLive.delete(tabId)
      pillPosts.delete(tabId)
      pillsAskedAt.delete(tabId)
      yield* board.close(tabId)
    }))

  const attending = Stream.runForEach(
    extension.connections,
    // Forked, because `attend` runs until its port disconnects and the next
    // surface must not wait behind it. `Effect.scoped` gives that surface its
    // own scope, so the subscriptions inside `attend` die with the port rather
    // than accumulating on the worker's scope for as long as the worker lives.
    (wireup) => Effect.forkScoped(Effect.scoped(attend(wireup)))
  )

  /**
   * The six subscriptions ARE the worker's life, which is why they are the
   * body of this effect rather than six things forked off the end of it.
   *
   * This shape is load-bearing and the reason is a bug that cost days. `serve`
   * runs inside `Effect.scoped`, and a scope closes the instant the effect it
   * wraps *completes* — interrupting everything forked into it. When these five
   * were `Effect.forkScoped(...)` the generator fell off the end in the same
   * turn as the last fork, the scope closed, and all five children were
   * interrupted before they executed a single instruction. Nothing failed and
   * nothing hung: the fiber exited `Success`, so there was no Cause to log, and
   * the worker sat alive and completely inert for the rest of its life.
   *
   * `Effect.all` makes that unrepresentable. None of these streams ends while
   * the platform lives, so this expression cannot return, so the scope cannot
   * close — and `forever` above stays open for the per-tab ushers forked into
   * it. It also means a subscription that DIES takes the worker's root fiber
   * with it, where the observer in `main` will say so, instead of vanishing.
   *
   * The remaining `Effect.forkScoped` calls in this file — the ushers, and the
   * two inside `attend` — are safe for the same reason and only for that
   * reason: each is forked into a scope whose owner then blocks. `attend` in
   * particular survives only because it ends by blocking on `wireup.asks`. Give
   * it an early return before that line and its subscriptions die exactly the
   * way these five did.
   */
  yield* Effect.all([disclosing, sighting, following, redrawing, closing, attending], {
    concurrency: "unbounded",
    discard: true
  })
})

export default defineBackground({
  type: "module",
  main: () => {
    /**
     * MV3 wakes this worker for an event by looking at which listeners were
     * attached during the worker's FIRST TURN. `armExtension` is a plain
     * function, not an Effect, for exactly that reason: every
     * `chrome.*.addListener` this worker will ever make happens on the next
     * line, before anything awaits, and the events that arrive before the
     * runtime is up are buffered rather than dropped.
     */
    const attached = armExtension()

    const worker = forBackground(ParleLayer(attached))
    const fiber = worker.start(Effect.scoped(serve))

    /**
     * `serve` cannot finish — see the `Effect.all` above — so ANY exit here
     * means the worker has stopped serving and is now inert. That includes a
     * SUCCESSFUL one, which is what the scope bug produced and why nothing
     * reported it: `forBackground` logs a failed exit, Effect logs a failed
     * exit, WXT's try/catch catches a throw, and none of the three has anything
     * to say about an effect that simply finished. This does.
     */
    fiber.addObserver((exit) => {
      console.error("parle: the background stopped serving — no further page will be looked up", exit)
    })
  }
})
