/**
 * Harvest, through the graph as it actually ships.
 *
 * Three claims are checked here and each one is an ADR rather than a
 * preference:
 *
 *   1. **ADR 0012's marquee case.** A page harvested from Hacker News is
 *      attached to the article before the reader clicks the link, survives the
 *      service worker being killed, and renders from the reader's own disk
 *      *before a single request is made*. The second run below is a different
 *      runtime over the same store, which is what an MV3 restart is.
 *   2. **ADR 0012's disclosure argument.** A Harvest-derived Mention reaches the
 *      disk; a Lookup-derived one does not. Asserted on the bytes in the store,
 *      not on which function was called, because the claim is about what is on
 *      the reader's machine.
 *   3. **ADR 0015's two controls.** "Forget everything" clears the Local
 *      Discussion Cache; the finer Lookup-Record-only control leaves it exactly
 *      where it was.
 *
 * `makeDouble()` is created once per scenario and reused across runtimes on
 * purpose: its `held` map IS the reader's disk, and a test that made a fresh one
 * per run could not tell a durable write from a heap one.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Schedule from "effect/Schedule"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { isSettled } from "@parle/domain/Coverage"
import { makeDouble, type WebExtDouble, WebExt } from "@parle/browser/WebExtApi"
import { hackerNewsItem, hackerNewsListing, xTimeline } from "@parle/harvest/Fixtures"
import { hackerNewsLinked, hackerNewsTopical } from "@parle/networks/Recorded"
import { type Exchange, recording } from "@parle/networks/Recording"
import * as Pipeline from "../app/Pipeline.ts"
import { Board } from "../reading/Board.ts"
import { everyNetworkOn, type Surroundings } from "../reading/Surroundings.ts"
import { Forgetting } from "../settings/Forgetting.ts"
import { Settings, withAutomatic, withNetwork, withPause } from "../settings/Settings.ts"
import { type Panel } from "../view/Panel.ts"
import { panelOf } from "../view/panelOf.ts"
import { Harvesting } from "./Harvesting.ts"
import { CACHE_ROOT } from "./LocalCache.ts"

/** The article the Hacker News fixture's front page links to. */
const ARTICLE = "https://www.nature.com/articles/d41586-024-02012-5"
const NOW = 1_800_000_000_000

const AGREED: Surroundings = {
  decision: "automatic",
  provider: { connected: false, name: "" },
  networks: everyNetworkOn,
  index: { _tag: "Absent" },
  everyDiscussion: false
}

/**
 * Nobody answers anything.
 *
 * Deliberately not the recorded Algolia bodies: this file is about what the
 * reader's own machine knows, and a wire that could answer would make every
 * assertion below ambiguous about where the row came from.
 */
const silent = (): Exchange => ({ status: 403, body: "no", headers: {} })

/**
 * Hacker News answering for real, so that a Lookup has Mentions to remember.
 *
 * Only used by the test that holds the disclosure seam to account against a
 * Lookup that ANSWERED — every other test here wants a wire that cannot be the
 * source of a row.
 */
const algolia = (url: string): Exchange => {
  if (!url.includes("hn.algolia.com")) return silent()
  return {
    status: 200,
    body: url.includes("restrictSearchableAttributes") ? hackerNewsLinked : hackerNewsTopical,
    headers: { "content-type": "application/json" }
  }
}

const agree = Effect.gen(function*() {
  const settings = yield* Settings
  yield* settings.change((held) => withAutomatic(held, true))
})

/** No answer at all to the first-run question. What a fresh install actually is. */
const sayNothing = Effect.void

/** One worker lifetime over one store. A second call is an MV3 restart. */
const worker = <A>(
  double: WebExtDouble,
  answer: (url: string) => Exchange,
  // `Scope` is in the requirement because `framesFor` forks its frame collector
  // into the worker's own scope — the same shape the background uses, where a
  // subscription that outlives the thing it is watching is the bug.
  body: (asked: ReadonlyArray<string>) => Effect.Effect<A, unknown, Pipeline.Pipeline | Scope.Scope>,
  /** What the reader has decided before this lifetime starts. */
  decide: Effect.Effect<void, never, Settings> = agree
): Promise<A> => {
  const wire = recording(answer)
  return Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      yield* decide
      return yield* body(wire.asked)
    })).pipe(
      Effect.provide(Pipeline.on(WebExt.doubleLayer(double), wire.layer))
    ) as Effect.Effect<A>
  )
}

