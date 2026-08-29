/**
 * Every state the panel can be in, drawn on BOTH surfaces, and read back as a
 * reader would.
 *
 * Two properties are checked over the same set of cases, and they are the two
 * ADR 0011 and `CONTEXT.md` respectively demand:
 *
 * **Nothing renders as nothing.** ADR 0011 makes each degraded capability a
 * state rather than an error, which is only true if every one of them produces
 * words on screen. An empty panel is a reader who cannot tell "nobody has
 * discussed this" from "Reddit refused" from "we chose not to ask", and those
 * have opposite meanings. Both surfaces are held to it: the toolbar surface is
 * where the specifics live now, and the page surface is only injected where
 * there is something to read, but neither is allowed a state it draws blank.
 *
 * **No engineering vocabulary reaches the reader.** `CONTEXT.md` is binding and
 * lists seven reader-facing terms; everything else in it is how we talk to each
 * other. The check is a grep over the finished `textContent`, because that is
 * the only place the question can actually be answered — a term can be absent
 * from every string literal and still arrive through a `Record` lookup, an
 * interpolation, or a case name.
 *
 * The panels are derived by `panelOf` from real Knowledge rather than written
 * out by hand, so a case that stops being reachable stops being tested rather
 * than quietly passing forever.
 */
import { Consultation, Place } from "@parle/domain/Coverage"
import { Citation, DigestOrigin } from "@parle/domain/Digest"
import { Mention } from "@parle/domain/Mention"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { Arrival, SubjectUrl } from "@parle/domain/Subject"
import { Holding } from "@parle/archive/Holding"
import { Backlink, BacklinkAnswer } from "@parle/backlinks/Backlink"
import { Discussion } from "@parle/networks/Discussion"
import { Observation } from "@parle/networks/Observation"
import { beforeEach, describe, expect, it } from "vitest"
import { begin, DigestStanding, fold, type Knowledge, mark } from "../enquiry/Knowledge.ts"
import { type Reading, Standing } from "../reading/Reading.ts"
import { everyNetworkOn, noProvider, type Surroundings } from "../reading/Surroundings.ts"
import { type Fake, mountDouble } from "./domDouble.ts"
import type { Panel } from "./Panel.ts"
import { panelOf } from "./panelOf.ts"
import type { Acts } from "./render.ts"
import { render, renderStatus, resetViewState } from "./render.ts"

const NOW = 1_700_000_100_000
const subject = SubjectUrl.make("https://example.com/piece")

const recall = Place.cases.Recall.make({})
const hnLinked = Place.cases.Network.make({ network: "hackernews" })
const redditLinked = Place.cases.Network.make({ network: "reddit" })
const xLinked = Place.cases.Network.make({ network: "x" })
const blueskyLinked = Place.cases.Network.make({ network: "bluesky" })
const lemmyLinked = Place.cases.Network.make({ network: "lemmy" })
const lobstersLinked = Place.cases.Network.make({ network: "lobsters" })
/**
 * Every Place a real Enquiry seeds, in the order it seeds them.
 *
 * All six Networks, because `Enquiry.places` is all six: a panel derived from a
 * shorter list would be a panel that never has to account for the three added
 * last, and every case below would pass without them ever being drawn.
 */
const places = [
  recall,
  hnLinked,
  redditLinked,
  xLinked,
  blueskyLinked,
  lemmyLinked,
  lobstersLinked
]
/** Every switch down — the state the "nowhere left to ask" restraint is about. */
const NOTHING_ON = {
  hackernews: false,
  reddit: false,
  x: false,
  bluesky: false,
  lemmy: false,
  lobsters: false
}
/** Every Network Place, for the fixtures that settle "everything that has not answered". */
const NETWORK_PLACES = [hnLinked, redditLinked, xLinked, blueskyLinked, lemmyLinked, lobstersLinked]

/** The Networks in the order the nav is expected to draw them. */
const NETWORKS_IN_ORDER = ["hackernews", "reddit", "x", "bluesky", "lemmy", "lobsters"] as const

/** Written out rather than imported, so a renamed Network fails here too. */
const NAMES: Record<typeof NETWORKS_IN_ORDER[number], string> = {
  hackernews: "Hacker News",
  reddit: "Reddit",
  x: "X",
  bluesky: "Bluesky",
  lemmy: "Lemmy",
  lobsters: "Lobsters"
}

/** Each Network's own word for the number beside a Discussion. */
const NUMBER_WORDS = [
  ["hackernews", "points"],
  ["reddit", "upvotes"],
  ["x", "likes"],
  ["bluesky", "likes"],
  ["lemmy", "upvotes"],
  ["lobsters", "points"]
] as const

const AGREED: Surroundings = { decision: "automatic", provider: noProvider, networks: everyNetworkOn, index: { _tag: "Absent" }, everyDiscussion: false }
const MANUAL: Surroundings = { decision: "manual", provider: noProvider, networks: everyNetworkOn, index: { _tag: "Absent" }, everyDiscussion: false }
const UNTOLD: Surroundings = { decision: "undecided", provider: noProvider, networks: everyNetworkOn, index: { _tag: "Absent" }, everyDiscussion: false }
const INDEXED: Surroundings = { decision: "automatic", provider: noProvider, networks: everyNetworkOn, index: { _tag: "Ready", builtAt: NOW }, everyDiscussion: false }
const STALE: Surroundings = {
  decision: "automatic", provider: noProvider, networks: everyNetworkOn,
  index: { _tag: "Stale", builtAt: NOW - 90 * 24 * 3_600_000 },
  everyDiscussion: false
}

const idOf = (network: "hackernews" | "reddit", nativeId: string): DiscussionId =>
  DiscussionId.make({ network, nativeId: NativeId.make(nativeId) })

const rowsFor = (id: DiscussionId, title: string) => ({
  discussions: [
    Discussion.make({ id, title, submittedUrl: subject, postedAt: NOW - 3_600_000, author: null, venue: null })
  ],
  observations: [
    Observation.make({ discussion: id, score: 42, comments: 3, present: true, receivedAt: NOW })
  ]
})

const readingOf = (
  knowledge: Knowledge,
  excludedBecause: string | null = null
): Reading => ({
  address: subject,
  title: "A piece",
  traversed: [],
  arrival: Arrival.cases.Elsewhere.make({}),
  standing: Standing.cases.Enquiring.make({ subject, knowledge }),
  excludedBecause
})

const everyPlace = (
  make: (place: Place) => Consultation,
  from: Knowledge = begin(subject, places)
): Knowledge => places.reduce((held, place) => mark(held, make(place)), from)

// ---------------------------------------------------------------------------
// One panel per state, each derived from a Reading that can really occur
// ---------------------------------------------------------------------------

const found = (): Panel => {
  let knowledge = fold(
    begin(subject, places),
    Consultation.cases.Answered.make({
      place: hnLinked,
      mentions: [Mention.cases.Linked.make({
        subject,
        discussion: idOf("hackernews", "1"),
        viaAlias: subject
      })]
    }),
    rowsFor(idOf("hackernews", "1"), "the thread about this page")
  )
  knowledge = fold(
    knowledge,
    Consultation.cases.Answered.make({
      place: redditLinked,
      mentions: [Mention.cases.Passing.make({
        subject,
        discussion: idOf("reddit", "abc"),
        inComment: "t1_x"
      })]
    }),
    rowsFor(idOf("reddit", "abc"), "someone linked it here")
  )
  // Only the Places that have not answered. Marking every Place would replace
  // the three Answered ones and quietly empty the panel this case is about.
  for (const place of [recall, xLinked, blueskyLinked, lemmyLinked, lobstersLinked]) {
    knowledge = mark(knowledge, Consultation.cases.Silence.make({ place }))
  }
  return panelOf(readingOf(knowledge), NOW, AGREED)
}

/**
 * Hacker News answered, and said there was more than we asked to hear.
 *
 * `rows` chooses between the two shapes that carry it, and both must draw the
 * sentence: an `Answered` where the count on screen is a floor, and a `Silence`
 * where the reader is being told nobody has discussed this page and the truth
 * is that we did not look far enough. The second is the one that would
 * otherwise be indistinguishable from a page nobody has ever submitted.
 */
const windowedPanel = (rows: boolean): Panel => {
  const id = idOf("hackernews", "1")
  let knowledge = rows
    ? fold(
      begin(subject, places),
      Consultation.cases.Answered.make({
        place: hnLinked,
        mentions: [Mention.cases.Linked.make({ subject, discussion: id, viaAlias: subject })],
        windowed: true
      }),
      rowsFor(id, "the thread about this page")
    )
    : mark(
      begin(subject, places),
      Consultation.cases.Silence.make({ place: hnLinked, windowed: true })
    )
  for (const place of [recall, redditLinked, xLinked, blueskyLinked, lemmyLinked, lobstersLinked]) {
    knowledge = mark(knowledge, Consultation.cases.Silence.make({ place }))
  }
  return panelOf(readingOf(knowledge), NOW, AGREED)
}

