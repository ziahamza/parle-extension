/**
 * What the panel says about the page itself and about who publishes it.
 *
 * `render.test.ts` already walks every one of these states through both surfaces
 * and asserts the two properties it exists for — that nothing renders as
 * nothing, and that no engineering term reaches the reader. This file asserts
 * the thing those two cannot: that the states MEAN different things on screen.
 *
 * Three claims here are the ones worth the file, and each of them is a
 * distinction that would be invisible to a coverage check:
 *
 *   1. **A kept copy with a history and a kept copy whose history could not be
 *      asked for must look different.** `record.history` is `null` for exactly
 *      one reason — the CDX half of the Archive Lookup failed, which is the
 *      routine half, because it is the rate-limited one — and it means "could
 *      not ask" and never "no history". Rendered alike, a page captured five
 *      hundred times would read as one that never changed. This is ADR 0005's
 *      silent false negative arriving through a nullable field.
 *
 *   2. **"At least" flows from a measured bound and from nowhere else.** The
 *      Archive's `clipped` and Wikipedia's `bounded` are both facts about the
 *      size of OUR request; a count drawn without them reads as a total.
 *
 *   3. **A rater's words are drawn verbatim.** ADR 0022 makes the attribution
 *      structural rather than a rendering convention: "Lean Left" is an
 *      assertion Parle would have to defend and "Lean Left — per AllSides" is a
 *      checkable fact about AllSides. This file is the check that the panel does
 *      not paraphrase one into the other.
 *
 * The Standing fixtures use real domains out of the shipped artifact rather than
 * a hand-written one, because half of what is under test is that the committed
 * `data/standing.json` reaches the panel at all — against a fixture, the whole
 * wiring could be cut and every assertion here would still pass.
 */
import { Holding } from "@parle/archive/Holding"
import { Backlink, BacklinkAnswer } from "@parle/backlinks/Backlink"
import { Consultation, Place } from "@parle/domain/Coverage"
import { Arrival, SubjectUrl } from "@parle/domain/Subject"
import { beforeEach, describe, expect, it } from "vitest"
import { begin, type Knowledge, mark } from "../enquiry/Knowledge.ts"
import { type Reading, Standing } from "../reading/Reading.ts"
import { everyNetworkOn, noProvider, type Surroundings } from "../reading/Surroundings.ts"
import { type Fake, mountDouble } from "./domDouble.ts"
import type { Panel } from "./Panel.ts"
import { panelOf } from "./panelOf.ts"
import type { Acts } from "./render.ts"
import { render, renderStatus, resetViewState } from "./render.ts"

const NOW = Date.UTC(2026, 7, 24)
const AGREED: Surroundings = {
  decision: "automatic",
  provider: noProvider,
  networks: everyNetworkOn,
  index: { _tag: "Absent" },
  everyDiscussion: false
}

const places = [
  Place.cases.Recall.make({}),
  Place.cases.Network.make({ network: "hackernews" }),
  Place.cases.Network.make({ network: "reddit" }),
  Place.cases.Network.make({ network: "x" }),
  Place.cases.Network.make({ network: "bluesky" }),
  Place.cases.Network.make({ network: "lemmy" }),
  Place.cases.Network.make({ network: "lobsters" })
]

/** Everything answered with nothing, so the context block is what is on screen. */
const quiet = (subject: SubjectUrl): Knowledge =>
  places.reduce(
    (held, place) => mark(held, Consultation.cases.Silence.make({ place })),
    begin(subject, places)
  )

const readingOn = (address: string, knowledge: Knowledge): Reading => ({
  address,
  title: "A piece",
  traversed: [],
  arrival: Arrival.cases.Elsewhere.make({}),
  standing: Standing.cases.Enquiring.make({
    subject: SubjectUrl.make(address),
    knowledge
  }),
  excludedBecause: null
})

const PLAIN = "https://example.com/piece"
const subject = SubjectUrl.make(PLAIN)
const KEPT = "https://web.archive.org/web/20240101000000/https://example.com/piece"

const panelWith = (
  said: {
    readonly archive?: typeof Holding.Type
    readonly backlinks?: typeof BacklinkAnswer.Type
  },
  address = PLAIN
): Panel =>
  panelOf(
    readingOn(address, {
      ...quiet(SubjectUrl.make(address)),
      archive: said.archive ?? null,
      backlinks: said.backlinks ?? null
    }),
    NOW,
    AGREED
  )

const found = (
  history: {
    readonly firstCaptureAt: number | null
    readonly latestCaptureAt: number | null
    readonly contentChanges: number
    readonly clipped: boolean
  } | null,
  snapshotStatus = "200"
) =>
  Holding.cases.Found.make({
    record: {
      subject,
      archivedUrl: KEPT,
      snapshotAt: Date.UTC(2024, 0, 1),
      snapshotStatus,
      history
    }
  })