/**
 * Count what leaves the machine through `fetch` rather than through the wire.
 *
 * Shortlink resolution is deliberately NOT on the injected `HttpClient` — see
 * `@parle/harvest`'s `Redirects` for why it has to be plain `fetch` in a browser
 * — so the recording wire cannot see it, and a test that only watched `asked`
 * would report zero traffic while `t.co` was being asked forty times.
 */
const watchingFetch = async <A>(body: () => Promise<A>): Promise<[A, ReadonlyArray<string>]> => {
  const outbound: Array<string> = []
  const real = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    outbound.push(typeof input === "string" ? input : String(input))
    return new Response("", { status: 200 })
  }) as typeof globalThis.fetch
  try {
    return [await body(), outbound]
  } finally {
    globalThis.fetch = real
  }
}

/** Keys under the Local Discussion Cache root, as they are on the reader's disk. */
const cached = (double: WebExtDouble): ReadonlyArray<string> =>
  [...double.held.keys()].filter((key) => key.startsWith(CACHE_ROOT))

/** Offer one page and wait for its Mentions to settle rather than sleeping. */
const harvest = (network: "hackernews" | "reddit" | "x", url: string, markup: string) =>
  Effect.gen(function*() {
    const harvesting = yield* Harvesting
    yield* harvesting.offer(network, url, markup)
    // The throttled consumer is what actually writes Mentions, so "offer
    // returned" is not "the cache is filled". `waiting` reaching zero is the
    // pipeline's own account of being caught up, and waiting on it rather than
    // on a duration is what stops this being flaky on a loaded machine.
    // Spaced rather than a busy loop: the fiber this is waiting ON is the
    // harvester's drain, and spinning would starve the very thing being waited
    // for on a loaded machine — which is where a test like this goes flaky.
    yield* Effect.repeat(harvesting.waiting, {
      until: (left) => left === 0,
      schedule: Schedule.spaced("5 millis")
    }).pipe(Effect.timeout("10 seconds"))
  })

interface Frame {
  readonly panel: Panel
  /** How many requests had left the machine when this frame was produced. */
  readonly askedBy: number
}

/**
 * Navigate, and keep every frame the panel would have drawn along with the
 * request count at that moment.
 *
 * The request count per FRAME is the whole point: "the cache renders before any
 * network request" is a claim about ordering, and a count taken at the end
 * cannot distinguish it from "the cache and the network both answered".
 */
const framesFor = (double: WebExtDouble, address: string, asked: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const board = yield* Board
    const frames: Array<Frame> = []

    const ref = yield* board.open(1)
    const watching = yield* Effect.forkScoped(
      Stream.runForEach(SubscriptionRef.changes(ref), (reading) =>
        Effect.sync(() => {
          frames.push({ panel: panelOf(reading, NOW, AGREED), askedBy: asked.length })
        }))
    )

    yield* board.sight(1, address, "An article", { _tag: "Elsewhere" } as never)

    yield* SubscriptionRef.changes(ref).pipe(
      Stream.filter((reading) =>
        reading.standing._tag === "Excluded" ||
        (reading.standing._tag === "Enquiring" && isSettled(reading.standing.knowledge.coverage))
      ),
      Stream.take(1),
      Stream.runCollect,
      Effect.timeout("15 seconds")
    )
    yield* Fiber.interrupt(watching)
    return frames
  })

