/**
 * The rule that decides whether a Subject is a site's entrance.
 *
 * Every case in here is a real address with its real Hacker News submissions,
 * taken from the exact query the shipped connector issues — `query=<url>
 * &restrictSearchableAttributes=url&tags=story&hitsPerPage=50` — on 2026-08-09.
 * That matters more than it usually would: this rule's margins were measured
 * twice, against full retrieval and against the top-50 relevance window the
 * connector actually gets, and they are DIFFERENT. `sicpdistilled.com` scores
 * 0.526 on full retrieval and 0.400 live, because the window drops three of its
 * five submissions and one of the two survivors is a strict subset of the
 * other. A test written against full retrieval would pass at a threshold that
 * silences a classic in production.
 *
 * The classics are not decoration either. `paulgraham.com/greatwork.html` is
 * resubmitted over years; so is every essay worth reading twice. The obvious
 * version of this rule — Discussions spread over a long time means an
 * everlasting page — silences 98.2% of them, which is why time spread is
 * nowhere in the module and there is a test below asserting it stays nowhere.
 */
import { describe, expect, it } from "vitest"
import {
  anyIncident,
  anyRootish,
  builtHere,
  DISAGREEMENT,
  freshCount,
  HORIZON_MS,
  isFrontDoor,
  isRootish,
  judge,
  type Submission,
  titleAgreement,
  titleWords
} from "./FrontDoor.ts"

const at = (title: string, daysAgo: number): Submission => ({
  title,
  postedAt: Date.UTC(2026, 7, 9) - daysAgo * 24 * 60 * 60 * 1000
})

const NOW = Date.UTC(2026, 7, 9)

describe("what counts as a front door address", () => {
  it.each([
    ["a bare host", "https://facebook.com/"],
    ["no trailing slash", "https://facebook.com"],
    ["a locale root", "https://example.com/en"],
    ["a regional root", "https://example.com/en-GB"],
    ["an index file", "https://example.com/index.html"],
    ["a Microsoft-shaped default", "https://example.com/default.aspx"],
    ["the word home", "https://example.com/home"]
  ])("%s is rootish", (_name, address) => {
    expect(isRootish(address)).toBe(true)
  })

  it.each([
    ["an essay", "https://paulgraham.com/greatwork.html"],
    ["a slug", "https://danluu.com/empirical-pl/"],
    // The measured cost of widening to `depth <= 1` is 27.6% of real pages —
    // every flat-site blog post. This is the case that widening breaks.
    ["a flat-site post", "https://example.com/why-i-left"],
    ["a deep generic path", "https://news.ycombinator.com/newest"],
    ["a pricing page", "https://openai.com/pricing"],
    // A WordPress permalink lives at the root path and is a document. The
    // benefit of the doubt goes to showing, which is the direction every
    // uncertainty in this module runs.
    ["a query-string permalink", "https://example.com/?p=1234"],
    ["a non-web scheme", "chrome://extensions"]
  ])("%s is not rootish", (_name, address) => {
    expect(isRootish(address)).toBe(false)
  })
})