/** A reader who has connected something. Every Digest state below needs one. */
const CONNECTED: Surroundings = {
  ...AGREED,
  provider: { connected: true, name: "your own API key" }
}

const withDigest = (
  digest: Knowledge["digest"],
  around: Surroundings = CONNECTED
): Panel =>
  panelOf(
    readingOf({ ...everyPlace((place) => Consultation.cases.Silence.make({ place })), digest }),
    NOW,
    around
  )

/**
 * A page with one Linked Mention and a Digest in whatever state is being drawn.
 *
 * Built from a real Answered Consultation rather than from a hand-written
 * Knowledge, because the Digest's sources are resolved against the Discussions
 * the panel actually knows about — a Finding whose Citation names a thread
 * nothing described would render its Network's name instead of a title, and
 * that is a different case from the one being tested here.
 */
const withDigestOver = (
  digest: Knowledge["digest"],
  around: Surroundings = CONNECTED
): Panel => {
  const knowledge = fold(
    begin(subject, places),
    Consultation.cases.Answered.make({
      place: hnLinked,
      mentions: [Mention.cases.Linked.make({
        subject,
        discussion: idOf("hackernews", "1"),
        viaAlias: subject
      })]
    }),
    rowsFor(idOf("hackernews", "1"), "the thread about this page")
  )
  const settled = [recall, redditLinked, xLinked, blueskyLinked, lemmyLinked, lobstersLinked].reduce(
    (held, place) => mark(held, Consultation.cases.Silence.make({ place })),
    knowledge
  )
  return panelOf(readingOf({ ...settled, digest }), NOW, around)
}

/**
 * Every state, named the way a reader would describe the situation.
 *
 * The names are the test report, so they are written as the thing that is true
 * of the world rather than as the tag of the value that produced it.
 */
// ---------------------------------------------------------------------------
// The context block's fixtures
// ---------------------------------------------------------------------------

const KEPT = "https://web.archive.org/web/20240101000000/https://example.com/piece"

/** A kept copy whose capture history came back too. */
const keptSince = (clipped = false) =>
  Holding.cases.Found.make({
    record: {
      subject,
      archivedUrl: KEPT,
      snapshotAt: Date.UTC(2024, 0, 1),
      snapshotStatus: "200",
      history: {
        firstCaptureAt: Date.UTC(2019, 4, 2),
        latestCaptureAt: Date.UTC(2024, 0, 1),
        contentChanges: 6,
        clipped
      }
    }
  })

/**
 * A kept copy whose history could NOT be asked for.
 *
 * `history: null` is the routine state, not the corner: the two Archive
 * endpoints fail independently and the history one is the rate-limited one. It
 * means "could not ask" and never "no history", and it has to look different on
 * screen from the case above — see `context.test.ts`.
 */
const keptWithNoHistory = () =>
  Holding.cases.Found.make({
    record: {
      subject,
      archivedUrl: KEPT,
      snapshotAt: Date.UTC(2024, 0, 1),
      snapshotStatus: "200",
      history: null
    }
  })

const citedBy = (bounded: boolean) =>
  BacklinkAnswer.cases.Cited.make({
    reference: "wikipedia",
    backlinks: [
      Backlink.make({
        reference: "wikipedia",
        title: "Open-source artificial intelligence",
        url: "https://en.wikipedia.org/wiki/Open-source_artificial_intelligence",
        matchedUrl: subject
      })
    ],
    ...(bounded ? { bounded: true } : {})
  })

/** A Reading with the two lazy answers folded into its Knowledge. */
const withContext = (
  said: {
    readonly archive?: typeof Holding.Type
    readonly backlinks?: typeof BacklinkAnswer.Type
  }
): Panel =>
  panelOf(
    readingOf({
      ...everyPlace((place) => Consultation.cases.Silence.make({ place })),
      archive: said.archive ?? null,
      backlinks: said.backlinks ?? null
    }),
    NOW,
    AGREED
  )

/**
 * A page on a publisher four named raters have all had something to say about.
 *
 * A real domain out of the shipped artifact rather than a fixture, because the
 * thing under test is that the shipped artifact reaches the panel at all — a
 * hand-written one would pass with the wiring cut.
 */
const RATED = "https://www.breitbart.com/politics/2024/01/01/a-piece/"

const ratedPanel = (): Panel =>
  panelOf(
    {
      address: RATED,
      title: "A piece",
      traversed: [],
      arrival: Arrival.cases.Elsewhere.make({}),
      standing: Standing.cases.Enquiring.make({
        subject: SubjectUrl.make(RATED),
        knowledge: everyPlace((place) => Consultation.cases.Silence.make({ place }))
      }),
      excludedBecause: null
    },
    NOW,
    AGREED
  )

