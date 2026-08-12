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
 * lists five reader-facing terms; everything else in it is how we talk to each
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
import { render, renderAside, renderStatus } from "./render.ts"

const NOW = 1_700_000_100_000
const subject = SubjectUrl.make("https://example.com/piece")

const recall = Place.cases.Recall.make({})
const hnLinked = Place.cases.Network.make({ network: "hackernews" })
const redditLinked = Place.cases.Network.make({ network: "reddit" })
const xLinked = Place.cases.Network.make({ network: "x" })
const places = [recall, hnLinked, redditLinked, xLinked]

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
  for (const place of [recall, xLinked]) {
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
  for (const place of [recall, redditLinked, xLinked]) {
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
  const settled = [recall, redditLinked, xLinked].reduce(
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
      { ...AGREED, networks: { hackernews: false, reddit: false, x: false } }
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

/**
 * The surface beside the page, where the browser has one.
 *
 * In the walks below rather than trusted to be a composition of two things
 * already walked. It is a third CONTAINER for one renderer and every
 * reader-facing guarantee asserted once now has three places it can be true or
 * false — the totality check and the vocabulary check are the two that must
 * hold in all of them, so both run over this too and neither costs anything.
 */
const beside = (panel: Panel): Fake => {
  renderAside(root as unknown as HTMLElement, panel, acts())
  return root
}

const SURFACES: ReadonlyArray<readonly [string, (panel: Panel) => Fake]> = [
  ["the page surface", draw],
  ["the toolbar surface", status],
  ["the surface beside the page", beside]
]

beforeEach(() => {
  root = mountDouble()
  done = []
})

describe("every state puts something on the screen", () => {
  for (const [surface, onto] of SURFACES) {
    for (const [name, panel] of STATES) {
      it(`${surface}: ${name}`, () => {
        const text = onto(panel).textContent
        // The heading and the address are always drawn, so a panel that said
        // nothing about its own state would still be non-empty. What is checked
        // is that something was drawn BELOW the header.
        const below = text.slice((panel.heading + panel.address).length)
        expect(below.trim().length).toBeGreaterThan(0)
      })
    }
  }
})

/**
 * `CONTEXT.md`, binding: Discussion, Digest, Finding, Spread and Provider are
 * the reader-facing terms. Everything else in that file is how the code talks
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
        const text = onto(panel).textContent
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
    // above would pass by drawing nothing at all.
    expect(draw(found()).textContent).toContain("the thread about this page")
    expect(status(found()).textContent).toContain("Where Parle asked")
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

  it("marks each conversation tab with its Network and themes the open thread", () => {
    // `found()` has a Linked HN thread and a Passing Reddit mention — tabs are
    // only for Linked conversations, so the mark and theme under test are HN's.
    const drawn = draw(found())
    const tabs = drawn.withClass("parle-tab")
    expect(tabs.length).toBeGreaterThan(0)
    expect(tabs.every((tab) => tab.getAttribute("data-network") === "hackernews")).toBe(true)
    expect(drawn.withClass("parle-tab-mark").length).toBeGreaterThanOrEqual(tabs.length)
    // Every tile carries a short label so the strip is scannable at a glance.
    expect(drawn.withClass("parle-tab-name").map((node) => node.textContent)).toContain("HN")
    const conversation = drawn.withClass("parle-conversation")[0]
    expect(conversation?.getAttribute("data-network")).toBe("hackernews")
    expect(drawn.withClass("parle-room-bar").length).toBe(1)
    expect(drawn.withClass("parle-room-where")[0]?.textContent).toBe("Hacker News")
    expect(drawn.textContent).toContain("Hacker News")
    expect(drawn.textContent).toContain("points")
  })

  it("uses each Network's own wording once that conversation is open", () => {
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
    const redditTab = drawn.withClass("parle-tab")
      .find((tab) => tab.getAttribute("data-network") === "reddit")
    expect(redditTab).toBeDefined()
    redditTab?.click()
    expect(drawn.withClass("parle-conversation")[0]?.getAttribute("data-network")).toBe("reddit")
    expect(drawn.textContent).toContain("upvotes")
  })

  it("names the subreddit on every Reddit tab and in that room's bar", () => {
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
    const names = drawn.withClass("parle-tab-name").map((node) => node.textContent)
    expect(names).toContain("r/science")
    expect(names).toContain("r/MachineLearning")
    expect(drawn.withClass("parle-room-where")[0]?.textContent).toBe("r/science")
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
    expect(drawn.withClass("parle-tab-name")[0]?.textContent).toBe("X")
    expect(drawn.withClass("parle-comment-who")[0]?.textContent).toContain("@physicshq")
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
    expect(text).toContain("About this page")
    // Passing still states its weaker claim in words; Linked lets the tabs and
    // room chrome carry that weight so the label can stay quiet.
    expect(text).toContain("linked inside a conversation about something else")
    // The caption that apologised for the rows beneath it, and the rows.
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

  /**
   * The surface beside the page is the one that cannot leave.
   *
   * The mark takes itself off a page that turns out to hold nothing — that is
   * `pill.content.ts`'s central promise and it is checkable in the browser by
   * walking every shadow root. A panel docked in the browser's own chrome has
   * no such move: the reader opened it, and it stays open across navigations
   * and tab switches. So it has to answer for an empty page in words, and the
   * words that exist for that are the toolbar's.
   */
  it("opens straight into the discussions when there are some", () => {
    const drawn = beside(found())
    expect(drawn.withClass("parle-row").length).toBeGreaterThan(0)
    expect(drawn.textContent).not.toContain("Where Parle asked")
  })

  it("becomes the account of every place when there are none", () => {
    const [, nothing] = STATES.find(
      ([name]) => name === "everyone answered and nobody had anything"
    )!
    const drawn = beside(nothing)
    expect(drawn.withClass("parle-row")).toHaveLength(0)
    expect(drawn.textContent).toContain("Where Parle asked")
  })

  it("says why a page was held back, rather than sitting there empty", () => {
    // The state the mark answers by never appearing at all. This container
    // cannot, so ADR 0011's restraint — and the one click out of it — have to
    // be readable here.
    const [, held] = STATES.find(([name]) => name === "automatic lookups are off")!
    const drawn = beside(held)
    expect(drawn.textContent).toContain("Look this page up")
    expect(drawn.withClass("parle-act").length).toBeGreaterThan(0)
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
    draw(found()).labelled("Pause on example.com")?.click()
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
    // One row, not five, and the surviving one is still a link to the thread.
    // Two rows in total now rather than three: the topical group is gone.
    expect(drawn.withClass("parle-row")).toHaveLength(2)
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
    drawn.labelled("Continue this reply on Hacker News")?.click()
    expect(done).toContain(`openOut:${panel.linked[0]?.permalink}`)
  })

  it("can flatten the comments without losing any authors or words", () => {
    const drawn = draw(tree("nested-flat"))
    drawn.labelled("Flatten")?.click()
    expect(drawn.textContent).toContain("A direct reply")
    expect(drawn.textContent).toContain("Only on the original discussion")
    expect(drawn.labelled("Show nested")).toBeDefined()
    expect(drawn.withClass("parle-replies")).toHaveLength(0)
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
    drawn.labelled("Open 5 more on Hacker News")?.click()
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

  it("says no Provider is connected as an offer, not as a failure", () => {
    const drawn = draw(stateNamed("no Provider is connected"))
    const text = drawn.textContent
    expect(text).toContain("No Provider connected")
    // The words that would make it read as something broken.
    expect(text).not.toMatch(/error|failed|unavailable/i)
    expect(drawn.labelled("Connect a Provider")).toBeDefined()
  })

  it("sends a reader with nothing connected to the settings page", () => {
    const drawn = draw(stateNamed("no Provider is connected"))
    drawn.labelled("Connect a Provider")?.click()
    expect(done).toEqual(["openSettings"])
  })

  it("says what it will fetch and where it will send it, before fetching anything", () => {
    const drawn = draw(
      stateNamed("a Provider is connected and the reader has not asked for a Digest yet")
    )
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
    expect(done).toEqual([])
    drawn.labelled("Summarise these discussions")?.click()
    expect(done).toEqual(["summarise"])
  })

  it("offers nothing to summarise on a page nothing links to", () => {
    const drawn = draw(stateNamed("a Provider is connected and nothing links to this page"))
    expect(drawn.textContent).toContain("no conversation to summarise")
    expect(drawn.labelled("Summarise these discussions")).toBeUndefined()
  })

  it("gives every Finding a link to the comment it came from", () => {
    const drawn = draw(stateNamed("a Digest has been written"))
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
    drawn.withClass("parle-source")[0]?.click()
    expect(done).toEqual(["openOut:https://news.ycombinator.com/item?id=1201"])
  })

  it("marks a disputed claim as a report about the conversation, not as a verdict", () => {
    const drawn = draw(stateNamed("a Digest reports a claim as disputed"))
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
    drawn.labelled("Write it again")?.click()
    expect(done).toEqual(["summarise"])
  })

  it("makes 'try again' after a refusal really ask again", () => {
    const drawn = draw(stateNamed("the Provider asked us to slow down"))
    drawn.labelled("Try again")?.click()
    expect(done).toEqual(["summarise"])
  })

  it("records who wrote it and that it stayed on this machine", () => {
    expect(draw(stateNamed("a Digest has been written")).textContent).toContain(
      "Written on this device, by gpt-4o-mini"
    )
  })

  it("gives each way of failing its own words and its own way out", () => {
    const rejected = draw(stateNamed("the reader's key was rejected"))
    expect(rejected.textContent).toContain("rejected")
    expect(rejected.labelled("Change the Provider")).toBeDefined()

    const broke = draw(stateNamed("the account is out of credit"))
    expect(broke.textContent).toContain("cannot pay")
    expect(broke.textContent).not.toContain("rejected")

    const paced = draw(stateNamed("the Provider asked us to slow down"))
    expect(paced.textContent).toContain("slow down")
    expect(paced.labelled("Try again")).toBeDefined()

    const unusable = draw(stateNamed("the model answered unusably"))
    expect(unusable.textContent).toContain("nothing it wrote pointed at a comment")

    const unread = draw(stateNamed("no comments could be read, so nothing was sent anywhere"))
    expect(unread.textContent).toContain("could not read the comments")
  })

  it("says a Digest is being written rather than showing an empty section", () => {
    const text = draw(stateNamed("a Digest is being written")).textContent
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
  const doorPlaces = [recall, hnLinked, redditLinked, xLinked]

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
    ["the toolbar surface", status],
    ["the surface beside the page", beside]
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
    expect(beside(frontDoor()).textContent).not.toContain("Nobody has discussed")
  })

  it("keeps the folded Discussions out of sight until they are asked for", () => {
    const drawn = beside(frontDoor())
    expect(drawn.textContent).not.toContain("Bankofamerica.com is down")
  })

  it("opens them on one click, with no request behind it", () => {
    const drawn = beside(frontDoor())
    const open = drawn.withClass("parle-act-folded")[0]
    expect(open).toBeDefined()
    open?.click()
    expect(drawn.textContent).toContain("Bankofamerica.com is down")
    expect(drawn.textContent).toContain("Bank of America sues a customer over a wire transfer")
    // Nothing was asked of the background to get them.
    expect(done).toEqual([])
  })

  it("takes the control away once it has been used", () => {
    const drawn = beside(frontDoor())
    drawn.withClass("parle-act-folded")[0]?.click()
    expect(drawn.withClass("parle-act-folded")).toHaveLength(0)
  })

  it("still opens the Discussion itself, through the background like any other", () => {
    const drawn = beside(frontDoor())
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
    const doorPlaces = [recall, hnLinked, redditLinked, xLinked]
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
