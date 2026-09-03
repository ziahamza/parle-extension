/**
 * When the Archive and Wikipedia are asked, and when they are not.
 *
 * Driven through `Pipeline.on` — the graph as it actually ships — for the reason
 * `Pipeline.test.ts` gives: a test that assembled its own lookalike would stay
 * green while the real wiring rotted, and every seam crossed here was written by
 * a different wave from the one that consumes it.
 *
 * The claim under test is a PRIVACY claim, so it is asserted on the wire rather
 * than on the panel. `Recording.asked` is every URL the client was given, in
 * order, and the whole of this file is about which of them contain `archive.org`
 * and `en.wikipedia.org` and at what moment. A panel that renders an Archive line
 * proves the derivation; only the wire proves that nothing was sent about a page
 * the reader merely navigated to.
 *
 * The fake is `@parle/archive`'s own shipped `Recording`, not a local one. It
 * lives beside the code it fakes so that it moves when that code moves, and it
 * keys on the full resolved URL precisely so "did it stop after the availability
 * request" is answerable — which is a behaviour of that package rather than an
 * implementation detail.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { type Exchange, json, recording } from "@parle/archive/Recording"
import { Arrival } from "@parle/domain/Subject"
import { makeDouble, WebExt } from "@parle/browser/WebExtApi"
import { Board } from "../reading/Board.ts"
import { Settings, withAutomatic, withExclusion, withPause } from "../settings/Settings.ts"
import * as Pipeline from "./Pipeline.ts"

const ADDRESS = "https://www.nature.com/articles/d41586-024-02012-5"
const TITLE = "Not all 'open source' AI models are open"
const TAB = 1

/** Well inside the year `background.ts` allows a kept copy to be. */
const NOW = Date.UTC(2026, 7, 24)
const SNAPSHOT_AT = "20260601000000"
const ARCHIVED = `https://web.archive.org/web/${SNAPSHOT_AT}/${ADDRESS}`

const AVAILABLE = JSON.stringify({
  archived_snapshots: {
    closest: { url: ARCHIVED, timestamp: SNAPSHOT_AT, status: "200", available: true }
  }
})

const CAPTURES = JSON.stringify([
  ["timestamp", "statuscode", "digest"],
  ["20190502000000", "200", "AAA"],
  ["20220101000000", "200", "BBB"],
  [SNAPSHOT_AT, "200", "CCC"]
])

const CITING = JSON.stringify({
  query: {
    exturlusage: [
      { title: "Open-source artificial intelligence", url: ADDRESS, ns: 0, pageid: 1 }
    ]
  }
})

/**
 * Everything answers, so that "it did not ask" can never be confused with "it
 * asked and got nothing".
 *
 * The Networks 403 exactly as Reddit does from this development box, which is
 * also what keeps the Network Lookups out of the way of the assertions below —
 * they settle quickly and they are not what any of this is about.
 */
const answers = (url: string): Exchange => {
  if (url.includes("archive.org/wayback/available")) return json(AVAILABLE)
  if (url.includes("web.archive.org/cdx")) return json(CAPTURES)
  if (url.includes("en.wikipedia.org")) return json(CITING)
  return { status: 403, body: "<html>blocked</html>", headers: { "content-type": "text/html" } }
}

const cdxUnavailable = (url: string): Exchange => {
  if (url.includes("archive.org/wayback/available")) return json(AVAILABLE)
  if (url.includes("web.archive.org/cdx")) {
    return { status: 503, body: "<html>offline</html>", headers: { "content-type": "text/html" } }
  }
  return answers(url)
}

/**
 * Requests TO the Archive, matched on the host rather than on the string.
 *
 * `.includes("archive.org")` is not good enough here and finding that out was
 * the point of one of these cases: a reader standing on an archived page has
 * `web.archive.org` inside the query string of every Network Lookup, so a
 * substring match reports ten requests to the Archive that were requests to
 * Algolia about the Archive. The distinction is exactly the one the loop guard
 * is about, so the assertion has to be able to see it.
 */
const toHost = (asked: ReadonlyArray<string>, host: string): ReadonlyArray<string> =>
  asked.filter((url) => {
    try {
      const parsed = new URL(url)
      return parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    } catch {
      return false
    }
  })

