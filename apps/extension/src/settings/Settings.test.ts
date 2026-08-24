/**
 * The settings document: what survives a round trip, and what a broken one does.
 *
 * The edits are pure functions and are tested as such, because every surface
 * shares them and a divergence between "add an exclusion" in the settings page
 * and "pause this site" in the panel is a bug that shows up as a control that
 * looks like it worked.
 *
 * The two decoding tests are the ones worth keeping. A settings document is the
 * only thing in this product whose loss makes the reader *less* protected than
 * they chose to be, so the two failure directions are asserted separately: a
 * document from another version keeps every field it does carry, and a document
 * that is not one at all falls back to the defaults rather than to nothing.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Storage } from "@parle/browser/Storage"
import { makeDouble, WebExt } from "@parle/browser/WebExtApi"
import {
  asDocument,
  firstRun,
  fromDocument,
  readSite,
  type ReaderSettings,
  SETTINGS_KEY,
  Settings,
  siteLabel,
  withAllowAnyway,
  withAutomatic,
  withExclusion,
  withNetwork,
  withoutExclusion,
  withoutPause,
  withPause
} from "./Settings.ts"

const example = { host: "example.com", pathPrefix: "" }

describe("what the reader typed", () => {
  it("reads a bare host, a host with a path, and a whole URL as the same thing", () => {
    expect(readSite("example.com")).toEqual({ host: "example.com", pathPrefix: "" })
    expect(readSite("  https://Example.com/  ")).toEqual({ host: "example.com", pathPrefix: "" })
    expect(readSite("docs.example.com/internal")).toEqual({
      host: "docs.example.com",
      pathPrefix: "/internal"
    })
  })

  it("refuses what is not a site rather than storing an entry that matches nothing", () => {
    // A single-label host is already covered by the mechanical rules, which are
    // complete by construction; storing one here would be an entry the reader
    // believes in and that never fires.
    expect(readSite("")).toBeNull()
    expect(readSite("intranet")).toBeNull()
    expect(readSite("   ")).toBeNull()
  })

  it("reads back the way it was typed", () => {
    expect(siteLabel({ host: "example.com", pathPrefix: "" })).toBe("example.com")
    expect(siteLabel({ host: "example.com", pathPrefix: "/admin" })).toBe("example.com/admin")
  })
})

describe("the edits", () => {
  it("does not let one site be both skipped and looked up anyway", () => {
    // Two rows contradicting each other on the settings page leaves the reader
    // guessing which one won, and the answer is buried in a precedence order
    // they cannot see.
    const skipped = withExclusion(firstRun, example)
    const then = withAllowAnyway(skipped, example)

    expect(then.allowedAnyway).toEqual([example])
    expect(then.excluded).toEqual([])
  })

  it("adds each site once, however many times it is added", () => {
    const twice = withExclusion(withExclusion(firstRun, example), example)
    expect(twice.excluded).toHaveLength(1)
  })

  it("removes what it added", () => {
    expect(withoutExclusion(withExclusion(firstRun, example), example).excluded).toEqual([])
    expect(withoutPause(withPause(firstRun, "Example.com"), "example.com").paused).toEqual([])
  })

  it("holds a pause under one spelling of the host", () => {
    expect(withPause(firstRun, "EXAMPLE.com").paused).toEqual(["example.com"])
  })

  it("changes one switch and leaves the others alone", () => {
    const off = withNetwork(firstRun, "reddit", false)
    expect(off.networks).toEqual({
      hackernews: true,
      reddit: false,
      x: true,
      bluesky: true,
      lemmy: true,
      lobsters: true
    })
    expect(withAutomatic(off, false).networks).toEqual(off.networks)
  })
})

describe("the document", () => {
  it("survives a round trip whole", () => {
    const said: ReaderSettings = {
      ...firstRun,
      automatic: false,
      networks: {
        hackernews: true,
        reddit: false,
        x: false,
        bluesky: false,
        lemmy: true,
        lobsters: false
      },
      excluded: [{ host: "example.com", pathPrefix: "/admin" }],
      allowedAnyway: [{ host: "chase.com", pathPrefix: "" }],
      paused: ["news.example.org"]
    }

    expect(fromDocument(asDocument(said))).toEqual(said)
  })

  it("keeps every field a document from another version does carry", () => {
    // The direction that matters: a build that adds a field must not discard
    // the exclusions a reader already added. Nothing here is required, so a
    // document holding only what an older build wrote still decodes.
    const older = JSON.stringify({ excluded: [{ host: "example.com", pathPrefix: "" }] })
    const read = fromDocument(older)

    expect(read.excluded).toEqual([example])
    expect(read.networks).toEqual(firstRun.networks)
  })

  it("falls back to the defaults on something that is not a document at all", () => {
    expect(fromDocument("{ not json")).toEqual(firstRun)
    expect(fromDocument("[]")).toEqual(firstRun)
  })
})

describe("the store", () => {
  const over = (double = makeDouble()) =>
    Settings.layer.pipe(Layer.provide(Storage.layer), Layer.provide(WebExt.doubleLayer(double)))

  it("writes through to the reader's own store, under one key", async () => {
    const double = makeDouble()

    const held = await Effect.runPromise(
      Effect.gen(function*() {
        const settings = yield* Settings
        yield* settings.change((s) => withNetwork(s, "x", false))
        return yield* settings.current
      }).pipe(Effect.provide(over(double)))
    )

    expect(held.networks.x).toBe(false)
    expect([...double.held.keys()]).toEqual([SETTINGS_KEY])
  })

  it("reads what another context wrote, without being told", async () => {
    // The whole reason the settings page can own its own layer: extension pages
    // and the service worker share one store, and this layer holds nothing, so
    // a write from one is in force on the next read from the other.
    const double = makeDouble()
    const layer = over(double)

    const before = await Effect.runPromise(
      Effect.flatMap(Settings, (s) => s.current).pipe(Effect.provide(layer))
    )
    expect(before.automatic).toBe(true)

    double.held.set(
      SETTINGS_KEY,
      new TextEncoder().encode(asDocument(withAutomatic(firstRun, false)))
    )

    const after = await Effect.runPromise(
      Effect.flatMap(Settings, (s) => s.current).pipe(Effect.provide(layer))
    )
    expect(after.automatic).toBe(false)
  })

  it("falls back to what the reader last chose, never to the permissive defaults", async () => {
    // A store that will not answer must not silently widen what we look up.
    const double = makeDouble()
    const broken = { ...double, store: { ...double.store, get: () => Promise.reject(new Error("no")) } }

    const held = await Effect.runPromise(
      Effect.gen(function*() {
        const settings = yield* Settings
        yield* settings.change((s) => withExclusion(withAutomatic(s, false), example))
        return yield* settings.current
      }).pipe(
        Effect.provide(
          Settings.layer.pipe(Layer.provide(Storage.layer), Layer.provide(WebExt.doubleLayer(broken)))
        )
      )
    )

    expect(held.automatic).toBe(false)
    expect(held.excluded).toEqual([example])
  })
})
