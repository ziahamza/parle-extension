import { Consultation, Place } from "@parle/domain/Coverage"
import { Mention } from "@parle/domain/Mention"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { Arrival, SubjectUrl } from "@parle/domain/Subject"
import { describe, expect, it } from "vitest"
import { begin, fold, mark } from "../enquiry/Knowledge.ts"
import { Discussion } from "@parle/networks/Discussion"
import { Observation } from "@parle/networks/Observation"
import { type Reading, Standing } from "../reading/Reading.ts"
import { everyNetworkOn, noProvider, type Surroundings } from "../reading/Surroundings.ts"
import { badgeOf } from "./Panel.ts"
import { panelOf } from "./panelOf.ts"

const subject = SubjectUrl.make("https://example.com/piece")
const recall = Place.cases.Recall.make({})
const hnLinked = Place.cases.Network.make({ network: "hackernews" })
const redditLinked = Place.cases.Network.make({ network: "reddit" })
const xLinked = Place.cases.Network.make({ network: "x" })
const places = [recall, hnLinked, redditLinked, xLinked]

const NOW = 1_700_000_100_000

/**
 * A reader who has been asked and said yes, on a build with no shipped index.
 *
 * Stated rather than defaulted, because both halves of it change what the panel
 * says: an undecided reader sees the first-run restraint whatever else is true,
 * and an absent index is a sentence the reader is owed.
 */
const AGREED: Surroundings = { decision: "automatic", provider: noProvider, networks: everyNetworkOn, index: { _tag: "Absent" }, everyDiscussion: false }
const MANUAL: Surroundings = { decision: "manual", provider: noProvider, networks: everyNetworkOn, index: { _tag: "Absent" }, everyDiscussion: false }
const UNTOLD: Surroundings = { decision: "undecided", provider: noProvider, networks: everyNetworkOn, index: { _tag: "Absent" }, everyDiscussion: false }

const idOf = (network: "hackernews" | "reddit", nativeId: string): DiscussionId =>
  DiscussionId.make({ network, nativeId: NativeId.make(nativeId) })

const discussionOf = (id: DiscussionId, title: string): Discussion =>
  Discussion.make({
    id,
    title,
    submittedUrl: subject,
    postedAt: NOW - 3_600_000,
    author: null, venue: null
  })

const observationOf = (id: DiscussionId, score: number, comments = 7): Observation =>
  Observation.make({
    discussion: id,
    score,
    comments,
    present: true,
    receivedAt: NOW
  })

const readingOf = (
  knowledge: ReturnType<typeof begin>,
  excludedBecause: string | null = null
): Reading => ({
  address: subject,
  title: "A piece",
  traversed: [],
  arrival: Arrival.cases.Elsewhere.make({}),
  standing: Standing.cases.Enquiring.make({ subject, knowledge }),
  excludedBecause
})

/** Every Place held back for one reason — the shape that produces a banner. */
const allWithheld = (reason: Parameters<typeof Consultation.cases.Withholding.make>[0]["reason"]) => {
  let knowledge = begin(subject, places)
  for (const place of places) {
    knowledge = mark(knowledge, Consultation.cases.Withholding.make({ place, reason }))
  }
  return knowledge
}

describe("grouping", () => {


  it("carries what a row needs to be drawn", () => {
    const id = idOf("hackernews", "41293011")
    const knowledge = fold(
      begin(subject, places),
      Consultation.cases.Answered.make({
        place: hnLinked,
        mentions: [Mention.cases.Linked.make({ subject, discussion: id, viaAlias: subject })]
      }),
      { discussions: [discussionOf(id, "thread")], observations: [observationOf(id, 1859)] }
    )
    const row = panelOf(readingOf(knowledge), NOW, AGREED).linked[0]
    expect(row?.networkName).toBe("Hacker News")
    expect(row?.score).toBe(1859)
    expect(row?.commentCount).toBe(7)
    expect(row?.age).toBe("1h")
    expect(row?.permalink).toBe("https://news.ycombinator.com/item?id=41293011")
    expect(row?.alsoSubmitted).toBe(0)
  })
})

/**
 * One page posted to one Network five times.
 *
 * This is the ordinary shape of a Hacker News result, not an edge case: an
 * article that did well was almost always submitted several times, once to
 * something and four times to silence. Five rows makes the reader do the
 * sorting, and the four dead ones crowd out the Reddit thread underneath them.
 */
