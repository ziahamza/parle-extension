/**
 * What a corrupt settings document costs the reader — found by the torture run
 * (`e2e/torture.e2e.ts`, scenario "storage full / corrupt").
 *
 * The file header's promise is that a storage fault falls back to the last
 * value actually read, never to the defaults, because the defaults are
 * permissive. Before this was pinned down, an UNREADABLE document — garbage
 * bytes at the key, which any crashed write can leave — was quietly treated as
 * a fresh install: `current` decoded it to `firstRun`, poisoned `lastGood`
 * with that, and the reader's Network switches, exclusions and their answer to
 * the first-run question were all un-made in one read. The one saving grace was
 * `decided: false` keeping anything automatic from firing; everything the
 * reader had chosen was still gone.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { Storage } from "@parle/browser/Storage"
import { makeDouble, WebExt, type WebExtApi } from "@parle/browser/WebExtApi"
import {
  asDocument,
  firstRun,
  fromDocument,
  readDocument,
  Settings,
  SETTINGS_KEY,
  withAutomatic,
  withAutoOpenArchive,
  withNetwork,
  withPause
} from "./Settings.ts"

const over = (double: WebExtApi): Layer.Layer<Settings | Storage> => {
  const bytes = Storage.layer.pipe(Layer.provide(WebExt.doubleLayer(double)))
  return Layer.mergeAll(Settings.layer.pipe(Layer.provide(bytes)), bytes)
}

/** One worker lifetime over the shared disk. */
const lifetime = <A>(double: WebExtApi, use: Effect.Effect<A, never, Settings | Storage>): Promise<A> =>
  Effect.runPromise(use.pipe(Effect.provide(over(double))))

const corrupt = Effect.gen(function*() {
  const store = yield* Storage
  yield* store.set(SETTINGS_KEY, "{ not a document at all ][").pipe(
    Effect.catch(() => Effect.void)
  )
})

describe("a corrupt settings document", () => {
  it("falls back to the last value actually read, not to the defaults", async () => {
    const double = makeDouble()
    const seen = await lifetime(
      double,
      Effect.gen(function*() {
        const settings = yield* Settings
        // The reader answered the question, switched Reddit off and paused a
        // site — the three kinds of thing a fallback to defaults would undo.
        yield* settings.change((held) => withPause(withNetwork(withAutomatic(held, true), "reddit", false), "example.com"))
        yield* corrupt
        return yield* settings.current
      })
    )

    expect(seen.decided).toBe(true)
    expect(seen.automatic).toBe(true)
    expect(seen.networks.reddit).toBe(false)
    expect(seen.paused).toContain("example.com")
  })

  it("read by a fresh lifetime, degrades to asking nobody — never to permissive defaults", async () => {
    // Across a worker restart there is no last-known-good to fall back to; the
    // floor is `firstRun`, and what makes that floor safe rather than
    // permissive is `decided: false` — nothing automatic runs until the reader
    // is asked again. This test is the record of that judgement.
    const double = makeDouble()
    await lifetime(
      double,
      Effect.gen(function*() {
        const settings = yield* Settings
        yield* settings.change((held) => withAutomatic(held, true))
        yield* corrupt
      })
    )

    const seen = await lifetime(
      double,
      Effect.gen(function*() {
        const settings = yield* Settings
        return yield* settings.current
      })
    )
    expect(seen).toEqual(firstRun)
    expect(seen.decided).toBe(false)
  })

  it("does not stop the reader's next edit from writing a clean document", async () => {
    const double = makeDouble()
    const seen = await lifetime(
      double,
      Effect.gen(function*() {
        const settings = yield* Settings
        yield* corrupt
        yield* settings.change((held) => withAutomatic(held, true))
        return yield* settings.current
      })
    )

    expect(seen.decided).toBe(true)
    expect(seen.automatic).toBe(true)
  })
})

/**
 * The field that decides whether a reader is moved off the page they opened.
 *
 * It is checked apart from the switches above it because it has no state in
 * which the permissive fallback is honest. A missing Network key at least has
 * one: while `decided` is false the disclosure naming that Network is still
 * ahead of the reader, so "on" is only what the first-run screen will offer.
 * A document written before this field existed is a reader who never agreed to
 * be redirected, in every state, and falling back to "on" would start
 * redirecting them.
 */