const STATES: ReadonlyArray<readonly [string, Panel]> = [
  [
    "nobody has been asked anything yet",
    panelOf(readingOf(begin(subject, places)), NOW, UNTOLD)
  ],
  [
    "automatic lookups are off",
    panelOf(readingOf(everyPlace((place) =>
      Consultation.cases.Withholding.make({ place, reason: "manual-only" })
    )), NOW, MANUAL)
  ],
  [
    "our own switch is off",
    panelOf(readingOf(everyPlace((place) =>
      Consultation.cases.Withholding.make({ place, reason: "kill-switched" })
    )), NOW, AGREED)
  ],
  [
    "the reader switched every Network off",
    panelOf(
      readingOf(everyPlace((place) =>
        Consultation.cases.Withholding.make({ place, reason: "network-off" })
      )),
      NOW,
      { ...AGREED, networks: NOTHING_ON }
    )
  ],
  [
    "the reader switched one Network off and the rest answered",
    panelOf(
      readingOf(mark(
        mark(
          everyPlace((place) => Consultation.cases.Silence.make({ place })),
          Consultation.cases.Withholding.make({ place: redditLinked, reason: "network-off" })
        ),
        Consultation.cases.Withholding.make({ place: redditLinked, reason: "network-off" })
      )),
      NOW,
      { ...AGREED, networks: { ...everyNetworkOn, reddit: false } }
    )
  ],
  [
    "this page is on the exclusion list, and we know which rule",
    panelOf(
      readingOf(
        everyPlace((place) => Consultation.cases.Withholding.make({ place, reason: "excluded" })),
        "it looks like a bank or a financial account — chase.com is on the built-in list"
      ),
      NOW,
      AGREED
    )
  ],
  [
    "this page is on the exclusion list, and we do not know which rule",
    panelOf(
      readingOf(everyPlace((place) =>
        Consultation.cases.Withholding.make({ place, reason: "excluded" })
      )),
      NOW,
      AGREED
    )
  ],
  [
    "the reader paused this site",
    panelOf(readingOf(everyPlace((place) =>
      Consultation.cases.Withholding.make({ place, reason: "site-paused" })
    )), NOW, AGREED)
  ],
  [
    "we have asked enough for now",
    panelOf(readingOf(everyPlace((place) =>
      Consultation.cases.Withholding.make({ place, reason: "over-budget" })
    )), NOW, AGREED)
  ],
  [
    "this address is no page at all",
    panelOf({
      address: "http://192.168.1.1/admin",
      title: "",
      traversed: [],
  arrival: Arrival.cases.Elsewhere.make({}),
      standing: Standing.cases.Excluded.make({
        reason: "excluded",
        because: "Parle only looks up public web pages, and this address is not one."
      }),
      excludedBecause: null
    }, NOW, AGREED)
  ],
  [
    "nothing has been asked yet on this page",
    panelOf(readingOf(begin(subject, places)), NOW, AGREED)
  ],
  [
    "one is still looking while another has answered",
    panelOf(
      readingOf(mark(
        mark(begin(subject, places), Consultation.cases.Silence.make({ place: hnLinked })),
        Consultation.cases.Asking.make({ place: redditLinked })
      )),
      NOW,
      AGREED
    )
  ],
  [
    "everyone answered and nobody had anything",
    panelOf(
      readingOf(everyPlace((place) => Consultation.cases.Silence.make({ place }))),
      NOW,
      AGREED
    )
  ],
  [
    "nobody would answer at all",
    panelOf(
      readingOf(everyPlace((place) =>
        Consultation.cases.Refusal.make({ place, reason: "rate-limited" })
      )),
      NOW,
      AGREED
    )
  ],
  [
    "Reddit is unavailable because the reader is not signed in",
    panelOf(
      readingOf(mark(
        everyPlace((place) => Consultation.cases.Silence.make({ place })),
        Consultation.cases.Refusal.make({ place: redditLinked, reason: "not-signed-in" })
      )),
      NOW,
      AGREED
    )
  ],
  [
    "Reddit is rate-limiting us",
    panelOf(
      readingOf(mark(
        everyPlace((place) => Consultation.cases.Silence.make({ place })),
        Consultation.cases.Refusal.make({ place: redditLinked, reason: "rate-limited" })
      )),
      NOW,
      AGREED
    )
  ],
  [
    "X is not in this build",
    panelOf(
      readingOf(mark(
        everyPlace((place) => Consultation.cases.Silence.make({ place })),
        Consultation.cases.Withholding.make({ place: xLinked, reason: "compiled-out" })
      )),
      NOW,
      AGREED
    )
  ],
  [
    "X was not asked because nothing links here",
    panelOf(
      readingOf(mark(
        everyPlace((place) => Consultation.cases.Silence.make({ place })),
        Consultation.cases.Withholding.make({ place: xLinked, reason: "awaiting-linked-mention" })
      )),
      NOW,
      AGREED
    )
  ],
  [
    "an answer came back unreadable",
    panelOf(
      readingOf(mark(
        everyPlace((place) => Consultation.cases.Silence.make({ place })),
        Consultation.cases.Garble.make({ place: redditLinked, detail: "an interstitial page" })
      )),
      NOW,
      AGREED
    )
  ],
  ["there are discussions of all three kinds", found()],
  [
    "there is no offline list of already-discussed pages",
    panelOf(readingOf(begin(subject, places)), NOW, AGREED)
  ],
  [
    "the offline list is out of date",
    panelOf(readingOf(begin(subject, places)), NOW, STALE)
  ],
  [
    "the offline list is current",
    panelOf(readingOf(begin(subject, places)), NOW, INDEXED)
  ],
  [
    "no Provider is connected",
    withDigest(DigestStanding.cases.Ready.make({ discussions: 2 }), AGREED)
  ],
  [
    "a Provider is connected and the reader has not asked for a Digest yet",
    withDigestOver(DigestStanding.cases.Ready.make({ discussions: 2 }))
  ],
  [
    "a Provider is connected and nothing links to this page",
    withDigest(DigestStanding.cases.Ready.make({ discussions: 0 }))
  ],
  ["a Digest is being written", withDigest(DigestStanding.cases.Writing.make({}))],
  [
    "the reader's key was rejected",
    withDigest(DigestStanding.cases.Refused.make({
      because: "your own API key rejected the key Parle sent.",
      offer: "connect"
    }))
  ],
  [
    "the account is out of credit",
    withDigest(DigestStanding.cases.Refused.make({
      because: "your own API key says the account cannot pay for this request.",
      offer: "connect"
    }))
  ],
  [
    "the Provider asked us to slow down",
    withDigest(DigestStanding.cases.Refused.make({
      because: "your own API key asked us to slow down.",
      offer: "again"
    }))
  ],
  [
    "the model answered unusably",
    withDigest(DigestStanding.cases.Refused.make({
      because:
        "your own API key answered, but nothing it wrote pointed at a comment Parle had actually read.",
      offer: "again"
    }))
  ],
  [
    "no comments could be read, so nothing was sent anywhere",
    withDigest(DigestStanding.cases.Refused.make({
      because: "Parle could not read the comments of any of these discussions.",
      offer: "again"
    }))
  ],
  [
    "a Digest has been written",
    withDigestOver(DigestStanding.cases.Written.make({
      origin: DigestOrigin.cases.Local.make({ providerId: "byok", model: "gpt-4o-mini" }),
      completeness: "complete",
      findings: [
        {
          statement: "Most commenters read it as a licensing change rather than a technical one.",
          contested: false,
          citations: [
            Citation.make({ discussion: idOf("hackernews", "1"), comment: "1201" })
          ]
        }
      ]
    }))
  ],
  [
    "a Digest reports a claim as disputed",
    withDigestOver(DigestStanding.cases.Written.make({
      origin: DigestOrigin.cases.Local.make({ providerId: "byok", model: "gpt-4o-mini" }),
      completeness: "complete",
      findings: [
        {
          statement: "Several commenters said the benchmark was run on the wrong hardware.",
          contested: true,
          citations: [
            Citation.make({ discussion: idOf("hackernews", "1"), comment: "1202" })
          ]
        }
      ]
    }))
  ],
  [
    "a Network had more here than Parle reads in one go",
    windowedPanel(true)
  ],
  [
    "a Network filled the window and none of it was this page",
    windowedPanel(false)
  ],
  /**
   * The context block, one state at a time.
   *
   * Every one of these is a state the Archive or Wikipedia can really leave the
   * panel in, and each is here for the two checks this list feeds: that it draws
   * words rather than nothing, and that none of those words is a term out of
   * `CONTEXT.md` that was never meant to reach a reader. The distinctions
   * between them — a kept copy with a history against one whose history could not
   * be asked for — are asserted in `context.test.ts`, which is about meaning
   * rather than about coverage.
   */
  [
    "the Archive has a kept copy and knows how often it changed",
    withContext({ archive: keptSince() })
  ],
  [
    "the Archive has a kept copy and could not be asked how often it changed",
    withContext({ archive: keptWithNoHistory() })
  ],
  [
    "the Archive has never kept a copy of this page",
    withContext({ archive: Holding.cases.NothingArchived.make({}) })
  ],
  [
    "the Archive could not be asked",
    withContext({ archive: Holding.cases.CouldNotAsk.make({ reason: "rate-limited" }) })
  ],
  [
    "the Archive answered unreadably",
    withContext({ archive: Holding.cases.Garbled.make({ detail: "an interstitial page" }) })
  ],
  [
    "Wikipedia cites this page",
    withContext({ backlinks: citedBy(false) })
  ],
  [
    "Wikipedia cites this page in more articles than Parle read",
    withContext({ backlinks: citedBy(true) })
  ],
  [
    "no Wikipedia article cites this page",
    withContext({
      backlinks: BacklinkAnswer.cases.Uncited.make({ reference: "wikipedia" })
    })
  ],
  [
    "no Wikipedia article cites this page, in the ones Parle read",
    withContext({
      backlinks: BacklinkAnswer.cases.Uncited.make({ reference: "wikipedia", bounded: true })
    })
  ],
  [
    "Wikipedia could not be asked",
    withContext({
      backlinks: BacklinkAnswer.cases.CouldNotAsk.make({
        reference: "wikipedia",
        reason: "offline"
      })
    })
  ],
  [
    "Wikipedia answered unreadably",
    withContext({
      backlinks: BacklinkAnswer.cases.Garbled.make({
        reference: "wikipedia",
        detail: "an error envelope"
      })
    })
  ],
  ["named raters have rated this page's publisher", ratedPanel()],
  [
    "the model died mid-answer and what arrived was kept",
    withDigestOver(DigestStanding.cases.Written.make({
      origin: DigestOrigin.cases.Local.make({ providerId: "on-device", model: "gemini-nano" }),
      completeness: "partial",
      findings: [
        {
          statement: "Several commenters said the benchmark was run on the wrong hardware.",
          contested: true,
          citations: [
            Citation.make({ discussion: idOf("hackernews", "1"), comment: "1202" })
          ]
        }
      ]
    }))
  ]
]

let root: Fake
let done: Array<string>

const acts = (): Acts => ({
  openOut: (address) => done.push(`openOut:${address}`),
  lookAnyway: () => done.push("lookAnyway"),
  summarise: () => done.push("summarise"),
  readDiscussion: (key: string) => done.push(`readDiscussion:${key}`),
  decide: (automatic) => done.push(`decide:${automatic}`),
  openDisclosure: () => done.push("openDisclosure"),
  openSettings: () => done.push("openSettings"),
  pauseSite: (host) => done.push(`pauseSite:${host}`),
  resumeSite: (host) => done.push(`resumeSite:${host}`)
})

/** The page surface: the Discussions themselves, inside the mark's shadow root. */
const draw = (panel: Panel): Fake => {
  render(root as unknown as HTMLElement, panel, acts())
  return root
}

/** The toolbar surface: what happened, and why, on every page there is. */
const status = (panel: Panel): Fake => {
  renderStatus(root as unknown as HTMLElement, panel, acts())
  return root
}

const SURFACES: ReadonlyArray<readonly [string, (panel: Panel) => Fake]> = [
  ["the page surface", draw],
  ["the toolbar surface", status]
]

beforeEach(() => {
  root = mountDouble()
  done = []
  resetViewState()
})

describe("every state puts something on the screen", () => {
  for (const [surface, onto] of SURFACES) {
    for (const [name, panel] of STATES) {
      it(`${surface}: ${name}`, () => {
        const drawn = onto(panel)
        // Toolbar still draws the heading; the page surface is comments-first
        // and may not. Strip those when present so emptiness is about state.
        const text = drawn.textContent
          .split(panel.heading).join(" ")
          .split(panel.address).join(" ")
        expect(text.trim().length).toBeGreaterThan(0)
      })
    }
  }
})

/**
 * `CONTEXT.md`, binding: Discussion, Digest, Finding, Spread, Provider, Standing
 * and Archive are the reader-facing terms. Everything else in that file is how the code talks
 * about itself.
 *
 * Matched case-insensitively and as whole words, so `Coverage` and `coverage`
 * both fail and `discovered` does not trip `Coverage`. Two entries deserve a
 * note: `mention` is banned even though English has the word, because in this
 * product it is a term of art with three tiers and using it loosely is exactly
 * the confusion the three separate arrays exist to prevent; and `subject` is
 * banned for the same reason, which is why the weakest tier's heading reads
 * "On this topic".
 */
