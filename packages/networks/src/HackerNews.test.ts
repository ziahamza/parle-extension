/**
 * Hacker News is the connector that has to work, so these tests are about the
 * ways it could look like it works and not.
 *
 * Every fixture in `Recorded.ts` used here was captured live from Algolia on
 * 2026-08-08, so "the search engine returns an article one digit away from the
 * one you asked about" is not a hypothetical this file invents — it is the
 * first query anyone would write, and its sixth hit.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { type Consultation } from "@parle/domain/Coverage"
import { Alias, SubjectUrl } from "@parle/domain/Subject"
import { TestClock } from "effect/testing"
import { HackerNews } from "./HackerNews.ts"
import type { Discussion } from "./Discussion.ts"
import { DiscussionSink } from "./Discussion.ts"
import { ObservationSink } from "./Observation.ts"
import { type Exchange, recording, recordingRows, recordingSink } from "./Recording.ts"
import { hackerNewsLinked, hackerNewsTopical } from "./Recorded.ts"

const SUBJECT = SubjectUrl.make("https://www.nature.com/articles/d41586-024-02012-5")
const TITLE = "Not all open source AI models are open"

const alias = (url: string) => Alias.make({ url, evidence: { _tag: "Redirected", from: url } })

const ok = (body: string): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "application/json; charset=UTF-8" }
})

interface Run {
  readonly consultations: ReadonlyArray<Consultation>
  readonly asked: ReadonlyArray<string>
  readonly observed: ReadonlyArray<{ readonly receivedAt: number; readonly score: number | null }>
  readonly noted: ReadonlyArray<Discussion>
}

const run = async (
  answer: (url: string) => Exchange,
  ask: (source: HackerNews["Service"]) => Stream.Stream<Consultation, never, never>,
  at = 1_700_000_000_000
): Promise<Run> => {
  const wire = recording(answer)
  const sink = recordingSink()
  const rows = recordingRows()

  const consultations = await Effect.runPromise(
    Effect.gen(function*() {
      yield* TestClock.setTime(at)
      const source = yield* HackerNews
      return yield* Stream.runCollect(ask(source))
    }).pipe(
      Effect.provideService(ObservationSink, sink.sink),
      Effect.provideService(DiscussionSink, rows.sink),
      Effect.provide(
        HackerNews.layer.pipe(Layer.provide(wire.layer))
      ),
      Effect.provide(TestClock.layer())
    )
  )

  return {
    consultations,
    asked: wire.asked,
    observed: sink.seen.map((o) => ({ receivedAt: o.receivedAt, score: o.score })),
    noted: rows.noted
  }
}

/**
 * The same, on the real clock.
 *
 * Retries sleep, and a `TestClock` nobody advances turns a retried status into
 * a hung test rather than a failed one — which is worth knowing, but not here.
 */
const runLive = async (
  answer: (url: string) => Exchange,
  ask: (source: HackerNews["Service"]) => Stream.Stream<Consultation, never, never>
): Promise<Run> => {
  const wire = recording(answer)
  const sink = recordingSink()
  const rows = recordingRows()

  const consultations = await Effect.runPromise(
    Effect.gen(function*() {
      const source = yield* HackerNews
      return yield* Stream.runCollect(ask(source))
    }).pipe(
      Effect.provideService(ObservationSink, sink.sink),
      Effect.provideService(DiscussionSink, rows.sink),
      Effect.provide(
        HackerNews.layer.pipe(Layer.provide(wire.layer))
      )
    )
  )

  return {
    consultations,
    asked: wire.asked,
    observed: sink.seen.map((o) => ({ receivedAt: o.receivedAt, score: o.score })),
    noted: rows.noted
  }
}

const terminal = (consultations: ReadonlyArray<Consultation>): Consultation => {
  const last = consultations[consultations.length - 1]
  if (last === undefined) throw new Error("the connector emitted nothing at all")
  return last
}

const mentionsOf = (consultation: Consultation) =>
  consultation._tag === "Answered" ? consultation.mentions : []

