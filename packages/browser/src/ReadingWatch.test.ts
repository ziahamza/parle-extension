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
import { arrivalFrom, isReadable, type ReadingBoundary, ReadingWatch } from "./ReadingWatch.ts"
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
const readingsFrom = (script: (double: WebExtDouble) => void) =>
  Effect.runPromise(
    Effect.gen(function*() {
      const double = makeDouble()
      const watch = yield* Effect.provide(
        ReadingWatch,
        ReadingWatch.settlingAfter(`${SETTLE} millis`).pipe(
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
      yield* Effect.sleep(`${QUIET} millis`)
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