const NEVER = [
  "subject",
  "alias",
  "enquiry",
  "mention",
  "observation",
  "movement",
  "coverage",
  "consultation",
  "silence",
  "refusal",
  "withholding",
  "withheld",
  "garble",
  "garbled",
  "harvest",
  "brief",
  "citation",
  "watermark",
  "prefilter",
  /**
   * The `_Avoid_` lists of the two terms `CONTEXT.md` added for enrichment.
   *
   * `Archive` is the Internet Archive's holdings, said in those words; "wayback"
   * and "snapshot" are what the API calls them and what a reader would not.
   * `Backlink` is engineering vocabulary outright — a Backlink is not a Mention
   * and the panel says "Cited by Wikipedia", which is a proper noun and plain
   * English.
   */
  "backlink",
  "backlinks",
  "wayback",
  "snapshot",
  /**
   * Standing's `_Avoid_` list, the same way. Parle's voice says "Standing" and
   * repeats what named raters said with their name attached; it never rates,
   * scores or grades anyone itself. A rater's own product name or verbatim
   * words are a quotation — none of the shipped attributions contains these
   * words, and one that did would deserve the red so a human can decide.
   */
  "rating",
  "ratings",
  "score",
  "scores",
  "bias rating",
  "credibility",
  "trust",
  "trusted",
  /**
   * Banned in either case, unlike the entries below.
   *
   * `Exclusion List` is a `CONTEXT.md` term, and capitalising it was the only
   * thing this check was catching — the panel said "this page is on the
   * exclusion list" in lower case and passed. The settings page had already
   * settled on the reader's words for the same thing ("a built-in list of
   * places to skip", "the skip list"), so the panel was also the odd one out.
   */
  "exclusion list"
]

/**
 * Terms that are ordinary English in lower case and vocabulary in upper.
 *
 * "automatic lookups" is the wording the research settled on for the reader and
 * appears in the disclosure verbatim; a `Lookup` is the unit of work and belongs
 * only in the code. "the page you are reading" is likewise the approved
 * sentence, while a `Reading` is a tab's stance; "an address on a private
 * network" is what a person would say, while a `Network` is Hacker News, Reddit
 * or X. Each pair is a real distinction, so the test keeps it rather than
 * banning the English word and forcing worse prose.
 */
const NEVER_CAPITALISED = [
  "Lookup",
  "Lookups",
  "Place",
  "Places",
  "Reading",
  "Network",
  "Networks",
  "Exclusion List",
  "Discussion Index",
  "Local Discussion Cache"
]

describe("no engineering vocabulary reaches the reader", () => {
  for (const [surface, onto] of SURFACES) {
    for (const [name, panel] of STATES) {
      it(`${surface}: ${name}`, () => {
        const drawn = onto(panel)
        // Digests live in their own destination on the page surface — open it so the
        // check still covers that prose when a Linked room would otherwise hide it.
        if (surface === "page") drawn.labelled("Digest")?.click()
        const text = drawn.textContent
        // The address is the reader's own URL and can contain anything; it is
        // drawn verbatim by design and is not our prose.
        const prose = text.split(panel.address).join(" ")
        for (const term of NEVER) {
          expect(prose, `"${term}" reached the reader`).not.toMatch(
            new RegExp(`\\b${term}\\b`, "i")
          )
        }
        for (const term of NEVER_CAPITALISED) {
          expect(prose, `"${term}" reached the reader`).not.toContain(term)
        }
      })
    }
  }

  it("checks the whole subtree and not just the top of it", () => {
    // A guard on the guard: if `textContent` stopped descending, every case
    // above would pass by drawing nothing at all. Passing rows still carry
    // titles; the open Linked room no longer repeats the page's own thread.
    expect(draw(found()).textContent).toContain("someone linked it here")
    expect(status(found()).textContent).toContain("Where Parle asked")
  })

  it("checks accessible names and tooltips as well as visible prose", () => {
    const drawn = draw(found())
    const labels = drawn.all().flatMap((node) => [
      node.getAttribute("aria-label") ?? "",
      node.className.includes("parle-thread-pick") ? "" : node.title
    ]).join(" ")
    for (const term of NEVER) {
      expect(labels, `"${term}" reached an accessible label`).not.toMatch(
        new RegExp(`\\b${term}\\b`, "i")
      )
    }
    for (const term of NEVER_CAPITALISED) {
      expect(labels, `"${term}" reached an accessible label`).not.toContain(term)
    }
  })
})

/**
 * The split between the two surfaces, asserted rather than assumed.
 *
 * The mark appears only where there is something to read, so the page surface
 * opens straight into the conversations; everything about *us* — what refused,
 * what was not asked and why, and the switch that decides it — is one click
 * away on the toolbar, which is reachable on every page including the ones
 * nothing was ever injected into.
 */
