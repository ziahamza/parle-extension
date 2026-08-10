/**
 * The reader's controls, driven through the graph as it actually ships.
 *
 * Before this file the Exclusion List, the per-site pause and manual mode were
 * enforced and unreachable, and there was no test that could have told the
 * difference between a control that works and a control that is drawn. That is
 * the specific failure this file exists to make impossible: every assertion
 * below is about **what went out on the wire**, not about what the settings
 * page rendered. A switch that is honoured everywhere except in the one place
 * that issues requests is worse than no switch, because it is a promise.
 *
 * Only the platform and the wire are substituted, exactly as in
 * `Pipeline.test.ts`: the settings document is seeded into the platform
 * double's own byte store, which is the same seam `Settings` reads through in
 * the browser, so nothing here is a hand-assembled lookalike of the real path.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { isSettled } from "@parle/domain/Coverage"
import { ReadingWatch } from "@parle/browser/ReadingWatch"
import { makeDouble, WebExt, type WebExtDouble } from "@parle/browser/WebExtApi"
import { hackerNewsLinked, hackerNewsTopical } from "@parle/networks/Recorded"
import { type Exchange, recording } from "@parle/networks/Recording"
import { Board } from "../reading/Board.ts"
import type { Reading } from "../reading/Reading.ts"
import { noProvider, surroundingsOf } from "../reading/Surroundings.ts"
import {
  asDocument,
  firstRun,
  fromDocument,
  type ReaderSettings,
  SETTINGS_KEY,
  withAutomatic,
  withExclusion,
  withNetwork
} from "../settings/Settings.ts"
import type { Panel } from "../view/Panel.ts"
import { panelOf } from "../view/panelOf.ts"
import * as Pipeline from "./Pipeline.ts"

const ADDRESS = "https://www.nature.com/articles/d41586-024-02012-5"
const TITLE = "Not all 'open source' AI models are open"

const json = (body: string): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "application/json" }
})

/** Algolia answers; nothing else does. Reddit 403s, exactly as it does live. */
const algolia = (url: string): Exchange => {
  if (!url.includes("hn.algolia.com")) {
    return { status: 403, body: "<html>blocked</html>", headers: { "content-type": "text/html" } }
  }
  return json(url.includes("restrictSearchableAttributes") ? hackerNewsLinked : hackerNewsTopical)
}

/**
 * A platform whose store already holds one settings document.
 *
 * `decided` is true throughout: the first-run question is a separate control
 * with its own tests, and leaving it unanswered would make every case below
 * pass for the wrong reason.
 */
const readerWhoSaid = (said: Partial<ReaderSettings>): WebExtDouble => {
  const double = makeDouble()
  const settings: ReaderSettings = { ...firstRun, decided: true, ...said }
  double.held.set(SETTINGS_KEY, new TextEncoder().encode(asDocument(settings)))
  return double
}

/** The settings this double really holds, read back the way the app reads them. */
const settingsIn = (double: WebExtDouble): ReaderSettings => {
  const held = double.held.get(SETTINGS_KEY)
  return held === undefined ? firstRun : fromDocument(new TextDecoder().decode(held))
}

/** Everything has answered, been refused, or been deliberately not asked. */
const nothingLeftToWaitFor = (reading: Reading): boolean =>
  reading.standing._tag === "Excluded" ||
  (reading.standing._tag === "Enquiring" && isSettled(reading.standing.knowledge.coverage))

const answeredAbout = (network: string) => (reading: Reading): boolean =>
  reading.standing._tag === "Enquiring" &&
  isSettled(reading.standing.knowledge.coverage) &&
  reading.standing.knowledge.coverage.consultations.some((consultation) =>
    consultation.place._tag === "Network" &&
    consultation.place.network === network &&
    consultation._tag === "Answered"
  )

interface Run {
  readonly panel: Panel
  readonly asked: ReadonlyArray<string>
}

/**
 * Open one page as this reader, and read what actually went out.
 *
 * `after` runs once everything has settled — which is how the toolbar case is
 * expressed: manual mode settles immediately with every Place held back, and
 * only then does the reader press the button.
 */