const archiveAsked = (asked: ReadonlyArray<string>): ReadonlyArray<string> =>
  toHost(asked, "archive.org")

const wikipediaAsked = (asked: ReadonlyArray<string>): ReadonlyArray<string> =>
  toHost(asked, "en.wikipedia.org")

const settle = (ms: number) => Effect.promise(() => new Promise((go) => setTimeout(go, ms)))

/**
 * Run one scenario against the shipped graph.
 *
 * `use` gets the Board and the live list of asked URLs. Everything else — the
 * Enquiry, the policy, the settings document, the pacing buckets — is real.
 */
const over = async <A>(
  use: (
    board: Board["Service"],
    asked: ReadonlyArray<string>
  ) => Effect.Effect<A, never, Board | Settings>,
  prepare: (settings: Settings["Service"]) => Effect.Effect<void> = () => Effect.void,
  answer: (url: string) => Exchange = answers
): Promise<A> => {
  const double = makeDouble()
  const wire = recording(answer)
  return await Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      const settings = yield* Settings
      // A reader who read the disclosure and said yes. Everything here needs
      // that: `Choices.choicesOf` folds `decided` into `manualOnly`, so a fresh
      // install asks nobody anything and every assertion would pass vacuously.
      yield* settings.change((held) => withAutomatic(held, true))
      yield* prepare(settings)
      const board = yield* Board
      return yield* use(board, wire.asked)
    })).pipe(Effect.provide(Pipeline.on(WebExt.doubleLayer(double), wire.layer)))
  )
}

/** Put a page in front of the reader and let the Network Lookups get out of the way. */
const opening = (board: Board["Service"], address = ADDRESS) =>
  Effect.gen(function*() {
    yield* board.sight(TAB, address, TITLE, Arrival.cases.Elsewhere.make({}))
    yield* settle(300)
  })

describe("what a navigation costs", () => {
  it("asks neither the Archive nor Wikipedia about a page the reader only opened", async () => {
    // The whole privacy decision, on the wire. These two Lookups add context
    // beside an answer somebody is reading; a page opened in a background tab, a
    // session restore and a link opened to read later are none of them somebody
    // reading, and each is a navigation. If this ever goes green because the
    // requests moved rather than stopped, the counts below catch it.
    const asked = await over((board, asked) =>
      Effect.gen(function*() {
        yield* opening(board)
        yield* settle(400)
        return [...asked]
      }))

    expect(archiveAsked(asked)).toEqual([])
    expect(wikipediaAsked(asked)).toEqual([])
  })
})

