/**
 * The one place `chrome.*` is allowed to appear.
 *
 * ADR 0003 ships Chrome and Safari (macOS + iOS) together in v1, so a browser
 * difference has to be a change in one adapter rather than a change everywhere.
 * That is only true if the rest of the codebase never sees the platform: every
 * service in this package is written against {@link WebExtApi}, and the two
 * implementations of it — the live adapter and {@link makeDouble} — are the
 * entire portability surface.
 *
 * Three shapes of the platform differ between Chrome and Safari and are
 * absorbed here rather than leaked:
 *
 *   - **The namespace.** Safari and Firefox expose promise-returning
 *     `browser.*`; Chrome exposes `chrome.*` (also promise-returning under
 *     MV3). We prefer `browser` when present and wrap every call in
 *     `Promise.resolve`, so a callback-flavoured host still works.
 *   - **`webNavigation` may not exist.** Safari on iOS is the constraining
 *     platform (ADR 0003) and does not reliably grant it. We fall back to
 *     `tabs.onUpdated`, which sees fewer boundaries but never zero.
 *   - **`document.referrer` reaches no background API.** No navigation event
 *     carries it, so the only path that can is a report from the top-frame
 *     content script. That report is a platform detail, so it is merged into
 *     the same Sighting stream here rather than being a second seam that every
 *     consumer has to know about.
 *
 * Note what this interface is made of: promises and callbacks, not Effects. The
 * Effect surface belongs to the services above it. Keeping the seam plain is
 * what makes {@link makeDouble} small enough to be obviously correct, and the
 * whole package testable in node with no browser.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Relay from "./Relay.ts"
import { type Json, isPlainObject, isString, propertyOf } from "@parle/domain/Refine"
import { isJson } from "@parle/domain/Json"

/**
 * A browser tab. Branded because `tabId`, `frameId` and `windowId` are all bare
 * numbers in the platform API and mixing them up silently addresses the wrong
 * thing.
 */
export const TabId = Schema.Number.pipe(Schema.brand("TabId"))
export type TabId = typeof TabId.Type

/**
 * The frame the platform calls the top frame.
 *
 * Load-bearing: an embedded `youtube-nocookie.com/embed/…` iframe reports
 * frame ids above zero, and treating one as a Reading mints a Subject for a
 * page nobody is reading.
 */
export const TOP_FRAME = 0

/**
 * The reserved tag on a note from the top-frame content script announcing where
 * it is and where it came from.
 *
 * Exported so the messaging adapter can keep it out of ordinary Deliveries —
 * one platform event must not surface as both a Sighting and a message.
 */
export const SIGHTED = "parle/browser/sighted"

/** A browser tab, as the platform describes it. */
export interface Tab {
  readonly id: TabId
  /** The raw address. NOT a Subject URL — only the canonicalizer mints those. */
  readonly address: string
  readonly active: boolean
}

/**
 * What the platform did, as far as it will tell us.
 *
 * `reported` is the content script's own account of itself. It is the only
 * cause that can carry a referrer, and the only one that proves a document
 * actually ran.
 *
 * `intended` is the opposite end: an address the browser was about to ask for,
 * before anything came back. It proves nothing about what the reader is looking
 * at — the navigation may be cancelled, or turn out to be a download — so
 * `ReadingWatch` never lets one settle as a Reading's address. It exists so the
 * address a redirect started from survives the hop; see `ReadingBoundary.traversed`.
 */
export type SightingCause = "committed" | "history" | "fragment" | "tab-updated" | "reported" | "intended"

/**
 * One raw navigation event, before any judgement about whether it is a Reading.
 *
 * Deliberately carries `frameId` rather than a `topFrame: boolean` the adapter
 * has already decided: the enforcement lives in ReadingWatch, where it can be
 * tested, not in three separate platform listeners.
 */
export interface Sighting {
  readonly tabId: TabId
  readonly frameId: number
  readonly address: string
  readonly cause: SightingCause
  /** `document.referrer`, when a content script reported it. Usually absent. */
  readonly referrer: string | undefined
}