describe("the same page, submitted more than once", () => {
  // One Consultation carrying every posting, because that is what one answer
  // from Hacker News actually looks like: a search for this address returns all
  // of them at once.
  const submissions = (
    postings: ReadonlyArray<readonly [string, string, number, number]>
  ) => {
    const ids = postings.map(([nativeId]) => idOf("hackernews", nativeId))
    const knowledge = fold(
      begin(subject, places),
      Consultation.cases.Answered.make({
        place: hnLinked,
        mentions: ids.map((discussion) =>
          Mention.cases.Linked.make({ subject, discussion, viaAlias: subject })
        )
      }),
      {
        discussions: postings.map(([, title], at) => discussionOf(ids[at]!, title)),
        observations: postings.map(([, , score, comments], at) =>
          observationOf(ids[at]!, score, comments)
        )
      }
    )
    return panelOf(readingOf(knowledge), NOW, AGREED)
  }

  it("shows the conversation, and keeps the fact of the reposts", () => {
    const panel = submissions([
      ["1", "the thread people actually read", 210, 18],
      ["2", "a repost", 2, 0],
      ["3", "another repost", 1, 0],
      ["4", "a third repost", 1, 0],
      ["5", "a fourth repost", 0, 0]
    ])
    expect(panel.linked.map((row) => row.title)).toEqual(["the thread people actually read"])
    // Not lost, and not a row of its own.
    expect(panel.linked[0]?.alsoSubmitted).toBe(4)
    // The toolbar's own count has to agree with what the reader will see.
    expect(badgeOf(panel)).toBe("1")
  })

  it("never folds away a thread somebody replied to", () => {
    // Two real conversations about one page is not a repost problem, and
    // collapsing to the louder one would silently drop 40 comments.
    const panel = submissions([
      ["1", "the first time it went round", 210, 18],
      ["2", "the second time, a year later", 90, 40],
      ["3", "a repost", 1, 0]
    ])
    expect(panel.linked.map((row) => row.title)).toEqual([
      "the first time it went round",
      "the second time, a year later"
    ])
    expect(panel.linked[0]?.alsoSubmitted).toBe(1)
    expect(panel.linked[1]?.alsoSubmitted).toBe(0)
  })

  it("folds a repost that drew a reply but not a conversation", () => {
    // `paulgraham.com/greatwork.html` as it actually came back: one thread with
    // 432 comments and five reposts of the same essay with one comment each.
    // The old rule kept anything with a comment at all and drew seven rows.
    const panel = submissions([
      ["1", "How to Do Great Work", 1008, 432],
      ["2", "How to Do Great Work (2023)", 93, 69],
      ["3", "How to Do Great Work", 5, 1],
      ["4", "How to do great work – Paul Graham", 3, 1],
      ["5", "How to Do Great Work", 1, 1]
    ])
    expect(panel.linked.map((row) => row.title)).toEqual([
      "How to Do Great Work",
      "How to Do Great Work (2023)"
    ])
    // Folded, never dropped: the count is what makes it checkable.
    expect(panel.linked[0]?.alsoSubmitted).toBe(3)
  })

  it("keeps a busy thread beside a viral one, on the absolute floor", () => {
    // A tenth of 1,283 is 128, which would fold a 40-comment thread that any
    // reader would want. Ten comments is the floor that stops it.
    const panel = submissions([
      ["1", "the viral one", 2589, 1283],
      ["2", "the busy one", 72, 40]
    ])
    expect(panel.linked).toHaveLength(2)
  })

  it("keeps the loudest when every posting was ignored", () => {
    const panel = submissions([
      ["1", "posted, ignored", 9, 0],
      ["2", "posted again, ignored", 3, 0]
    ])
    expect(panel.linked.map((row) => row.title)).toEqual(["posted, ignored"])
    expect(panel.linked[0]?.alsoSubmitted).toBe(1)
  })

  it("does not fold two Networks into each other", () => {
    const hn = idOf("hackernews", "1")
    const reddit = idOf("reddit", "abc")
    let knowledge = fold(
      begin(subject, places),
      Consultation.cases.Answered.make({
        place: hnLinked,
        mentions: [Mention.cases.Linked.make({ subject, discussion: hn, viaAlias: subject })]
      }),
      { discussions: [discussionOf(hn, "on Hacker News")], observations: [observationOf(hn, 10, 0)] }
    )
    knowledge = fold(
      knowledge,
      Consultation.cases.Answered.make({
        place: redditLinked,
        mentions: [Mention.cases.Linked.make({ subject, discussion: reddit, viaAlias: subject })]
      }),
      { discussions: [discussionOf(reddit, "on Reddit")], observations: [observationOf(reddit, 4, 0)] }
    )
    const panel = panelOf(readingOf(knowledge), NOW, AGREED)
    expect(panel.linked).toHaveLength(2)
    expect(panel.linked.every((row) => row.alsoSubmitted === 0)).toBe(true)
  })

})

