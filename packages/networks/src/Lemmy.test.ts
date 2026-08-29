/**
 * Lemmy's two failure modes, which are the opposite of Hacker News'.
 *
 * Algolia is fuzzy and returns a near-miss article, so the danger there is a
 * false Linked Mention. `type_=Url` is exact, so the danger here is the Mention
 * that never appears at all — the post submitted under `www.` when the Subject
 * URL is bare. These tests are mostly about that miss, and about the second
 * query that repairs it costing exactly one extra request and never a duplicate
 * Discussion.
 *
 * The bodies are shaped from a live capture of
 * `lemmy.world/api/v3/search?q=…&type_=Url` on 2026-08-24, which returned three
 * posts for `nature.com/articles/d41586-024-02012-5` — two of them held by
 * `lemmy.ml` and reachable only because `lemmy.world` federates with it. There
 * is deliberately no live test: the instance is volunteer-run and a test suite
 * is the last thing that should be spending its rate limit.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { type Consultation } from "@parle/domain/Coverage"
import { permalinkOf } from "@parle/domain/Network"
import { Alias, SubjectUrl } from "@parle/domain/Subject"
import { TestClock } from "effect/testing"
import type { Discussion } from "./Discussion.ts"
import { DiscussionSink } from "./Discussion.ts"
import { Lemmy } from "./Lemmy.ts"
import { Observation, ObservationSink } from "./Observation.ts"
import { type Exchange, recording, recordingRows, recordingSink } from "./Recording.ts"

const SUBJECT = SubjectUrl.make("https://www.nature.com/articles/d41586-024-02012-5")
/** The same document, submitted without the `www.` — invisible to an exact match. */
const BARE = "https://nature.com/articles/d41586-024-02012-5"

const alias = (url: string) => Alias.make({ url, evidence: { _tag: "Redirected", from: url } })

const ok = (body: unknown): Exchange => ({
  status: 200,
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" }
})

interface PostOptions {
  readonly apId: string
  readonly url?: string | null
  readonly name?: string
  readonly published?: string
  readonly score?: number
  readonly comments?: number
  readonly community?: string
  readonly instance?: string
  readonly creator?: string
  readonly removed?: boolean
  readonly deleted?: boolean
}

/** One `PostView`, in the shape the live endpoint returned. */
const post = (options: PostOptions) => ({
  post: {
    id: 16924449,
    name: options.name ?? "Not all 'open source' AI models are actually open",
    url: options.url === undefined ? (SUBJECT as string) : options.url,
    ap_id: options.apId,
    published: options.published ?? "2024-06-25T18:40:04.447403Z",
    removed: options.removed ?? false,
    deleted: options.deleted ?? false,
    local: false
  },
  counts: {
    post_id: 16924449,
    score: options.score ?? 30,
    comments: options.comments ?? 1,
    upvotes: 30,
    downvotes: 0
  },
  community: {
    id: 2358,
    name: options.community ?? "fosai",
    title: "Free Open-Source Artificial Intelligence",
    actor_id: `https://${options.instance ?? "lemmy.world"}/c/${options.community ?? "fosai"}`
  },
  creator: { id: 45971, name: options.creator ?? "ylai" }
})

/** The full envelope, including the three arrays this connector ignores. */
const answer = (...posts: ReadonlyArray<ReturnType<typeof post>>) => ({
  type_: "Url",
  comments: [],
  posts,
  communities: [],
  users: []
})

interface Run {
  readonly consultations: ReadonlyArray<Consultation>
  readonly asked: ReadonlyArray<string>
  readonly observed: ReadonlyArray<Observation>
  readonly noted: ReadonlyArray<Discussion>
}

