/**
 * ADR 0013's chain, exercised in both directions.
 *
 * These run against recorded bodies rather than the wire on purpose. Every
 * request from a datacenter IP — including this one — gets Reddit's
 * network-policy block page, so a wire test would assert the 403 path forever
 * and never once reach the parse. The recorded 403 IS that live capture; the
 * successful bodies are reconstructed, and `Recorded.ts` says so.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { type Consultation } from "@parle/domain/Coverage"
import { Alias, SubjectUrl } from "@parle/domain/Subject"
import { TestClock } from "effect/testing"
import { ObservationSink } from "./Observation.ts"
import { Reddit } from "./Reddit.ts"
import { type Exchange, recording, recordingSink } from "./Recording.ts"
import { redditBlockPage, redditInfo, redditSearchPage } from "./Recorded.ts"

const SUBJECT = SubjectUrl.make("https://www.nature.com/articles/d41586-024-02012-5")
const TITLE = "Not all open source AI models are open"

const alias = (url: string) => Alias.make({ url, evidence: { _tag: "Redirected", from: url } })

const json = (body: string, headers: Record<string, string> = {}): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "application/json; charset=UTF-8", ...headers }
})

const html = (body: string): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "text/html; charset=UTF-8" }
})

/** The 403 + block page this sandbox actually receives from both hosts. */
const blocked: Exchange = {
  status: 403,
  body: redditBlockPage,
  headers: { "content-type": "text/html; charset=utf-8" }
}

const isTierOne = (url: string) => url.startsWith("https://www.reddit.com/")
const isTierTwo = (url: string) => url.startsWith("https://old.reddit.com/")

interface Run {
  readonly consultations: ReadonlyArray<Consultation>
  readonly asked: ReadonlyArray<string>
  readonly observed: ReadonlyArray<{ readonly score: number | null; readonly comments: number | null }>
}

const run = async (
  answer: (url: string) => Exchange,
  ask: (source: Reddit["Service"]) => Stream.Stream<Consultation, never, never>
): Promise<Run> => {
  const wire = recording(answer)
  const sink = recordingSink()

  const consultations = await Effect.runPromise(
    Effect.gen(function*() {
      yield* TestClock.setTime(1_700_000_000_000)
      const source = yield* Reddit
      return yield* Stream.runCollect(ask(source))
    }).pipe(
      Effect.provideService(ObservationSink, sink.sink),
      Effect.provide(
        Layer.provide(Reddit.layer, wire.layer)
      ),
      Effect.provide(TestClock.layer())
    )
  )

  return {
    consultations,
    asked: wire.asked,
    observed: sink.seen.map((o) => ({ score: o.score, comments: o.comments }))
  }
}

/** Two Lookups against one layer, so the rate-limit memory is shared. */
const runTwice = async (
  answer: (url: string) => Exchange,
  ask: (source: Reddit["Service"]) => Stream.Stream<Consultation, never, never>
): Promise<{ readonly asked: ReadonlyArray<string> }> => {
  const wire = recording(answer)
  const sink = recordingSink()

  await Effect.runPromise(
    Effect.gen(function*() {
      yield* TestClock.setTime(1_700_000_000_000)
      const source = yield* Reddit
      yield* Stream.runCollect(ask(source))
      yield* Stream.runCollect(ask(source))
    }).pipe(
      Effect.provideService(ObservationSink, sink.sink),
      Effect.provide(
        Layer.provide(Reddit.layer, wire.layer)
      ),
      Effect.provide(TestClock.layer())
    )
  )

  return { asked: wire.asked }
}

const terminal = (consultations: ReadonlyArray<Consultation>): Consultation => {
  const last = consultations[consultations.length - 1]
  if (last === undefined) throw new Error("the connector emitted nothing at all")
  return last
}

const mentionsOf = (consultation: Consultation) =>
  consultation._tag === "Answered" ? consultation.mentions : []

describe("tier 1: the cookie path", () => {
  it("reads api/info.json and stops there when it answered", async () => {
    const { consultations, asked } = await run(
      (url) => (isTierOne(url) ? json(redditInfo) : html(redditSearchPage)),
      (reddit) => reddit.linked(SUBJECT, [])
    )

    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain("www.reddit.com/api/info.json")
    expect(mentionsOf(terminal(consultations)).map((m) => m.discussion.nativeId as string)).toEqual([
      "1dnr4kx",
      "1dpz9qa"
    ])
  })

  it("does not fall through when tier 1 answered with nothing", async () => {
    // Tier 1 answering is an answer. Falling through would spend a second
    // request to disagree with an answer we have no reason to doubt — and
    // would turn a cacheable Silence into a second chance to be refused.
    const { consultations, asked } = await run(
      (url) => (isTierOne(url) ? json(JSON.stringify({ data: { children: [] } })) : html(redditSearchPage)),
      (reddit) => reddit.linked(SUBJECT, [])
    )
    expect(asked).toHaveLength(1)
    expect(terminal(consultations)._tag).toBe("Silence")
  })

  it("still checks the submitted URL against the Aliases", async () => {
    // The third recorded child was submitted under `…-02082-5`. Reddit's `url:`
    // semantics are close to exact — "close to" is not the standard the strong
    // tier is held to.
    const { consultations } = await run(
      (url) => (isTierOne(url) ? json(redditInfo) : html(redditSearchPage)),
      (reddit) => reddit.linked(SUBJECT, [])
    )
    expect(mentionsOf(terminal(consultations)).map((m) => m.discussion.nativeId as string)).not
      .toContain("1dq00zz")
  })

  it("matches a submission carrying campaign parameters", async () => {
    const linked = mentionsOf(
      terminal(
        (await run(
          (url) => (isTierOne(url) ? json(redditInfo) : html(redditSearchPage)),
          (reddit) => reddit.linked(SUBJECT, [])
        )).consultations
      )
    )
    const withCampaign = linked.find((m) => (m.discussion.nativeId as string) === "1dpz9qa")
    expect(withCampaign).toBeDefined()
    if (withCampaign?._tag === "Linked") expect(withCampaign.viaAlias).toBe(SUBJECT as string)
  })
})