describe("degraded states are states, not absences", () => {
  it("distinguishes still looking from nothing found", () => {
    const looking = panelOf(readingOf(begin(subject, places)), NOW, AGREED)
    expect(looking.stillLooking).toBe(true)
    expect(looking.foundNothing).toBe(false)

    let settled = begin(subject, places)
    for (const place of places) {
      settled = mark(settled, Consultation.cases.Silence.make({ place }))
    }
    const quiet = panelOf(readingOf(settled), NOW, AGREED)
    expect(quiet.stillLooking).toBe(false)
    expect(quiet.foundNothing).toBe(true)
    expect(quiet.couldNotAsk).toBe(false)
  })

  it("names who it is still waiting on, because they answer in waves", () => {
    // "Still looking" over the whole page tells a reader nothing about whether
    // to keep waiting. Hacker News finishing while Reddit hangs is the ordinary
    // case, and the panel has to be able to say which is which.
    let knowledge = mark(begin(subject, places), Consultation.cases.Silence.make({
      place: hnLinked
    }))
    knowledge = mark(knowledge, Consultation.cases.Asking.make({ place: redditLinked }))
    const panel = panelOf(readingOf(knowledge), NOW, AGREED)

    expect(panel.stillLooking).toBe(true)
    expect(panel.waitingOn.some((who) => who.startsWith("Reddit"))).toBe(true)
    expect(panel.waitingOn.some((who) => who.startsWith("Hacker News · by address"))).toBe(false)
  })

  it("does not call a page undiscussed while a Network is still refusing", () => {
    // The ordinary Reddit path: Hacker News answers with nothing while Reddit
    // 403s. Reporting "settled, and undiscussed" here is the wrong quantifier,
    // and it is what every `some(...)` formulation produces.
    let knowledge = mark(begin(subject, places), Consultation.cases.Silence.make({
      place: hnLinked
    }))
    knowledge = mark(knowledge, Consultation.cases.Asking.make({ place: redditLinked }))
    const panel = panelOf(readingOf(knowledge), NOW, AGREED)
    expect(panel.stillLooking).toBe(true)
    expect(panel.foundNothing).toBe(false)
  })

  it("separates 'nobody discussed it' from 'nobody would answer'", () => {
    // The same empty screen and opposite facts. A Silence is evidence about the
    // world; a Refusal is evidence about us, and saying "nothing found" over a
    // page nobody could reach is the one lie this panel exists to avoid.
    let refused = begin(subject, places)
    for (const place of places) {
      refused = mark(
        refused,
        Consultation.cases.Refusal.make({ place, reason: "rate-limited" })
      )
    }
    const panel = panelOf(readingOf(refused), NOW, AGREED)
    expect(panel.stillLooking).toBe(false)
    expect(panel.foundNothing).toBe(false)
    expect(panel.couldNotAsk).toBe(true)
  })

  it("does not let this device's own silence stand in for a Network's answer", () => {
    // The shape the case above cannot produce, and the only one that really
    // happens: `Enquiry` never withholds the Recall Place and never lets it
    // refuse — it asks the reader's own machine, so it always answers, and on a
    // worker that has looked nothing up yet it always answers with nothing.
    //
    // That silence is not evidence about the world. It says this device has no
    // record, which is exactly what a device that has never asked would say. If
    // it counts as somebody having answered, then a page where every Network
    // refused reads as "nobody has discussed this page".
    let blind = begin(subject, places)
    blind = mark(blind, Consultation.cases.Silence.make({ place: recall }))
    for (const place of [hnLinked, redditLinked, xLinked]) {
      blind = mark(blind, Consultation.cases.Refusal.make({ place, reason: "rate-limited" }))
    }

    const panel = panelOf(readingOf(blind), NOW, AGREED)
    expect(panel.foundNothing).toBe(false)
    expect(panel.couldNotAsk).toBe(true)
    expect(panel.answeredBy).toEqual([])
  })

  it("names the Networks that actually answered, rather than assuming both did", () => {
    // With Reddit switched off, "Hacker News and Reddit both answered" names a
    // Network that was never asked.
    let quiet = begin(subject, places)
    quiet = mark(quiet, Consultation.cases.Silence.make({ place: recall }))
    quiet = mark(quiet, Consultation.cases.Silence.make({ place: hnLinked }))
    quiet = mark(quiet, Consultation.cases.Silence.make({ place: hnLinked }))
    for (const place of [redditLinked, xLinked]) {
      quiet = mark(quiet, Consultation.cases.Withholding.make({ place, reason: "network-off" }))
    }

    const panel = panelOf(readingOf(quiet), NOW, {
      ...AGREED,
      networks: { ...everyNetworkOn, reddit: false }
    })
    expect(panel.foundNothing).toBe(true)
    expect(panel.answeredBy).toEqual(["Hacker News"])
  })

  it("says which Network could not answer, and why, in words that distinguish it", () => {
    const knowledge = mark(
      begin(subject, places),
      Consultation.cases.Refusal.make({ place: redditLinked, reason: "not-signed-in" })
    )
    const panel = panelOf(readingOf(knowledge), NOW, AGREED)
    const notice = panel.accounts.find((account) => account.place.startsWith("Reddit"))
    // Specifically NOT "unavailable — …". Terse is fine; vague is not. The
    // word said nothing the reason did not say better, and prefixing six
    // distinct facts with it made them look like one generic one.
    expect(notice?.standing).not.toMatch(/unavailable/)
    expect(notice?.standing).toMatch(/not signed in/)
  })

  it("says a Network is rate-limiting us rather than reporting nothing", () => {
    const knowledge = mark(
      begin(subject, places),
      Consultation.cases.Refusal.make({ place: redditLinked, reason: "rate-limited" })
    )
    const notice = panelOf(readingOf(knowledge), NOW, AGREED).accounts.find((a) =>
      a.place.startsWith("Reddit")
    )
    expect(notice?.tone).toBe("refused")
    expect(notice?.standing).toMatch(/rate-limiting/)
  })

  it("says X was not asked, and why, rather than leaving it blank", () => {
    const knowledge = mark(
      begin(subject, places),
      Consultation.cases.Withholding.make({ place: xLinked, reason: "awaiting-linked-mention" })
    )
    const panel = panelOf(readingOf(knowledge), NOW, AGREED)
    const notice = panel.accounts.find((account) => account.place.startsWith("X"))
    expect(notice?.standing).toMatch(/not asked/)
    expect(notice?.standing).toMatch(/nothing links here yet/)
  })

  it("never leaves a Place out of the account, at any moment", () => {
    const early = panelOf(readingOf(begin(subject, places)), NOW, AGREED)
    expect(early.accounts).toHaveLength(places.length)
    expect(early.accounts.every((account) => account.standing !== "")).toBe(true)
  })

  it("renders an address that is no page at all as a reason, with no way out", () => {
    const reading: Reading = {
      address: "http://192.168.1.1/admin",
      title: "Router",
      traversed: [],
  arrival: Arrival.cases.Elsewhere.make({}),
      standing: Standing.cases.Excluded.make({
        reason: "excluded",
        because: "Parle only looks up public web pages, and this address is not one."
      }),
      excludedBecause: null
    }
    const panel = panelOf(reading, NOW, AGREED)
    expect(panel.restraint?.kind).toBe("not-a-web-page")
    expect(panel.restraint?.says).toMatch(/public web pages/)
    expect(badgeOf(panel)).toBe("")
  })

  it("names the rule that excluded a page, so the reader can correct it", () => {
    // ADR 0005's own objection is that a silent false negative is one nobody
    // can complain about. A reason nobody can read is the same objection one
    // step later, which is why the ground travels on the Reading.
    const reading = readingOf(
      allWithheld("excluded"),
      "it looks like a bank or a financial account — chase.com is on the built-in list"
    )
    const panel = panelOf(reading, NOW, AGREED)
    expect(panel.restraint?.kind).toBe("excluded")
    expect(panel.restraint?.says).toMatch(/chase\.com is on the built-in list/)
    expect(badgeOf(panel)).toBe("")
  })

  it("still says something true when it cannot name the rule", () => {
    const panel = panelOf(readingOf(allWithheld("excluded")), NOW, AGREED)
    expect(panel.restraint?.kind).toBe("excluded")
    expect(panel.restraint?.says).toMatch(/example\.com/)
  })

  it("says a paused site is paused, and by whom", () => {
    const panel = panelOf(readingOf(allWithheld("site-paused")), NOW, AGREED)
    expect(panel.restraint?.kind).toBe("site-paused")
    expect(panel.restraint?.says).toMatch(/You paused Parle on example\.com/)
  })

  it("says the budget ran out rather than pretending the page is quiet", () => {
    const panel = panelOf(readingOf(allWithheld("over-budget")), NOW, AGREED)
    expect(panel.restraint?.kind).toBe("over-budget")
    expect(panel.restraint?.says).toMatch(/stopped for now/)
  })

  it("tells the reader's own switch apart from ours", () => {
    // These were one literal, and the panel guessed between them from the
    // reader's settings. They are opposite facts — one the reader did and can
    // undo, one they did not — so each now carries its own reason and the copy
    // follows from the reason rather than from a guess.
    const theirs = panelOf(readingOf(allWithheld("manual-only")), NOW, MANUAL)
    expect(theirs.restraint?.kind).toBe("automatic-off")
    expect(theirs.restraint?.says).toMatch(/Automatic lookups are off/)

    const ours = panelOf(readingOf(allWithheld("kill-switched")), NOW, AGREED)
    expect(ours.restraint?.kind).toBe("switched-off")
    expect(ours.restraint?.says).toMatch(/not something you did/)

    // The one that was wrong before: switching Reddit off, with automatic
    // lookups still ON, used to be reported as "automatic lookups are off".
    const reddit = panelOf(readingOf(allWithheld("network-off")), NOW, {
      ...AGREED,
      networks: { ...everyNetworkOn, reddit: false }
    })
    expect(reddit.restraint?.kind).toBe("networks-off")
    expect(reddit.restraint?.says).not.toMatch(/Automatic lookups are off/)
  })

  it("says no Provider is connected instead of showing nothing about the Digest", () => {
    const panel = panelOf(readingOf(begin(subject, places)), NOW, AGREED)
    expect(panel.digest.says.text).toMatch(/No Provider connected/)
  })
})