describe("the Local Discussion Cache, filled by Harvest", () => {
  it("attaches a Hacker News thread to the article before the reader clicks, and across a restart", async () => {
    const double = makeDouble()

    // Worker one: the reader is on the Hacker News front page.
    const spent = await worker(double, silent, (asked) =>
      Effect.gen(function*() {
        yield* harvest("hackernews", "https://news.ycombinator.com/", hackerNewsListing)
        return asked.length
      }))

    // Harvesting reads a page the reader already loaded. It is not a Lookup and
    // must not produce one — that is the whole reason ADR 0012 says this cache
    // discloses nothing.
    expect(spent).toBe(0)
    expect(cached(double).length).toBeGreaterThan(0)

    // Worker two: MV3 killed the first one. Nothing is in any heap; everything
    // below comes off the reader's disk.
    const frames = await worker(double, silent, (asked) => framesFor(double, ARTICLE, asked))

    const first = frames.find((frame) => frame.panel.linked.length > 0)
    expect(first).toBeDefined()
    expect(first?.panel.linked[0]?.title).toBe(
      "Not all 'open source' AI models are open: here's a ranking"
    )
    expect(first?.panel.linked[0]?.permalink).toBe("https://news.ycombinator.com/item?id=40786237")
    // The score and comment count came off the page the reader was looking at,
    // through the Observation the harvest wrote.
    expect(first?.panel.linked[0]?.score).toBe(127)
    expect(first?.panel.linked[0]?.commentCount).toBe(18)
    // ADR 0012: "results are instant, offline, and require no Lookup at all."
    // This is the "offline" half, measured: the row was on screen before
    // anything left the machine.
    expect(first?.askedBy).toBe(0)
  })

  it("records an address inside a comment as a Passing Mention, never a Linked one", async () => {
    // The tier is the evidence, and the evidence for a comment link is weaker.
    // Promoting it would open ADR 0001's X gate on a page nobody submitted.
    const double = makeDouble()
    await worker(double, silent, () =>
      harvest("hackernews", "https://news.ycombinator.com/item?id=40786237", hackerNewsItem))

    const frames = await worker(
      double,
      silent,
      (asked) => framesFor(double, "https://opening-up-chatgpt.github.io/", asked)
    )

    const found = frames.find((frame) => frame.panel.passing.length > 0)
    expect(found).toBeDefined()
    expect(found?.panel.linked).toHaveLength(0)
    expect(found?.askedBy).toBe(0)
  })
})

describe("nothing at all until the reader has answered", () => {
  /**
   * The harvest content script is IN the manifest, unlike the pill.
   *
   * So on a fresh install it starts running the first time the reader opens X —
   * before they have read the disclosure, before they have answered anything,
   * and whatever the answer turns out to be. That makes it the one part of this
   * build whose traffic is not downstream of a decision unless something makes
   * it so, and resolving a `t.co` link is a real `HEAD` to a third party.
   *
   * The README's own promise is the assertion: "nothing automatic happens until
   * the first-run question is answered, and answering *only when I ask* means
   * nothing automatic ever happens."
   */
  it("spends no request and writes no row on an install that has agreed to nothing", async () => {
    const double = makeDouble()
    const [, outbound] = await watchingFetch(() =>
      worker(
        double,
        silent,
        () => harvest("x", "https://x.com/home", xTimeline),
        sayNothing
      ))
    expect(outbound).toEqual([])
    expect(cached(double)).toHaveLength(0)
  })

  it("does the same for a reader who answered only when I ask", async () => {
    const double = makeDouble()
    const decline = Effect.flatMap(Settings, (s) => s.change((held) => withAutomatic(held, false)))
    const [, outbound] = await watchingFetch(() =>
      worker(double, silent, () => harvest("x", "https://x.com/home", xTimeline), decline))
    expect(outbound).toEqual([])
    expect(cached(double)).toHaveLength(0)
  })

  it("harvests once they have said yes, which is what makes the two above meaningful", async () => {
    const double = makeDouble()
    const [, outbound] = await watchingFetch(() =>
      worker(double, silent, () => harvest("x", "https://x.com/home", xTimeline)))
    expect(outbound.length).toBeGreaterThan(0)
    expect(cached(double).length).toBeGreaterThan(0)
  })

  it("stays off on a site the reader paused, which is what pausing it says", async () => {
    // "Pause on x.com" that leaves Parle reading x.com and spending requests on
    // its links is a control that reads as off and is on.
    const double = makeDouble()
    const pause = Effect.flatMap(
      Settings,
      (s) => s.change((held) => withPause(withAutomatic(held, true), "x.com"))
    )
    const [, outbound] = await watchingFetch(() =>
      worker(double, silent, () => harvest("x", "https://x.com/home", xTimeline), pause))
    expect(outbound).toEqual([])
    expect(cached(double)).toHaveLength(0)
  })
})