/** Who sent us a message. */
export interface Correspondent {
  /** Absent when the note came from an extension page rather than a tab. */
  readonly tabId: TabId | undefined
  readonly frameId: number | undefined
}

/** One inbound message, with the channel back to its sender still open. */
export interface Delivery {
  readonly note: Json
  readonly from: Correspondent
  readonly reply: (note: Json) => void
}

/**
 * Byte storage.
 *
 * Bytes, not JSON: `storage.local` stringifies a `Uint8Array` into an object of
 * numbered keys, which measured at roughly an order of magnitude over the raw
 * bytes and blows the quota on the shipped Discussion Index. The live adapter
 * is the Cache API, which stores response bodies verbatim.
 */
export interface StoreApi {
  readonly get: (key: string) => Promise<Uint8Array | undefined>
  readonly set: (key: string, value: Uint8Array) => Promise<void>
  readonly remove: (key: string) => Promise<void>
  readonly clear: () => Promise<void>
  readonly keys: () => Promise<ReadonlyArray<string>>
  readonly has: (key: string) => Promise<boolean>
}

export interface TabsApi {
  readonly active: () => Promise<Tab | undefined>
  /** The top-frame address of a tab, or undefined if the tab is gone. */
  readonly topFrameAddress: (id: TabId) => Promise<string | undefined>
}

export interface NavigationApi {
  /** Subscribe to Sightings. Returns the unsubscribe. */
  readonly watch: (sighted: (sighting: Sighting) => void) => () => void
}

export interface MessagesApi {
  /** `to` absent means "the extension" — background from a surface, or back. */
  readonly send: (note: Json, to: TabId | undefined) => Promise<Json | undefined>
  readonly watch: (received: (delivery: Delivery) => void) => () => void
}

/** Which adapter answered. Recorded for diagnosis; nothing branches on it. */
export type Vendor = "browser" | "chrome" | "double"

export interface WebExtApi {
  readonly vendor: Vendor
  readonly store: StoreApi
  readonly tabs: TabsApi
  readonly navigation: NavigationApi
  readonly messages: MessagesApi
}

/**
 * The platform seam as a service.
 *
 * Every other service in this package requires this one and nothing else from
 * the browser, so swapping {@link makeDouble} in swaps the whole platform out.
 */
export class WebExt extends Context.Service<WebExt, WebExtApi>()("parle/browser/WebExt") {
  /** The real browser. Fails at first use, not at build, in a bare node process. */
  static readonly layer = Layer.effect(WebExt, Effect.sync(() => live()))

  /** An in-memory platform for tests. */
  static readonly doubleLayer = (double: WebExtApi = makeDouble()): Layer.Layer<WebExt> =>
    Layer.effect(WebExt, Effect.succeed(double))
}

// ---------------------------------------------------------------------------
// The live adapter
// ---------------------------------------------------------------------------

/**
 * The sliver of the WebExtension surface we actually touch.
 *
 * Hand-written rather than `@types/chrome` so the package compiles with
 * `"types": []` and the dependency surface stays honest about what is used.
 */
interface Listenable<F> {
  readonly addListener: (f: F) => void
  readonly removeListener: (f: F) => void
}

interface NavigationDetails {
  readonly tabId: number
  readonly frameId: number
  readonly url: string
}

interface RawTab {
  readonly id?: number | undefined
  readonly url?: string | undefined
  readonly active?: boolean | undefined
}

interface RawSender {
  readonly tab?: RawTab | undefined
  readonly frameId?: number | undefined
}

/** An untrusted structured-clone value delivered by the browser host. */
type HostMessage = {} | null | undefined

