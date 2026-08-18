/**
 * The one place in this app that touches an extension API.
 *
 * ADR 0003 ships Chrome and Safari together and Firefox after, on one MV3
 * manifest, and the way it pays for that is this file: a browser difference is
 * a change here rather than a change everywhere. Nothing outside `src/platform`
 * imports `wxt/browser`, which is a property `grep` can check.
 *
 * What is deliberately NOT here is the Reading boundary. Top-frame enforcement,
 * settling a redirect chain into one Reading, and reading the arriving Network
 * off a referrer all live in `@parle/browser`'s `ReadingWatch`, where they are
 * a pure function of a Sighting stream and are tested against a platform double
 * rather than against a browser. This file carries the parts of the extension
 * surface that have no home there: the toolbar, script injection, and the
 * ports the panel and the pill speak over.
 *
 * Every method is total. A tab can close between the event and the call, a
 * `chrome://` page will refuse injection, and a port can die mid-post; none of
 * those is a failure of the Enquiry, so none of them widens an error channel.
 *
 * The file splits in two, and the split is MV3's, not ours. {@link armExtension}
 * is a plain function that attaches every listener in the caller's own turn;
 * {@link Extension.layerFrom} is the Effect service that reads what it caught.
 * The service cannot do the attaching itself — a `Stream` does not run until
 * some fiber runs it, which is a layer build too late for a worker the browser
 * only wakes for listeners it saw during initial evaluation.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { browser } from "wxt/browser"
import { relay, type Relay, streamOf } from "@parle/browser/Relay"
import { armed, type WebExtApi } from "@parle/browser/WebExtApi"

/**
 * One of our own pages, by the path WXT emits it at.
 *
 * A closed union rather than `string` so that a typo is a compile error rather
 * than a tab opening on a blank error page — which is exactly the failure a
 * reader would meet at their least forgiving moment, clicking "what does this
 * send?".
 */
export type PagePath = "/options.html" | "/popup.html" | "/welcome.html"

/** A top-frame address that has settled in a tab. */
export interface TabAddress {
  readonly tabId: number
  readonly address: string
  readonly title: string
  /** Whether the reader is actually looking at this tab right now. */
  readonly active: boolean
}

/** A surface — a panel or a pill — attached to the background. */
export interface Wireup {
  readonly name: string
  /** The tab a content script speaks for; `null` for the panel. */
  readonly tabId: number | null
  /** The browser window containing that tab; `null` for extension pages. */
  readonly windowId: number | null
  readonly post: (word: unknown) => Effect.Effect<void>
  /** What the surface says, ending when it goes away. */
  readonly asks: Stream.Stream<unknown>
}

const quietly = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<void> =>
  effect.pipe(Effect.catch(() => Effect.void), Effect.asVoid)

const addressOf = (tab: {
  id?: number | undefined
  url?: string | undefined
  title?: string | undefined
  active?: boolean | undefined
}): Option.Option<TabAddress> =>
  tab.id === undefined || tab.url === undefined || tab.url === ""
    ? Option.none()
    : Option.some({
      tabId: tab.id,
      address: tab.url,
      title: tab.title ?? "",
      active: tab.active === true
    })

