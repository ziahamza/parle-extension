/**
 * The one test that does not substitute the platform.
 *
 * Every other test in this workspace — all 880 of them, including
 * `Pipeline.live.test.ts`, which drives the real Hacker News API — reaches into
 * the graph and runs a service directly. None of them runs `main`, and none
 * asks the only question a service worker's user asks: *is anything listening?*
 * A bug that registered zero listeners and did nothing on any navigation
 * therefore passed the entire suite, in a browser, in silence, for days.
 *
 * So this drives the REAL entrypoint — `background.ts`'s own default export —
 * against a recording browser, and asserts the two properties that were both
 * violated and neither observable:
 *
 *   1. **Every listener is attached in `main`'s own turn.** MV3 decides whether
 *      to wake a killed worker from the listeners registered during initial
 *      evaluation, and delivers the waking event in that same turn. A listener
 *      attached after an `await` belongs to a worker that will not be woken and
 *      misses the navigation that started it (measured on Chrome 151: 33ms late
 *      was late enough). This is a *synchronous* assertion on purpose.
 *
 *   2. **The subscriptions are live.** Registration is necessary and nowhere
 *      near sufficient: the original bug forked five stream subscriptions into
 *      a scope that closed in the same tick, so every one was interrupted
 *      before it ran a single instruction — and the root fiber exited
 *      `Success`, so there was no Cause to log and nothing to catch. Firing one
 *      navigation and requiring the worker to *act* on it is what catches that,
 *      and it would still catch it if the listeners were attached by some other
 *      route.
 *
 * The fake below records rather than answers: it is not a model of Chrome, it
 * is a ledger of what was asked of Chrome. Note what is NOT stubbed — the
 * Layer, the Board, the Enquiry, the policy, the settings document. Those are
 * real, which is the property that makes this test worth having.
 *
 * It lives in `src/app` rather than beside `background.ts` because WXT treats
 * every `*.ts` in `src/entrypoints` as an entrypoint (`*.[jt]s?(x)` →
 * "unlisted-script") and fails the whole build on one without a default export.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import {
  Forget,
  LookAnyway,
  PANEL_PORT,
  PanelClosed,
  PanelOpened,
  PILL_PORT,
  Sighted,
  Summarise,
  Watch
} from "../wire/Wire.ts"

/** One `chrome.*` event, recording every registration and able to fire. */
interface Fired {
  readonly addListener: (f: (...args: Array<never>) => void) => void
  readonly removeListener: (f: (...args: Array<never>) => void) => void
  readonly hasListeners: () => boolean
  readonly fire: (...args: Array<unknown>) => void
}

/** Every `addListener` this worker made, in order. */
const attached: Array<string> = []

const event = (name: string): Fired => {
  const listeners: Array<(...args: Array<never>) => void> = []
  return {
    addListener: (f) => {
      attached.push(name)
      listeners.push(f)
    },
    removeListener: (f) => {
      const at = listeners.indexOf(f)
      if (at >= 0) listeners.splice(at, 1)
    },
    hasListeners: () => listeners.length > 0,
    fire: (...args) => listeners.slice().forEach((f) => (f as (...a: Array<unknown>) => void)(...args))
  }
}

const events = {
  installed: event("runtime.onInstalled"),
  connect: event("runtime.onConnect"),
  message: event("runtime.onMessage"),
  tabActivated: event("tabs.onActivated"),
  tabUpdated: event("tabs.onUpdated"),
  tabRemoved: event("tabs.onRemoved"),
  committed: event("webNavigation.onCommitted"),
  history: event("webNavigation.onHistoryStateUpdated"),
  fragment: event("webNavigation.onReferenceFragmentUpdated")
}

/** What the worker told the browser to show, and what it asked about. */
const marked: Array<{ readonly tabId: number; readonly text: string; readonly hint: string }> = []
const askedAbout: Array<number> = []
const nativeMessages: Array<{
  readonly application: string
  readonly message: Record<string, unknown>
}> = []
let nativeRecordFailures = 0

const TAB = 7
/** A second tab, so "follows the reader" is about following and not about one tab. */
const OTHER_TAB = 11
/** A tab holding one of our own pages — the popup opened as a page. */
const POPUP_TAB = 13
const PAGE = "https://www.nature.com/articles/d41586-024-02012-5"
const SUBJECT = "https://nature.com/articles/d41586-024-02012-5"
const POPUP_PAGE = "chrome-extension://parle-under-test/popup.html"