const runWith = async (
  respond: (url: string) => Exchange,
  ask: (source: Lemmy["Service"]) => Stream.Stream<Consultation, never, never>,
  options: { readonly at?: number; readonly testClock: boolean }
): Promise<Run> => {
  const wire = recording(respond)
  const sink = recordingSink()
  const rows = recordingRows()

  const body = Effect.gen(function*() {
    if (options.testClock) yield* TestClock.setTime(options.at ?? 1_700_000_000_000)
    const source = yield* Lemmy
    return yield* Stream.runCollect(ask(source))
  }).pipe(
    Effect.provideService(ObservationSink, sink.sink),
    Effect.provideService(DiscussionSink, rows.sink),
    Effect.provide(Lemmy.layer.pipe(Layer.provide(wire.layer)))
  )

  const consultations = await Effect.runPromise(
    options.testClock ? body.pipe(Effect.provide(TestClock.layer())) : body
  )

  return { consultations, asked: wire.asked, observed: sink.seen, noted: rows.noted }
}

const run = (
  respond: (url: string) => Exchange,
  ask: (source: Lemmy["Service"]) => Stream.Stream<Consultation, never, never>,
  at = 1_700_000_000_000
): Promise<Run> => runWith(respond, ask, { at, testClock: true })

/**
 * The same, on the real clock.
 *
 * Retries sleep, and a `TestClock` nobody advances turns a retried status into
 * a hung test rather than a failed one.
 */
const runLive = (
  respond: (url: string) => Exchange,
  ask: (source: Lemmy["Service"]) => Stream.Stream<Consultation, never, never>
): Promise<Run> => runWith(respond, ask, { testClock: false })

const terminal = (consultations: ReadonlyArray<Consultation>): Consultation => {
  const last = consultations[consultations.length - 1]
  if (last === undefined) throw new Error("the connector emitted nothing at all")
  return last
}

const mentionsOf = (consultation: Consultation) =>
  consultation._tag === "Answered" ? consultation.mentions : []

/** Which address a recorded request asked about. */
const queryOf = (url: string): string => new URL(url).searchParams.get("q") ?? ""