interface ExtensionGlobal {
  readonly runtime?: {
    readonly sendMessage: (note: Json) => HostMessage
    readonly onMessage?: Listenable<
      (note: HostMessage, sender: RawSender, respond: (note: Json) => void) => boolean | undefined
    >
  }
  readonly tabs?: {
    readonly query: (q: { readonly active: boolean; readonly currentWindow: boolean }) => Json
    readonly get: (id: number) => Json
    readonly sendMessage: (id: number, note: Json) => HostMessage
    readonly onUpdated?: Listenable<
      (tabId: number, change: { readonly url?: string | undefined }, tab: RawTab) => void
    >
  }
  readonly webNavigation?: {
    readonly onCommitted: Listenable<(d: NavigationDetails) => void>
    readonly onHistoryStateUpdated: Listenable<(d: NavigationDetails) => void>
    readonly onReferenceFragmentUpdated: Listenable<(d: NavigationDetails) => void>
    /**
     * Optional because it is the one listener a host may not have: it is not in
     * the `webNavigation` shim Safari's converter builds for some targets, and
     * a missing Alias costs a fold rather than causing one.
     */
    readonly onBeforeNavigate?: Listenable<(d: NavigationDetails) => void> | undefined
  }
}

/** The resolved WebExtension namespace and which vendor exposed it. */
type HostNamespace = {
  readonly api: ExtensionGlobal
  readonly vendor: Vendor
}

/** Safari and Firefox answer to `browser`; Chrome to `chrome`. */
const namespace = (): HostNamespace => {
  // SAFETY: Safari/Firefox expose browser, Chrome exposes chrome; we probe both.
  const globals = globalThis as { browser?: ExtensionGlobal; chrome?: ExtensionGlobal }
  if (globals.browser !== undefined) return { api: globals.browser, vendor: "browser" }
  if (globals.chrome !== undefined) return { api: globals.chrome, vendor: "chrome" }
  throw new Error("no WebExtension namespace: this code must run inside an extension")
}

class NoExtensionApi extends Error {
  constructor(what: string) {
    super(`the host browser does not provide ${what}`)
  }
}

/**
 * A synthetic origin for Cache API keys.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so nothing here can
 * be mistaken for — or collide with — a cached response for a real address.
 */
const STORE_ORIGIN = "https://parle.invalid/"
const STORE_NAME = "parle"

const addressForKey = (key: string): string => `${STORE_ORIGIN}${encodeURIComponent(key)}`
const keyForAddress = (address: string): string =>
  decodeURIComponent(address.slice(STORE_ORIGIN.length))

const liveStore = (): StoreApi => {
  const open = () => {
    // SAFETY: the Cache API is optional on this global; we read it and branch on absence.
    const store = (globalThis as { caches?: CacheStorage }).caches
    if (store === undefined) return Promise.reject(new NoExtensionApi("the Cache API"))
    return store.open(STORE_NAME)
  }
  return {
    get: async (key) => {
      const held = await (await open()).match(addressForKey(key))
      if (held === undefined) return undefined
      return new Uint8Array(await held.arrayBuffer())
    },
    set: async (key, value) => {
      // `slice()` detaches the bytes from any larger buffer they were a view
      // into, so the Response body is exactly the value and nothing more.
      await (await open()).put(addressForKey(key), new Response(value.slice().buffer))
    },
    remove: async (key) => {
      await (await open()).delete(addressForKey(key))
    },
    clear: async () => {
      // SAFETY: the Cache API is optional on this global; we read it and branch on absence.
      const store = (globalThis as { caches?: CacheStorage }).caches
      if (store === undefined) throw new NoExtensionApi("the Cache API")
      await store.delete(STORE_NAME)
    },
    keys: async () => (await (await open()).keys()).map((held) => keyForAddress(held.url)),
    // `keys(address)` matches without reading a body, which `match` would.
    has: async (key) => (await (await open()).keys(addressForKey(key))).length > 0
  }
}

const asTab = (raw: RawTab | undefined): Tab | undefined => {
  if (raw === undefined || raw.id === undefined || raw.url === undefined) return undefined
  return { id: TabId.make(raw.id), address: raw.url, active: raw.active ?? false }
}