export class Extension extends Context.Service<Extension, {
  /**
   * The reader switched to a tab — and nothing else.
   *
   * Reading BOUNDARIES come from `@parle/browser`'s ReadingWatch, which is
   * where top-frame enforcement and settling live. This stream is the one
   * thing a navigation event cannot tell us: that a tab the reader was not
   * looking at is now the one they are. It once also carried title arrivals,
   * and that was P1/P2 of the 2026-08-10 battery: a consumer that treats one
   * stream's every event as "the reader is here now" mints a Reading per
   * pushState and per redirect interstitial, with no settle window anywhere
   * in the path. Titles now arrive on {@link retitled}, which is a CORRECTION
   * channel and may never mint.
   */
  readonly activated: Stream.Stream<TabAddress>
  /**
   * A page the reader is on finally has a title — or a better one.
   *
   * `webNavigation.onCommitted` fires before the document has parsed a
   * `<title>`, and the title is what the topical Lookup is keyed on, so the
   * arrival matters. But a title event is a fact about a DOCUMENT, not about
   * where the reader is: during a navigation Chrome stamps the tab with
   * placeholder titles (the bare host, the address itself) for pages that are
   * still interstitial, and an SPA burst re-titles every transient state.
   * Consumers must therefore only ever attach these to the Reading whose
   * address they belong to — `Board.retitle` — and never start anything from
   * them. That is the entire reason this is not a case of {@link activated}.
   */
  readonly retitled: Stream.Stream<TabAddress>
  /**
   * A tab finished loading a page — `tabs.onUpdated` reporting `complete`.
   *
   * This exists for one reason, found by the torture run's rapid-navigation
   * scenario: Chrome CLEARS a tab's per-tab action badge and title on every
   * navigation commit, and a back/forward that lands on the address the tab
   * already had is — correctly — not a new Reading, so ReadingWatch emits no
   * boundary, no frame is drawn, and the account the toolbar was carrying
   * stays wiped until some unrelated frame rewrites it. This stream is the
   * redraw trigger for exactly that case, and it must never become a
   * SIGHTING: `status: "complete"` fires on consent-wall interstitials too,
   * and minting Readings from it would re-issue the Lookups the settle window
   * exists to withhold.
   */
  readonly loaded: Stream.Stream<TabAddress>
  /** A tab went away. */
  readonly closed: Stream.Stream<number>
  /**
   * Parle was just installed, for the first time.
   *
   * Emits on a fresh install and on nothing else — not on an update, not on a
   * browser restart, not on a service-worker wake. It is the one moment we can
   * put the disclosure in front of the reader before they have opened a single
   * page with this thing running, which is the only time showing it is a
   * disclosure rather than an apology.
   *
   * The platform fires this once, early, and does not queue it for a listener
   * that registers late — which is why {@link armExtension} attaches in the
   * worker's first turn and holds what arrives. The background still has a
   * store read to do before it can subscribe; the difference is that the event
   * is now waiting for it rather than gone. (Before that seam existed, the
   * subscription landed some 20ms in and this was missed as the normal case,
   * not the slow-start edge case this comment used to claim.)
   */
  readonly installed: Stream.Stream<void>
  /** A surface attached. */
  readonly connections: Stream.Stream<Wireup>
  readonly activeTab: Effect.Effect<Option.Option<TabAddress>>
  readonly tabAddress: (tabId: number) => Effect.Effect<Option.Option<TabAddress>>
  /** What the toolbar shows about a tab. Empty text means "nothing to say". */
  readonly mark: (tabId: number, text: string, hint: string) => Effect.Effect<void>
  /** Put the pill on a page. Injected only where there is something to show. */
  readonly showPill: (tabId: number) => Effect.Effect<void>
  readonly openOut: (address: string) => Effect.Effect<void>
  /**
   * Open one of our own pages, focusing the one already open rather than
   * stacking a second copy of it.
   *
   * The focusing matters for the disclosure specifically: a reader who clicks
   * "what does this send?" from three different tabs should end up looking at
   * one page, not three, and a first-run screen that duplicates itself reads as
   * something broken at exactly the moment we are asking to be trusted.
   */
  readonly openPage: (path: PagePath) => Effect.Effect<void>
}>()("parle/extension/platform/Extension") {
  static readonly layerFrom = (attached: ArmedExtension) => Layer.effect(
    Extension,
    Effect.gen(function*() {
      const activated = streamOf(attached.activated)
      const retitled = streamOf(attached.retitled)
      const loaded = streamOf(attached.loaded)
      const closed = streamOf(attached.closed)
      const installed = streamOf(attached.installed)
      const connections = streamOf(attached.connections)

      const tabAddress = Effect.fn("Extension.tabAddress")(function*(tabId: number) {
        const tab = yield* Effect.tryPromise(() => browser.tabs.get(tabId)).pipe(
          Effect.catch(() => Effect.succeed(null))
        )
        return tab === null ? Option.none<TabAddress>() : addressOf(tab)
      })

      const activeTab = Effect.gen(function*() {
        const tabs = yield* Effect.tryPromise(() =>
          browser.tabs.query({ active: true, currentWindow: true })
        ).pipe(Effect.catch(() => Effect.succeed([])))
        const first = tabs[0]
        return first === undefined ? Option.none<TabAddress>() : addressOf(first)
      })

      const mark = Effect.fn("Extension.mark")(function*(
        tabId: number,
        text: string,
        hint: string
      ) {
        yield* quietly(Effect.tryPromise(() => browser.action.setBadgeText({ tabId, text })))
        yield* quietly(Effect.tryPromise(() => browser.action.setTitle({ tabId, title: hint })))
      })

      const showPill = Effect.fn("Extension.showPill")(function*(tabId: number) {
        yield* quietly(Effect.tryPromise(() =>
          browser.scripting.executeScript({
            target: { tabId },
            files: ["/content-scripts/pill.js"]
          })
        ))
      })

      const openOut = Effect.fn("Extension.openOut")(function*(address: string) {
        yield* quietly(Effect.tryPromise(() => browser.tabs.create({ url: address })))
      })

      const openPage = Effect.fn("Extension.openPage")(function*(path: string) {
        // WXT types `getURL` as the exact union of paths this build emits, which
        // is a real check at every other call site and an impossible one here:
        // this function exists precisely so callers pass a path as data. The
        // cast is to the parameter's own type rather than to a template literal,
        // so it narrows with the build rather than drifting from it.
        const url = browser.runtime.getURL(
          path as Parameters<typeof browser.runtime.getURL>[0]
        )
        const open = yield* Effect.tryPromise(() => browser.tabs.query({ url })).pipe(
          Effect.catch(() => Effect.succeed([]))
        )
        const first = open[0]
        if (first?.id !== undefined) {
          yield* quietly(
            Effect.tryPromise(() => browser.tabs.update(first.id, { active: true }))
          )
          return
        }
        yield* quietly(Effect.tryPromise(() => browser.tabs.create({ url })))
      })

      return Extension.of({
        activated,
        retitled,
        loaded,
        closed,
        installed,
        connections,
        activeTab,
        tabAddress,
        mark,
        showPill,
        openOut,
        openPage
      })
    })
  )
}

