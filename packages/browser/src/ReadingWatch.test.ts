/**
 * The two rules a Reading has to obey, driven through the platform double.
 *
 * These are the tests that would otherwise be a comment. Top-frame enforcement
 * and settling are both invisible when they are wrong: the failure is extra
 * Subjects and extra Lookups about pages nobody opened, which looks exactly
 * like the product working.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { arrivalFrom, carriesAnAddress, isReadable, type ReadingBoundary, ReadingWatch } from "./ReadingWatch.ts"
import { Tabs } from "./Tabs.ts"
import { makeDouble, WebExt, type WebExtDouble } from "./WebExtApi.ts"

/** Short enough to keep the suite quick, long enough not to race the loop. */
const SETTLE = 60
/** Comfortably past the settle window, so "and nothing else" means something. */
const QUIET = 260

/**
 * Run a script against the double and return every Reading it produced.
 *
 * Goes through the real Tabs layer and the real ReadingWatch layer, so what is
 * under test is the wiring as it ships, not a hand-assembled stream.
 */
const readingsFrom = (
  script: (double: WebExtDouble) => void,
  windows: { readonly settle: number; readonly quiet: number } = { settle: SETTLE, quiet: QUIET }
) =>
  Effect.runPromise(
    Effect.gen(function*() {
      const double = makeDouble()
      const watch = yield* Effect.provide(
        ReadingWatch,
        ReadingWatch.settlingAfter(`${windows.settle} millis`).pipe(
          Layer.provide(Tabs.layer),
          Layer.provide(WebExt.doubleLayer(double))
        )
      )

      const seen: Array<ReadingBoundary> = []
      const collecting = yield* Effect.forkChild(
        Stream.runForEach(watch.readings, (boundary) =>
          Effect.sync(() => {
            seen.push(boundary)
          }))
      )

      // The platform's own word that the subscription exists, rather than a
      // guess at how long registering it takes on this machine.
      yield* Effect.promise(() => double.watched)
      script(double)
      yield* Effect.sleep(`${windows.quiet} millis`)
      yield* Fiber.interrupt(collecting)
      return seen
    })
  )

describe("top frame only", () => {
  it("does not mint a Reading for an embedded iframe", async () => {
    // The exact shape that made this rule necessary: a page embedding a video.
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://blog.example.com/post", frameId: 0 })
      double.sight({ address: "https://www.youtube-nocookie.com/embed/dQw4", frameId: 3 })
    })

    expect(seen.map((r) => r.address)).toEqual(["https://blog.example.com/post"])
  })

  it("mints nothing at all when every Sighting is a sub-frame", async () => {
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://ads.example.net/frame", frameId: 1 })
      double.sight({ address: "https://analytics.example.net/px", frameId: 2 })
    })

    expect(seen).toEqual([])
  })

  it("ignores addresses that could not be a Subject", async () => {
    const seen = await readingsFrom((double) => {
      double.sight({ address: "chrome-extension://abcdef/panel.html" })
      double.sight({ address: "about:blank" })
      double.sight({ address: "file:///home/reader/notes.txt" })
    })

    expect(seen).toEqual([])
  })

  it("recognises which schemes can name a Subject", () => {
    expect(isReadable("https://example.com/a")).toBe(true)
    expect(isReadable("http://example.com/a")).toBe(true)
    expect(isReadable("data:text/html,hi")).toBe(false)
    expect(isReadable("not a url at all")).toBe(false)
  })
})

describe("settling", () => {
  it("collapses a redirect chain into one Reading at the destination", async () => {
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://t.co/xY7" })
      double.sight({ address: "https://example.com/consent?next=/story" })
      double.sight({ address: "https://example.com/story" })
    })

    expect(seen.map((r) => r.address)).toEqual(["https://example.com/story"])
  })

  it("settles each tab independently", async () => {
    // A global debounce would let the background tab cancel the foreground one,
    // and nothing anywhere would record that it had happened.
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://example.com/foreground", tabId: 1 })
      double.sight({ address: "https://example.org/background", tabId: 2 })
    })

    expect(seen.map((r) => r.address).sort()).toEqual([
      "https://example.com/foreground",
      "https://example.org/background"
    ])
  })

  it("does not mint a second Reading when the address has not changed", async () => {
    // A Reading runs until the address CHANGES, so a reload is the same one.
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://example.com/story" })
      setTimeout(() => double.sight({ address: "https://example.com/story" }), SETTLE * 2)
    })

    expect(seen).toHaveLength(1)
  })

  it("mints a new Reading when an in-page navigation changes the address", async () => {
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://example.com/story" })
      setTimeout(
        () => double.sight({ address: "https://example.com/story/comments", cause: "history" }),
        SETTLE * 2
      )
    })

    expect(seen.map((r) => r.address)).toEqual([
      "https://example.com/story",
      "https://example.com/story/comments"
    ])
    expect(seen.map((r) => r.cause)).toEqual(["loaded", "in-page"])
  })
})