describe("what each surface is for", () => {
  it("gives the page surface the discussions and not the account", () => {
    const drawn = draw(found())
    expect(drawn.withClass("parle-row").length).toBeGreaterThan(0)
    expect(drawn.textContent).not.toContain("Where Parle asked")
  })

  it("puts Networks on compact adaptive navigation with iOS-style count badges", () => {
    // `found()` has a Linked HN thread and a Passing Reddit mention — only
    // Linked Networks get a nav icon. The open room starts on the loudest.
    const drawn = draw(found())
    const items = drawn.withClass("parle-nav-item")
      .filter((item) => item.getAttribute("data-network") !== null)
    expect(items).toHaveLength(1)
    expect(items[0]?.getAttribute("data-network")).toBe("hackernews")
    expect(drawn.withClass("parle-tab-mark").length).toBeGreaterThan(0)
    expect(drawn.withClass("parle-nav-badge")[0]?.textContent).toBe("3")
    expect(
      drawn.withClass("parle-nav-icon")
        .some((icon) => icon.withClass("parle-nav-badge").length === 1)
    ).toBe(true)
    expect(drawn.withClass("parle-room")[0]?.getAttribute("data-network")).toBe("hackernews")
    // The Discussion title is useful context; page and Network chrome stay out.
    expect(drawn.textContent).not.toContain("A piece")
    expect(drawn.textContent).toContain("the thread about this page")
    expect(drawn.textContent).not.toContain("Hacker News")
    expect(drawn.textContent).not.toContain("points")
    expect(drawn.withClass("parle-nav-brand")).toHaveLength(0)
    expect(drawn.labelled("Open discussion")).toBeDefined()
    expect(drawn.withClass("parle-nav-pause")).toHaveLength(0)
    expect(drawn.textContent).not.toContain("Pause on example.com")
    drawn.labelled("More actions")?.click()
    expect(drawn.textContent).toContain("Pause on example.com")
    expect(drawn.labelled("Pause on example.com")).toBeDefined()
    expect(drawn.labelled("Settings")).toBeDefined()
  })

  it("switches Network rooms without repeating that Network in visible chrome", () => {
    const panel = found()
    const hn = panel.linked[0]!
    const dual: Panel = {
      ...panel,
      linked: [
        hn,
        {
          ...hn,
          key: "reddit-abc",
          network: "reddit",
          networkName: "Reddit",
          place: "science",
          title: "someone linked it here",
          permalink: "https://www.reddit.com/comments/abc",
          commentCount: 40,
          score: 120
        }
      ]
    }
    const drawn = draw(dual)
    const redditTab = drawn.withClass("parle-nav-item")
      .find((tab) => tab.getAttribute("data-network") === "reddit")
    expect(redditTab).toBeDefined()
    redditTab?.click()
    expect(drawn.withClass("parle-room")[0]?.getAttribute("data-network")).toBe("reddit")
    expect(drawn.withClass("parle-home")[0]?.getAttribute("data-network")).toBe("reddit")
    const home = drawn.withClass("parle-home")[0]
    expect(home?.textContent).not.toContain("Reddit")
    expect(home?.textContent).not.toContain("upvotes")
  })

  it("offers a compact thread picker when one Network has several Linked threads", () => {
    const panel = found()
    const hn = panel.linked[0]!
    const dual: Panel = {
      ...panel,
      linked: [
        {
          ...hn,
          key: "reddit-science",
          network: "reddit",
          networkName: "Reddit",
          place: "science",
          title: "in science",
          permalink: "https://www.reddit.com/r/science/comments/aaa",
          commentCount: 200,
          score: 1000
        },
        {
          ...hn,
          key: "reddit-ml",
          network: "reddit",
          networkName: "Reddit",
          place: "MachineLearning",
          title: "in ML",
          permalink: "https://www.reddit.com/r/MachineLearning/comments/bbb",
          commentCount: 40,
          score: 120
        }
      ]
    }
    const drawn = draw(dual)
    const picks = drawn.withClass("parle-thread-pick").map((node) => node.textContent)
    expect(picks).toContain("r/science")
    expect(picks).toContain("r/MachineLearning")
  })

  it("writes X authors as handles inside an open X conversation", () => {
    const panel = found()
    const hn = panel.linked[0]!
    const drawn = draw({
      ...panel,
      linked: [
        {
          ...hn,
          key: "x-thread",
          network: "x",
          networkName: "X",
          place: null,
          title: "the preprint just dropped",
          permalink: "https://x.com/physicshq/status/1",
          commentCount: 12,
          score: 40,
          comments: {
            _tag: "Read",
            beyond: 0,
            comments: [
              {
                id: "1",
                parentId: null,
                depth: 0,
                author: "physicshq",
                text: "Reading now.",
                age: "1h"
              }
            ]
          }
        }
      ]
    })
    expect(
      drawn.withClass("parle-nav-item").some((tab) => tab.getAttribute("data-network") === "x")
    ).toBe(true)
    expect(drawn.withClass("parle-comment-who")[0]?.textContent).toContain("@physicshq")
  })

  it("gives every Network its own destination, disc and room", () => {
    // Six Networks, six nav items, six rooms — and the room that opens is the
    // one whose icon was clicked. A Network that reached the panel with no
    // drawing for it renders as a gap the reader cannot get into, which is the
    // shape the three added last would have failed in.
    const panel = found()
    const hn = panel.linked[0]!
    const drawn = draw({
      ...panel,
      linked: NETWORKS_IN_ORDER.map((network, index) => ({
        ...hn,
        key: `${network}-1`,
        network,
        networkName: NAMES[network],
        place: null,
        title: `the ${network} thread`,
        permalink: `https://example.invalid/${network}`,
        commentCount: 10 + index,
        score: 20 + index
      }))
    })

    const items = drawn.withClass("parle-nav-item")
      .filter((item) => item.getAttribute("data-network") !== null)
    expect(items.map((item) => item.getAttribute("data-network"))).toEqual([...NETWORKS_IN_ORDER])
    // A disc per destination, each built rather than blank.
    expect(drawn.withClass("parle-tab-mark")).toHaveLength(6)
    for (const mark of drawn.withClass("parle-tab-mark")) {
      expect(mark.children.length).toBeGreaterThan(0)
    }
    for (const network of NETWORKS_IN_ORDER) {
      drawn.withClass("parle-nav-item")
        .find((item) => item.getAttribute("data-network") === network)
        ?.click()
      expect(drawn.withClass("parle-room")[0]?.getAttribute("data-network")).toBe(network)
      expect(drawn.withClass("parle-room")[0]?.textContent).toContain(`the ${network} thread`)
    }
  })

  it("writes a Lemmy venue whole, because the instance half is what disambiguates it", () => {
    // `technology` is two different rooms on two instances, so the venue
    // arrives as `name@instance` and is already complete. Reddit's `r/` in
    // front of it would name a place on neither site.
    const panel = found()
    const hn = panel.linked[0]!
    const drawn = draw({
      ...panel,
      linked: [
        {
          ...hn,
          key: "lemmy-a",
          network: "lemmy",
          networkName: "Lemmy",
          place: "fosai@lemmy.world",
          title: "in fosai",
          permalink: "https://lemmy.world/post/1",
          commentCount: 30,
          score: 90
        },
        {
          ...hn,
          key: "lemmy-b",
          network: "lemmy",
          networkName: "Lemmy",
          place: "technology@lemmy.ml",
          title: "in technology",
          permalink: "https://lemmy.ml/post/2",
          commentCount: 8,
          score: 12
        }
      ]
    })
    const picks = drawn.withClass("parle-thread-pick").map((node) => node.textContent)
    expect(picks).toContain("fosai@lemmy.world")
    expect(picks).toContain("technology@lemmy.ml")
    expect(picks).not.toContain("r/fosai@lemmy.world")
  })

  it("tells two venueless threads apart by title, on Bluesky and Lobsters alike", () => {
    // Neither Network has a place a reader names — Lobsters' tags are labels on
    // a story, not a room — so `place` is null and the picker falls back to
    // titles exactly as it does on Hacker News. A blank chip would be two
    // conversations the reader cannot choose between.
    const panel = found()
    const hn = panel.linked[0]!
    for (const network of ["bluesky", "lobsters"] as const) {
      // Each pass is a fresh surface: the destination the reader last chose is
      // remembered per Subject, and a leftover choice for a Network this panel
      // has no rows for would draw no room at all.
      resetViewState()
      const drawn = draw({
        ...panel,
        linked: [
          {
            ...hn,
            key: `${network}-a`,
            network,
            networkName: NAMES[network],
            place: null,
            title: "the first conversation",
            permalink: `https://example.invalid/${network}/a`,
            commentCount: 30,
            score: 90
          },
          {
            ...hn,
            key: `${network}-b`,
            network,
            networkName: NAMES[network],
            place: null,
            title: "the second conversation",
            permalink: `https://example.invalid/${network}/b`,
            commentCount: 8,
            score: 12
          }
        ]
      })
      const picks = drawn.withClass("parle-thread-pick").map((node) => node.textContent)
      expect(picks).toContain("the first conversation")
      expect(picks).toContain("the second conversation")
      expect(picks.every((label) => label !== "")).toBe(true)
      // And the destination they hang under is drawn, disc and all: a Network
      // with no glyph of its own puts an empty span in the nav, which reads as
      // a dead button rather than as a missing Network.
      const mark = drawn.withClass(`parle-tab-mark-${network}`)[0]
      expect(mark).toBeDefined()
      expect(mark?.children.length).toBeGreaterThan(0)
    }
  })

  it("uses each Network's own word for its numbers on a Passing row", () => {
    // The Passing list is where the facts line is drawn, and each Network's
    // wording is the one its own readers use: points on Hacker News and
    // Lobsters, upvotes on Reddit and Lemmy, likes on X and Bluesky. A Network
    // that fell through to another's wording would report likes as points.
    const panel = found()
    const passing = panel.passing[0]!
    for (const [network, word] of NUMBER_WORDS) {
      resetViewState()
      const drawn = draw({
        ...panel,
        linked: [],
        passing: [{
          ...passing,
          key: `${network}-p`,
          network,
          networkName: NAMES[network],
          place: null,
          title: "somebody pasted it",
          score: 42,
          commentCount: 3
        }]
      })
      expect(drawn.textContent).toContain(`42 ${word}`)
    }
  })

  it("says a windowed answer is a floor, whichever Network it came from", () => {
    // ADR 0005: a filled retrieval window is reported as "at least N", never as
    // a total. Lobsters reads a page of 25 and cannot see past it, so this is
    // its ordinary case rather than an edge one — and the sentence has to reach
    // the reader through the same path Hacker News' does.
    const id = DiscussionId.make({ network: "lobsters", nativeId: NativeId.make("abc") })
    let knowledge = fold(
      begin(subject, places),
      Consultation.cases.Answered.make({
        place: lobstersLinked,
        mentions: [Mention.cases.Linked.make({ subject, discussion: id, viaAlias: subject })],
        windowed: true
      }),
      rowsFor(id, "the thread about this page")
    )
    for (const place of [recall, hnLinked, redditLinked, xLinked, blueskyLinked, lemmyLinked]) {
      knowledge = mark(knowledge, Consultation.cases.Silence.make({ place }))
    }
    const drawn = status(panelOf(readingOf(knowledge), NOW, AGREED))
    expect(drawn.textContent).toContain("at least")
    expect(drawn.textContent).toContain("Lobsters")
  })

  it("keeps the two tiers apart on the page surface, in words and in class", () => {
    // A domain rule rather than a style choice: a Linked Mention says this
    // conversation is about this page, and a Passing one says only that someone
    // pasted the address into a conversation about something else. One list
    // would promote the weaker claim. The third tier this used to check,
    // Topical, was deleted rather than reworded.
    const drawn = draw(found())
    expect(drawn.withClass("parle-group-linked")).toHaveLength(1)
    expect(drawn.withClass("parle-group-passing")).toHaveLength(1)
    expect(drawn.withClass("parle-group-topical")).toHaveLength(0)
    const text = drawn.textContent
    // Passing still states its weaker claim in words; Linked is the bottom nav.
    expect(text).toContain("Came up elsewhere")
    expect(text).toContain("linked inside a conversation about something else")
    expect(text).not.toContain("About this page")
    expect(text).not.toContain("On this topic")
    expect(text).not.toContain("not provably this page")
  })

  it("gives the toolbar surface the account and not the discussions", () => {
    const drawn = status(found())
    expect(drawn.withClass("parle-row")).toHaveLength(0)
    expect(drawn.textContent).toContain("Where Parle asked")
    // It still says how much there is, so the toolbar is never a dead end.
    expect(drawn.textContent).toContain("2 discussions on this page")
  })

  it("accounts for every place, at every moment, in the reader's words", () => {
    // ADR 0011: each degraded capability is a state with words, and the words
    // have to be specific. All six of these are one Place's standing on one
    // frame, and no two of them read alike.
    const said = (name: string): string => {
      const [, panel] = STATES.find(([held]) => held === name)!
      return status(panel).textContent
    }
    expect(said("Reddit is unavailable because the reader is not signed in"))
      .toContain("you are not signed in")
    expect(said("Reddit is rate-limiting us")).toContain("rate-limiting us")
    expect(said("an answer came back unreadable")).toContain("an interstitial page")
    expect(said("X is not in this build")).toContain("not in this build")
    expect(said("X was not asked because nothing links here")).toContain("nothing links here yet")
    expect(said("everyone answered and nobody had anything")).toContain("nothing")
  })
})