/**
 * Every platform listener this worker will ever attach, already attached.
 *
 * Handed to {@link Extension.layerFrom} and to `WebExt`, which read from it
 * instead of registering anything themselves.
 */
export interface ArmedExtension {
  /** The `@parle/browser` platform, its navigation listeners already attached. */
  readonly platform: WebExtApi
  readonly activated: Relay<TabAddress>
  /** Title arrivals — corrections only, never sightings. See {@link Extension}. */
  readonly retitled: Relay<TabAddress>
  /** Load completions, for redrawing what the browser wiped. See {@link Extension}. */
  readonly loaded: Relay<TabAddress>
  readonly closed: Relay<number>
  readonly installed: Relay<void>
  readonly connections: Relay<Wireup>
}

/**
 * Attach every listener, now, in the caller's own turn.
 *
 * **This is a plain function and must stay one.** MV3 chooses whether to wake a
 * killed service worker by looking at which listeners were attached during the
 * worker's initial evaluation, and it delivers the waking event in that same
 * turn. Measured on Chrome 151: a listener attached 33ms into the worker's life
 * missed the navigation that started it. Every listener below is therefore
 * registered before this function returns, and what arrives before the Effect
 * runtime is up is held by the relays rather than dropped — see `Relay.ts`.
 *
 * Call it once, from the background entrypoint's `main`, before anything
 * awaits. Calling it twice would double every event.
 *
 * The streams these feed are still lazy, and that is now harmless: laziness
 * decides when we start READING, not when the browser starts telling us.
 */