describe("the shape of every Lookup", () => {
  it("emits Asking first and exactly one terminal, whatever happened", async () => {
    const { consultations } = await run(() => ok(hackerNewsLinked), (hn) => hn.linked(SUBJECT, []))
    expect(consultations.map((c) => c._tag)).toEqual(["Asking", "Answered"])
  })

  it("still emits Asking then a terminal when the Network refuses", async () => {
    const { consultations } = await run(
      () => ({ status: 403, body: "no", headers: { "content-type": "text/html" } }),
      (hn) => hn.linked(SUBJECT, [])
    )
    expect(consultations.map((c) => c._tag)).toEqual(["Asking", "Refusal"])
  })

  it("names the Place with the Question, so the two questions are separable", async () => {
    const linked = await run(() => ok(hackerNewsLinked), (hn) => hn.linked(SUBJECT, []))
    const topical = await run(() => ok(hackerNewsTopical), (hn) => hn.topical(SUBJECT, TITLE))
    expect(terminal(linked.consultations).place).toEqual({
      _tag: "Network",
      network: "hackernews",
      question: "linked"
    })
    expect(terminal(topical.consultations).place).toEqual({
      _tag: "Network",
      network: "hackernews",
      question: "topical"
    })
  })
})

describe("what a panel row is drawn from", () => {
  it("hands over the title and the posting time, not only the identity", async () => {
    // A Mention carries a DiscussionId and its evidence, which is everything
    // Coverage needs and nothing a row can be drawn from. A connector that read
    // the title off the wire and dropped it would make every row untitled, and
    // the only repair would be asking the Network again.
    const { noted } = await run(() => ok(hackerNewsLinked), (hn) => hn.linked(SUBJECT, []))
    const top = noted.find((row) => (row.id.nativeId as string) === "40786237")

    expect(top?.title).toBe("Not all 'open source' AI models are open: here's a ranking")
    expect(top?.submittedUrl).toBe(SUBJECT as string)
    expect(top?.author).toBe("weinzierl")
    // `created_at_i` is epoch SECONDS. Read as milliseconds this row is a
    // conversation from January 1970, which then sorts and ages as one.
    expect(top?.postedAt).toBe(1719307028 * 1000)
  })

  it("notes a row for every Mention it went on to make, and no others", async () => {
    const { consultations, noted } = await run(
      () => ok(hackerNewsLinked),
      (hn) => hn.linked(SUBJECT, [])
    )
    const claimed = mentionsOf(terminal(consultations)).map((m) => m.discussion.nativeId as string)

    expect(noted.map((row) => row.id.nativeId as string).sort()).toEqual([...claimed].sort())
  })

  it("says it does not know when a hit carries no posting time", async () => {
    // A zero would render as 1970 and, worse, would read as OLDER than any
    // Last Look — so "we were not told" has to survive as its own answer.
    const { noted } = await run(
      () =>
        ok(JSON.stringify({
          hits: [{ objectID: "1", title: "t", url: SUBJECT as string, points: 1 }]
        })),
      (hn) => hn.linked(SUBJECT, [])
    )

    expect(noted).toHaveLength(1)
    expect(noted[0]?.postedAt).toBeNull()
  })
})