describe("the way out of a restraint", () => {
  it("offers one click to look an excluded page up anyway", () => {
    const [, panel] = STATES.find(([name]) => name.startsWith("this page is on the exclusion list, and we know"))!
    const drawn = status(panel)
    const act = drawn.withClass("parle-act")[0]
    expect(act?.textContent).toBe("Look it up anyway")
    act?.click()
    expect(done).toContain("lookAnyway")
  })

  it("names the rule that excluded it, in the reader's words", () => {
    const [, panel] = STATES.find(([name]) => name.startsWith("this page is on the exclusion list, and we know"))!
    expect(status(panel).textContent).toContain("chase.com is on the built-in list")
  })

  it("sends a reader who switched every Network off to the switches, not to a dead button", () => {
    // ADR 0014: a Network switched off stays off even for an explicit Ask, so
    // `LookupPolicy` checks `killSwitched` before it looks at whose initiative
    // it was. "Look it up anyway" was therefore a button that did nothing on
    // the one page it could appear on.
    const [, panel] = STATES.find(([name]) => name === "the reader switched every Network off")!
    const drawn = status(panel)
    const act = drawn.withClass("parle-act")[0]
    expect(act?.textContent).toBe("Choose where Parle looks")
    act?.click()
    expect(done).toEqual(["openSettings"])
  })

  it("does not tell a reader that their own switches were not their doing", () => {
    const [, theirs] = STATES.find(([name]) => name === "the reader switched every Network off")!
    expect(status(theirs).textContent).not.toContain("not something you did")

    // And the sentence is still there for the case it is actually true of.
    const [, ours] = STATES.find(([name]) => name === "our own switch is off")!
    expect(status(ours).textContent).toContain("not something you did")
  })

  it("offers no false hope on an address that is not a page", () => {
    // There is nothing for anyone to have discussed at `192.168.1.1`, so a
    // button offering to go and look would be a lie with a click target.
    const [, panel] = STATES.find(([name]) => name === "this address is no page at all")!
    expect(status(panel).withClass("parle-act")).toHaveLength(0)
  })

  it("sends a first-run reader to the disclosure rather than to a lookup", () => {
    const [, panel] = STATES.find(([name]) => name === "nobody has been asked anything yet")!
    const drawn = status(panel)
    drawn.withClass("parle-act")[0]?.click()
    expect(done).toEqual(["openDisclosure"])
    // And no switch to flip until they have read it.
    expect(drawn.withClass("parle-footer")).toHaveLength(0)
  })

  it("lets a reader with automatic lookups off ask about this one page", () => {
    const [, panel] = STATES.find(([name]) => name === "automatic lookups are off")!
    const drawn = status(panel)
    expect(drawn.withClass("parle-act")[0]?.textContent).toBe("Look this page up")
    expect(drawn.textContent).toContain("Automatic lookups are off")
  })

  it("still says why on the page surface, if a frame ever gets there", () => {
    // The mark is not offered on a page that was held back, so this is a state
    // the page surface should never be sitting in. It draws the reason anyway,
    // because "should never happen" is not a thing to render blank.
    const [, panel] = STATES.find(([name]) => name === "the reader paused this site")!
    expect(draw(panel).textContent).toContain("You paused Parle on example.com")
  })
})

describe("the switch", () => {
  it("says which way it is set, and turns the other way", () => {
    const on = status(found())
    expect(on.textContent).toContain("Looking pages up automatically")
    on.labelled("Turn off")?.click()
    expect(done).toContain("decide:false")
  })

  it("reads the other way round when lookups are manual", () => {
    const [, panel] = STATES.find(([name]) => name === "automatic lookups are off")!
    const off = status(panel)
    expect(off.textContent).toContain("Only when you ask")
    off.labelled("Turn on")?.click()
    expect(done).toContain("decide:true")
  })

  it("is on the surface that is reachable on every page, and only there", () => {
    // The page surface exists on pages that have Discussions, which is a small
    // minority of them. A switch that lives only there is one a reader cannot
    // find on the page they want to switch it off from.
    expect(draw(found()).labelled("Turn off")).toBeUndefined()
    expect(status(found()).labelled("Turn off")).toBeDefined()
  })

  it("offers the per-site pause from both, because that is where the moment is", () => {
    expect(draw(found()).labelled("Pause on example.com")).toBeDefined()
    expect(status(found()).labelled("Pause on example.com")).toBeDefined()
    const drawn = draw(found())
    done = []
    drawn.labelled("More actions")?.click()
    drawn.labelled("Pause on example.com")?.click()
    expect(done).toEqual(["pauseSite:example.com"])
  })

  it("offers no pause on an address that is not a site the reader browses", () => {
    // `chrome-extension://…` parses, and its hostname is our own id — which is
    // how the toolbar came to offer to pause Parle on a 32-character string
    // while looking at one of our own pages.
    const [, panel] = STATES.find(([name]) => name === "this address is no page at all")!
    const ours: Panel = { ...panel, address: "chrome-extension://abcdef/popup.html" }
    expect(status(ours).textContent).not.toContain("Pause on")
    // And the one it is really about still gets it.
    expect(status(panel).labelled("Pause on 192.168.1.1")).toBeDefined()
  })
})

describe("the two empty panels that mean opposite things", () => {
  it("says nobody discussed it only when somebody actually answered", () => {
    const [, quiet] = STATES.find(([name]) => name === "everyone answered and nobody had anything")!
    expect(status(quiet).textContent).toContain("Nobody has discussed this page")
  })

  it("says we could not find out when nobody answered", () => {
    const [, blind] = STATES.find(([name]) => name === "nobody would answer at all")!
    const text = status(blind).textContent
    expect(text).toContain("could not find out")
    expect(text).not.toContain("Nobody has discussed this page")
  })

  it("keeps them apart on the page surface too", () => {
    const [, quiet] = STATES.find(([name]) => name === "everyone answered and nobody had anything")!
    const [, blind] = STATES.find(([name]) => name === "nobody would answer at all")!
    expect(draw(quiet).textContent).toContain("Nobody has discussed this page")
    const text = draw(blind).textContent
    expect(text).toContain("could not find out")
    expect(text).not.toContain("Nobody has discussed this page")
  })
})

describe("the offline list of already-discussed pages", () => {
  it("says an absent one means every page you open is asked about", () => {
    const [, panel] = STATES.find(([name]) =>
      name === "there is no offline list of already-discussed pages"
    )!
    expect(status(panel).textContent).toContain("about every page you open")
  })

  it("says an out-of-date one costs speed and not results", () => {
    const [, panel] = STATES.find(([name]) => name === "the offline list is out of date")!
    const text = status(panel).textContent
    expect(text).toContain("out of date")
    expect(text).toContain("Nothing is missed because of it")
  })

  it("says nothing at all when it is current", () => {
    const [, panel] = STATES.find(([name]) => name === "the offline list is current")!
    const text = status(panel).textContent
    expect(text).not.toContain("out of date")
    expect(text).not.toContain("about every page you open")
  })
})

/**
 * One page, submitted five times, drawn as one conversation.
 *
 * The fact of the reposts is kept — it is true, and a page that went round five
 * times had something happen to it — but it is a clause on the row that
 * survived rather than four rows of its own.
 */
describe("repeat submissions", () => {
  const repeated = (): Panel => {
    const panel = found()
    const first = panel.linked[0]!
    return { ...panel, linked: [{ ...first, alsoSubmitted: 4 }] }
  }

  it("says it happened, quietly, on the row that survived", () => {
    const drawn = draw(repeated())
    expect(drawn.withClass("parle-repeat")[0]?.textContent).toBe("also submitted 4 times")
    // Linked rooms no longer draw a titled row — only Passing still does.
    expect(drawn.withClass("parle-row")).toHaveLength(1)
    expect(drawn.withClass("parle-group-passing")).toHaveLength(1)
  })

  it("counts once as once", () => {
    const panel = repeated()
    const only = panel.linked[0]!
    const drawn = draw({ ...panel, linked: [{ ...only, alsoSubmitted: 1 }] })
    expect(drawn.withClass("parle-repeat")[0]?.textContent).toBe("also submitted once")
  })

  it("says nothing at all when a page was submitted once", () => {
    expect(draw(found()).withClass("parle-repeat")).toHaveLength(0)
  })
})