describe("judging the Aliases and not only the elected address", () => {
  /**
   * The submissions `en.wikipedia.org/wiki/Main_Page` actually returns, from the
   * shipped connector's own query on 2026-08-10. Thirteen of them, on the
   * encyclopedia's front door, and every one about the site rather than about a
   * page: this was the worst miss in the 82-page sweep.
   */
  const wikipedia = [
    at("Wikipedia Is Down?", 1400),
    at("Wikipedia is blacked out", 5300),
    at("Wikipedia is now a client-side app", 3800),
    at("Even Wikipedia Celebrates the April Fools' Day", 4100),
    at("Kiwi Farms", 1700),
    at("Wikipedia: Internal Error (Too many connections)", 4500),
    at("Wikipedia was down", 750),
    at("Flashed Face Distortion Effect", 850)
  ]

  it("does not judge Wikipedia's front door on the address it redirected to", () => {
    // `/wiki/Main_Page` is a two-segment path. Nothing about it says entrance.
    expect(isRootish("https://en.wikipedia.org/wiki/Main_Page")).toBe(false)
    expect(judge(["https://en.wikipedia.org/wiki/Main_Page"], wikipedia)._tag).toBe("Document")
  })

  it("judges it on the address the reader's browser started from", () => {
    // ADR 0015's evidence: the reader's own browser traversed the redirect.
    const verdict = judge(
      ["https://en.wikipedia.org/wiki/Main_Page", "https://en.wikipedia.org/"],
      wikipedia
    )
    expect(isFrontDoor(verdict)).toBe(true)
  })

  it("gives the elected address no privilege over the others", () => {
    expect(anyRootish(["https://example.com/a/deep/path", "https://example.com/"])).toBe(true)
    expect(anyRootish(["https://example.com/", "https://example.com/a/deep/path"])).toBe(true)
  })

  it("is not made true by a chain of deep addresses", () => {
    // A `t.co` hop into an article is the common case and must stay a Document.
    expect(
      anyRootish(["https://blog.example.com/why-i-left", "https://t.co/xY7Kd2"])
    ).toBe(false)
  })

  it("leaves the pages the two refused widenings would have folded", () => {
    // ADR 0019 refuses both on measurement, and both are one commit away from
    // looking obvious again. These are the loudest page each would silence.

    // The generic-path word list: `boringcompany.com/faq` at 624 points, whose
    // two submissions genuinely are about that page. 616 `host/<entrance word>`
    // addresses were measured; the list folds 22 front doors and 17 real pages.
    expect(
      judge(["https://www.boringcompany.com/faq"], [
        at("The Boring Company FAQ", 2000),
        at("How The Boring Company is increasing tunneling speed", 1900)
      ])._tag
    ).toBe("Document")

    // "the single title is only the site's own name": `18words.com` at 1,160
    // points. A product named after what it does looks exactly like a masthead.
    expect(
      judge(["https://18words.com/"], [at("Show HN: 18 Words", 200)])._tag
    ).toBe("Document")
  })

  it("judges nothing at all when the Subject has no submissions", () => {
    // A Silence is evidence nobody discussed the page — the opposite of
    // evidence that it is an entrance. Widening the addresses must not widen
    // this, or one quiet week on a redirecting host marks it permanently.
    expect(judge(["https://example.com/en-GB/home", "https://example.com/"], [])._tag)
      .toBe("Document")
  })
})

/**
 * The correction the widened evidence forced. ADR 0017 shipped saying its safety
 * evidence was thinnest exactly here and asked for 150+ Show HN homepage
 * launches; 1,136 were seeded, and the rule as shipped folded away every row of
 * 68 of them. A founder resubmitting their own homepage with a different pitch
 * each time is what low title agreement actually looks like on a real product.
 */
describe("a homepage somebody said they built", () => {
  // gitdiagram.com, 222 points, exactly as Hacker News holds it.
  const gitdiagram = [
    at("Show HN: Instantly visualize any codebase as an interactive diagram", 400),
    at("Show HN: Instantly understand any GitHub repo", 300),
    at("Visualize Any Repository", 120)
  ]

  it("disagrees with itself the way every relaunched product does", () => {
    expect(titleAgreement(gitdiagram)).toBeLessThan(DISAGREEMENT)
  })

  it("is not a front door, because somebody said the address IS the thing", () => {
    expect(judge(["https://gitdiagram.com/"], gitdiagram)._tag).toBe("Document")
    expect(builtHere(gitdiagram)).toBe(true)
  })

  it("does not let a Show HN buy a site out of the incident clause", () => {
    // The abuse this ordering exists to refuse: one submission claiming to have
    // built something, pointed at a site whose other submissions are outages.
    const github = [
      at("Show HN: I built a text to JSON local tool in GitHub Spark", 200),
      at("GitHub is down", 900),
      at("GitHub is down", 1500)
    ]
    expect(judge(["https://github.com/"], github)).toMatchObject({
      _tag: "FrontDoor",
      because: "incident"
    })
  })

  it("does not read Ask HN or Tell HN as somebody having built the page", () => {
    // "Tell HN: GitHub Apps – Private key is not private" is a submission about
    // an organisation. Only Show and Launch carry the claim.
    expect(builtHere([at("Tell HN: GitHub Apps – Private key is not private", 100)])).toBe(false)
    expect(builtHere([at("Ask HN: Who is hiring?", 100)])).toBe(false)
    expect(builtHere([at("Launch HN: ProvenMetal (YC S26) delivers circuit boards", 100)])).toBe(true)
  })
})