describe("the strong tier is not taken on Algolia's word", () => {
  it("drops the hit whose submitted URL is a DIFFERENT article", async () => {
    // Live 2026-08-08: the url-restricted query for `…-02012-5` returns six
    // hits and the sixth, item 40802874, was submitted under `…-02082-5`.
    // Kept, it is a Linked Mention — the only tier that discharges ADR 0001's
    // disclosure argument and licenses an authenticated request against the
    // reader's own X account.
    const { consultations } = await run(() => ok(hackerNewsLinked), (hn) => hn.linked(SUBJECT, []))
    const ids = mentionsOf(terminal(consultations)).map((m) => m.discussion.nativeId as string)

    expect(ids).toHaveLength(5)
    expect(ids).not.toContain("40802874")
  })

  it("records which Alias each Mention matched", async () => {
    const { consultations } = await run(() => ok(hackerNewsLinked), (hn) => hn.linked(SUBJECT, []))
    const mentions = mentionsOf(terminal(consultations))
    expect(mentions.every((m) => m._tag === "Linked")).toBe(true)
    for (const mention of mentions) {
      if (mention._tag === "Linked") expect(mention.viaAlias).toBe(SUBJECT as string)
    }
  })

  it("asks about every Alias, not only the Subject URL", async () => {
    // A Subject reachable under two addresses whose Discussion was submitted
    // under the second is a systematic STRONG-tier false negative if we ask
    // once. Nobody files a bug for a Mention that never appeared.
    const other = "https://nature.com/articles/d41586-024-02012-5.amp"
    const answer = (url: string): Exchange =>
      url.includes(encodeURIComponent(other))
        ? ok(
          JSON.stringify({
            hits: [{ objectID: "99999999", title: "amp", url: other, points: 5, num_comments: 2 }]
          })
        )
        : ok(JSON.stringify({ hits: [] }))

    const { consultations, asked } = await run(answer, (hn) => hn.linked(SUBJECT, [alias(other)]))

    expect(asked).toHaveLength(2)
    const mentions = mentionsOf(terminal(consultations))
    expect(mentions).toHaveLength(1)
    const only = mentions[0]
    if (only?._tag !== "Linked") throw new Error("expected a Linked Mention")
    expect(only.viaAlias).toBe(other)
  })
})