const reading = async (
  double: WebExtDouble,
  options: {
    readonly address?: string
    readonly after?: Effect.Effect<void, never, Board>
    readonly until?: (reading: Reading) => boolean
  } = {}
): Promise<Run> => {
  const wire = recording(algolia)
  const address = options.address ?? ADDRESS

  const panel = await Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      const watch = yield* ReadingWatch
      const board = yield* Board

      const boundaries = yield* Effect.forkScoped(
        Stream.runForEach(watch.readings, (boundary) =>
          board.sight(boundary.tab, boundary.address, TITLE, boundary.arrival))
      )

      const waitFor = (ready: (reading: Reading) => boolean) =>
        Effect.gen(function*() {
          const ref = yield* board.open(1)
          const seen = yield* SubscriptionRef.changes(ref).pipe(
            Stream.filter(ready),
            Stream.take(1),
            Stream.runCollect,
            Effect.timeout("10 seconds")
          )
          const first = seen[0]
          if (first === undefined) throw new Error("the Reading never got there")
          return first
        })

      yield* Effect.promise(() => double.watched)
      double.sight({ address, tabId: 1 })

      let settled = yield* waitFor(nothingLeftToWaitFor)

      if (options.after !== undefined) {
        yield* options.after
        settled = yield* waitFor(options.until ?? nothingLeftToWaitFor)
      }

      yield* Fiber.interrupt(boundaries)
      return settled
    })).pipe(Effect.provide(Pipeline.on(WebExt.doubleLayer(double), wire.layer)))
  )

  // Derived from the document this reader actually has, never hard-coded. The
  // panel's account of WHY a Place was not asked is a function of the reader's
  // settings — `Coverage` has one `kill-switched` literal for the per-Network
  // switch, manual mode and our own switch — so a fixed `decision: "automatic"`
  // here made every sentence below untestable, and one of them was false.
  const around = surroundingsOf(settingsIn(double), { _tag: "Absent" }, noProvider)
  return { panel: panelOf(panel, Date.now(), around), asked: wire.asked }
}

/** The reader opening the extension on this page, on purpose. */
const insisting = Effect.flatMap(Board, (board) => board.insist(1))

const askedOf = (asked: ReadonlyArray<string>, host: string): ReadonlyArray<string> =>
  asked.filter((url) => url.includes(host))

describe("a Network the reader switched off", () => {
  it("is not asked, on a page every other Network is asked about", async () => {
    const { asked } = await reading(readerWhoSaid({
      networks: { ...firstRun.networks, reddit: false }
    }))

    expect(askedOf(asked, "reddit.com")).toHaveLength(0)
    // The control is off, not broken: everything else still went out.
    expect(askedOf(asked, "hn.algolia.com").length).toBeGreaterThan(0)
  })

  it("says so per Place rather than looking like a Network that had nothing", async () => {
    const { panel } = await reading(readerWhoSaid({
      networks: { ...firstRun.networks, reddit: false }
    }))
    const reddit = panel.accounts.filter((account) => account.place.startsWith("Reddit"))

    expect(reddit).toHaveLength(1)
    expect(reddit.every((account) => account.tone === "withheld")).toBe(true)
  })

  it("names the switch the reader actually moved, not a different one", async () => {
    // The tone alone cannot catch this and did not: `Coverage` has one
    // `kill-switched` literal for the per-Network switch, manual mode and our
    // own switch, and the panel reported all three as "automatic lookups are
    // off" — to a reader who had left automatic lookups ON.
    const { panel } = await reading(readerWhoSaid({
      networks: { ...firstRun.networks, reddit: false }
    }))
    const reddit = panel.accounts.filter((account) => account.place.startsWith("Reddit"))

    for (const account of reddit) {
      expect(account.standing).toContain("you switched Reddit off")
      expect(account.standing).not.toContain("automatic lookups are off")
    }
    // And it stays a notice about Reddit rather than a banner across a page
    // whose other Networks answered perfectly well.
    expect(panel.restraint).toBeNull()
  })

  it("does not tell a reader who switched everything off that it was not them", async () => {
    const { panel } = await reading(readerWhoSaid({
      networks: { hackernews: false, reddit: false, x: false }
    }))

    expect(panel.restraint?.kind).toBe("networks-off")
    expect(panel.restraint?.says).toContain("You switched")
    expect(panel.restraint?.says).toContain("Hacker News")
    expect(panel.restraint?.says).toContain("Reddit")
    expect(panel.restraint?.says).not.toContain("not something you did")
  })

  it("stays off when the reader opens the panel", async () => {
    // The difference between "off" and "off until you click". An explicit Ask
    // overrides the exclusion list, a pause and manual mode — deliberately —
    // and it must not override this one (ADR 0014).
    const { asked } = await reading(
      readerWhoSaid({ networks: { ...firstRun.networks, reddit: false } }),
      { after: insisting }
    )

    expect(askedOf(asked, "reddit.com")).toHaveLength(0)
  })
})