describe("reading a comment tree in a narrow panel", () => {
  const withComments = (
    key: string,
    comments: NonNullable<Panel["linked"][number]["comments"]> & { readonly _tag: "Read" }
  ): Panel => {
    const panel = found()
    const first = panel.linked[0]!
    return {
      ...panel,
      passing: [],
      linked: [{ ...first, key, commentCount: comments.comments.length + comments.beyond, comments }]
    }
  }

  const tree = (key: string): Panel => withComments(key, {
    _tag: "Read",
    beyond: 0,
    comments: [
      { id: "root", parentId: null, depth: 0, author: "ada", age: "", text: "Top-level point" },
      { id: "other", parentId: null, depth: 0, author: "lin", age: "", text: "Another top-level point" },
      { id: "child", parentId: "root", depth: 1, author: "grace", age: "", text: "A direct reply" },
      { id: "grand", parentId: "child", depth: 2, author: "alan", age: "", text: "A deeper reply" },
      { id: "deep", parentId: "grand", depth: 3, author: "margaret", age: "", text: "At the panel limit" },
      { id: "ultra", parentId: "deep", depth: 4, author: "donald", age: "", text: "Only on the original discussion" }
    ]
  })

  it("starts with top-level comments and keeps replies counted but collapsed", () => {
    const drawn = draw(tree("nested-default"))
    expect(drawn.textContent).toContain("Top-level point")
    expect(drawn.textContent).toContain("Another top-level point")
    expect(drawn.textContent).not.toContain("A direct reply")
    expect(drawn.labelled("4 replies")).toBeDefined()
  })

  it("opens one branch at a time and sends depth beyond the panel to the Discussion", () => {
    const panel = tree("nested-branch")
    const drawn = draw(panel)
    drawn.labelled("4 replies")?.click()
    expect(drawn.textContent).toContain("A direct reply")
    expect(drawn.textContent).not.toContain("A deeper reply")
    drawn.labelled("3 replies")?.click()
    drawn.labelled("2 replies")?.click()
    drawn.labelled("1 reply")?.click()
    expect(drawn.textContent).toContain("At the panel limit")
    expect(drawn.textContent).not.toContain("Only on the original discussion")
    drawn.labelled("Continue this reply on the discussion")?.click()
    expect(done).toContain(`openOut:${panel.linked[0]?.permalink}`)
  })

  it("can flatten the comments without losing any authors or words", () => {
    const drawn = draw(tree("nested-flat"))
    drawn.labelled("Nested")?.click()
    expect(drawn.textContent).toContain("A direct reply")
    expect(drawn.textContent).toContain("Only on the original discussion")
    expect(drawn.labelled("Flat")).toBeDefined()
    expect(drawn.withClass("parle-replies")).toHaveLength(0)
  })

  it("collapses every open branch from one control", () => {
    const drawn = draw(tree("nested-collapse"))
    drawn.labelled("4 replies")?.click()
    expect(drawn.textContent).toContain("A direct reply")
    drawn.labelled("Collapse all")?.click()
    expect(drawn.textContent).not.toContain("A direct reply")
    expect(drawn.labelled("4 replies")).toBeDefined()
  })

  it("caps the top level and discloses the exact remainder", () => {
    const comments = Array.from({ length: 10 }, (_, index) => ({
      id: `root-${index}`,
      parentId: null,
      depth: 0,
      author: `reader-${index}`,
      age: "",
      text: `Top-level ${index}`
    }))
    const panel = withComments("nested-capped", { _tag: "Read", comments, beyond: 3 })
    const drawn = draw(panel)
    expect(drawn.textContent).toContain("Top-level 7")
    expect(drawn.textContent).not.toContain("Top-level 8")
    drawn.labelled("Open 5 more on the discussion")?.click()
    expect(done).toContain(`openOut:${panel.linked[0]?.permalink}`)
  })
})

/**
 * The Digest, as a reader meets it.
 *
 * Four properties, each one a promise made somewhere other than in the code:
 * ADR 0004 makes the absence of AI ordinary, ADR 0006 makes every Finding
 * checkable and requires the disputed mark not to read as a verdict, and the
 * disclosure model requires the reader to be told what asking will fetch and
 * where it will go BEFORE they ask.
 */
describe("the Digest", () => {
  const stateNamed = (name: string): Panel => {
    const found = STATES.find(([held]) => held === name)
    if (found === undefined) throw new Error(`no state named ${name}`)
    return found[1]
  }

  /** Digests live in the Digest nav destination. */
  const openSummary = (drawn: ReturnType<typeof draw>): void => {
    drawn.labelled("Digest")?.click()
  }

  it("says no Provider is connected as an offer, not as a failure", () => {
    const drawn = draw(stateNamed("no Provider is connected"))
    openSummary(drawn)
    const text = drawn.textContent
    expect(text).toContain("No Provider connected")
    // The words that would make it read as something broken.
    expect(text).not.toMatch(/error|failed|unavailable/i)
    expect(drawn.labelled("Connect a Provider")).toBeDefined()
  })

  it("sends a reader with nothing connected to the settings page", () => {
    const drawn = draw(stateNamed("no Provider is connected"))
    openSummary(drawn)
    drawn.labelled("Connect a Provider")?.click()
    expect(done).toEqual(["openSettings"])
  })

  it("says what it will fetch and where it will send it, before fetching anything", () => {
    const drawn = draw(
      stateNamed("a Provider is connected and the reader has not asked for a Digest yet")
    )
    openSummary(drawn)
    done = []
    const text = drawn.textContent
    expect(text).toContain("read the comments of 2 discussions")
    expect(text).toContain("send them to your own API key")
    // And it says plainly that it has not done it, so the sentence cannot be
    // read as a report of something already sent.
    expect(text).toContain("has not done that yet")
    expect(done).toEqual([])
  })

  it("asks only when the reader clicks", () => {
    const drawn = draw(
      stateNamed("a Provider is connected and the reader has not asked for a Digest yet")
    )
    openSummary(drawn)
    done = []
    drawn.labelled("Summarise these discussions")?.click()
    expect(done).toEqual(["summarise"])
  })

  it("offers nothing to summarise on a page nothing links to", () => {
    const drawn = draw(stateNamed("a Provider is connected and nothing links to this page"))
    openSummary(drawn)
    expect(drawn.textContent).toContain("no conversation to summarise")
    expect(drawn.labelled("Summarise these discussions")).toBeUndefined()
  })

  it("gives every Finding a link to the comment it came from", () => {
    const drawn = draw(stateNamed("a Digest has been written"))
    openSummary(drawn)
    const sources = drawn.withClass("parle-source")
    expect(sources).toHaveLength(1)
    // ADR 0006: a source the reader cannot follow is not one. The link goes to
    // the COMMENT, not to the top of a 640-comment thread.
    expect(sources[0]?.href).toBe("https://news.ycombinator.com/item?id=1201")
    // Named by the thread's own title, which is how a person recognises it.
    expect(sources[0]?.textContent).toContain("the thread about this page")
    expect(sources[0]?.textContent).toContain("the comment")
  })

  it("opens a source through the background, like any other discussion", () => {
    const drawn = draw(stateNamed("a Digest has been written"))
    openSummary(drawn)
    done = []
    drawn.withClass("parle-source")[0]?.click()
    expect(done).toEqual(["openOut:https://news.ycombinator.com/item?id=1201"])
  })

  it("marks a disputed claim as a report about the conversation, not as a verdict", () => {
    const drawn = draw(stateNamed("a Digest reports a claim as disputed"))
    openSummary(drawn)
    const text = drawn.textContent

    // Visually distinct: its own class, which the stylesheet gives a rule down
    // the left rather than a warning colour.
    expect(drawn.withClass("parle-finding-disputed")).toHaveLength(1)

    // And distinct in words, in the direction ADR 0006 requires. It says
    // someone disagreed; it must never say the claim is false.
    //
    // Checked over OUR prose only. The statement itself is the model reporting
    // what a commenter said and may legitimately contain any word at all — it
    // is what the disputed mark is about, not part of the mark.
    const ours = text.split(
      "Several commenters said the benchmark was run on the wrong hardware."
    ).join(" ")
    expect(ours).toContain("Someone there disagreed")
    expect(ours).not.toMatch(/\bfalse\b/i)
    expect(ours).not.toMatch(/\bwrong\b/i)
    expect(ours).not.toMatch(/\bincorrect\b/i)
    expect(ours).not.toMatch(/\bdebunk/i)
    expect(ours).not.toMatch(/\bmisleading\b/i)

    // The whole justification for allowing the mark: it is checkable.
    expect(drawn.withClass("parle-source")[0]?.href).toBe(
      "https://news.ycombinator.com/item?id=1202"
    )
  })

  it("keeps what a dying model produced, and says it is not the whole answer", () => {
    const drawn = draw(stateNamed("the model died mid-answer and what arrived was kept"))
    openSummary(drawn)
    const text = drawn.textContent
    expect(text).toContain("Several commenters said")
    expect(text).toContain("part of an answer")
    // The Findings that did arrive are still followable — they were paid for.
    expect(drawn.withClass("parle-source")).toHaveLength(1)
  })

  it("offers to write it again, and the button really asks", () => {
    // Not a decoration: `Enquiry.summarise` refuses only while one is being
    // written, precisely so this and "Try again" are not buttons that silently
    // do nothing — which reads to the reader as the Provider failing again.
    const drawn = draw(stateNamed("a Digest has been written"))
    openSummary(drawn)
    done = []
    drawn.labelled("Write it again")?.click()
    expect(done).toEqual(["summarise"])
  })

  it("makes 'try again' after a refusal really ask again", () => {
    const drawn = draw(stateNamed("the Provider asked us to slow down"))
    openSummary(drawn)
    drawn.labelled("Try again")?.click()
    expect(done).toEqual(["summarise"])
  })

  it("records who wrote it and that it stayed on this machine", () => {
    const drawn = draw(stateNamed("a Digest has been written"))
    openSummary(drawn)
    expect(drawn.textContent).toContain("Written on this device, by gpt-4o-mini")
  })

  it("gives each way of failing its own words and its own way out", () => {
    const rejected = draw(stateNamed("the reader's key was rejected"))
    openSummary(rejected)
    expect(rejected.textContent).toContain("rejected")
    expect(rejected.labelled("Change the Provider")).toBeDefined()

    const broke = draw(stateNamed("the account is out of credit"))
    openSummary(broke)
    expect(broke.textContent).toContain("cannot pay")
    expect(broke.textContent).not.toContain("rejected")

    const paced = draw(stateNamed("the Provider asked us to slow down"))
    openSummary(paced)
    expect(paced.textContent).toContain("slow down")
    expect(paced.labelled("Try again")).toBeDefined()

    const unusable = draw(stateNamed("the model answered unusably"))
    openSummary(unusable)
    expect(unusable.textContent).toContain("nothing it wrote pointed at a comment")

    const unread = draw(stateNamed("no comments could be read, so nothing was sent anywhere"))
    openSummary(unread)
    expect(unread.textContent).toContain("could not read the comments")
  })

  it("says a Digest is being written rather than showing an empty section", () => {
    const drawn = draw(stateNamed("a Digest is being written"))
    openSummary(drawn)
    const text = drawn.textContent
    expect(text).toContain("Going through the comments")
    expect(text).toContain("your own API key")
  })
})