const history = (
  said: { readonly changes?: number; readonly clipped?: boolean; readonly first?: number | null }
) => ({
  firstCaptureAt: said.first === undefined ? Date.UTC(2019, 4, 2) : said.first,
  latestCaptureAt: Date.UTC(2024, 0, 1),
  contentChanges: said.changes ?? 6,
  clipped: said.clipped ?? false
})

const cited = (
  titles: ReadonlyArray<string>,
  bounded = false
): typeof BacklinkAnswer.Type =>
  BacklinkAnswer.cases.Cited.make({
    reference: "wikipedia",
    backlinks: titles.map((title) =>
      Backlink.make({
        reference: "wikipedia",
        title,
        url: `https://en.wikipedia.org/wiki/${title.replace(/ /g, "_")}`,
        matchedUrl: subject
      })
    ),
    ...(bounded ? { bounded: true } : {})
  })

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

let root: Fake
let opened: Array<string>

const acts = (): Acts => ({
  openOut: (address) => opened.push(address),
  lookAnyway: () => {},
  summarise: () => {},
  readDiscussion: () => {},
  decide: () => {},
  openDisclosure: () => {},
  openSettings: () => {},
  pauseSite: () => {},
  resumeSite: () => {}
})

beforeEach(() => {
  root = mountDouble()
  opened = []
  resetViewState()
})

/** The context block's text on the toolbar surface, which draws every state. */
const said = (panel: Panel): string => {
  renderStatus(root as unknown as HTMLElement, panel, acts())
  return root.withClass("parle-context").map((node) => node.textContent).join(" ")
}

const onThePage = (panel: Panel): Fake => {
  render(root as unknown as HTMLElement, panel, acts())
  return root
}

// ---------------------------------------------------------------------------
// The Archive
// ---------------------------------------------------------------------------