describe("tier 2: the markup path", () => {
  it("falls through on the 403 this machine actually gets, and parses old.reddit", async () => {
    const { consultations, asked } = await run(
      (url) => (isTierOne(url) ? blocked : html(redditSearchPage)),
      (reddit) => reddit.linked(SUBJECT, [])
    )

    expect(asked).toHaveLength(2)
    expect(asked[1]).toContain("old.reddit.com/search")
    expect(asked[1]).toContain(encodeURIComponent("url:"))
    expect(mentionsOf(terminal(consultations)).map((m) => m.discussion.nativeId as string)).toEqual([
      "1dnr4kx",
      "1dpz9qa"
    ])
  })

  it("reads the score and comment count out of the markup", async () => {
    const { observed } = await run(
      (url) => (isTierOne(url) ? blocked : html(redditSearchPage)),
      (reddit) => reddit.linked(SUBJECT, [])
    )
    expect(observed).toEqual([
      { score: 4821, comments: 213 },
      { score: 312, comments: 41 }
    ])
  })

  it("treats a block page served with a 200 as a Refusal, not a Silence", async () => {
    // Reddit soft-blocks with the same document at status 200. It scans to zero
    // rows, and a Silence is the ONE outcome we are allowed to cache — so this
    // is the mistake that would poison a Subject for a whole TTL.
    const { consultations } = await run(
      (url) => (isTierOne(url) ? blocked : html(redditBlockPage)),
      (reddit) => reddit.linked(SUBJECT, [])
    )
    const end = terminal(consultations)
    expect(end._tag).toBe("Refusal")
    if (end._tag === "Refusal") expect(end.reason).toBe("forbidden")
  })
})

describe("tier 3: a Refusal, never a thrown error", () => {
  it("ends in a Refusal when both tiers are blocked", async () => {
    const { consultations, asked } = await run(
      () => blocked,
      (reddit) => reddit.linked(SUBJECT, [])
    )
    expect(asked).toHaveLength(2)
    expect(consultations.map((c) => c._tag)).toEqual(["Asking", "Refusal"])
  })

  it("keeps the Refusal off the Subject: nothing is Answered and nothing is Silent", async () => {
    const { consultations } = await run(() => blocked, (reddit) => reddit.linked(SUBJECT, []))
    expect(consultations.map((c) => c._tag)).not.toContain("Silence")
    expect(consultations.map((c) => c._tag)).not.toContain("Answered")
  })
})

describe("the shared rate budget", () => {
  it("stops asking tier 1 once the remaining count runs low", async () => {
    // The budget is shared with the reader's own Reddit browsing. Spending the
    // last request means the next thing THEY do is the one that gets refused.
    const { asked } = await runTwice(
      (url) =>
        isTierOne(url)
          ? json(redditInfo, { "x-ratelimit-remaining": "1", "x-ratelimit-reset": "300" })
          : html(redditSearchPage),
      (reddit) => reddit.linked(SUBJECT, [])
    )

    expect(asked).toHaveLength(2)
    expect(isTierOne(asked[0] ?? "")).toBe(true)
    // The second Lookup skipped the cookie path entirely and degraded to
    // markup, which is cookie-free and on a different budget.
    expect(isTierTwo(asked[1] ?? "")).toBe(true)
  })

  it("keeps asking tier 1 while the budget is healthy", async () => {
    const { asked } = await runTwice(
      (url) =>
        isTierOne(url)
          ? json(redditInfo, { "x-ratelimit-remaining": "94", "x-ratelimit-reset": "190" })
          : html(redditSearchPage),
      (reddit) => reddit.linked(SUBJECT, [])
    )
    expect(asked.every(isTierOne)).toBe(true)
  })
})

describe("the weak tier", () => {


  it("accepts a submission under any Alias, though it asks about one", async () => {
    // Unlike Hacker News, Reddit is asked about the elected address only: the
    // budget is shared with the reader's own browsing and ADR 0013 allows one
    // request per page view. The Alias set still widens what we ACCEPT back.
    const other = "https://nature.com/articles/d41586-024-02012-5"
    const { consultations, asked } = await run(
      (url) => (isTierOne(url) ? json(redditInfo) : html(redditSearchPage)),
      (reddit) => reddit.linked(SUBJECT, [alias(other)])
    )
    expect(asked).toHaveLength(1)
    expect(mentionsOf(terminal(consultations))).toHaveLength(2)
  })
})