describe("the first run", () => {
  it("shows the disclosure state before anything else, whatever the page", () => {
    // Not a banner over a decision already taken: on a fresh install there is
    // nothing to show under it, because nothing has been asked.
    const panel = panelOf(readingOf(begin(subject, places)), NOW, UNTOLD)
    expect(panel.restraint?.kind).toBe("undecided")
    // Names where the address would go, before it goes, and says nothing has
    // happened yet. Both halves, in two sentences.
    expect(panel.restraint?.says).toMatch(/Hacker News and Reddit/)
    expect(panel.restraint?.says).toMatch(/has not started yet/)
    expect(panel.automatic).toBe(false)
    expect(badgeOf(panel)).toBe("")
  })

  it("takes precedence over an address we would not look up anyway", () => {
    const reading: Reading = {
      address: "chrome://settings",
      title: "Settings",
      traversed: [],
  arrival: Arrival.cases.Elsewhere.make({}),
      standing: Standing.cases.Excluded.make({ reason: "excluded", because: "not a web page" }),
      excludedBecause: null
    }
    expect(panelOf(reading, NOW, UNTOLD).restraint?.kind).toBe("undecided")
  })
})

/**
 * ADR 0018. The panel may show fewer Discussions than exist; what it may not do
 * is show fewer and imply that is all of them.
 */