/**
 * A Cache API, because the settings document is read through it before the
 * worker subscribes to anything — which is exactly the await this used to race.
 */
const cache = new Map<string, Response>()
const caches = {
  open: async () => ({
    match: async (url: string) => cache.get(url),
    put: async (url: string, body: Response) => void cache.set(url, body),
    delete: async (url: string) => cache.delete(url),
    keys: async (url?: string) =>
      [...cache.keys()].filter((k) => url === undefined || k === url).map((k) => ({ url: k }))
  }),
  keys: async () => ["parle"],
  delete: async () => true
}

/**
 * Every tab `chrome.sidePanel.open` was called for. The native panel is gone;
 * this stays so a regression that starts calling it again fails here, not
 * only in a browser.
 */
const openedAside: Array<number> = []

const TITLE = "Not all 'open source' AI models are actually open"

const browser = {
  runtime: {
    id: "parle-under-test",
    onInstalled: events.installed,
    onConnect: events.connect,
    onMessage: events.message,
    getManifest: () => ({}),
    getURL: (path: string) => `chrome-extension://parle-under-test${path}`,
    sendMessage: async () => undefined,
    sendNativeMessage: async (application: string, message: Record<string, unknown>) => {
      nativeMessages.push({ application, message })
      if (message.command === "recordOpening" && nativeRecordFailures > 0) {
        nativeRecordFailures -= 1
        return { ok: false, error: "shared store unavailable" }
      }
      return { ok: true }
    }
  },
  // Still present on the fake Chrome, so a regression that starts opening a
  // native panel again is recorded rather than silently no-op'd.
  sidePanel: {
    open: async ({ tabId }: { tabId: number }) => {
      openedAside.push(tabId)
    }
  },
  tabs: {
    onActivated: events.tabActivated,
    onUpdated: events.tabUpdated,
    onRemoved: events.tabRemoved,
    get: async (tabId: number) => {
      askedAbout.push(tabId)
      return tabId === POPUP_TAB
        ? { id: tabId, url: POPUP_PAGE, title: "Parle", active: true }
        : { id: tabId, url: PAGE, title: TITLE, active: true }
    },
    // Asked two different questions through one API: "which page is the reader
    // looking at" (no `url`), and "is one of our own pages already open"
    // (`url`). Only the first has an answer here.
    query: async (about: { url?: string } = {}) =>
      about.url === undefined ? [{ id: TAB, url: PAGE, title: TITLE, active: true }] : [],
    create: async () => ({ id: 99 }),
    update: async () => ({ id: 99 }),
    sendMessage: async () => undefined
  },
  webNavigation: {
    onCommitted: events.committed,
    onHistoryStateUpdated: events.history,
    onReferenceFragmentUpdated: events.fragment
  },
  action: {
    setBadgeText: async ({ tabId, text }: { tabId: number; text: string }) => {
      marked.push({ tabId, text, hint: "" })
    },
    setTitle: async ({ tabId, title }: { tabId: number; title: string }) => {
      marked.push({ tabId, text: "", hint: title })
    },
    getBadgeText: async () => ""
  },
  scripting: { executeScript: async () => [] }
}

/**
 * A surface connecting, with its own event objects.
 *
 * Not built from `event()` above on purpose: these are the PORT's listeners,
 * not the worker's, and counting them would break the "nothing was attached
 * after main's turn" check with noise that is not what that check is about.
 */
const connect = (
  name: string,
  tabId: number | null,
  heard: (word: {
    readonly _tag: string
    readonly tabId?: number
    readonly aside?: string
    readonly open?: boolean
    readonly scope?: string
    readonly requestId?: string
    readonly ok?: boolean
  }) => void,
  windowId = 1
) => {
  const onMessage: Array<(raw: unknown) => void> = []
  const onDisconnect: Array<() => void> = []
  const port = {
    name,
    sender: tabId === null ? {} : { tab: { id: tabId, windowId } },
    onMessage: { addListener: (f: (raw: unknown) => void) => onMessage.push(f) },
    onDisconnect: { addListener: (f: () => void) => onDisconnect.push(f) },
    postMessage: (word: unknown) => heard(word as { _tag: string })
  }
  events.connect.fire(port)
  return {
    say: (ask: unknown) => onMessage.slice().forEach((f) => f(ask)),
    disconnect: () => onDisconnect.slice().forEach((f) => f())
  }
}