describe("the shape of every Lookup", () => {
  it("emits Asking first and exactly one terminal, whatever happened", async () => {
    const { consultations } = await run(
      () => ok(answer(post({ apId: "https://lemmy.world/post/1" }))),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    expect(consultations.map((c) => c._tag)).toEqual(["Asking", "Answered"])
  })

  it("asks the exact-URL question, once, when there is nothing else to ask", async () => {
    const { asked } = await run(
      () => ok(answer()),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain("type_=Url")
    expect(asked[0]).toContain("limit=50")
    expect(queryOf(asked[0] ?? "")).toBe(SUBJECT as string)
  })
})

describe("an exact hit is a Linked Mention", () => {
  it("records which Alias the submitted URL matched", async () => {
    const { consultations } = await run(
      () => ok(answer(post({ apId: "https://lemmy.world/post/16828706" }))),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    const mentions = mentionsOf(terminal(consultations))
    expect(mentions).toHaveLength(1)
    const only = mentions[0]
    if (only?._tag !== "Linked") throw new Error("expected a Linked Mention")
    expect(only.viaAlias).toBe(SUBJECT as string)
    expect(only.discussion.network).toBe("lemmy")
  })

  it("draws a row from the same hit, with the community named by its instance", async () => {
    // `technology@lemmy.world` and `technology@beehaw.org` are different rooms.
    // A bare community name would draw two Discussions as though they were in
    // the same place.
    const { noted } = await run(
      () =>
        ok(answer(post({
          apId: "https://lemmy.ml/post/17293918",
          community: "technology",
          instance: "beehaw.org",
          creator: "ylai"
        }))),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    expect(noted).toHaveLength(1)
    expect(noted[0]?.venue).toBe("technology@beehaw.org")
    expect(noted[0]?.author).toBe("ylai")
    expect(noted[0]?.submittedUrl).toBe(SUBJECT as string)
    // ISO 8601 with microseconds. Read as seconds this is a 1970 conversation.
    expect(noted[0]?.postedAt).toBe(Date.parse("2024-06-25T18:40:04.447403Z"))
  })

  it("says it does not know when a post carries no publishing time", async () => {
    const { noted } = await run(
      () =>
        ok({
          posts: [{
            post: { ap_id: "https://lemmy.world/post/9", url: SUBJECT as string },
            counts: { score: 3, comments: 0 }
          }]
        }),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    expect(noted).toHaveLength(1)
    expect(noted[0]?.postedAt).toBeNull()
    expect(noted[0]?.venue).toBeNull()
  })

  it("drops a post nobody can read any more", async () => {
    const { consultations } = await run(
      () =>
        ok(answer(
          post({ apId: "https://lemmy.world/post/1", removed: true }),
          post({ apId: "https://lemmy.world/post/2", deleted: true })
        )),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Silence")
  })
})

describe("a federated post keeps the identity of the instance that owns it", () => {
  it("identifies a hit by its ap_id, not by the local id of whoever answered", async () => {
    // Verified live: a query to lemmy.world returned posts whose `ap_id` is on
    // lemmy.ml. The numeric `id` in that payload is lemmy.world's own row
    // number and means a different post on every other instance.
    const { consultations, noted } = await run(
      () => ok(answer(post({ apId: "https://infosec.pub/post/4242" }))),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    const mentions = mentionsOf(terminal(consultations))
    expect(mentions[0]?.discussion.nativeId as string).toBe("https://infosec.pub/post/4242")
    expect(noted[0]?.id.nativeId as string).toBe("https://infosec.pub/post/4242")
  })

  it("permalinks back to the owning instance", async () => {
    const { consultations } = await run(
      () => ok(answer(post({ apId: "https://infosec.pub/post/4242" }))),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    const mention = mentionsOf(terminal(consultations))[0]
    if (mention === undefined) throw new Error("expected a Mention")
    expect(permalinkOf(mention.discussion)).toBe("https://infosec.pub/post/4242")
  })
})

describe("the exact match is not taken on the instance's word", () => {
  it("drops a hit whose submitted URL matches no Alias", async () => {
    // `type_=Url` is exact, but the second query asks about a DIFFERENT
    // address, and a hit returned for that question is evidence about that
    // question until we have compared it ourselves.
    const { consultations } = await run(
      () =>
        ok(answer(
          post({ apId: "https://lemmy.world/post/1" }),
          post({ apId: "https://lemmy.world/post/2", url: "https://elsewhere.example/a" })
        )),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    const ids = mentionsOf(terminal(consultations)).map((m) => m.discussion.nativeId as string)
    expect(ids).toEqual(["https://lemmy.world/post/1"])
  })

  it("drops a text post, which carries no submitted address at all", async () => {
    const { consultations } = await run(
      () => ok(answer(post({ apId: "https://lemmy.world/post/3", url: null }))),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Silence")
  })
})

describe("the one extra query, and what earns it", () => {
  it("asks about a materially different Alias — the www flip an exact match misses", async () => {
    // The failure this repairs is silent: the post exists, was submitted under
    // the bare host, and a single query on the Subject URL returns nothing.
    const respond = (url: string): Exchange =>
      queryOf(url) === BARE
        ? ok(answer(post({ apId: "https://lemmy.world/post/77", url: BARE })))
        : ok(answer())

    const { consultations, asked } = await run(respond, (lemmy) => lemmy.linked(SUBJECT, [alias(BARE)]))

    expect(asked.map(queryOf).sort()).toEqual([BARE, SUBJECT as string].sort())
    const mentions = mentionsOf(terminal(consultations))
    expect(mentions).toHaveLength(1)
    const only = mentions[0]
    if (only?._tag !== "Linked") throw new Error("expected a Linked Mention")
    // The Alias recorded is the ELECTED address, not the one that found it: a
    // `www.` flip names the same document under `Address.ts`, so the reader is
    // owed the address we hold rather than a search artefact.
    expect(only.viaAlias).toBe(SUBJECT as string)
  })

  it("records the Alias itself when it names a genuinely different address", async () => {
    const amp = "https://www.nature.com/articles/d41586-024-02012-5.amp"
    const respond = (url: string): Exchange =>
      queryOf(url) === amp
        ? ok(answer(post({ apId: "https://lemmy.world/post/78", url: amp })))
        : ok(answer())

    const { consultations } = await run(respond, (lemmy) => lemmy.linked(SUBJECT, [alias(amp)]))
    const only = mentionsOf(terminal(consultations))[0]
    if (only?._tag !== "Linked") throw new Error("expected a Linked Mention")
    expect(only.viaAlias).toBe(amp)
  })

  it("spends nothing on an Alias that is the same paste wearing a click id", async () => {
    // Campaign parameters and a fragment are what a poster's address carries by
    // accident, not a second form anyone submitted under. Asking again buys a
    // second copy of the first answer for one of the two requests we have.
    const { asked } = await run(
      () => ok(answer()),
      (lemmy) =>
        lemmy.linked(SUBJECT, [
          alias(`${SUBJECT as string}?utm_source=newsletter`),
          alias(`${SUBJECT as string}#abstract`)
        ])
    )
    expect(asked).toHaveLength(1)
  })

  it("never spends more than two requests, however many Aliases there are", async () => {
    const { asked } = await run(
      () => ok(answer()),
      (lemmy) =>
        lemmy.linked(SUBJECT, [
          alias(BARE),
          alias("http://www.nature.com/articles/d41586-024-02012-5"),
          alias("https://www.nature.com/articles/d41586-024-02012-5.amp"),
          alias("https://nature.com/articles/d41586-024-02012-5/")
        ])
    )
    expect(asked).toHaveLength(2)
  })

  it("deduplicates by ap_id when both queries return the same post", async () => {
    // A post federated under both forms, or simply matched by both questions,
    // is one Discussion. Two Mentions would draw it twice in the panel.
    const both = post({ apId: "https://lemmy.world/post/77" })
    const { consultations, noted } = await run(
      () => ok(answer(both)),
      (lemmy) => lemmy.linked(SUBJECT, [alias(BARE)])
    )
    expect(mentionsOf(terminal(consultations))).toHaveLength(1)
    expect(noted).toHaveLength(1)
  })

  it("still answers from the query that worked when the other one failed", async () => {
    const respond = (url: string): Exchange =>
      queryOf(url) === BARE
        ? ok(answer(post({ apId: "https://lemmy.world/post/77", url: BARE })))
        : { status: 500, body: "", headers: { "content-type": "text/plain" } }

    const { consultations } = await runLive(respond, (lemmy) => lemmy.linked(SUBJECT, [alias(BARE)]))
    expect(terminal(consultations)._tag).toBe("Answered")
  })
})

describe("nothing found is never the same as nothing said", () => {
  it("answers Silence — not Answered with no Mentions — when the search is empty", async () => {
    const { consultations } = await run(() => ok(answer()), (lemmy) => lemmy.linked(SUBJECT, []))
    const end = terminal(consultations)
    expect(end._tag).toBe("Silence")
    if (end._tag === "Silence") expect(end.windowed).not.toBe(true)
  })

  it("answers Garble — not Silence — when a 200 carries an interstitial", async () => {
    const { consultations } = await run(
      () => ({
        status: 200,
        body: "<html><body>Checking your browser…</body></html>",
        headers: { "content-type": "text/html; charset=utf-8" }
      }),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Garble")
  })

  it("answers Garble when the body is JSON but carries no posts array", async () => {
    // An instance mid-migration answers `{"error":"unknown"}` with a 200.
    // Reading that as zero posts would write a Silence into the Lookup Record.
    const { consultations } = await run(
      () => ok({ error: "couldnt_find_object" }),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Garble")
  })

  it("answers Refusal — never Silence — on a 403", async () => {
    const { consultations } = await run(
      () => ({ status: 403, body: "", headers: { "content-type": "text/plain" } }),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    const end = terminal(consultations)
    expect(end._tag).toBe("Refusal")
    if (end._tag === "Refusal") expect(end.reason).toBe("forbidden")
  })

  it("answers Refusal with the rate-limited reason on a 429, and retries it", async () => {
    // The instance limit is in the ~60/10min class and is charged to the
    // reader's own address, so a 429 is a fact about the attempt that must be
    // rendered — never softened into "Lemmy has nothing".
    const { consultations, asked } = await runLive(
      () => ({ status: 429, body: "", headers: { "content-type": "text/plain" } }),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    const end = terminal(consultations)
    expect(end._tag).toBe("Refusal")
    if (end._tag === "Refusal") expect(end.reason).toBe("rate-limited")
    expect(asked.length).toBeGreaterThan(1)
  })

  it("never retries a 403", async () => {
    const { asked } = await runLive(
      () => ({ status: 403, body: "", headers: { "content-type": "text/plain" } }),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    expect(asked).toHaveLength(1)
  })
})

describe("saying when the answer was the size of our own request", () => {
  const fill = (count: number, url: string) =>
    answer(...Array.from({ length: count }, (_, i) => post({ apId: `https://lemmy.world/post/${i}`, url })))

  it("marks an Answered whose window filled", async () => {
    // There is no total in the payload, so a full fifty cannot be told from a
    // complete answer that happens to be fifty long. ADR 0005 decides which way
    // that falls: the reader is told the list may be short, not that it is all.
    const { consultations } = await run(
      () => ok(fill(50, SUBJECT as string)),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    const end = terminal(consultations)
    expect(end._tag).toBe("Answered")
    if (end._tag === "Answered") expect(end.windowed).toBe(true)
  })

  it("marks a SILENCE whose window filled — the case that would otherwise be cached", async () => {
    const { consultations } = await run(
      () => ok(fill(50, "https://elsewhere.example/a")),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    const end = terminal(consultations)
    expect(end._tag).toBe("Silence")
    if (end._tag === "Silence") expect(end.windowed).toBe(true)
  })

  it("does not mark an ordinary short answer", async () => {
    const { consultations } = await run(
      () => ok(fill(3, SUBJECT as string)),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    const end = terminal(consultations)
    expect(end._tag).toBe("Answered")
    if (end._tag === "Answered") expect(end.windowed).not.toBe(true)
  })
})

describe("Observations are stamped with our receive time", () => {
  it("uses the Clock, because no Lemmy count says when it was true", async () => {
    // `counts` sits beside `counts.published` and `newest_comment_time`, and
    // neither of those is an as-of time for the score.
    const at = 1_800_000_000_000
    const { observed } = await run(
      () =>
        ok(answer(
          post({ apId: "https://lemmy.world/post/1", score: 30, comments: 1 }),
          post({ apId: "https://lemmy.ml/post/2", score: 15, comments: 0 })
        )),
      (lemmy) => lemmy.linked(SUBJECT, []),
      at
    )
    expect(observed.map((o) => o.receivedAt)).toEqual([at, at])
    expect(observed.map((o) => o.score)).toEqual([30, 15])
    expect(observed.map((o) => o.comments)).toEqual([1, 0])
    expect(observed.every((o) => o.present)).toBe(true)
  })

  it("says nothing rather than zero when a post carries no counts", async () => {
    const { observed } = await run(
      () => ok({ posts: [{ post: { ap_id: "https://lemmy.world/post/9", url: SUBJECT as string } }] }),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    expect(observed[0]?.score).toBeNull()
    expect(observed[0]?.comments).toBeNull()
  })

  it("hands over nothing when the Network refused", async () => {
    const { observed, noted } = await run(
      () => ({ status: 403, body: "", headers: { "content-type": "text/plain" } }),
      (lemmy) => lemmy.linked(SUBJECT, [])
    )
    expect(observed).toEqual([])
    expect(noted).toEqual([])
  })
})