describe("an answer cut off by the size of our own request", () => {
  const id = idOf("hackernews", "41293011")

  /** Hacker News answered, `windowed` or not; everyone else was quiet. */
  const asked = (windowed: boolean, mentions: boolean) => {
    let knowledge = fold(
      begin(subject, places),
      mentions
        ? windowed
          ? Consultation.cases.Answered.make({
            place: hnLinked,
            mentions: [Mention.cases.Linked.make({ subject, discussion: id, viaAlias: subject })],
            windowed: true
          })
          : Consultation.cases.Answered.make({
            place: hnLinked,
            mentions: [Mention.cases.Linked.make({ subject, discussion: id, viaAlias: subject })]
          })
        : windowed
          ? Consultation.cases.Silence.make({ place: hnLinked, windowed: true })
          : Consultation.cases.Silence.make({ place: hnLinked }),
      mentions
        ? { discussions: [discussionOf(id, "the thread")], observations: [observationOf(id, 40)] }
        : { discussions: [], observations: [] }
    )
    for (const place of [redditLinked, xLinked, recall]) {
      knowledge = mark(knowledge, Consultation.cases.Silence.make({ place }))
    }
    return panelOf(readingOf(knowledge), NOW, AGREED)
  }

  it("says nothing at all on the ordinary page", () => {
    // Measured at 1.6% of discussed pages, so the common case is silence — and
    // that silence is now a measured claim rather than an assumption.
    expect(asked(false, true).windowed).toBeNull()
  })

  it("names who ran out of room, and says the count is a floor", () => {
    const panel = asked(true, true)
    expect(panel.windowed?.text).toContain("Hacker News")
    expect(panel.windowed?.text).toContain("at least")
    // Never "we may have missed something", which is either always true or a
    // claim we cannot support.
    expect(panel.windowed?.text).not.toContain("may have missed")
  })

  it("marks the Place's own account as a floor rather than a total", () => {
    const account = asked(true, true).accounts.find((a) => a.place === "Hacker News")
    expect(account?.standing).toBe("at least 1 found")
    expect(asked(false, true).accounts.find((a) => a.place === "Hacker News")?.standing)
      .toBe("1 found")
  })

  it("does not let a windowed Silence read as 'nothing'", () => {
    // The dangerous one. `github.com` returns fifty hits, none of them the page,
    // out of 1,973,692 — and unqualified that renders as the same word a page
    // nobody has ever submitted gets.
    const account = asked(true, false).accounts.find((a) => a.place === "Hacker News")
    expect(account?.standing).toBe("nothing this far in")
    expect(asked(false, false).accounts.find((a) => a.place === "Hacker News")?.standing)
      .toBe("nothing")
  })

  it("still says it on a page where nothing could be drawn", () => {
    // The state that most needs it: the reader is being told nobody has
    // discussed this page, and the truth is that we did not look far enough.
    const panel = asked(true, false)
    expect(panel.foundNothing).toBe(true)
    expect(panel.windowed).not.toBeNull()
  })
})