describe("a site the reader added themselves", () => {
  it("is not looked up anywhere", async () => {
    const { asked } = await reading(readerWhoSaid({
      excluded: [{ host: "nature.com", pathPrefix: "" }]
    }))

    expect(asked).toHaveLength(0)
  })

  it("covers a path prefix without covering the rest of the site", async () => {
    const under = readerWhoSaid({
      excluded: [{ host: "nature.com", pathPrefix: "/articles" }]
    })
    expect((await reading(under)).asked).toHaveLength(0)

    const elsewhere = readerWhoSaid({
      excluded: [{ host: "nature.com", pathPrefix: "/careers" }]
    })
    expect((await reading(elsewhere)).asked.length).toBeGreaterThan(0)
  })

  it("is still looked up when the reader asks for this page on purpose", async () => {
    // ADR 0005: the toolbar never says "not applicable", even on a page the
    // reader themselves put on the list.
    const { asked } = await reading(
      readerWhoSaid({ excluded: [{ host: "nature.com", pathPrefix: "" }] }),
      { after: insisting, until: answeredAbout("hackernews") }
    )

    expect(askedOf(asked, "hn.algolia.com").length).toBeGreaterThan(0)
  })
})

describe("a built-in entry the reader overrode", () => {
  it("is on the built-in list, and is therefore skipped until they say otherwise", async () => {
    // The premise. Without this the test below could pass on a domain that was
    // never on the list, and would prove nothing about the override.
    const { asked } = await reading(readerWhoSaid({}), {
      address: "https://www.chase.com/personal/credit-cards"
    })
    expect(asked).toHaveLength(0)
  })

  it("is looked up again, automatically, once they have overridden it", async () => {
    // "Look it up anyway" on the settings page is the only control in the
    // product that makes Parle send MORE than it otherwise would, and it had no
    // test that it did anything at all. Ticket 03 §5 puts it at the top of the
    // precedence order — above the mechanical rules, for `http(s)` hosts — so
    // the proof has to be that a request really went out without anyone
    // pressing anything.
    const { asked } = await reading(
      readerWhoSaid({ allowedAnyway: [{ host: "chase.com", pathPrefix: "" }] }),
      { address: "https://www.chase.com/personal/credit-cards" }
    )
    expect(askedOf(asked, "hn.algolia.com").length).toBeGreaterThan(0)
  })
})

describe("a site the reader paused", () => {
  it("is not looked up until they resume it", async () => {
    const { asked } = await reading(readerWhoSaid({ paused: ["nature.com"] }))
    expect(asked).toHaveLength(0)
  })
})

describe("automatic lookups switched off", () => {
  it("sends nothing as the reader browses", async () => {
    const { asked } = await reading(readerWhoSaid(withAutomatic(firstRun, false)))
    expect(asked).toHaveLength(0)
  })

  it("leaves the toolbar working, on demand, on the same page", async () => {
    const { asked, panel } = await reading(
      readerWhoSaid(withAutomatic(firstRun, false)),
      { after: insisting, until: answeredAbout("hackernews") }
    )

    expect(askedOf(asked, "hn.algolia.com").length).toBeGreaterThan(0)
    expect(panel.linked.length).toBeGreaterThan(0)
  })

  it("still asks nobody about a page the reader did not ask about", async () => {
    // The switch is not a delay. Nothing fires without the act.
    const { asked } = await reading(readerWhoSaid(withAutomatic(firstRun, false)))
    expect(askedOf(asked, "hn.algolia.com")).toHaveLength(0)
  })
})

describe("the settings the reader never touched", () => {
  it("looks the page up, which is what makes every switch above meaningful", async () => {
    const { asked, panel } = await reading(readerWhoSaid({}))

    expect(askedOf(asked, "hn.algolia.com").length).toBeGreaterThan(0)
    expect(panel.linked.length).toBeGreaterThan(0)
  })

  it("is what the edits in `Settings` produce from a first run", async () => {
    // Guards the join between the settings page and this path: the page never
    // constructs a document, it applies these functions to the one on disk.
    const said = withExclusion(
      withNetwork({ ...firstRun, decided: true }, "reddit", false),
      { host: "nature.com", pathPrefix: "" }
    )
    const double = makeDouble()
    double.held.set(SETTINGS_KEY, new TextEncoder().encode(asDocument(said)))

    expect((await reading(double)).asked).toHaveLength(0)
  })
})