describe("what may be written to the reader's disk", () => {
  it("writes a harvested Mention, and nothing a Lookup produced", async () => {
    const double = makeDouble()

    // A page nobody harvested, looked up for real. Every Network refuses here,
    // but `Enquiry.publish` calls `remember` on whatever a Consultation carries
    // and the Recall Place answers on every Enquiry — so if the Enquiry's view
    // of the store could write, this would leave something behind.
    await worker(double, silent, (asked) => framesFor(double, ARTICLE, asked))
    expect(cached(double)).toHaveLength(0)

    // The same store, now harvested into.
    await worker(double, silent, () =>
      harvest("hackernews", "https://news.ycombinator.com/", hackerNewsListing))
    expect(cached(double).length).toBeGreaterThan(0)
  })

  it("writes nothing when the Lookups actually ANSWER, which is the case that matters", async () => {
    // The test above runs against a wire where every Network refuses, so no
    // `Answered` Consultation is ever folded and `Enquiry.publish` never reaches
    // `remember` with a Mention in its hand. It therefore proves the seam holds
    // in the one situation where there is nothing for it to hold back. This is
    // the same claim against a Hacker News that answers with real Mentions.
    const double = makeDouble()
    const frames = await worker(double, algolia, (asked) => framesFor(double, ARTICLE, asked))
    const rows = frames.at(-1)?.panel
    expect(rows?.linked.length ?? 0).toBeGreaterThan(0)
    expect(cached(double)).toHaveLength(0)
  })

  it("keeps the reader's settings out of the cache root, so clearing one is not clearing the other", async () => {
    const double = makeDouble()
    await worker(double, silent, () =>
      harvest("hackernews", "https://news.ycombinator.com/", hackerNewsListing))

    const settings = [...double.held.keys()].filter((key) => key.startsWith("parle/settings/"))
    expect(settings).toHaveLength(1)
    expect(cached(double).some((key) => key.startsWith("parle/settings/"))).toBe(false)
  })
})

describe("the switches still apply to what the reader's own machine remembers", () => {
  it("draws no Reddit row from the cache for a reader who switched Reddit off", async () => {
    // ADR 0014: a Network switched off STAYS off, even for an explicit Ask.
    // Wave one asks nobody, so it never meets `LookupPolicy` — and before this
    // the cache went on handing up Reddit rows to sit directly above the
    // account saying "you switched Reddit off". The panel contradicted itself,
    // and the switch read as broken.
    const double = makeDouble()
    await worker(double, silent, () =>
      harvest("hackernews", "https://news.ycombinator.com/", hackerNewsListing))

    const on = await worker(double, silent, (asked) => framesFor(double, ARTICLE, asked))
    expect(on.some((frame) => frame.panel.linked.length > 0)).toBe(true)

    const switchedOff = Effect.flatMap(
      Settings,
      (s) => s.change((held) => withNetwork(withAutomatic(held, true), "hackernews", false))
    )
    const off = await worker(
      double,
      silent,
      (asked) => framesFor(double, ARTICLE, asked),
      switchedOff
    )
    expect(off.every((frame) => frame.panel.linked.length === 0)).toBe(true)
    expect(off.every((frame) => frame.panel.passing.length === 0)).toBe(true)
  })
})

describe("the two clearing controls", () => {
  it("forgets everything, and leaves the cache alone when only the Lookup Record is asked for", async () => {
    const double = makeDouble()
    await worker(double, silent, () =>
      harvest("hackernews", "https://news.ycombinator.com/", hackerNewsListing))
    const filled = cached(double).length
    expect(filled).toBeGreaterThan(0)

    // ADR 0015: the finer control exists so that a reader worried about the
    // record of what we ASKED is not made to throw away harvested work that was
    // never a privacy liability and is expensive to rebuild.
    await worker(double, silent, () =>
      Effect.flatMap(Forgetting, (forgetting) => forgetting.lookupRecord))
    expect(cached(double)).toHaveLength(filled)

    await worker(double, silent, () =>
      Effect.flatMap(Forgetting, (forgetting) => forgetting.everything))
    expect(cached(double)).toHaveLength(0)
  })
})