describe("the archived-copy setting", () => {
  it("is off for a reader who has touched nothing", () => {
    expect(firstRun.autoOpenArchive).toBe(false)
  })

  it("round-trips through the document, both ways", () => {
    const on = withAutoOpenArchive(firstRun, true)
    expect(fromDocument(asDocument(on)).autoOpenArchive).toBe(true)
    const off = withAutoOpenArchive(on, false)
    expect(fromDocument(asDocument(off)).autoOpenArchive).toBe(false)
  })

  it("survives a worker restart", async () => {
    const double = makeDouble()
    await lifetime(
      double,
      Effect.gen(function*() {
        const settings = yield* Settings
        yield* settings.change((held) => withAutoOpenArchive(withAutomatic(held, true), true))
      })
    )
    const seen = await lifetime(
      double,
      Effect.gen(function*() {
        const settings = yield* Settings
        return yield* settings.current
      })
    )
    expect(seen.autoOpenArchive).toBe(true)
  })

  it("reads a document written before the field existed as OFF", () => {
    // The recovery case, and the one that matters: a reader upgrading into this
    // release has a stored document with no `autoOpenArchive` in it, and they
    // have agreed to nothing. Their exclusions, their pause list and their
    // answer to the first-run question all survive; the new setting does not
    // arrive switched on.
    const older = JSON.stringify({
      networks: { hackernews: true, reddit: false },
      automatic: true,
      decided: true,
      excluded: [{ host: "example.com", pathPrefix: "" }],
      paused: ["news.example"],
      everyDiscussion: true
    })
    const seen = fromDocument(older)
    expect(seen.autoOpenArchive).toBe(false)
    // Nothing else was lost on the way through.
    expect(seen.decided).toBe(true)
    expect(seen.networks.reddit).toBe(false)
    expect(seen.everyDiscussion).toBe(true)
    expect(seen.paused).toContain("news.example")
    expect(seen.excluded.map((p) => p.host)).toContain("example.com")
  })

  it("is not un-set by a corrupt document, any more than the other choices are", async () => {
    const double = makeDouble()
    const seen = await lifetime(
      double,
      Effect.gen(function*() {
        const settings = yield* Settings
        yield* settings.change((held) => withAutoOpenArchive(withAutomatic(held, true), true))
        yield* corrupt
        return yield* settings.current
      })
    )
    expect(seen.autoOpenArchive).toBe(true)
  })
})

/**
 * The three Networks added after the first release, read from a document that
 * predates them.
 *
 * The contract in `welcomeCopy.ts` is that the names are read BEFORE an address
 * leaves the browser. A reader with `decided: true` answered a first-run screen
 * that named two companies and will never see that screen again — so for them a
 * missing `bluesky` / `lemmy` / `lobsters` key must mean OFF, or the upgrade
 * silently starts sending every non-skipped address to three companies nobody
 * named to them. Only a document the consent gate is still holding everything
 * for (`decided` false or absent) may read the missing keys as the first-run
 * defaults, because the screen that names all of these sites is still ahead.
 */
describe("the Networks added after the reader answered first-run", () => {
  it("stay OFF for a reader who already answered a first-run that never named them", () => {
    const upgraded = fromDocument(JSON.stringify({
      networks: { hackernews: true, reddit: true },
      automatic: true,
      decided: true
    }))
    expect(upgraded.networks.bluesky).toBe(false)
    expect(upgraded.networks.lemmy).toBe(false)
    expect(upgraded.networks.lobsters).toBe(false)
    // And nothing they did choose is disturbed on the way through.
    expect(upgraded.networks.hackernews).toBe(true)
    expect(upgraded.decided).toBe(true)
    expect(upgraded.automatic).toBe(true)
  })

  it("stay OFF even when the reader's answer was manual", () => {
    // Manual mode still issues Lookups when the reader clicks the toolbar, and
    // a manual reader was named two companies too.
    const upgraded = fromDocument(JSON.stringify({
      networks: { hackernews: true, reddit: false },
      automatic: false,
      decided: true
    }))
    expect(upgraded.networks.bluesky).toBe(false)
    expect(upgraded.networks.lemmy).toBe(false)
    expect(upgraded.networks.lobsters).toBe(false)
  })

  it("default ON only while the first-run screen is still ahead of the reader", () => {
    // `decided` false or absent: the consent gate holds every Lookup, and the
    // screen the reader is yet to answer names all of these sites.
    const undecided = fromDocument(JSON.stringify({
      networks: { hackernews: true, reddit: true },
      decided: false
    }))
    expect(undecided.networks.bluesky).toBe(true)
    expect(undecided.networks.lemmy).toBe(true)
    expect(undecided.networks.lobsters).toBe(true)
    expect(fromDocument("{}").networks).toEqual(firstRun.networks)
  })

  it("keep an answer the reader has since given in settings, either way", () => {
    const chosen = fromDocument(JSON.stringify({
      networks: { bluesky: true, lemmy: false },
      decided: true
    }))
    expect(chosen.networks.bluesky).toBe(true)
    expect(chosen.networks.lemmy).toBe(false)
    expect(chosen.networks.lobsters).toBe(false)
  })
})

describe("readDocument", () => {
  it("reads a document any build of ours wrote", () => {
    expect(Option.isSome(readDocument(JSON.stringify({ automatic: false, decided: true })))).toBe(true)
    expect(Option.isSome(readDocument("{}"))).toBe(true)
  })

  it("refuses what no build of ours wrote", () => {
    expect(Option.isNone(readDocument("!!! not json"))).toBe(true)
    expect(Option.isNone(readDocument("[1,2,3]"))).toBe(true)
    expect(Option.isNone(readDocument('"a string"'))).toBe(true)
  })
})