export const armExtension = (): ArmedExtension => {
  const activated = relay<TabAddress>((emit) => {
    browser.tabs.onActivated.addListener((info) => {
      void browser.tabs.get(info.tabId).then((tab) => {
        const address = addressOf({ ...tab, active: true })
        if (Option.isSome(address)) emit(address.value)
      }, () => {})
    })
  })

  /**
   * Title arrivals, on their own relay because they are a different KIND of
   * event. The listener that used to feed these into `activated` carried the
   * comment "re-announcing the address here would mint a second Reading for
   * one page" — and its consumer did exactly that: `board.sight` on every
   * title event. When the title event's address differed from the settled
   * Reading (an SPA re-titling each transient pushState; Chrome stamping a
   * redirect interstitial with its host as a placeholder title), that call
   * minted a Reading and a full Lookup burst with no settle discipline
   * anywhere in the path — P1 and P2 of the 2026-08-10 battery, including the
   * `consent?continue=%2Freal%2Fdoc` query-string disclosure. The relay split
   * makes the mistake structural to repeat: whatever consumes this stream is
   * consuming corrections.
   */
  const retitled = relay<TabAddress>((emit) => {
    browser.tabs.onUpdated.addListener((tabId, change, tab) => {
      if (change.title === undefined) return
      if (tab.active !== true) return
      const address = addressOf({ id: tabId, url: tab.url, title: tab.title, active: true })
      if (Option.isSome(address)) emit(address.value)
    })
  })

  /**
   * Load completions. A separate relay rather than a case of `activated`,
   * because the two are consumed differently: an activation is a SIGHTING (the
   * reader is looking at this now), a completion is only permission to redraw
   * furniture the browser cleared. Every tab, active or not — a background
   * tab's badge is wiped by its navigation just the same.
   */
  const loaded = relay<TabAddress>((emit) => {
    browser.tabs.onUpdated.addListener((tabId, change, tab) => {
      if (change.status !== "complete") return
      const address = addressOf({ id: tabId, url: tab.url, title: tab.title, active: tab.active })
      if (Option.isSome(address)) emit(address.value)
    })
  })

  const closed = relay<number>((emit) => {
    browser.tabs.onRemoved.addListener((tabId) => emit(tabId))
  })

  const installed = relay<void>((emit) => {
    browser.runtime.onInstalled.addListener((details) => {
      // `reason` is checked rather than assumed: an update or a browser
      // upgrade also fires this, and re-asking a reader who has already
      // answered would train them to click past the one screen that matters.
      if (details.reason !== "install") return
      emit(undefined)
    })
  })

  const connections = relay<Wireup>((emit) => {
    browser.runtime.onConnect.addListener((port) => {
      const tabId = port.sender?.tab?.id ?? null
      const windowId = port.sender?.tab?.windowId ?? null
      /**
       * The port's own listeners, attached in the turn the port arrived.
       *
       * Not deferred to whoever eventually reads `asks`: a surface's first
       * message is usually posted in the same turn it connects, and a panel
       * that opened and immediately asked to watch a tab would have that ask
       * dropped by a listener attached three hops later.
       */
      const asks = relay<unknown>((say, close) => {
        port.onMessage.addListener((raw) => say(raw))
        port.onDisconnect.addListener(() => close())
      })
      emit({
        name: port.name,
        tabId,
        windowId,
        // A port that has already gone is the ordinary case for a popup
        // the reader closed; posting into it must not be an error.
        post: (word) => Effect.sync(() => {
          try {
            port.postMessage(word)
          } catch {
            // The surface left. Nothing to do and nothing to report.
          }
        }),
        asks: streamOf(asks)
      })
    })
  })

  return {
    platform: armed(),
    activated,
    retitled,
    loaded,
    closed,
    installed,
    connections
  }
}