describe("the shipped list of already-discussed pages", () => {
  it("says an absent one costs the reader requests, in so many words", () => {
    // The privacy-relevant half, and the reason absent and stale are two states.
    const panel = panelOf(readingOf(begin(subject, places)), NOW, AGREED)
    expect(panel.index?.text).toMatch(/asks about every page you open that is not skipped/)
  })

  it("says a stale one costs speed and explicitly not coverage", () => {
    // A list can only ever save a request; it can never assert that nobody
    // discussed a page. Telling the reader an old one loses them results would
    // be false, and it is the obvious thing to write.
    const panel = panelOf(readingOf(begin(subject, places)), NOW, {
      decision: "automatic", provider: noProvider, networks: everyNetworkOn,
      index: { _tag: "Stale", builtAt: NOW - 90 * 24 * 3_600_000 },
      everyDiscussion: false
    })
    expect(panel.index?.text).toMatch(/out of date/)
    expect(panel.index?.text).toMatch(/Nothing is missed/)
  })

  it("says nothing at all when it is current", () => {
    const panel = panelOf(readingOf(begin(subject, places)), NOW, {
      decision: "automatic", provider: noProvider, networks: everyNetworkOn,
      index: { _tag: "Ready", builtAt: NOW - 3_600_000 },
      everyDiscussion: false
    })
    expect(panel.index).toBeNull()
  })
})

describe("the badge", () => {
  it("counts what was found, marks the wait, and stays quiet otherwise", () => {
    const id = idOf("hackernews", "1")
    const found = fold(
      begin(subject, places),
      Consultation.cases.Answered.make({
        place: hnLinked,
        mentions: [Mention.cases.Linked.make({ subject, discussion: id, viaAlias: subject })]
      }),
      { discussions: [discussionOf(id, "thread")], observations: [observationOf(id, 1)] }
    )
    expect(badgeOf(panelOf(readingOf(found), NOW, AGREED))).toBe("1")
    expect(badgeOf(panelOf(readingOf(begin(subject, places)), NOW, AGREED))).toBe("…")

    let settled = begin(subject, places)
    for (const place of places) {
      settled = mark(settled, Consultation.cases.Silence.make({ place }))
    }
    expect(badgeOf(panelOf(readingOf(settled), NOW, AGREED))).toBe("")
  })
})

// ---------------------------------------------------------------------------
// A site's front door
// ---------------------------------------------------------------------------

/**
 * The one place in the product where a Discussion the reader could see is kept
 * off the front of the panel.
 *
 * ADR 0005's rule is that a mechanism which silently hides Discussions is worse
 * than one that costs requests, because a false negative is invisible to the
 * reader. Every assertion below is one half of the answer to that: the rows are
 * still in the panel and still counted; the sentence says which page it thinks
 * this is; anything from the last month is untouched; and the toolbar count
 * never promises conversations the panel will not show.
 */