const liveTabs = (api: ExtensionGlobal): TabsApi => ({
  active: async () => {
    if (api.tabs === undefined) throw new NoExtensionApi("tabs")
    const found = await Promise.resolve(api.tabs.query({ active: true, currentWindow: true }))
    // SAFETY: chrome.tabs returns Tab objects; the adapter types the wire as Json at the boundary.
    return asTab((found as ReadonlyArray<RawTab> | undefined)?.[0])
  },
  topFrameAddress: async (id) => {
    if (api.tabs === undefined) throw new NoExtensionApi("tabs")
    // `tabs.get(...).url` is the top frame by definition; no sub-frame address
    // ever appears here, which is one of the two places top-frame-only is free.
    const raw = await Promise.resolve(api.tabs.get(id))
    // SAFETY: chrome.tabs returns Tab objects; the adapter types the wire as Json at the boundary.
    return asTab(raw as RawTab | undefined)?.address
  }
})

const liveNavigation = (api: ExtensionGlobal): NavigationApi => ({
  watch: (sighted) => {
    const offs: Array<() => void> = []

    const nav = api.webNavigation
    if (nav !== undefined) {
      const relay = (cause: SightingCause) => (d: NavigationDetails) =>
        sighted({
          tabId: TabId.make(d.tabId),
          frameId: d.frameId,
          address: d.url,
          cause,
          referrer: undefined
        })
      const on = <F>(source: Listenable<F>, f: F) => {
        source.addListener(f)
        offs.push(() => source.removeListener(f))
      }
      on(nav.onCommitted, relay("committed"))
      on(nav.onHistoryStateUpdated, relay("history"))
      on(nav.onReferenceFragmentUpdated, relay("fragment"))
      // The address the browser was about to ask for. For a server redirect
      // this is the ONLY event carrying the address it started from —
      // `onCommitted` reports the destination and nothing else — and that
      // address is what tells `en.wikipedia.org/wiki/Main_Page` apart from a
      // Wikipedia article. Needs no permission `onCommitted` does not already
      // have.
      if (nav.onBeforeNavigate !== undefined) on(nav.onBeforeNavigate, relay("intended"))
      // `tabs.onUpdated` address changes ride ALONGSIDE webNavigation, not only
      // as its fallback. Measured (P1, 2026-08-10 battery, instrumented worker):
      // a redirect chain served through interception commits pages whose
      // navigation events never fire — the tab's address became
      // `/consent?…` and then `/real/doc` with `onCommitted` reporting
      // neither — and the only account of where the tab actually is was
      // `tabs.onUpdated`. A destination webNavigation never announces would
      // otherwise never be a Reading: the silent false negative ADR 0005
      // forbids. For ordinary navigations this merely repeats the commit one
      // event later, which the per-tab settle absorbs; only ADDRESS changes
      // are relayed, so a slow page's `status: complete` cannot restart the
      // settle and delay the panel. `tabs.onUpdated` reports the tab's
      // committed top-frame address by definition, so TOP_FRAME is exact, and
      // an address Chrome only shows mid-redirect enters the chain as a hop
      // that the settle discipline — not a listener — decides about.
      const source = api.tabs?.onUpdated
      if (source !== undefined) {
        const onAddress = (tabId: number, change: { readonly url?: string | undefined }) => {
          if (change.url === undefined) return
          sighted({
            tabId: TabId.make(tabId),
            frameId: TOP_FRAME,
            address: change.url,
            cause: "tab-updated",
            referrer: undefined
          })
        }
        source.addListener(onAddress)
        offs.push(() => source.removeListener(onAddress))
      }
    } else if (api.tabs?.onUpdated !== undefined) {
      // Safari on iOS. Coarser — no frame id, no in-page transitions — but the
      // alternative is a platform where nothing is ever read.
      const source = api.tabs.onUpdated
      const onUpdated = (tabId: number, change: { readonly url?: string | undefined }) => {
        if (change.url === undefined) return
        sighted({
          tabId: TabId.make(tabId),
          frameId: TOP_FRAME,
          address: change.url,
          cause: "tab-updated",
          referrer: undefined
        })
      }
      source.addListener(onUpdated)
      offs.push(() => source.removeListener(onUpdated))
    }

    // The referrer path. No background navigation event carries one, so a
    // report from the content script is the only evidence of which Network the
    // reader arrived from.
    const inbox = api.runtime?.onMessage
    if (inbox !== undefined) {
      const onNote = (note: HostMessage, sender: RawSender) => {
        if (!isJson(note)) return undefined
        const report = asSightingReport(note)
        if (report === undefined) return undefined
        sighted({
          tabId: TabId.make(sender.tab?.id ?? -1),
          frameId: sender.frameId ?? TOP_FRAME,
          address: report.address,
          cause: "reported",
          referrer: report.referrer
        })
        return undefined
      }
      inbox.addListener(onNote)
      offs.push(() => inbox.removeListener(onNote))
    }

    return () => {
      for (const off of offs) off()
      offs.length = 0
    }
  }
})