describe("the addresses a Reading passed through", () => {
  it("keeps the address a server redirect started from", async () => {
    // The case this exists for. `en.wikipedia.org/` redirects to
    // `/wiki/Main_Page`, and `onCommitted` reports only the destination — a
    // two-segment path indistinguishable from an article. The address the
    // reader actually asked for is the front door, and it survives here.
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://en.wikipedia.org/", cause: "intended" })
      double.sight({ address: "https://en.wikipedia.org/wiki/Main_Page", cause: "committed" })
    })

    expect(seen.map((r) => r.address)).toEqual(["https://en.wikipedia.org/wiki/Main_Page"])
    expect(seen[0]?.traversed).toEqual(["https://en.wikipedia.org/"])
  })

  it("keeps the origin of a server redirect that was slower than the settle window", async () => {
    // F1 in the 2026-08-10 battle battery. A server redirect produces exactly
    // two events — `onBeforeNavigate` at the origin and `onCommitted` at the
    // destination, which never gets an `intended` of its own — so the time
    // between the two hops is the WHOLE network round-trip: DNS, TLS, the 301,
    // the second request. On a cold profile under load that crosses the settle
    // window, and the fold ADR 0019 shipped flickered with the network weather
    // (en.wikipedia.org/ folded 11 both visits in battery 1, drew 11 unfolded
    // in battery 2). The origin of a navigation that COMMITTED is part of that
    // navigation however slow the wire was; only an abandoned one is stale.
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://en.wikipedia.org/", cause: "intended" })
      setTimeout(
        () => double.sight({ address: "https://en.wikipedia.org/wiki/Main_Page", cause: "committed" }),
        SETTLE * 2
      )
    })

    expect(seen.map((r) => r.address)).toEqual(["https://en.wikipedia.org/wiki/Main_Page"])
    expect(seen[0]?.traversed).toEqual(["https://en.wikipedia.org/"])
  })

  it("carries nothing on an ordinary page load", async () => {
    // 675 of 732 measured addresses redirect nowhere. The common case has to be
    // empty, or every page would carry an alias that means nothing.
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://example.com/story", cause: "intended" })
      double.sight({ address: "https://example.com/story", cause: "committed" })
    })

    expect(seen[0]?.traversed).toEqual([])
  })

  it("never mints a Reading for an address the browser only intended to fetch", async () => {
    // A cancelled navigation, or a link that turned out to be a download. If
    // this settled, we would open an Enquiry — and issue Lookups — about a page
    // the reader never arrived at, which no log would ever show as wrong.
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://example.com/huge.zip", cause: "intended" })
    })

    expect(seen).toEqual([])
  })

  it("does not let the page the reader was on become the next page's Alias", async () => {
    // The dangerous version of this feature. If `example.com/` were still in
    // the chain when the reader's NEXT page settled, that page would be judged
    // as a site's front door on the strength of where they came from.
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://example.com/", cause: "committed" })
      setTimeout(
        () => double.sight({ address: "https://example.com/a-real-essay", cause: "committed" }),
        SETTLE * 3
      )
    })

    expect(seen.map((r) => r.address)).toEqual([
      "https://example.com/",
      "https://example.com/a-real-essay"
    ])
    expect(seen[1]?.traversed).toEqual([])
  })

  it("drops an abandoned navigation's address when a new navigation supersedes it", async () => {
    // An `intended` sighting settles nothing, so a navigation that is cancelled
    // leaves its address behind with no boundary to clear it. Succession is
    // what takes it out: a genuinely NEW navigation always announces its own
    // `intended` before it can commit, and an old `intended` followed by
    // another `intended` was abandoned, not redirected. (This test used to
    // drive `intended` then a bare commit of a different address — but on the
    // real platform that exact sequence can only be a server redirect, whose
    // origin must be KEPT; see the test above. Pinning it as "dropped" was F1.)
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://example.com/", cause: "intended" })
      setTimeout(() => {
        double.sight({ address: "https://elsewhere.example/an-essay", cause: "intended" })
        double.sight({ address: "https://elsewhere.example/an-essay", cause: "committed" })
      }, SETTLE * 2)
    })

    expect(seen.map((r) => r.address)).toEqual(["https://elsewhere.example/an-essay"])
    expect(seen[0]?.traversed).toEqual([])
  })

  it("does not let a slow client-redirect page a document ran on outlive the window as an Alias", async () => {
    // The guard on the widened keep-rule above. In a bouncing client chain
    // whose hops each arrive inside the settle window but whose whole exceeds
    // it, the first page COMMITTED — a document ran there — so it is a page
    // the reader passed through, not the address a server redirect started
    // from. Only a pure `intended`, where nothing was ever fetched, may
    // outlive the window. Wider windows than the other tests, because the
    // three hops must interleave with real timers and the margins have to
    // survive a loaded machine.
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://example.com/", cause: "intended" })
      double.sight({ address: "https://example.com/", cause: "committed" })
      setTimeout(
        () => double.sight({ address: "https://example.com/hop", cause: "committed" }),
        200
      )
      setTimeout(
        () => double.sight({ address: "https://example.com/a-real-essay", cause: "committed" }),
        450
      )
    }, { settle: 300, quiet: 1400 })

    expect(seen.map((r) => r.address)).toEqual(["https://example.com/a-real-essay"])
    // `/hop` arrived inside the window of the settling commit and is carried;
    // the rootish `example.com/` is older than the window, a document ran on
    // it, and it must NOT be dressed as this page's redirect origin — that is
    // exactly the stale rootish hop the bound exists to keep out of the fold.
    expect(seen[0]?.traversed).toEqual(["https://example.com/hop"])
  })
})