describe("nothing found is never the same as nothing said", () => {
  it("answers Silence — not Answered with no Mentions — when the search is empty", async () => {
    const { consultations } = await run(
      () => ok(JSON.stringify({ hits: [] })),
      (hn) => hn.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Silence")
  })

  it("answers Silence when every hit was somebody else's article", async () => {
    const { consultations } = await run(
      () =>
        ok(
          JSON.stringify({
            hits: [{ objectID: "1", title: "x", url: "https://elsewhere.example/a", points: 1 }]
          })
        ),
      (hn) => hn.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Silence")
  })

  it("answers Garble — not Silence — when a 200 carries an interstitial", async () => {
    // A Cloudflare or captive-portal page arrives as text/html with a 200 and
    // parses to zero results. Filed as a Silence it would be cached as evidence
    // about the world and would close the X gate as a promise kept.
    const { consultations } = await run(
      () => ({
        status: 200,
        body: "<html><body>Checking your browser…</body></html>",
        headers: { "content-type": "text/html; charset=utf-8" }
      }),
      (hn) => hn.linked(SUBJECT, [])
    )
    const end = terminal(consultations)
    expect(end._tag).toBe("Garble")
  })

  it("answers Garble when the body is JSON but not an answer we know", async () => {
    const { consultations } = await run(
      () => ok(JSON.stringify({ message: "index not ready" })),
      (hn) => hn.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Garble")
  })

  it("answers Refusal — never Silence — on a 403", async () => {
    const { consultations } = await run(
      () => ({ status: 403, body: "", headers: { "content-type": "text/plain" } }),
      (hn) => hn.linked(SUBJECT, [])
    )
    const end = terminal(consultations)
    expect(end._tag).toBe("Refusal")
    if (end._tag === "Refusal") expect(end.reason).toBe("forbidden")
  })

  it("never retries a 403, and does retry a 429", async () => {
    // 403 is deliberately outside Effect's transient set: ADR 0013 makes it the
    // ORDINARY Reddit answer and ADR 0001 the ordinary cold-session X answer,
    // and retrying a refusal spends the reader's own budget to learn the same
    // thing. 429 is transient and is backed off instead.
    const forbidden = await runLive(
      () => ({ status: 403, body: "", headers: { "content-type": "text/plain" } }),
      (hn) => hn.linked(SUBJECT, [])
    )
    expect(forbidden.asked).toHaveLength(1)

    const limited = await runLive(
      () => ({ status: 429, body: "", headers: { "content-type": "text/plain" } }),
      (hn) => hn.linked(SUBJECT, [])
    )
    expect(limited.asked.length).toBeGreaterThan(1)

    const end = terminal(limited.consultations)
    expect(end._tag).toBe("Refusal")
    if (end._tag === "Refusal") expect(end.reason).toBe("rate-limited")
  })
})

describe("Observations are stamped with our receive time", () => {
  it("uses the Clock, not the hit's created_at or updated_at", async () => {
    // The fixture's hits carry created_at 2024-06 (when the THREAD was posted)
    // and updated_at 2024-09 (Algolia's reindex). Neither says when `points`
    // was true, so neither may be used.
    const at = 1_800_000_000_000
    const { observed } = await run(() => ok(hackerNewsLinked), (hn) => hn.linked(SUBJECT, []), at)

    expect(observed).toHaveLength(5)
    expect(observed.every((o) => o.receivedAt === at)).toBe(true)
  })

  it("carries the score through", async () => {
    const { observed } = await run(() => ok(hackerNewsLinked), (hn) => hn.linked(SUBJECT, []))
    expect(observed.map((o) => o.score)).toEqual([127, 8, 4, 2, 1])
  })

  it("hands over nothing when the Network refused", async () => {
    const { observed } = await run(
      () => ({ status: 403, body: "", headers: { "content-type": "text/plain" } }),
      (hn) => hn.linked(SUBJECT, [])
    )
    expect(observed).toEqual([])
  })
})

describe("the weak tier", () => {
  it("survives a text post, which has no URL at all", async () => {
    // Two of the fixture's hits are Ask HN stories with `url: null`. A schema
    // requiring `url` turns one of those into a Garble for the whole Lookup.
    const { consultations } = await run(() => ok(hackerNewsTopical), (hn) => hn.topical(SUBJECT, TITLE))
    const end = terminal(consultations)
    expect(end._tag).toBe("Answered")
    expect(mentionsOf(end).map((m) => m.discussion.nativeId as string)).toEqual([
      "36615023",
      "38107077",
      "42430296"
    ])
  })

  it("does not re-report the Subject's own submissions at the weak tier", async () => {
    // Five of the fixture's eight hits ARE the Subject. `linked` reports those,
    // with evidence. Repeating them here puts the same Discussion in Coverage
    // twice, once with evidence that understates what we know.
    const { consultations } = await run(() => ok(hackerNewsTopical), (hn) => hn.topical(SUBJECT, TITLE))
    const ids = mentionsOf(terminal(consultations)).map((m) => m.discussion.nativeId as string)
    expect(ids).not.toContain("40786237")
  })

  it("carries the title that was searched, as the evidence for the claim", async () => {
    const { consultations } = await run(() => ok(hackerNewsTopical), (hn) => hn.topical(SUBJECT, TITLE))
    for (const mention of mentionsOf(terminal(consultations))) {
      expect(mention._tag).toBe("Topical")
      if (mention._tag === "Topical") expect(mention.matchedTitle).toBe(TITLE)
    }
  })

  it("restricts the search to stories", async () => {
    // Without `tags=story` Algolia returns comment hits, which carry no title
    // and no url of their own — only `story_title` and `story_url`. A Mention
    // built from one names the parent thread while claiming evidence from the
    // child.
    const { asked } = await run(() => ok(hackerNewsTopical), (hn) => hn.topical(SUBJECT, TITLE))
    expect(asked[0]).toContain("tags=story")
  })
})

/**
 * ADR 0018. Two separate promises, and they are not the same promise:
 * that we ask Algolia in the way that actually finds things, and that we say so
 * when the answer we got back was cut off by the size of our own request.
 */
describe("asking in the way that finds things", () => {
  it("turns typo tolerance off on the URL search", async () => {
    // Measured live against 305 known-submitted pages: with typo tolerance on,
    // four returned `nbHits: 0` — a flat "never seen this page" about pages
    // carrying 2,594, 2,611, 2,504 and 1,032 points. `min` and `strict` are not
    // enough; only `false` returns them. This is the highest-recall line in the
    // connector and it costs no request and no byte.
    const { asked } = await run(() => ok(hackerNewsLinked), (hn) => hn.linked(SUBJECT, []))
    expect(asked[0]).toContain("typoTolerance=false")
  })

  it("leaves typo tolerance ON for the title search", async () => {
    // A title is prose typed by a human, which is the case typo tolerance is
    // for. Copying the URL search's setting across would trade a measured gain
    // on one question for an unmeasured loss on the other.
    const { asked } = await run(() => ok(hackerNewsTopical), (hn) => hn.topical(SUBJECT, TITLE))
    expect(asked[0]).not.toContain("typoTolerance")
  })
})

describe("saying when the answer was cut off by our own window", () => {
  /** `count` hits, all submitted under `SUBJECT`, out of a claimed `nbHits`. */
  const windowOf = (count: number, nbHits: number): string =>
    JSON.stringify({
      nbHits,
      hits: Array.from({ length: count }, (_, i) => ({
        objectID: `w${i}`,
        title: `Submission ${i}`,
        url: SUBJECT as string,
        author: "someone",
        created_at_i: 1719307028,
        points: 10,
        num_comments: 2
      }))
    })

  it("never marks a title search, however full its window", async () => {
    // Found in a real browser, not here: a title search fills its window on 42%
    // of pages, so disclosing it put "this is not all of them" on nearly every
    // ordinary article. It is also the wrong claim — the top thirty by
    // relevance is a sample by design, drawn under the words "not provably this
    // page", and a window announces an enumeration nobody attempted.
    const crowded = JSON.stringify({
      nbHits: 3413,
      hits: Array.from({ length: 30 }, (_, i) => ({
        objectID: `t${i}`,
        title: `On this topic ${i}`,
        url: `https://elsewhere.example/${i}`,
        created_at_i: 1719307028,
        points: 5,
        num_comments: 1
      }))
    })
    const { consultations } = await run(() => ok(crowded), (hn) => hn.topical(SUBJECT, TITLE))
    const end = terminal(consultations)
    expect(end._tag).toBe("Answered")
    if (end._tag === "Answered") expect(end.windowed).not.toBe(true)
  })

  it("does not mark an answer that came back short of the window", async () => {
    // The ordinary case, and it must stay unmarked: a note on every page is a
    // note nobody reads, and it would be false besides.
    const { consultations } = await run(() => ok(windowOf(3, 3)), (hn) => hn.linked(SUBJECT, []))
    const end = terminal(consultations)
    expect(end._tag).toBe("Answered")
    if (end._tag === "Answered") expect(end.windowed).not.toBe(true)
  })

  it("does not mark a full window when the Network had nothing more", async () => {
    // Exactly fifty submissions and exactly fifty in the index is a complete
    // answer that happens to be the size of the window. Marking it would
    // announce a gap that is not there.
    const { consultations } = await run(() => ok(windowOf(50, 50)), (hn) => hn.linked(SUBJECT, []))
    const end = terminal(consultations)
    if (end._tag === "Answered") expect(end.windowed).not.toBe(true)
  })

  it("marks an Answered whose window filled with more behind it", async () => {
    const { consultations } = await run(() => ok(windowOf(50, 987)), (hn) => hn.linked(SUBJECT, []))
    const end = terminal(consultations)
    expect(end._tag).toBe("Answered")
    if (end._tag === "Answered") expect(end.windowed).toBe(true)
  })

  it("marks a SILENCE whose window filled — the case that would otherwise be cached", async () => {
    // Fifty hits, none of them this page, and 1,973,692 more Algolia did not
    // send. That is `github.com`, measured. Unmarked it is an ordinary Silence:
    // "nobody discussed this page", written into `LookupRecord` and believed
    // for as long as `silenceTtl` allows.
    const elsewhere = JSON.stringify({
      nbHits: 1_973_692,
      hits: Array.from({ length: 50 }, (_, i) => ({
        objectID: `x${i}`,
        title: `Something else ${i}`,
        url: `https://github.com/someone/repo-${i}`,
        created_at_i: 1719307028,
        points: 3,
        num_comments: 0
      }))
    })
    const { consultations } = await run(
      () => ok(elsewhere),
      (hn) => hn.linked(SubjectUrl.make("https://github.com/"), [])
    )
    const end = terminal(consultations)
    expect(end._tag).toBe("Silence")
    if (end._tag === "Silence") expect(end.windowed).toBe(true)
  })

  it("marks the union when any one Alias hit its window", async () => {
    // The Aliases are asked independently and the reader is shown the union, so
    // an unbounded gap under any one of them is a gap in what they see.
    const other = "https://nature.com/articles/d41586-024-02012-5"
    const { consultations } = await run(
      (url) => ok(url.includes("www.nature.com") ? windowOf(2, 2) : windowOf(50, 400)),
      (hn) => hn.linked(SUBJECT, [alias(other)])
    )
    const end = terminal(consultations)
    if (end._tag === "Answered") expect(end.windowed).toBe(true)
  })

  it("says nothing about the window when Algolia omits nbHits", async () => {
    // The field is advisory. Missing, we do not know whether the answer was
    // whole — and "we do not know" must render as no claim, never as a claim of
    // completeness dressed up as silence, and never as a Garble.
    const noTotal = JSON.stringify({
      hits: Array.from({ length: 50 }, (_, i) => ({
        objectID: `n${i}`,
        title: `Submission ${i}`,
        url: SUBJECT as string,
        created_at_i: 1719307028,
        points: 10,
        num_comments: 1
      }))
    })
    const { consultations } = await run(() => ok(noTotal), (hn) => hn.linked(SUBJECT, []))
    const end = terminal(consultations)
    expect(end._tag).toBe("Answered")
    if (end._tag === "Answered") expect(end.windowed).not.toBe(true)
  })
})

describe("a Topical Lookup never sends the address as a title", () => {
  // The battle battery caught the extension firing a Topical Lookup with
  // Chrome's placeholder tab title — the raw URL — before <title> parsed,
  // re-leaking the very parameters the canonicalizer had stripped from the
  // address queries. This is the wire's own guarantee that it cannot happen,
  // whatever an upstream race does.
  const withheldForNoTitle = (consultations: ReadonlyArray<Consultation>) => {
    const end = terminal(consultations)
    return end._tag === "Withholding" && end.reason === "no-title"
  }

  it("withholds, and issues NO request, when the title is the Subject URL", async () => {
    const { consultations, asked } = await run(
      () => ok(hackerNewsTopical),
      (hn) => hn.topical(SUBJECT, SUBJECT as string)
    )
    expect(withheldForNoTitle(consultations)).toBe(true)
    expect(asked).toHaveLength(0)
  })

  it("withholds when the title is any http(s) URL — a redirect echoed back", async () => {
    const { consultations, asked } = await run(
      () => ok(hackerNewsTopical),
      (hn) => hn.topical(SUBJECT, "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s")
    )
    expect(withheldForNoTitle(consultations)).toBe(true)
    expect(asked).toHaveLength(0)
    // The decisive assertion: nothing carrying that leaked parameter went out.
    expect(asked.some((u) => u.includes("dQw4w9WgXcQ"))).toBe(false)
  })

  it("withholds on an empty or whitespace title", async () => {
    const { consultations, asked } = await run(
      () => ok(hackerNewsTopical),
      (hn) => hn.topical(SUBJECT, "   ")
    )
    expect(withheldForNoTitle(consultations)).toBe(true)
    expect(asked).toHaveLength(0)
  })

  it("still asks with a real title", async () => {
    const { consultations, asked } = await run(
      () => ok(hackerNewsTopical),
      (hn) => hn.topical(SUBJECT, TITLE)
    )
    expect(withheldForNoTitle(consultations)).toBe(false)
    expect(asked.length).toBeGreaterThan(0)
  })
})