interface SightingReport {
  readonly address: string
  readonly referrer: string | undefined
}

/** Recognise a content-script report without trusting its shape. */
const asSightingReport = (note: Json): SightingReport | undefined => {
  if (!isPlainObject(note)) return undefined
  const tag = propertyOf(note, "_tag")
  const address = propertyOf(note, "address")
  const referrer = propertyOf(note, "referrer")
  if (tag !== SIGHTED || !isString(address)) return undefined
  return {
    address,
    referrer: isString(referrer) && referrer !== "" ? referrer : undefined
  }
}

const liveMessages = (api: ExtensionGlobal): MessagesApi => ({
  send: async (note, to) => {
    const runtime = api.runtime
    if (runtime === undefined) throw new NoExtensionApi("runtime")
    const answer = to === undefined
      ? await Promise.resolve(runtime.sendMessage(note))
      : api.tabs === undefined
        ? await Promise.reject<HostMessage>(new NoExtensionApi("tabs"))
        : await Promise.resolve(api.tabs.sendMessage(to, note))
    return isJson(answer) ? answer : undefined
  },
  watch: (received) => {
    const inbox = api.runtime?.onMessage
    if (inbox === undefined) return () => {}
    const onNote = (note: HostMessage, sender: RawSender, respond: (note: Json) => void) => {
      if (!isJson(note)) return undefined
      // A content-script report is a Sighting, not a message. Surfacing it as
      // both would have every panel see navigation traffic it cannot use.
      if (asSightingReport(note) !== undefined) return undefined
      received({
        note,
        from: { tabId: sender.tab?.id === undefined ? undefined : TabId.make(sender.tab.id), frameId: sender.frameId },
        reply: respond
      })
      // Keeps the response channel open across an async handler. Returning
      // anything falsy closes it and the sender's `ask` resolves undefined.
      return true
    }
    inbox.addListener(onNote)
    return () => inbox.removeListener(onNote)
  }
})

/** The real browser, resolved at first use. */
export const live = (): WebExtApi => {
  const { api, vendor } = namespace()
  return {
    vendor,
    store: liveStore(),
    tabs: liveTabs(api),
    navigation: liveNavigation(api),
    messages: liveMessages(api)
  }
}

/**
 * The real browser, with its navigation listeners ALREADY ATTACHED.
 *
 * {@link live} attaches nothing: `navigation.watch` is called by
 * `Tabs.sightings`, which is a `Stream.callback` and therefore does not run
 * until some fiber runs the stream — a layer build and a schedule after the
 * worker started. That is too late for MV3 (see `Relay.ts`), so a background
 * worker calls THIS in its first turn instead. The adapter is unchanged and
 * still the only one: all this does is start it early and hold what it reports
 * until the runtime is up.
 *
 * Surfaces that are not the background — the popup, the options page — have no
 * wake-up semantics to satisfy and should keep using {@link live}.
 */
export const armed = (): WebExtApi => {
  const platform = live()
  const sightings = Relay.relay<Sighting>((emit) => {
    platform.navigation.watch(emit)
  })
  return {
    ...platform,
    navigation: { watch: (sighted) => sightings.watch(sighted) }
  }
}

// ---------------------------------------------------------------------------
// The test double
// ---------------------------------------------------------------------------

