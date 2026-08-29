/**
 * The redirect, end to end, through the worker's own entrypoint.
 *
 * `Enrichment.test.ts` proves the DECISION against the shipped graph: which
 * requests go out, and what `Board.landing` answers. It stops one step short of
 * the only thing the reader experiences, which is the tab moving. This file is
 * that step, and it is worth its own file for the reason `Background.test.ts`
 * exists at all: nothing else in this workspace runs `main`, and a chain that is
 * correct at every link and wired to nothing passes every other test in here.
 *
 * So the entrypoint is real, the layer is real, the Board and the Enquiry and the
 * settings document are real, and two things are recorded rather than answered:
 * the browser (a ledger of what was asked of Chrome, exactly as in
 * `Background.test.ts`) and `fetch` (a ledger of what went on the wire).
 *
 * Three claims, and the third is the one that cost the design something:
 *
 *   1. With the setting off — which is the default — a navigation produces no
 *      request to archive.org AND no navigation. Both halves: a wiring that
 *      asked and then declined to move anybody would satisfy a reader watching
 *      their address bar and disclose every page they open to a third party.
 *   2. With it on, the tab is sent to the kept copy.
 *   3. The redirected tab lands on `web.archive.org`, which settles as a new
 *      Reading of the original Subject: its address unwraps mechanically, so
 *      every Discussion about the original page stays beside the kept copy.
 *      The same wiring runs again and is refused without a request. That is the
 *      loop, and it is closed by `decideLanding`'s `already-in-the-archive`
 *      rule plus the same predicate checked before the Archive is asked at all.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import { SETTINGS_KEY } from "../settings/Settings.ts"
import { PanelOpened, PILL_PORT, Watch } from "../wire/Wire.ts"

const TAB = 5
const PAGE = "https://www.nature.com/articles/d41586-024-02012-5"
const TITLE = "Not all 'open source' AI models are open"
/** Six weeks old, so it is inside the year `background.ts` allows. */
const SNAPSHOT_AT = "20260713000000"
const ARCHIVED = `https://web.archive.org/web/${SNAPSHOT_AT}/${PAGE}`

interface Fired {
  readonly addListener: (f: (...args: Array<never>) => void) => void
  readonly removeListener: (f: (...args: Array<never>) => void) => void
  readonly hasListeners: () => boolean
  readonly fire: (...args: Array<unknown>) => void
}

const event = (): Fired => {
  const listeners: Array<(...args: Array<never>) => void> = []
  return {
    addListener: (f) => listeners.push(f),
    removeListener: (f) => {
      const at = listeners.indexOf(f)
      if (at >= 0) listeners.splice(at, 1)
    },
    hasListeners: () => listeners.length > 0,
    fire: (...args) =>
      listeners.slice().forEach((f) => (f as (...a: Array<unknown>) => void)(...args))
  }
}

const events = {
  installed: event(),
  connect: event(),
  message: event(),
  tabActivated: event(),
  tabUpdated: event(),
  tabRemoved: event(),
  committed: event(),
  history: event(),
  fragment: event()
}

/** Every `tabs.update` that carried a `url` — the whole of "the reader moved". */
const navigated: Array<{ readonly tabId: number; readonly url: string }> = []
/** Which address each tab is currently on, so a redirect is visible to the next read. */
const addresses = new Map<number, string>([[TAB, PAGE]])

/**
 * The settings document, pre-seeded before the worker starts.
 *
 * Written straight into the Cache fake under the key and origin
 * `@parle/browser`'s store uses, because the worker reads it during layer build
 * and there is no message that could arrive early enough to change it. The
 * reader here has answered the first-run question, said yes to automatic
 * lookups, and turned the archived-copy setting on: all three are required, and
 * the tests below turn the third one off by rewriting this before the run.
 */
const STORE_ORIGIN = "https://parle.invalid/"
const cache = new Map<string, Response>()

const seedSettings = (autoOpenArchive: boolean): void => {
  cache.set(
    `${STORE_ORIGIN}${encodeURIComponent(SETTINGS_KEY)}`,
    new Response(
      new TextEncoder().encode(
        JSON.stringify({ automatic: true, decided: true, autoOpenArchive })
      ).slice().buffer
    )
  )
}

const caches = {
  open: async () => ({
    match: async (url: string) => cache.get(url)?.clone(),
    put: async (url: string, body: Response) => void cache.set(url, body),
    delete: async (url: string) => cache.delete(url),
    keys: async (url?: string) =>
      [...cache.keys()].filter((k) => url === undefined || k === url).map((k) => ({ url: k }))
  }),
  keys: async () => ["parle"],
  delete: async () => true
}

const browser = {
  runtime: {
    id: "parle-under-test",
    onInstalled: events.installed,
    onConnect: events.connect,
    onMessage: events.message,
    getManifest: () => ({}),
    getURL: (path: string) => `chrome-extension://parle-under-test${path}`,
    sendMessage: async () => undefined
  },
  tabs: {
    onActivated: events.tabActivated,
    onUpdated: events.tabUpdated,
    onRemoved: events.tabRemoved,
    get: async (tabId: number) => ({
      id: tabId,
      url: addresses.get(tabId) ?? PAGE,
      title: TITLE,
      active: true
    }),
    query: async (about: { url?: string } = {}) =>
      about.url === undefined
        ? [{ id: TAB, url: addresses.get(TAB) ?? PAGE, title: TITLE, active: true }]
        : [],
    create: async () => ({ id: 99 }),
    // The one call this file is about. `active: true` focus changes come through
    // here too, so only the ones carrying a `url` count as moving a reader.
    update: async (tabId: number, change: { url?: string }) => {
      if (change.url !== undefined) {
        navigated.push({ tabId, url: change.url })
        addresses.set(tabId, change.url)
      }
      return { id: tabId }
    },
    sendMessage: async () => undefined
  },
  webNavigation: {
    onCommitted: events.committed,
    onHistoryStateUpdated: events.history,
    onReferenceFragmentUpdated: events.fragment
  },
  action: { setBadgeText: async () => {}, setTitle: async () => {}, getBadgeText: async () => "" },
  scripting: { executeScript: async () => [] }
}