describe("a site's front door", () => {
  const doorSubject = SubjectUrl.make("https://bankofamerica.com/")
  const doorPlaces = [recall, hnLinked, redditLinked, xLinked]

  const submittedAt = (id: DiscussionId, title: string, postedAt: number): Discussion =>
    Discussion.make({ id, title, submittedUrl: doorSubject, postedAt, author: null, venue: null })

  const doorReading = (knowledge: ReturnType<typeof begin>): Reading => ({
    address: "https://bankofamerica.com/",
    title: "Bank of America",
    traversed: [],
  arrival: Arrival.cases.Elsewhere.make({}),
    standing: Standing.cases.Enquiring.make({ subject: doorSubject, knowledge }),
    excludedBecause: null
  })

  /** One address, several submissions, all answered by Hacker News at once. */
  const submissions = (
    said: ReadonlyArray<{ readonly id: string; readonly title: string; readonly daysAgo: number }>
  ) => {
    const ids = said.map((s) => idOf("hackernews", s.id))
    let knowledge = begin(doorSubject, doorPlaces)
    knowledge = fold(
      knowledge,
      Consultation.cases.Answered.make({
        place: hnLinked,
        mentions: ids.map((id) =>
          Mention.cases.Linked.make({ subject: doorSubject, discussion: id, viaAlias: doorSubject })
        )
      }),
      {
        discussions: said.map((s, i) =>
          submittedAt(ids[i]!, s.title, NOW - s.daysAgo * 24 * 3_600_000)
        ),
        observations: ids.map((id, i) => observationOf(id, 100 + i))
      }
    )
    for (const place of [redditLinked, xLinked]) {
      knowledge = mark(knowledge, Consultation.cases.Silence.make({ place }))
    }
    return mark(knowledge, Consultation.cases.Silence.make({ place: recall }))
  }

  const OLD_EVENTS = [
    { id: "1", title: "Bankofamerica.com is down", daysAgo: 4000 },
    { id: "2", title: "Bank of America sues a customer over a wire transfer", daysAgo: 900 }
  ]

  it("folds the old Discussions rather than deleting them", () => {
    const panel = panelOf(doorReading(submissions(OLD_EVENTS)), NOW, AGREED)
    expect(panel.linked).toEqual([])
    expect(panel.folded).not.toBeNull()
    // Still here, still openable, never re-fetched.
    expect(panel.folded?.rows.map((r) => r.title)).toEqual([
      "Bank of America sues a customer over a wire transfer",
      "Bankofamerica.com is down"
    ])
  })

  it("says how many and which page it thinks this is", () => {
    // A suppression the reader cannot quantify is one they cannot argue with.
    const panel = panelOf(doorReading(submissions(OLD_EVENTS)), NOW, AGREED)
    expect(panel.folded?.says).toContain("2 Discussions link to this address")
    expect(panel.folded?.says).toContain("bankofamerica.com")
  })

  it("never says nobody discussed a page it is offering to show Discussions of", () => {
    // The lie this derivation exists to prevent, arriving through the one path
    // that takes rows OUT of the count.
    const panel = panelOf(doorReading(submissions(OLD_EVENTS)), NOW, AGREED)
    expect(panel.foundNothing).toBe(false)
    expect(panel.couldNotAsk).toBe(false)
  })

  it("wears no toolbar count, because there is nothing the panel would show", () => {
    const panel = panelOf(doorReading(submissions(OLD_EVENTS)), NOW, AGREED)
    expect(badgeOf(panel)).toBe("")
  })

  it("shows anything from the last month regardless of the verdict", () => {
    // The domain restriction, and the whole answer to "I don't want to miss a
    // page the moment it is discussed". The rule is not consulted for it.
    const panel = panelOf(
      doorReading(
        submissions([...OLD_EVENTS, { id: "3", title: "Bank of America outage today", daysAgo: 2 }])
      ),
      NOW,
      AGREED
    )
    expect(panel.linked.map((r) => r.title)).toEqual(["Bank of America outage today"])
    expect(panel.folded?.rows).toHaveLength(2)
    expect(badgeOf(panel)).toBe("1")
  })

  it("leaves a real page alone, however far apart its submissions are", () => {
    // `paulgraham.com/greatwork.html`, in miniature: resubmitted over years,
    // every submission about the same essay. Time spread is not a signal.
    const essay = submissions([
      { id: "1", title: "How to Do Great Work", daysAgo: 1000 },
      { id: "2", title: "How to Do Great Work (2023)", daysAgo: 400 },
      { id: "3", title: "How to Do Great Work", daysAgo: 90 }
    ])
    const reading: Reading = {
      address: "https://paulgraham.com/greatwork.html",
      title: "How to Do Great Work",
      traversed: [],
  arrival: Arrival.cases.Elsewhere.make({}),
      standing: Standing.cases.Enquiring.make({
        subject: SubjectUrl.make("https://paulgraham.com/greatwork.html"),
        knowledge: essay
      }),
      excludedBecause: null
    }
    const panel = panelOf(reading, NOW, AGREED)
    expect(panel.folded).toBeNull()
    expect(panel.linked).toHaveLength(3)
  })

  it("does nothing at all when the reader has asked to see everything", () => {
    const panel = panelOf(doorReading(submissions(OLD_EVENTS)), NOW, {
      ...AGREED,
      everyDiscussion: true
    })
    expect(panel.folded).toBeNull()
    expect(panel.linked).toHaveLength(2)
  })

  it("does not judge a Subject nobody submitted", () => {
    // A Silence is evidence that nobody discussed the page — the opposite of
    // evidence that the page is an entrance.
    let knowledge = begin(doorSubject, doorPlaces)
    for (const place of doorPlaces) {
      knowledge = mark(knowledge, Consultation.cases.Silence.make({ place }))
    }
    const panel = panelOf(doorReading(knowledge), NOW, AGREED)
    expect(panel.folded).toBeNull()
    expect(panel.foundNothing).toBe(true)
  })

  /**
   * `en.wikipedia.org/` redirects to `/wiki/Main_Page`, so the elected Subject
   * URL is a deep path and the rule declined to look at it — while the panel
   * drew eleven rows including "Wikipedia Is Down?" on the encyclopedia's front
   * page. It was the worst miss in the 82-page sweep, and the fix is that the
   * Reading carries the address its own browser started from.
   */
  describe("reached through a redirect", () => {
    const landed = SubjectUrl.make("https://en.wikipedia.org/wiki/Main_Page")

    const encyclopedia = (traversed: ReadonlyArray<string>): Reading => {
      const ids = ["1", "2"].map((n) => idOf("hackernews", n))
      let knowledge = begin(landed, doorPlaces)
      knowledge = fold(
        knowledge,
        Consultation.cases.Answered.make({
          place: hnLinked,
          mentions: ids.map((id) =>
            Mention.cases.Linked.make({ subject: landed, discussion: id, viaAlias: landed })
          )
        }),
        {
          discussions: [
            Discussion.make({
              id: ids[0]!,
              title: "Wikipedia Is Down?",
              submittedUrl: landed,
              postedAt: NOW - 1400 * 24 * 3_600_000,
              author: null, venue: null
            }),
            Discussion.make({
              id: ids[1]!,
              title: "Wikipedia is blacked out",
              submittedUrl: landed,
              postedAt: NOW - 5300 * 24 * 3_600_000,
              author: null, venue: null
            })
          ],
          observations: ids.map((id, i) => observationOf(id, 12 - i))
        }
      )
      for (const place of [redditLinked, xLinked, recall]) {
        knowledge = mark(knowledge, Consultation.cases.Silence.make({ place }))
      }
      return {
        address: "https://en.wikipedia.org/wiki/Main_Page",
        title: "Wikipedia",
        traversed,
        arrival: Arrival.cases.Elsewhere.make({}),
        standing: Standing.cases.Enquiring.make({ subject: landed, knowledge }),
        excludedBecause: null
      }
    }

    it("shows everything when nothing says this address was an entrance", () => {
      // Deep-linked straight to `/wiki/Main_Page`: no redirect was observed, so
      // there is no evidence and the rule stays out of it. Uncertainty runs
      // toward showing.
      const panel = panelOf(encyclopedia([]), NOW, AGREED)
      expect(panel.folded).toBeNull()
      expect(panel.linked).toHaveLength(2)
    })

    it("folds when the reader's own browser came through the front door", () => {
      const panel = panelOf(encyclopedia(["https://en.wikipedia.org/"]), NOW, AGREED)
      expect(panel.linked).toEqual([])
      expect(panel.folded?.rows).toHaveLength(2)
      expect(panel.folded?.says).toContain("en.wikipedia.org")
    })

    it("is not fooled by a chain that was deep all the way down", () => {
      // Arriving at an article through a link shortener is the ordinary case,
      // and every hop of it is a document.
      const panel = panelOf(encyclopedia(["https://t.co/xY7Kd2"]), NOW, AGREED)
      expect(panel.folded).toBeNull()
      expect(panel.linked).toHaveLength(2)
    })
  })
})