describe("what the Archive holds", () => {
  it("is not drawn at all until somebody asks", () => {
    // Absent renders NOTHING — no heading, no empty scaffolding, no "unknown".
    // Most pages are this, and a block that existed and was empty on all of them
    // would be a permanent apology for a feature nobody triggered.
    expect(said(panelWith({}))).toBe("")
    expect(panelWith({}).context.archive).toEqual([])
  })

  it("says when a copy was first kept and how often it changed", () => {
    const text = said(panelWith({ archive: found(history({ changes: 6 })) }))
    expect(text).toContain("First kept 2019")
    expect(text).toContain("changed 6 times")
  })

  it("draws a copy with no history DIFFERENTLY from one with a history", () => {
    // The load-bearing pair. `history: null` is the CDX half of the Lookup
    // failing — routine, because it is the rate-limited half — and it means "we
    // could not ask", never "it never changed". Two states that render alike
    // here is a page captured five hundred times reading as one that never
    // moved: ADR 0005's silent false negative, through a nullable field.
    const withHistory = said(panelWith({ archive: found(history({})) }))
    const without = said(panelWith({ archive: found(null) }))
    expect(without).not.toBe(withHistory)
    expect(without).toContain("could not ask")
    expect(without).not.toContain("changed 6 times")
    // And it must not read as an absence of changes either.
    expect(without).not.toContain("unchanged")
  })

  it("still offers the kept copy when the history could not be asked for", () => {
    // The two halves fail independently ON PURPOSE: the link is what the
    // package is for, and losing it to tidy away a missing count would throw
    // away the thing the reader came for.
    const panel = panelWith({ archive: found(null) })
    expect(panel.context.archive[0]?.href).toBe(KEPT)
  })

  it("does not say could not ask while the history half is still being asked", () => {
    // Availability notes Found with history null before CDX. That is not a
    // finished miss; the failure sentence is for a settled CDX miss only.
    const pending = Holding.cases.Found.make({
      record: {
        subject,
        archivedUrl: KEPT,
        snapshotAt: Date.UTC(2024, 0, 1),
        snapshotStatus: "200",
        history: null,
        historyPending: true
      }
    })
    const panel = panelWith({ archive: pending })
    const text = said(panel)
    expect(text).toContain("A kept copy from 2024")
    expect(text).not.toContain("could not ask")
    expect(text).not.toContain("How often it changed")
    expect(panel.context.archive[0]?.href).toBe(KEPT)
    expect(panel.context.archive[0]?.tone).toBe("found")
  })

  it("says at least when the Archive had more captures than Parle read", () => {
    const clipped = said(panelWith({ archive: found(history({ changes: 500, clipped: true })) }))
    expect(clipped).toContain("changed at least 500 times")
    const whole = said(panelWith({ archive: found(history({ changes: 500, clipped: false })) }))
    expect(whole).toContain("changed 500 times")
    expect(whole).not.toContain("at least")
  })

  it("says nothing was ever kept, rather than saying nothing", () => {
    // The Silence analog: the Archive answered, cleanly, and holds nothing. It
    // is evidence about the world and is worth a line for the same reason a
    // Network's silence is.
    const text = said(panelWith({ archive: Holding.cases.NothingArchived.make({}) }))
    expect(text).toContain("never kept a copy")
  })

  it("says we could not ask, rather than drawing it as nothing kept", () => {
    const text = said(panelWith({
      archive: Holding.cases.CouldNotAsk.make({ reason: "rate-limited" })
    }))
    expect(text).toContain("could not ask")
    expect(text).toContain("slow down")
    // The opposite fact must not be reachable from this state.
    expect(text).not.toContain("never kept a copy")
  })

  it("keeps an unreadable answer apart from an empty one", () => {
    const garbled = said(panelWith({
      archive: Holding.cases.Garbled.make({ detail: "an interstitial page" })
    }))
    expect(garbled).toContain("unreadably")
    expect(garbled).toContain("an interstitial page")
    expect(garbled).not.toContain("never kept a copy")
  })

  it("makes the whole line a native link to the kept copy", () => {
    const drawn = onThePage(panelWith({ archive: found(history({})) }))
    const line = drawn.withClass("parle-context-link")[0]
    expect(line?.tag).toBe("a")
    expect(line?.className.split(" ")).toContain("parle-context-line")
    expect(line?.href).toBe(KEPT)
    expect(line?.target).toBe("_blank")
    expect(line?.rel).toBe("noreferrer noopener")

    // A native anchor does not depend on the MV3 worker being alive for the
    // one click that opens it. The test double records cancellation without
    // asking its non-browser environment to perform a navigation.
    line?.click()
    expect(line?.clickWasPrevented).toBe(false)
    expect(opened).toEqual([])
  })

  it("draws four Archive states that no two of which read alike", () => {
    // Written as a set rather than as four assertions, because the failure this
    // catches is two states collapsing into one sentence, and that is a property
    // of the whole family rather than of any member of it.
    const texts = [
      said(panelWith({ archive: found(history({})) })),
      said(panelWith({ archive: found(null) })),
      said(panelWith({ archive: Holding.cases.NothingArchived.make({}) })),
      said(panelWith({ archive: Holding.cases.CouldNotAsk.make({ reason: "forbidden" }) }))
    ]
    expect(new Set(texts).size).toBe(4)
    expect(texts.every((text) => text.trim().length > 0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Wikipedia's citations
// ---------------------------------------------------------------------------

describe("which Wikipedia articles cite this page", () => {
  it("names them, and links each one", () => {
    const panel = panelWith({ backlinks: cited(["Open-source artificial intelligence"]) })
    const text = said(panel)
    expect(text).toContain("Cited by Wikipedia")
    expect(text).toContain("Open-source artificial intelligence")

    const drawn = onThePage(panel)
    const cites = drawn.withClass("parle-context-cite")
    expect(cites.length).toBe(1)
    expect(cites[0]?.href).toBe(
      "https://en.wikipedia.org/wiki/Open-source_artificial_intelligence"
    )
  })

  it("says at least when the answer was cut off by the size of our own request", () => {
    const bounded = said(panelWith({ backlinks: cited(["Alpha", "Beta"], true) }))
    expect(bounded).toContain("at least 2")
    const whole = said(panelWith({ backlinks: cited(["Alpha", "Beta"], false) }))
    expect(whole).not.toContain("at least")
  })

  it("does not claim Wikipedia is silent when only our window was", () => {
    // The dangerous case and the reason `isBounded` exists at all. An empty
    // answer from `exturlusage` is not evidence that nothing exists — verified
    // live: a namespace-filtered query returned `[]` together with a `continue`
    // token. Rendered as a flat "no article cites this page" it would be the
    // panel stating a fact about Wikipedia that is actually a fact about
    // `eulimit=25`.
    const bounded = said(panelWith({
      backlinks: BacklinkAnswer.cases.Uncited.make({ reference: "wikipedia", bounded: true })
    }))
    const whole = said(panelWith({
      backlinks: BacklinkAnswer.cases.Uncited.make({ reference: "wikipedia" })
    }))
    expect(bounded).not.toBe(whole)
    expect(bounded).toContain("in the ones Parle read")
    expect(whole).not.toContain("in the ones Parle read")
  })

  it("says we could not ask, rather than that nothing cites this page", () => {
    const text = said(panelWith({
      backlinks: BacklinkAnswer.cases.CouldNotAsk.make({
        reference: "wikipedia",
        reason: "rate-limited"
      })
    }))
    expect(text).toContain("could not ask Wikipedia")
    expect(text).not.toContain("No Wikipedia article cites")
  })

  it("is not drawn at all until somebody asks", () => {
    expect(panelWith({}).context.standing).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Standing
// ---------------------------------------------------------------------------

/**
 * Two real domains out of the shipped artifact, and one that is not in it.
 *
 * `example.com` is deliberately unrated, which is also why every other panel
 * test in this workspace uses it: a page with no rated publisher must draw no
 * Standing at all, and that is what keeps this feature off the overwhelming
 * majority of pages.
 */
const RATED = "https://www.breitbart.com/politics/2024/01/01/a-piece/"
const SUBDOMAIN = "https://blogs.nytimes.com/2024/01/01/a-piece/"

describe("what named raters say about the publisher", () => {
  it("says nothing about a publisher nobody rated", () => {
    expect(panelWith({}, PLAIN).context.standing).toEqual([])
  })

  it("draws each rater's own words, verbatim, with their name attached", () => {
    // The one thing this rendering may never do is paraphrase. ADR 0022:
    // "This publication leans left" is an assertion Parle would have to defend;
    // "Right — per AllSides" is a checkable fact about AllSides that the reader
    // can go and argue with, which is the entire point of the product. Every
    // line is compared against the string the package supplied.
    const panel = panelWith({}, RATED)
    const lines = panel.context.standing.map((line) => line.text)
    expect(lines).toContain("Right — per AllSides")
    expect(lines).toContain("Blacklisted — per Wikipedia's perennial sources list")
    expect(lines.some((line) => line.endsWith("— per the Iffy Index"))).toBe(true)
    // On screen too, not only in the derived value.
    expect(said(panel)).toContain("Right — per AllSides")
  })

  it("never states a rating without saying whose it is", () => {
    const panel = panelWith({}, RATED)
    const rater = /— per (AllSides|Wikipedia's perennial sources list|the Iffy Index|Wikidata)$/
    for (const line of panel.context.standing) {
      // Every line either carries a rater's name or is the sentence explaining
      // that the rating is about a parent domain. There is no third kind, and a
      // bare verdict with nobody's name on it is precisely what ADR 0009 refused.
      expect(rater.test(line.text) || line.text.startsWith("Said about")).toBe(true)
    }
  })

  it("says when a rating is about the site rather than about this page", () => {
    // The raters rated the publication, not the subdomain. A reader on
    // `blogs.nytimes.com` shown a rating filed against `nytimes.com` is owed the
    // difference rather than a precision nobody has.
    const panel = panelWith({}, SUBDOMAIN)
    expect(panel.context.standing.length).toBeGreaterThan(0)
    expect(panel.context.standing.map((line) => line.text)).toContain(
      "Said about nytimes.com, not about this page."
    )
  })

  it("keeps the original publisher's Standing on an archived copy", () => {
    const original = SubjectUrl.make(RATED)
    const knowledge = quiet(original)
    const reading: Reading = {
      ...readingOn(KEPT, knowledge),
      standing: Standing.cases.Enquiring.make({ subject: original, knowledge })
    }

    const panel = panelOf(reading, NOW, AGREED)
    expect(panel.address).toBe(KEPT)
    expect(panel.context.standing.map((line) => line.text)).toContain("Right — per AllSides")
  })

  it("costs no request, so it is drawn on a page Parle asked nothing about", () => {
    // Standing is a lookup in a file the reader already has: no request, no IP,
    // no timing, nothing to withhold and no reason owed for withholding it. It
    // is therefore the one thing in the block that is true of a page nothing was
    // asked about, and drawing it there is not a leak of anything.
    const untouched = panelOf(
      readingOn(RATED, begin(SubjectUrl.make(RATED), places)),
      NOW,
      AGREED
    )
    expect(untouched.context.standing.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// The block as a whole
// ---------------------------------------------------------------------------

describe("the block itself", () => {
  it("draws no heading for a group with nothing in it", () => {
    const drawn = onThePage(panelWith({ archive: Holding.cases.NothingArchived.make({}) }))
    const headings = drawn.withClass("parle-context-name").map((node) => node.textContent)
    expect(headings).toEqual(["Archive"])
  })

  it("keeps the two groups apart, so neither reads as the other", () => {
    // ADR 0022's second reconciliation, as a structural check: what Parle
    // observed about THIS page and what other people concluded about its
    // PUBLISHER must not render alike. Two named groups is how that is true on
    // screen rather than only in the glossary.
    const drawn = onThePage(
      panelWith({ archive: found(history({})), backlinks: cited(["Alpha"]) }, RATED)
    )
    expect(drawn.withClass("parle-context-name").map((node) => node.textContent))
      .toEqual(["Archive", "Standing"])
  })

  it("draws nothing at all when there is nothing to say", () => {
    const drawn = onThePage(panelWith({}, PLAIN))
    expect(drawn.withClass("parle-context")).toEqual([])
  })
})