/** Every URL the worker put on the wire, in order. */
const asked: Array<string> = []

const body = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  })

/**
 * A wire that answers for the Archive and refuses everything else.
 *
 * The Networks 403 — which is what this development box really gets from Reddit
 * — so they settle out of the way quickly and cannot be mistaken for the
 * requests under test.
 */
const fakeFetch = async (input: unknown): Promise<Response> => {
  const url = typeof input === "string"
    ? input
    : String((input as { url?: unknown }).url ?? input)
  asked.push(url)
  if (url.includes("archive.org/wayback/available")) {
    return body({
      archived_snapshots: {
        closest: { url: ARCHIVED, timestamp: SNAPSHOT_AT, status: "200", available: true }
      }
    })
  }
  if (url.includes("web.archive.org/cdx")) {
    return body([
      ["timestamp", "statuscode", "digest"],
      ["20190502000000", "200", "AAA"],
      [SNAPSHOT_AT, "200", "BBB"]
    ])
  }
  return new Response("<html>blocked</html>", {
    status: 403,
    headers: { "content-type": "text/html" }
  })
}

const toArchive = (): ReadonlyArray<string> =>
  asked.filter((url) => {
    try {
      const host = new URL(url).hostname
      return host === "archive.org" || host.endsWith(".archive.org")
    } catch {
      return false
    }
  })

const settle = (ms: number) => new Promise((go) => setTimeout(go, ms))

describe("taking the reader to the archived copy", () => {
  beforeAll(async () => {
    seedSettings(false)
    Object.assign(globalThis, { chrome: browser, browser, caches, fetch: fakeFetch })
    vi.spyOn(console, "error").mockImplementation(() => {})
    const worker: { default: { main: () => void } } = await import("../entrypoints/background.ts")
    worker.default.main()
    await settle(300)
  }, 20_000)

  it("with the setting off, asks the Archive nothing and moves nobody", async () => {
    // Off is the default, and off has to be silent in BOTH senses. A wiring that
    // asked at navigation time and then declined to redirect would look correct
    // to the reader and would be sending them to a third party on every page.
    events.committed.fire({ tabId: TAB, frameId: 0, url: PAGE })
    await settle(1_500)

    expect(toArchive()).toEqual([])
    expect(navigated).toEqual([])
  }, 15_000)

  it("with the setting on, sends the tab to the kept copy", async () => {
    seedSettings(true)
    const next = "https://www.nature.com/articles/d41586-024-02012-6"
    addresses.set(TAB, next)
    events.committed.fire({ tabId: TAB, frameId: 0, url: next })
    await settle(2_000)

    expect(toArchive()[0]).toContain("archive.org/wayback/available")
    expect(navigated.map((one) => one.url)).toContain(ARCHIVED)
    expect(navigated.every((one) => one.tabId === TAB)).toBe(true)
  }, 15_000)

  /**
   * The loop, closed at the level where it would actually run.
   *
   * The tab is now on `web.archive.org`. That settles as a new Reading of the
   * same Subject and the same wiring runs against it — which is the shape that,
   * left alone, redirects forever. It must produce no navigation and, because
   * `Board.landing` checks the Archive's own hosts before it asks, no request
   * either.
   */
  it("does not redirect again from the page it just redirected to", async () => {
    const moved = navigated.length
    const before = toArchive().length
    addresses.set(TAB, ARCHIVED)
    events.committed.fire({ tabId: TAB, frameId: 0, url: ARCHIVED })
    await settle(2_000)

    expect(navigated.length).toBe(moved)
    expect(toArchive().length).toBe(before)
  }, 15_000)

  /**
   * The other end of the same wiring: a reader opening the panel.
   *
   * `PanelOpened` is the only message on the wire that spends a request on these
   * two places, and it is a different act from `Watch` — which the pill sends the
   * instant it is injected. This drives both through a real port and asserts that
   * only the second one costs anything, which is the whole reason they are two
   * messages rather than one with a flag.
   */
  it("asks Wikipedia only once the reader has actually opened the panel", async () => {
    const fresh = "https://www.nature.com/articles/d41586-024-02012-7"
    addresses.set(TAB, fresh)
    events.committed.fire({ tabId: TAB, frameId: 0, url: fresh })
    await settle(1_500)

    const onMessage: Array<(raw: unknown) => void> = []
    events.connect.fire({
      name: PILL_PORT,
      sender: { tab: { id: TAB, windowId: 1 } },
      onMessage: { addListener: (f: (raw: unknown) => void) => onMessage.push(f) },
      onDisconnect: { addListener: () => {} },
      postMessage: () => {}
    })
    const say = (ask: unknown) => onMessage.slice().forEach((f) => f(ask))

    // Subscribing is not asking. The pill sends this the moment it appears, on
    // a page the reader may never look at.
    say(Watch(TAB))
    await settle(900)
    const wikipedia = () => asked.filter((url) => url.includes("en.wikipedia.org"))
    expect(wikipedia()).toEqual([])

    say(PanelOpened())
    await settle(1_500)
    expect(wikipedia().length).toBeGreaterThan(0)
  }, 20_000)
})