describe("reading a title for what it is about", () => {
  it("drops Hacker News' own resubmission year", () => {
    // Without this, "Do Things That Don't Scale" and the same essay reposted as
    // "(2013)" are two different titles, and the classics score as divergent.
    expect(titleAgreement([at("Do Things That Don't Scale", 900), at("Do Things That Don't Scale (2013)", 40)]))
      .toBe(1)
  })

  it("drops the Show HN convention, which is not the subject", () => {
    expect([...titleWords("Show HN: Ghostty 1.0")]).toEqual(["ghostty", "1", "0"])
  })

  it("drops a format tag", () => {
    expect(titleWords("Reflections on Trusting Trust [pdf]").has("pdf")).toBe(false)
  })

  it("keeps the words that say which event this is", () => {
    // The stoplist must never grow domain words. "down" and "outage" are
    // precisely what differs between two events at one organisation.
    expect(titleWords("Netflix is down").has("down")).toBe(true)
  })

  it("agrees with itself", () => {
    expect(titleAgreement([at("GitHub is down", 10), at("GitHub is down", 400)])).toBe(1)
  })

  it("is 1 for a single submission, so one posting is never a front door", () => {
    // 27 of the 35 rootish real pages in the measured corpus have exactly one
    // submission. Judging them on divergence they cannot have is how the rule
    // would acquire the false negatives it exists to avoid.
    expect(titleAgreement([at("Ghostty 1.0", 300)])).toBe(1)
    expect(judge(["https://ghostty.org/"], [at("Ghostty 1.0", 300)])._tag).toBe("Document")
  })
})

describe("front doors, from live submissions", () => {
  // The product owner's own two examples.
  it("bankofamerica.com — two outages, ten years apart", () => {
    const verdict = judge(["https://bankofamerica.com/"], [
      at("Bankofamerica.com is down", 4800),
      at("Bank of America Outage - Transfers, Balances, and Cards down for some users", 1200)
    ])
    expect(verdict._tag).toBe("FrontDoor")
  })

  it("facebook.com — caught by the incident clause, not by divergence", () => {
    // Live, the window returns four submissions whose agreement is 0.260 — but
    // the two that matter, "Facebook-owned sites were down" and "Facebook was
    // down", score 0.50 between them and would pass the threshold on their own.
    // This is the case that justifies the incident clause existing at all.
    const both = [at("Facebook-owned sites were down", 1600), at("Facebook was down", 2000)]
    expect(titleAgreement(both)).toBeGreaterThan(DISAGREEMENT)
    expect(isFrontDoor(judge(["https://facebook.com/"], both))).toBe(true)
  })

  it("github.com — four identical titles, caught only by the incident clause", () => {
    const same = [
      at("GitHub is down", 300),
      at("GitHub is down", 900),
      at("GitHub is down", 1500),
      at("GitHub is down", 2200)
    ]
    expect(titleAgreement(same)).toBe(1)
    expect(isFrontDoor(judge(["https://github.com/"], same))).toBe(true)
  })

  it("amazon.com — three different events, caught by divergence", () => {
    const verdict = judge(["https://amazon.com/"], [
      at("Amazon.com", 5000),
      at("Amazon.com now uses HTTPS by default", 3400),
      at("Amzn finally enforcing SSL", 3400)
    ])
    expect(verdict).toMatchObject({ _tag: "FrontDoor", because: "titles-disagree" })
  })
})