// ---------------------------------------------------------------------------
// A site's front door
// ---------------------------------------------------------------------------

/**
 * The one suppression in the product, and the three things that make it one the
 * reader can argue with.
 *
 * ADR 0005: a mechanism that silently hides Discussions is worse than one that
 * costs requests, because a false negative is invisible. So it is drawn on the
 * surface reachable from every page, the count is in the words, and the rows are
 * already in the DOM — opening them reaches no worker and can fail nowhere.
 */
describe("a site's front door", () => {
  const door = SubjectUrl.make("https://bankofamerica.com/")
  const doorPlaces = [recall, ...NETWORK_PLACES]

  const frontDoor = (): Panel => {
    const ids = [idOf("hackernews", "10"), idOf("hackernews", "11")]
    let knowledge = fold(
      begin(door, doorPlaces),
      Consultation.cases.Answered.make({
        place: hnLinked,
        mentions: ids.map((id) =>
          Mention.cases.Linked.make({ subject: door, discussion: id, viaAlias: door })
        )
      }),
      {
        discussions: [
          Discussion.make({
            id: ids[0]!,
            title: "Bankofamerica.com is down",
            submittedUrl: door,
            postedAt: NOW - 4000 * 24 * 3_600_000,
            author: null, venue: null
          }),
          Discussion.make({
            id: ids[1]!,
            title: "Bank of America sues a customer over a wire transfer",
            submittedUrl: door,
            postedAt: NOW - 900 * 24 * 3_600_000,
            author: null, venue: null
          })
        ],
        observations: ids.map((id) =>
          Observation.make({ discussion: id, score: 60, comments: 4, present: true, receivedAt: NOW })
        )
      }
    )
    for (const place of doorPlaces.filter((p) => p !== hnLinked)) {
      knowledge = mark(knowledge, Consultation.cases.Silence.make({ place }))
    }
    return panelOf(
      {
        address: "https://bankofamerica.com/",
        title: "Bank of America",
        traversed: [],
  arrival: Arrival.cases.Elsewhere.make({}),
        standing: Standing.cases.Enquiring.make({ subject: door, knowledge }),
        excludedBecause: null
      },
      NOW,
      AGREED
    )
  }

  it.each([
    ["the page surface", draw],
    ["the toolbar surface", status]
  ])("%s says how many, and which page it thinks this is", (_name, onto) => {
    const drawn = onto(frontDoor())
    expect(drawn.textContent).toContain("2 Discussions link to this address")
    expect(drawn.textContent).toContain("bankofamerica.com")
  })

  it("does not tell the reader nobody discussed a page it is offering to show", () => {
    // Both surfaces reach `summaryOf`, and the front-door sentence has to beat
    // the "nobody has discussed this page" branch or the panel contradicts the
    // line underneath it.
    expect(status(frontDoor()).textContent).not.toContain("Nobody has discussed")
    expect(draw(frontDoor()).textContent).not.toContain("Nobody has discussed")
  })

  it("keeps the folded Discussions out of sight until they are asked for", () => {
    const drawn = draw(frontDoor())
    expect(drawn.textContent).not.toContain("Bankofamerica.com is down")
  })

  it("opens them on one click, with no request behind it", () => {
    const drawn = draw(frontDoor())
    const open = drawn.withClass("parle-act-folded")[0]
    expect(open).toBeDefined()
    open?.click()
    expect(drawn.textContent).toContain("Bankofamerica.com is down")
    expect(drawn.textContent).toContain("Bank of America sues a customer over a wire transfer")
    // Nothing was asked of the background to get them.
    expect(done).toEqual([])
  })

  it("takes the control away once it has been used", () => {
    const drawn = draw(frontDoor())
    drawn.withClass("parle-act-folded")[0]?.click()
    expect(drawn.withClass("parle-act-folded")).toHaveLength(0)
  })

  it("still opens the Discussion itself, through the background like any other", () => {
    const drawn = draw(frontDoor())
    drawn.withClass("parle-act-folded")[0]?.click()
    // The title carries the link now: a row also holds the button that opens
    // the conversation, so the whole row can no longer be one anchor.
    const titles = drawn.withClass("parle-folded-rows")[0]?.withClass("parle-title") ?? []
    titles[0]?.click()
    expect(done[0]).toMatch(/^openOut:https:\/\/news\.ycombinator\.com\/item\?id=/)
  })
})

describe("a site's front door, said once", () => {
  it("does not print the fold's sentence twice on the toolbar surface", () => {
    // Found in a browser, not in a test: `summaryOf` falls through to the
    // fold's own words when nothing is showing, and the block underneath draws
    // them again. github.com rendered the whole sentence twice.
    const door = SubjectUrl.make("https://github.com/")
    const doorPlaces = [recall, ...NETWORK_PLACES]
    const id = idOf("hackernews", "77")
    let knowledge = fold(
      begin(door, doorPlaces),
      Consultation.cases.Answered.make({
        place: hnLinked,
        mentions: [Mention.cases.Linked.make({ subject: door, discussion: id, viaAlias: door })]
      }),
      {
        discussions: [
          Discussion.make({
            id,
            title: "GitHub is down",
            submittedUrl: door,
            postedAt: NOW - 500 * 24 * 3_600_000,
            author: null, venue: null
          })
        ],
        observations: [
          Observation.make({ discussion: id, score: 40, comments: 9, present: true, receivedAt: NOW })
        ]
      }
    )
    for (const place of doorPlaces.filter((p) => p !== hnLinked)) {
      knowledge = mark(knowledge, Consultation.cases.Silence.make({ place }))
    }
    const panel = panelOf(
      {
        address: "https://github.com/",
        title: "GitHub",
        traversed: [],
  arrival: Arrival.cases.Elsewhere.make({}),
        standing: Standing.cases.Enquiring.make({ subject: door, knowledge }),
        excludedBecause: null
      },
      NOW,
      AGREED
    )
    const says = panel.folded?.says ?? "never"
    const text = status(panel).textContent
    expect(text.split(says).length - 1).toBe(1)
  })
})

/**
 * ADR 0018. The disclosure is only worth anything if it reaches the reader, and
 * the reader is on one of three surfaces.
 */
describe("saying the list is a floor", () => {
  for (const [surface, onto] of SURFACES) {
    it(`${surface}: says so under an answer that filled our window`, () => {
      const text = onto(windowedPanel(true)).textContent
      expect(text).toContain("Hacker News had more here than Parle reads in one go")
    })

    it(`${surface}: says so where the page otherwise reads as undiscussed`, () => {
      // The case that matters most and is easiest to lose: no rows, so the
      // page surface hands off to the toolbar surface and the sentence has to
      // survive the hand-off.
      const text = onto(windowedPanel(false)).textContent
      expect(text).toContain("more here than Parle reads in one go")
    })
  }

  it("says nothing on an ordinary page, on every surface", () => {
    // A disclosure that appears everywhere is wallpaper. Measured at 1.6% of
    // discussed pages, so its absence is the common case and has to be real.
    for (const [, onto] of SURFACES) {
      expect(onto(found()).textContent).not.toContain("reads in one go")
    }
  })
})
