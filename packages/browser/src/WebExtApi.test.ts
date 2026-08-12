/**
 * The live adapter, against a fake namespace.
 *
 * These paths are the ones the double cannot exercise and CI cannot reach in a
 * real browser on every commit: the Safari-on-iOS fallback that ADR 0003 makes
 * a release blocker, the routing of a content-script report, and the key
 * encoding that decides whether two different Subject URLs share a stored value.
 */
import { afterEach, describe, expect, it } from "vitest"
import { asBytes } from "./Storage.ts"
import { live, type Sighting, SIGHTED } from "./WebExtApi.ts"
import { type Json } from "@parle/domain/Refine"

/** Chrome/cache stubs this file constructs; the live adapter only reads what it needs. */
interface HostFake {}

interface TestGlobals {
  chrome?: HostFake
  browser?: HostFake
  caches?: HostFake
}

// SAFETY: tests install fake chrome/browser/caches onto this process global.
const globals = globalThis as TestGlobals

const install = (name: "chrome" | "browser" | "caches", fake: HostFake) => {
  if (name === "chrome") globals.chrome = fake
  else if (name === "browser") globals.browser = fake
  else globals.caches = fake
}

afterEach(() => {
  delete globals.chrome
  delete globals.browser
  delete globals.caches
})

/** A platform event source, small enough to see through. */
const listenable = <F extends (...args: never[]) => boolean | undefined | void>() => {
  const listeners = new Set<F>()
  return {
    addListener: (f: F) => listeners.add(f),
    removeListener: (f: F) => listeners.delete(f),
    emit: (...args: Parameters<F>) => [...listeners].map((f) => f(...args)),
    get count() {
      return listeners.size
    }
  }
}

describe("choosing a namespace", () => {
  it("prefers browser over chrome", () => {
    // Safari and Firefox provide both; `browser` is the promise-returning one.
    install("browser", { runtime: {} })
    install("chrome", { runtime: {} })
    expect(live().vendor).toBe("browser")
  })

  it("falls back to chrome", () => {
    install("chrome", { runtime: {} })
    expect(live().vendor).toBe("chrome")
  })

  it("refuses to pretend when there is no extension at all", () => {
    expect(() => live()).toThrow(/no WebExtension namespace/)
  })
})

describe("watching navigation without webNavigation", () => {
  it("uses tabs.onUpdated, because Safari on iOS has nothing else", () => {
    const onUpdated = listenable<
      (tabId: number, change: { url?: string | undefined }, tab: Json) => void
    >()
    install("chrome", { runtime: {}, tabs: { onUpdated } })

    const seen: Array<Sighting> = []
    const unwatch = live().navigation.watch((sighting) => seen.push(sighting))

    onUpdated.emit(7, { url: "https://example.com/story" }, {})
    // A tab update that changed something other than the address is not a
    // navigation, and minting a Reading for it would double every Lookup.
    onUpdated.emit(7, {}, {})

    expect(seen).toEqual([
      {
        tabId: 7,
        frameId: 0,
        address: "https://example.com/story",
        cause: "tab-updated",
        referrer: undefined
      }
    ])

    unwatch()
    expect(onUpdated.count).toBe(0)
  })
})