describe("the pages this rule exists not to break", () => {
  it("paulgraham.com/greatwork.html — resubmitted for years, one document", () => {
    // The counterexample that refutes the time-spread rule. Five submissions
    // spanning three years, every one of them about the same essay.
    const essay = [
      at("How to Do Great Work (2023)", 1000),
      at("How to Do Great Work", 900),
      at("How to Do Great Work", 400),
      at("How to Do Great Work (2023)", 200),
      at("How to Do Great Work", 3)
    ]
    expect(titleAgreement(essay)).toBe(1)
    expect(judge(["https://paulgraham.com/greatwork.html"], essay)._tag).toBe("Document")
  })

  it("danluu.com — retitled by submitters, and saved by root scoping alone", () => {
    // Title divergence ALONE fails here: submitters rewrite his headlines, so
    // eight submissions of one essay score 0.366. It is a deep path, so the
    // rule never reaches the title half. This is why both signals are required.
    const retitled = [
      at("Literature review on the benefits of static types (2014)", 3000),
      at("Static vs. Dynamic Languages", 2600),
      at("The evidence behind strong claims about static vs. dynamic languages", 2000),
      at("Literature review on the benefits of static types", 1500),
      at("Static vs. dynamic languages literature review", 1100),
      at("Benefits of static types (2014)", 700),
      at("Static v. dynamic languages", 300)
    ]
    expect(titleAgreement(retitled)).toBeLessThan(DISAGREEMENT + 0.05)
    expect(judge(["https://danluu.com/empirical-pl/"], retitled)._tag).toBe("Document")
  })

  it("grugbrain.dev — a rootish classic, saved by title agreement alone", () => {
    // The mirror of danluu: root scoping alone silences this, title agreement
    // alone saves it. Live agreement 0.653.
    const grug = [
      at("The Grug Brained Developer", 900),
      at("The Grug Brained Developer", 600),
      at("Grug Brained Developer", 200),
      at("The Grug Brained Developer: A layman's guide to thinking like the self-aware smol brained", 20)
    ]
    expect(titleAgreement(grug)).toBeGreaterThan(DISAGREEMENT)
    expect(judge(["https://grugbrain.dev/"], grug)._tag).toBe("Document")
  })

  it("sicpdistilled.com — the thinnest margin there is, and it is live", () => {
    // 0.400 against a 0.35 threshold. Every threshold at or above 0.40 silences
    // this classic in production, which is the whole reason the threshold is
    // not the 0.5 that looks free on full retrieval.
    const two = [at("SICP Distilled", 2900), at("SICP Distilled: Wizard Book in Clojure", 2900)]
    expect(titleAgreement(two)).toBeCloseTo(0.4, 3)
    expect(judge(["https://sicpdistilled.com/"], two)._tag).toBe("Document")
  })

  it("does not fire on a Launch HN whose product does read-only debugging", () => {
    // A real defect from the first lexicon, which had `read-only` in it. The
    // Show/Ask/Tell/Launch HN guard is what removed it.
    const launch = [at("Launch HN: HyperProbe (YC S26) – Agents that do read-only debugging in prod", 5)]
    expect(anyIncident(launch)).toBe(false)
    expect(judge(["https://hyperprobe.co/"], launch)._tag).toBe("Document")
  })

  it("never judges a Subject nobody has submitted", () => {
    // A Silence is evidence that nobody discussed the page — the opposite of
    // evidence that the page is an entrance. Conflating them would let one
    // quiet week on a new site mark it permanently.
    expect(judge(["https://facebook.com/"], [])._tag).toBe("Document")
  })
})

describe("time spread is not a signal, and stays out", () => {
  it.each([
    ["ten years", 3650],
    ["five years", 1825],
    ["one year", 365]
  ])("%s of spread does not make one document a front door", (_name, days) => {
    // Measured: at a 365-day threshold, time spread suppresses 75.9% of front
    // doors AND 98.2% of the classics, at 57.5% precision — no information at
    // any operating point. This asserts the module has not quietly acquired it.
    const spread = [at("How to Do Great Work", days), at("How to Do Great Work", 1)]
    expect(judge(["https://paulgraham.com/greatwork.html"], spread)._tag).toBe("Document")
  })

  it("a front door verdict is unchanged by when the submissions landed", () => {
    const near = [at("Bank of America is down", 3), at("Bank of America sues a customer", 4)]
    const far = [at("Bank of America is down", 4000), at("Bank of America sues a customer", 4)]
    expect(judge(["https://bankofamerica.com/"], near)._tag)
      .toBe(judge(["https://bankofamerica.com/"], far)._tag)
  })
})

describe("the freshness horizon", () => {
  it("counts only what landed inside it", () => {
    expect(freshCount([at("x", 1), at("y", 29), at("z", 31), at("w", 4000)], NOW)).toBe(2)
  })

  it("never counts a submission whose date the Network did not give", () => {
    // A missing date renders as 1970 if treated as a number. Treating it as
    // fresh would be the other error, and this rule's uncertainties run toward
    // showing — but "fresh" is what EXEMPTS a row from folding, so an undated
    // row is folded rather than shown, and it is still one click away.
    expect(freshCount([{ title: "x", postedAt: null }], NOW)).toBe(0)
  })

  it("is thirty days", () => {
    expect(HORIZON_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })
})