describe("what opening the panel costs", () => {
  it("asks the Archive and Wikipedia, once each, when the reader opens the panel", async () => {
    const asked = await over((board, asked) =>
      Effect.gen(function*() {
        yield* opening(board)
        yield* board.enrich(TAB)
        yield* settle(600)
        return [...asked]
      }))

    // Two requests to the Archive — availability, then the capture history —
    // and no more. The second is spent only because the first found something;
    // an unarchived page costs one.
    expect(archiveAsked(asked).length).toBe(2)
    expect(archiveAsked(asked)[0]).toContain("archive.org/wayback/available")
    expect(archiveAsked(asked)[1]).toContain("web.archive.org/cdx")
    // One to Wikipedia: the `https` pass found a citation, so the `http` pass is
    // not spent. Two would mean the connector stopped recognising its own hit.
    expect(wikipediaAsked(asked).length).toBe(1)
  })

  it("pays once per page, however many times the panel is opened", async () => {
    // The answers live on the Enquiry, which is Subject-keyed and shared by
    // every surface on the page, so a second panel, a tab switched away from and
    // back, and a back button inside the idle window all rejoin what was already
    // paid for out of the reader's own address.
    const asked = await over((board, asked) =>
      Effect.gen(function*() {
        yield* opening(board)
        yield* board.enrich(TAB)
        yield* settle(600)
        yield* board.enrich(TAB)
        yield* board.enrich(TAB)
        yield* settle(400)
        return [...asked]
      }))

    expect(archiveAsked(asked).length).toBe(2)
    expect(wikipediaAsked(asked).length).toBe(1)
  })

  it("pays once when several surfaces open together", async () => {
    const asked = await over((board, asked) =>
      Effect.gen(function*() {
        yield* opening(board)
        // No settle between these: Board.enrich forks each Enquiry.enrich.
        // The first fiber must reserve both enrichments before storage-backed
        // policy checks give either of the other fibers a turn.
        yield* board.enrich(TAB)
        yield* board.enrich(TAB)
        yield* board.enrich(TAB)
        yield* settle(600)
        return [...asked]
      }))

    expect(archiveAsked(asked).length).toBe(2)
    expect(wikipediaAsked(asked).length).toBe(1)
  })

  it("does not retry Archive history after the one CDX attempt fails", async () => {
    const result = await over(
      (board, asked) =>
        Effect.gen(function*() {
          yield* opening(board)
          yield* board.enrich(TAB)
          yield* settle(600)

          // Reopening/re-enriching rejoins the retained answer. A 503 is not a
          // reason to spend the reader's Archive budget a second time.
          yield* board.enrich(TAB)
          yield* board.enrich(TAB)
          yield* settle(400)
          const reading = yield* SubscriptionRef.get(yield* board.open(TAB))
          return { asked: [...asked], reading }
      }),
      () => Effect.void,
      cdxUnavailable
    )

    expect(archiveAsked(result.asked).length).toBe(2)
    expect(archiveAsked(result.asked)[0]).toContain("archive.org/wayback/available")
    expect(archiveAsked(result.asked)[1]).toContain("web.archive.org/cdx")
    expect(result.reading.standing._tag).toBe("Enquiring")
    if (result.reading.standing._tag !== "Enquiring") return
    const held = result.reading.standing.knowledge.archive
    expect(held?._tag).toBe("Found")
    if (held?._tag === "Found") {
      expect(held.record.history).toBeNull()
      // 503 is transient, not the terminal 429. The history remains unresolved
      // so the useful first-paint link does not gain a finished-miss sentence.
      expect(held.record.historyPending).toBe(true)
    }
  })

  it("keeps the answers where the panel can draw them", async () => {
    const reading = await over((board) =>
      Effect.gen(function*() {
        yield* opening(board)
        yield* board.enrich(TAB)
        yield* settle(600)
        return yield* SubscriptionRef.get(yield* board.open(TAB))
      }))

    expect(reading.standing._tag).toBe("Enquiring")
    if (reading.standing._tag !== "Enquiring") return
    expect(reading.standing.knowledge.archive?._tag).toBe("Found")
    expect(reading.standing.knowledge.backlinks?._tag).toBe("Cited")
  })

  it("asks nothing about a site the reader put on the skip list", async () => {
    // The same gates a Lookup passes, and this is the one a reader can point at.
    // An excluded page is one they said not to ask about; asking two more places
    // than usual about it is the failure this whole gate exists to prevent.
    const asked = await over(
      (board, asked) =>
        Effect.gen(function*() {
          yield* opening(board)
          yield* board.enrich(TAB)
          yield* settle(600)
          return [...asked]
        }),
      (settings) =>
        Effect.asVoid(
          settings.change((held) => withExclusion(held, { host: "nature.com", pathPrefix: "" }))
        )
    )

    expect(archiveAsked(asked)).toEqual([])
    expect(wikipediaAsked(asked)).toEqual([])
  })

  it("asks nothing about a site the reader paused", async () => {
    const asked = await over(
      (board, asked) =>
        Effect.gen(function*() {
          yield* opening(board)
          yield* board.enrich(TAB)
          yield* settle(600)
          return [...asked]
        }),
      // `nature.com` and not `www.nature.com`: the pause is matched against the
      // Subject's host, and the canonicalization rules elect the bare form.
      (settings) => Effect.asVoid(settings.change((held) => withPause(held, "nature.com")))
    )

    expect(archiveAsked(asked)).toEqual([])
    expect(wikipediaAsked(asked)).toEqual([])
  })

  it("asks nothing while automatic lookups are off", async () => {
    const asked = await over(
      (board, asked) =>
        Effect.gen(function*() {
          yield* opening(board)
          yield* board.enrich(TAB)
          yield* settle(600)
          return [...asked]
        }),
      (settings) => Effect.asVoid(settings.change((held) => withAutomatic(held, false)))
    )

    expect(archiveAsked(asked)).toEqual([])
    expect(wikipediaAsked(asked)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The auto-open decision
// ---------------------------------------------------------------------------

const OFF = { autoOpen: false, maxSnapshotAgeDays: 365 }
const ON = { autoOpen: true, maxSnapshotAgeDays: 365 }

describe("whether to send the reader to the archived copy", () => {
  it("asks nobody and moves nobody while the setting is off", async () => {
    // Both halves, and the second is the one that is easy to lose. A wiring that
    // asked the Archive at navigation time and then declined to redirect would
    // pass a test that only checked the decision — while sending the address of
    // every page the reader opens to archive.org, which is exactly what turning
    // the setting ON is supposed to be agreeing to.
    const { decided, asked } = await over((board, asked) =>
      Effect.gen(function*() {
        yield* opening(board)
        const decided = yield* board.landing(TAB, OFF, NOW)
        yield* settle(300)
        return { decided, asked: [...asked] }
      }))

    expect(decided._tag).toBe("Stay")
    if (decided._tag === "Stay") expect(decided.reason).toBe("auto-open-off")
    expect(archiveAsked(asked)).toEqual([])
  })

  it("asks, and says to redirect, once the reader has turned it on", async () => {
    const { decided, asked } = await over((board, asked) =>
      Effect.gen(function*() {
        yield* opening(board)
        const decided = yield* board.landing(TAB, ON, NOW)
        return { decided, asked: [...asked] }
      }))

    expect(decided._tag).toBe("Redirect")
    if (decided._tag === "Redirect") expect(decided.archivedUrl).toBe(ARCHIVED)
    expect(archiveAsked(asked)[0]).toContain("archive.org/wayback/available")
  })

  /**
   * The loop, closed.
   *
   * A redirected tab lands on `web.archive.org`, which is a page like any other:
   * it settles, it mints a Reading, and the same wiring runs again. Left to
   * itself that is a redirect that fires forever. `decideLanding`'s
   * `already-in-the-archive` rule refuses it, and `Board.landing` checks the same
   * predicate BEFORE asking, so the refusal costs no request either — which
   * matters against the one host whose rate limit bans for an hour.
   */
  it("refuses to redirect a reader who is already in the Archive, and asks nothing", async () => {
    const { decided, asked } = await over((board, asked) =>
      Effect.gen(function*() {
        yield* opening(board, ARCHIVED)
        const decided = yield* board.landing(TAB, ON, NOW)
        yield* settle(300)
        return { decided, asked: [...asked] }
      }))

    expect(decided._tag).toBe("Stay")
    if (decided._tag === "Stay") expect(decided.reason).toBe("already-in-the-archive")
    expect(archiveAsked(asked)).toEqual([])
  })

  it("moves nobody off a site they told Parle to skip", async () => {
    const { decided, asked } = await over(
      (board, asked) =>
        Effect.gen(function*() {
          yield* opening(board)
          const decided = yield* board.landing(TAB, ON, NOW)
          yield* settle(300)
          return { decided, asked: [...asked] }
        }),
      (settings) =>
        Effect.asVoid(
          settings.change((held) => withExclusion(held, { host: "nature.com", pathPrefix: "" }))
        )
    )

    expect(decided._tag).toBe("Stay")
    expect(archiveAsked(asked)).toEqual([])
  })

  it("moves nobody when the kept copy is older than the reader's setting allows", async () => {
    // `now` two years past the snapshot. The kept copy is real, the Archive
    // answered, and the answer is still not one to move a reader on.
    const decided = await over((board) =>
      Effect.gen(function*() {
        yield* opening(board)
        return yield* board.landing(TAB, ON, Date.UTC(2028, 7, 24))
      }))

    expect(decided._tag).toBe("Stay")
    if (decided._tag === "Stay") expect(decided.reason).toBe("snapshot-too-old")
  })

  it("spends one Archive request between the redirect decision and the panel", async () => {
    // The two callers share one answer. Deciding whether to redirect and then
    // drawing the Archive line must not cost the reader's address twice, and the
    // memory that makes that true is the Enquiry's, not either caller's.
    const asked = await over((board, asked) =>
      Effect.gen(function*() {
        yield* opening(board)
        yield* board.landing(TAB, ON, NOW)
        yield* board.enrich(TAB)
        yield* settle(600)
        return [...asked]
      }))

    expect(archiveAsked(asked).filter((url) => url.includes("wayback/available")).length).toBe(1)
  })
})