describe("the content script's report", () => {
  const withInbox = () => {
    const onMessage = listenable<
      (note: Json, sender: Json, respond: (note: Json) => void) => boolean | undefined
    >()
    install("chrome", { runtime: { sendMessage: () => Promise.resolve(), onMessage } })
    return onMessage
  }

  it("carries the referrer no navigation event has", () => {
    const onMessage = withInbox()
    const seen: Array<Sighting> = []
    live().navigation.watch((sighting) => seen.push(sighting))

    onMessage.emit(
      { _tag: SIGHTED, address: "https://example.com/story", referrer: "https://news.ycombinator.com/item?id=1" },
      { tab: { id: 3 }, frameId: 0 },
      () => {}
    )

    expect(seen).toEqual([
      {
        tabId: 3,
        frameId: 0,
        address: "https://example.com/story",
        cause: "reported",
        referrer: "https://news.ycombinator.com/item?id=1"
      }
    ])
  })

  it("does not also arrive as a message", () => {
    // One platform event must not surface on two seams, or every panel sees
    // navigation traffic it has no use for and cannot distinguish.
    const onMessage = withInbox()
    const platform = live()
    const sightings: Array<Sighting> = []
    const notes: Array<Json> = []
    platform.navigation.watch((sighting) => sightings.push(sighting))
    platform.messages.watch((delivery) => notes.push(delivery.note))

    onMessage.emit({ _tag: SIGHTED, address: "https://example.com/story" }, { tab: { id: 3 } }, () => {})
    onMessage.emit({ _tag: "parle/panel/opened" }, { tab: { id: 3 } }, () => {})

    expect(sightings).toHaveLength(1)
    expect(notes).toEqual([{ _tag: "parle/panel/opened" }])
  })

  it("keeps the reply channel open for an ordinary note", () => {
    // Returning anything falsy closes it and the sender's `ask` resolves
    // undefined before the handler has run.
    const onMessage = withInbox()
    live().messages.watch(() => {})
    expect(onMessage.emit({ _tag: "parle/panel/opened" }, {}, () => {})).toEqual([true])
  })

  it("ignores a report whose shape it cannot trust", () => {
    const onMessage = withInbox()
    const seen: Array<Sighting> = []
    live().navigation.watch((sighting) => seen.push(sighting))

    onMessage.emit({ _tag: SIGHTED }, { tab: { id: 3 } }, () => {})
    onMessage.emit({ _tag: SIGHTED, address: 42 }, { tab: { id: 3 } }, () => {})
    onMessage.emit(null, { tab: { id: 3 } }, () => {})

    expect(seen).toEqual([])
  })
})

describe("the Cache API store", () => {
  /** A CacheStorage small enough to be obviously right. */
  const fakeCaches = () => {
    const held = new Map<string, Uint8Array>()
    const cache = {
      match: (address: string) => {
        const bytes = held.get(address)
        return Promise.resolve(bytes === undefined ? undefined : new Response(bytes.slice().buffer))
      },
      put: async (address: string, response: Response) => {
        held.set(address, new Uint8Array(await response.arrayBuffer()))
      },
      delete: (address: string) => Promise.resolve(held.delete(address)),
      keys: (address?: string) =>
        Promise.resolve(
          [...held.keys()]
            .filter((url) => address === undefined || url === address)
            .map((url) => ({ url }))
        )
    }
    return { store: { open: () => Promise.resolve(cache), delete: () => Promise.resolve(held.clear()) }, held }
  }

  it("round-trips a key containing everything a URL can contain", async () => {
    // Lookup Record keys are opaque hashes, but Recollection keys are Subject
    // URLs. A key encoding that dropped a query string would silently merge two
    // Subjects into one stored value.
    const { store } = fakeCaches()
    install("chrome", { runtime: {} })
    install("caches", store)

    const platform = live()
    const key = "recall/https://example.com/a?b=1&c=2#frag /x"
    await platform.store.set(key, new Uint8Array([0x00, 0xff, 0x7f]))

    expect([...(await platform.store.get(key)) ?? []]).toEqual([0x00, 0xff, 0x7f])
    expect(await platform.store.keys()).toEqual([key])
    expect(await platform.store.has(key)).toBe(true)
    expect(await platform.store.has("recall/https://example.com/a")).toBe(false)

    await platform.store.remove(key)
    expect(await platform.store.get(key)).toBeUndefined()
    expect(await platform.store.keys()).toEqual([])
  })

  it("keeps two Subjects that differ only in query apart", async () => {
    const { store } = fakeCaches()
    install("chrome", { runtime: {} })
    install("caches", store)

    const platform = live()
    await platform.store.set("https://example.com/a", asBytes("one"))
    await platform.store.set("https://example.com/a?utm=x", asBytes("two"))

    expect((await platform.store.keys()).length).toBe(2)
  })

  it("says the Cache API is missing rather than failing obscurely", async () => {
    install("chrome", { runtime: {} })
    await expect(live().store.get("k")).rejects.toThrow(/Cache API/)
  })
})