/** A Sighting with everything but the address defaulted. */
export interface SightingDraft {
  readonly address: string
  readonly tabId?: number | undefined
  readonly frameId?: number | undefined
  readonly cause?: SightingCause | undefined
  readonly referrer?: string | undefined
}

export interface WebExtDouble extends WebExtApi {
  /** Emit a Sighting as the platform would have. */
  readonly sight: (draft: SightingDraft) => void
  /** Deliver an inbound message as the platform would have. */
  readonly deliver: (note: Json, from?: Correspondent) => void
  /**
   * Resolves once something has subscribed to Sightings.
   *
   * A test that pushes an event before the subscription exists asserts against
   * an empty list and fails intermittently — under load, and therefore in CI
   * and not on the desk where it was written. Waiting on the platform's own
   * account of being watched removes the guess; a fixed sleep only shortens it.
   */
  readonly watched: Promise<void>
  /** Resolves once something has subscribed to inbound messages. */
  readonly listened: Promise<void>
  /** Everything `messages.send` was given, oldest first. */
  readonly sent: ReadonlyArray<{ readonly note: Json; readonly to: TabId | undefined }>
  /** What `messages.send` resolves with. Defaults to `undefined`. */
  answer: (note: Json) => Json | undefined
  /** The tab `tabs.active` reports. */
  activeTab: Tab | undefined
  /** The raw bytes held, for assertions. */
  readonly held: Map<string, Uint8Array>
}

/**
 * An in-memory platform.
 *
 * Not a mock framework: it is the same interface with a `Map` behind it and two
 * extra methods to push events in. Every service in this package can therefore
 * be exercised end to end in node, which is what makes top-frame enforcement
 * and debouncing testable rather than merely asserted in a comment.
 */
export const makeDouble = (): WebExtDouble => {
  const held = new Map<string, Uint8Array>()
  const watchers = new Set<(sighting: Sighting) => void>()
  const inboxes = new Set<(delivery: Delivery) => void>()
  const sent: Array<{ note: Json; to: TabId | undefined }> = []

  let announceWatched: () => void = () => {}
  const watched = new Promise<void>((resolve) => {
    announceWatched = resolve
  })
  let announceListened: () => void = () => {}
  const listened = new Promise<void>((resolve) => {
    announceListened = resolve
  })

  const double: WebExtDouble = {
    vendor: "double",
    held,
    sent,
    watched,
    listened,
    answer: () => undefined,
    activeTab: undefined,

    sight: (draft) =>
      watchers.forEach((watcher) =>
        watcher({
          tabId: TabId.make(draft.tabId ?? 1),
          frameId: draft.frameId ?? TOP_FRAME,
          address: draft.address,
          cause: draft.cause ?? "committed",
          referrer: draft.referrer
        })
      ),

    deliver: (note, from) =>
      inboxes.forEach((inbox) =>
        inbox({
          note,
          from: from ?? { tabId: TabId.make(1), frameId: TOP_FRAME },
          reply: () => {}
        })
      ),

    store: {
      get: (key) => Promise.resolve(held.get(key)),
      set: (key, value) => {
        held.set(key, value.slice())
        return Promise.resolve()
      },
      remove: (key) => {
        held.delete(key)
        return Promise.resolve()
      },
      clear: () => {
        held.clear()
        return Promise.resolve()
      },
      keys: () => Promise.resolve([...held.keys()]),
      has: (key) => Promise.resolve(held.has(key))
    },

    tabs: {
      active: () => Promise.resolve(double.activeTab),
      topFrameAddress: (id) =>
        Promise.resolve(double.activeTab?.id === id ? double.activeTab.address : undefined)
    },

    navigation: {
      watch: (sighted) => {
        watchers.add(sighted)
        announceWatched()
        return () => watchers.delete(sighted)
      }
    },

    messages: {
      send: (note, to) => {
        sent.push({ note, to })
        return Promise.resolve(double.answer(note))
      },
      watch: (received) => {
        inboxes.add(received)
        announceListened()
        return () => inboxes.delete(received)
      }
    }
  }

  return double
}