/** Attached in `main`'s own synchronous turn — the MV3 requirement. */
let inMainsTurn: ReadonlyArray<string> = []
/** Anything `main`'s exit observer said. A serving worker says nothing. */
const complained: Array<string> = []

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("the background service worker, driven through its own entrypoint", () => {
  beforeAll(async () => {
    // Before the import: `wxt/browser` resolves `globalThis.browser` once, at
    // module evaluation, exactly as it does in the built artifact.
    vi.stubEnv("SAFARI", "true")
    Object.assign(globalThis, { chrome: browser, browser, caches })

    vi.spyOn(console, "error").mockImplementation((...said: Array<unknown>) => {
      complained.push(said.map(String).join(" "))
    })

    const worker: { default: { main: () => void } } = await import("../entrypoints/background.ts")
    worker.default.main()
    inMainsTurn = [...attached]

    // Long enough for the layer to build and ReadingWatch's 400ms settle to
    // pass. Nothing here is racing a fix: a worker that is serving reacts in
    // well under this, and one that is not never does.
    events.committed.fire({ tabId: TAB, frameId: 0, url: PAGE })
    await settle(2_500)
  }, 20_000)

  it("attaches every listener before main returns, not one turn later", () => {
    // Written as a subset check rather than an equality so that adding a
    // listener does not fail this — but adding one LATE does.
    expect(inMainsTurn).toEqual(expect.arrayContaining([
      "webNavigation.onCommitted",
      "webNavigation.onHistoryStateUpdated",
      "webNavigation.onReferenceFragmentUpdated",
      "runtime.onConnect",
      "runtime.onInstalled",
      "runtime.onMessage",
      "tabs.onActivated",
      "tabs.onUpdated",
      "tabs.onRemoved"
    ]))
  })

  it("attaches nothing after that turn, so a woken worker misses nothing", () => {
    expect(attached).toEqual(inMainsTurn)
  })

  it("acts on a navigation, which is the whole job", () => {
    // The spine, end to end: the platform event reached ReadingWatch, settled
    // into a Reading, minted a Subject on the Board, and drove the toolbar.
    // A worker whose subscriptions were interrupted before they started
    // registers every listener above and then does none of this.
    expect(askedAbout).toContain(TAB)
    expect(marked.map((m) => m.tabId)).toContain(TAB)
  })

  it("redraws the toolbar after a navigation that did not change the Reading", async () => {
    // Chrome wipes per-tab badge and title on every navigation commit, and a
    // back/forward landing on the address the tab already had is the same
    // Reading — correctly no boundary, therefore no frame, therefore nothing
    // to rewrite what the browser cleared. Found by the torture run: twenty
    // flips left the toolbar at its default title over a discussed page. The
    // `loaded` stream exists for exactly this; here it must produce a fresh
    // mark for the tab, from the Reading the Board already holds.
    const before = marked.length
    events.tabUpdated.fire(
      TAB,
      { status: "complete" },
      { id: TAB, url: PAGE, title: TITLE, active: true }
    )
    await settle(800)
    expect(marked.slice(before).map((m) => m.tabId)).toContain(TAB)
  })

  it("is still serving — its root fiber has not exited", () => {
    // `serve` cannot finish while the platform lives. An exit of ANY kind,
    // including a successful one, means the worker has gone inert; that is what
    // the original bug did, and it is what nothing was watching for.
    expect(complained.filter((said) => said.includes("stopped serving"))).toEqual([])
  })

  /**
   * The in-page panel is the only discussion surface. Chrome still exposes
   * `sidePanel` on this fake, so a regression that starts opening a browser
   * sidebar again is recorded here rather than only in a browser.
  */
  it("never opens a browser side panel, for any message on the wire", () => {
    const pill = connect(PILL_PORT, TAB, () => {})
    openedAside.length = 0
    for (const ask of [
      Watch(TAB),
      LookAnyway(),
      Summarise(),
      { _tag: "OpenAside" },
      { _tag: "OpenAsideish" }
    ]) {
      pill.say(ask)
    }
    expect(openedAside).toEqual([])
  })

  /**
   * A surface with no tab of its own follows the reader from tab to tab.
   *
   * The toolbar popup is the remaining case: opened as a page it can outlive
   * one tab, and `Watch(null)` still means "whatever the reader is looking at".
   */
  it("follows the reader to another tab, for a surface that outlives one", async () => {
    const frames: Array<{ readonly tabId?: number }> = []
    const popup = connect(PANEL_PORT, null, (word) => {
      if (word._tag === "Standing") frames.push(word)
    })

    popup.say(Watch(null))
    await settle(600)
    expect(frames.map((frame) => frame.tabId)).toContain(TAB)

    events.tabActivated.fire({ tabId: OTHER_TAB })
    await settle(900)
    expect(frames.map((frame) => frame.tabId)).toContain(OTHER_TAB)
  }, 10_000)

  /**
   * P1/P2 of the 2026-08-10 battery, at the exact seam where the unit suite
   * and the live graph used to disagree.
   *
   * `ReadingWatch`'s settle window is proven in its own tests — and the live
   * wiring defeated it: `tabs.onUpdated` TITLE events fire mid-navigation
   * carrying the tab's current address (a redirect interstitial wearing its
   * host as a placeholder title; an SPA burst re-titling each transient
   * pushState), and the old `following` subscription answered each with
   * `board.sight`, which minted a Reading and a Lookup burst with no settle
   * discipline anywhere in the path. That is how
   * `consent?continue=%2Freal%2Fdoc` reached Algolia. A title event whose
   * address is not the settled Reading's is a navigation in flight and must
   * change NOTHING the surfaces can see.
   */
  it("does not mint a Reading from a mid-navigation title event", async () => {
    const interstitial = "https://consenty.example/consent?continue=%2Freal%2Fdoc"
    const frames: Array<{ readonly panel?: { readonly address?: string } }> = []
    const popup = connect(PANEL_PORT, null, (word) => {
      if (word._tag === "Standing") frames.push(word as (typeof frames)[number])
    })
    popup.say(Watch(TAB))
    await settle(600)
    frames.length = 0

    // Chrome stamping a mid-navigation placeholder: a title-only change whose
    // tab already wears the interstitial address.
    events.tabUpdated.fire(
      TAB,
      { title: "consenty.example" },
      { id: TAB, url: interstitial, title: "consenty.example", active: true }
    )
    await settle(900)

    expect(frames.map((frame) => frame.panel?.address).filter((a) => a?.includes("consent")))
      .toEqual([])
  }, 10_000)


  it("resolves a surface's own never-sighted tab when asked, instead of looking forever", async () => {
    // The popup opened AS A PAGE: its port carries its own tab, so `Watch(null)`
    // names that tab — one of our own pages, whose address no boundary can ever
    // sight (`isReadable` refuses `chrome-extension://`) and whose activation
    // snapshot can race the address and lose. Before the activated/retitled
    // split, the popup's title event re-sighted it by accident; the split
    // removed that cover, and the surface then watched an `unopened` Reading
    // forever — "Still looking." over a tab nothing will ever look up (caught
    // by `parle.e2e.ts`, 2026-08-10 re-battle). The ask itself must resolve the
    // tab's address once: a gesture may resolve where the reader is now, while
    // events may only correct.
    const frames: Array<{ readonly panel?: { readonly address?: string } }> = []
    const popup = connect(PANEL_PORT, POPUP_TAB, (word) => {
      if (word._tag === "Standing") frames.push(word as (typeof frames)[number])
    })
    popup.say(Watch(null))
    await settle(900)

    expect(frames.length).toBeGreaterThan(0)
    expect(frames.map((frame) => frame.panel?.address)).toContain(POPUP_PAGE)
  }, 10_000)

  it("mirrors only an explicit panel open, refreshes that entry, and stops at its Subject boundary", async () => {
    // All earlier tests navigated, switched tabs, redrew furniture and opened
    // surfaces that only watched. None of those is consent to keep history.
    expect(nativeMessages).toEqual([])

    const replies: Array<{
      readonly _tag: string
      readonly scope?: string
      readonly requestId?: string
      readonly ok?: boolean
    }> = []
    const pill = connect(PILL_PORT, TAB, (word) => replies.push(word))
    pill.say(Watch(TAB))
    await settle(400)
    expect(nativeMessages).toEqual([])

    const openedAt = Date.now()
    // A native host can still be starting when the explicit open arrives. The
    // worker must retain and retry that exact latest frame without needing a
    // second redraw from the surface to rescue it.
    nativeRecordFailures = 1
    pill.say(PanelOpened(openedAt))
    await settle(1_600)
    const firstRecords = nativeMessages.filter(({ message }) =>
      message.command === "recordOpening")
    expect(firstRecords).toHaveLength(2)
    expect(firstRecords[1]?.message).toEqual(firstRecords[0]?.message)
    const first = firstRecords.at(-1)?.message
    // The native key is the elected Subject, not the visible tab URL.
    expect(first?.subject).toBe(SUBJECT)
    expect(first?.title).toBe(TITLE)
    expect(first?.openedAt).toBe(openedAt)
    expect(nativeMessages.every(({ application }) => application === "com.ziahamza.parle"))

    // A later Board frame refreshes the same entry, retaining the time of the
    // click rather than turning each arriving answer into a new visit.
    const settledTitle = `${TITLE} — settled`
    pill.say(Sighted(PAGE, settledTitle, ""))
    await settle(500)
    const refreshed = nativeMessages.filter(({ message }) =>
      message.command === "recordOpening")
    expect(refreshed.at(-1)?.message.title).toBe(settledTitle)
    expect(refreshed.at(-1)?.message.openedAt).toBe(first?.openedAt)

    // An identical frame is not another native write.
    const beforeDuplicate = refreshed.length
    pill.say(Sighted(PAGE, settledTitle, ""))
    await settle(500)
    expect(nativeMessages.filter(({ message }) => message.command === "recordOpening"))
      .toHaveLength(beforeDuplicate)

    // Closing the visible surface ends its authority to improve the row even
    // though the pill's port remains connected for the on-page mark.
    pill.say(PanelClosed())
    pill.say(Sighted(PAGE, `${settledTitle} after close`, ""))
    await settle(500)
    expect(nativeMessages.filter(({ message }) => message.command === "recordOpening"))
      .toHaveLength(beforeDuplicate)

    // A later explicit open starts a fresh visit on the same Subject.
    const reopenedAt = openedAt + 1_000
    pill.say(PanelOpened(reopenedAt))
    await settle(500)
    const afterReopen = nativeMessages.filter(({ message }) =>
      message.command === "recordOpening")
    expect(afterReopen.length).toBeGreaterThan(beforeDuplicate)
    expect(afterReopen.at(-1)?.message.title).toBe(`${settledTitle} after close`)
    expect(afterReopen.at(-1)?.message.openedAt).toBe(reopenedAt)

    // Moving to another canonical Subject clears tracking. Neither the move nor
    // a later frame on that page is recorded without a fresh PanelOpened.
    const beforeBoundary = afterReopen.length
    const next = "https://example.org/another-page"
    pill.say(Sighted(next, "Another page", ""))
    await settle(500)
    pill.say(Sighted(next, "Another page, settled", ""))
    await settle(500)
    expect(nativeMessages.filter(({ message }) => message.command === "recordOpening"))
      .toHaveLength(beforeBoundary)

    // A new click authorises the new Subject. Forget Everything clears the
    // native mirror and the live tracker, so another frame cannot recreate it.
    pill.say(PanelOpened())
    await settle(500)
    const beforeClear = nativeMessages.filter(({ message }) =>
      message.command === "recordOpening").length
    expect(nativeMessages.at(-1)?.message.subject).toBe(next)

    const clearAt = Date.now()
    pill.say(Forget("everything", "clear-native-recents", clearAt))
    await settle(500)
    expect(nativeMessages.at(-1)?.message).toEqual({
      schemaVersion: 1,
      command: "clearRecentOpenings",
      clearedAt: clearAt
    })
    expect(replies).toContainEqual({
      _tag: "Forgot",
      scope: "everything",
      requestId: "clear-native-recents",
      ok: true
    })
    pill.say(Sighted(next, "Must not return", ""))
    await settle(500)
    expect(nativeMessages.filter(({ message }) => message.command === "recordOpening"))
      .toHaveLength(beforeClear)
  }, 10_000)
})