describe("redirect-carrier addresses", () => {
  it("never mints a Reading for a carrier interstitial slower than the settle window", async () => {
    // P1 in the 2026-08-10 battery. A consent-shaped chain whose hop was
    // SLOWER than one settle window minted a Reading at the interstitial and
    // sent `consent?continue=%2Freal%2Fdoc` to Algolia in five variants —
    // disclosing, in the `continue=` parameter, the address the reader was on
    // their way to. An address that names another address must earn its
    // Reading by dwell; the next hop arriving inside that dwell interrupts the
    // settle, and the interstitial is then never seen.
    const seen = await readingsFrom((double) => {
      double.sight({
        address: "https://consenty.example/consent?continue=%2Freal%2Fdoc",
        cause: "tab-updated"
      })
      setTimeout(
        () => double.sight({ address: "https://consenty.example/real/doc", cause: "tab-updated" }),
        SETTLE * 2
      )
    }, { settle: SETTLE, quiet: SETTLE * 8 })

    expect(seen.map((r) => r.address)).toEqual(["https://consenty.example/real/doc"])
  })

  it("still makes a Reading of a carrier-shaped page the reader stays on", async () => {
    // ADR 0005's bound on the rule above: the carrier shape may DELAY a
    // Lookup, never withhold it. A reader parked on a page whose query names
    // another address — a search results page, a consent wall they are
    // actually reading — still gets their Reading once the dwell passes.
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://example.com/search?q=%2Fdocs%2Fintro", cause: "committed" })
    }, { settle: SETTLE, quiet: SETTLE * 8 })

    expect(seen.map((r) => r.address)).toEqual(["https://example.com/search?q=%2Fdocs%2Fintro"])
  })

  it("recognises a carried address by the value's shape, never the parameter's name", () => {
    expect(carriesAnAddress("https://consenty.example/consent?continue=%2Freal%2Fdoc")).toBe(true)
    expect(carriesAnAddress("https://out.example/away?u=https%3A%2F%2Felsewhere.example%2Fstory")).toBe(true)
    expect(carriesAnAddress("https://out.example/go?dest=//elsewhere.example/story")).toBe(true)
    expect(carriesAnAddress("https://example.com/story?id=123&utm_source=newsletter")).toBe(false)
    expect(carriesAnAddress("https://example.com/story")).toBe(false)
    expect(carriesAnAddress("not an address")).toBe(false)
  })
})

describe("where the reader arrived from", () => {
  it("keeps the referrer the content script reported after the commit", async () => {
    // The commit carries no referrer and arrives first; the content script's
    // report carries one and arrives second. Settling keeps the LATEST, which
    // is the only reason the arriving Network survives at all.
    const seen = await readingsFrom((double) => {
      double.sight({ address: "https://example.com/story", cause: "committed" })
      double.sight({
        address: "https://example.com/story",
        cause: "reported",
        referrer: "https://news.ycombinator.com/item?id=41293011"
      })
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.arrival).toEqual({
      _tag: "FromNetwork",
      network: "hackernews",
      discussion: "41293011"
    })
  })

  it("reads a Discussion out of each Network's referrer", () => {
    expect(arrivalFrom("https://news.ycombinator.com/item?id=41293011")).toMatchObject({
      _tag: "FromNetwork",
      network: "hackernews",
      discussion: "41293011"
    })
    expect(arrivalFrom("https://old.reddit.com/r/programming/comments/1abc2de/some_slug/"))
      .toMatchObject({ _tag: "FromNetwork", network: "reddit", discussion: "1abc2de" })
    expect(arrivalFrom("https://x.com/patio11/status/1799999999999999999")).toMatchObject({
      _tag: "FromNetwork",
      network: "x",
      discussion: "1799999999999999999"
    })
    expect(arrivalFrom("https://twitter.com/i/status/1799999999999999999")).toMatchObject({
      _tag: "FromNetwork",
      network: "x",
      discussion: "1799999999999999999"
    })
  })

  it("refuses to invent a Discussion when the referrer names only a Network", () => {
    // A FromNetwork with an empty Discussion id becomes a Linked Mention
    // pointing at nothing, and a Linked Mention is the ONLY thing that opens
    // the X gate. Losing the signal is the safe direction.
    expect(arrivalFrom("https://news.ycombinator.com/")._tag).toBe("Elsewhere")
    expect(arrivalFrom("https://www.reddit.com/r/programming/")._tag).toBe("Elsewhere")
    expect(arrivalFrom("https://x.com/home")._tag).toBe("Elsewhere")
    expect(arrivalFrom("https://example.com/somewhere")._tag).toBe("Elsewhere")
    expect(arrivalFrom(undefined)._tag).toBe("Elsewhere")
    expect(arrivalFrom("garbage")._tag).toBe("Elsewhere")
  })
})
