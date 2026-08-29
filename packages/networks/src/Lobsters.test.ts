/**
 * Lobsters answers about a DOMAIN, so most of what it says is about other
 * pages — and the one status that means "nothing" is a 404. Those two facts are
 * where this connector can quietly go wrong, so most of what follows is about
 * them.
 *
 * The fixture shape is the live one: `/domains/theregister.com.json`, fetched
 * anonymously on 2026-08-24, is a bare array of stories, newest first, each
 * carrying `short_id`, `title`, `url`, `score`, `comment_count`, `created_at`,
 * `tags` and a bare-string `submitter_user`. There is no live test file here —
 * Lobsters is volunteer-run and every check that touched the wire would be a
 * request against it on every CI run.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { type Consultation } from "@parle/domain/Coverage"
import { Alias, SubjectUrl } from "@parle/domain/Subject"
import { TestClock } from "effect/testing"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { Lobsters } from "./Lobsters.ts"
import type { Discussion } from "./Discussion.ts"
import { DiscussionSink } from "./Discussion.ts"
import { ObservationSink } from "./Observation.ts"
import { type Exchange, recording, recordingRows, recordingSink } from "./Recording.ts"

const SUBJECT = SubjectUrl.make(
  "https://www.theregister.com/2021/11/08/system76_developing_new_linux_desktop/"
)

const alias = (url: string) => Alias.make({ url, evidence: { _tag: "Redirected", from: url } })

const ok = (body: string): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "application/json; charset=utf-8" }
})

/** One story as the domain page actually serves it. */
const story = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  short_id: "nzm4w4",
  created_at: "2021-11-08T11:09:59.000-06:00",
  title: "System76 is building a new Linux desktop in Rust",
  url: SUBJECT as string,
  score: 75,
  flags: 1,
  comment_count: 51,
  description: "",
  description_plain: "",
  submitter_user: "radmind",
  user_is_author: false,
  tags: ["linux", "rust"],
  short_id_url: "https://lobste.rs/s/nzm4w4",
  comments_url: "https://lobste.rs/s/nzm4w4/system76_is_building_new_linux_desktop",
  ...over
})

/** A story on the same domain that is a different article. */
const elsewhere = (i: number): Record<string, unknown> =>
  story({
    short_id: `other${i}`,
    title: `Something else ${i}`,
    url: `https://www.theregister.com/2021/10/${10 + i}/another_story/`,
    score: 3,
    comment_count: 1
  })

interface Run {
  readonly consultations: ReadonlyArray<Consultation>
  readonly asked: ReadonlyArray<string>
  readonly observed: ReadonlyArray<
    { readonly receivedAt: number; readonly score: number | null; readonly comments: number | null }
  >
  readonly noted: ReadonlyArray<Discussion>
}

const run = async (
  answer: (url: string) => Exchange,
  ask: (source: Lobsters["Service"]) => Stream.Stream<Consultation, never, never>,
  at = 1_700_000_000_000
): Promise<Run> => {
  const wire = recording(answer)
  const sink = recordingSink()
  const rows = recordingRows()

  const consultations = await Effect.runPromise(
    Effect.gen(function*() {
      yield* TestClock.setTime(at)
      const source = yield* Lobsters
      return yield* Stream.runCollect(ask(source))
    }).pipe(
      Effect.provideService(ObservationSink, sink.sink),
      Effect.provideService(DiscussionSink, rows.sink),
      Effect.provide(Lobsters.layer.pipe(Layer.provide(wire.layer))),
      Effect.provide(TestClock.layer())
    )
  )

  return {
    consultations,
    asked: wire.asked,
    observed: sink.seen.map((o) => ({
      receivedAt: o.receivedAt,
      score: o.score,
      comments: o.comments
    })),
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

const refused = (status: number): Exchange => ({
  status,
  body: "",
  headers: { "content-type": "text/plain" }
})

describe("the shape of every Lookup", () => {
  it("emits Asking first and exactly one terminal", async () => {
    const { consultations } = await run(
      () => ok(JSON.stringify([story()])),
      (lo) => lo.linked(SUBJECT, [])
    )
    expect(consultations.map((c) => c._tag)).toEqual(["Asking", "Answered"])
  })

  it("spends exactly one request on a Lookup", async () => {
    // Lobsters is a volunteer-run Rails site with no published limit, and the
    // request comes from the reader's own IP. One question, one request, and
    // the Aliases are matched here rather than asked about.
    const { asked } = await run(
      () => ok(JSON.stringify([story()])),
      (lo) => lo.linked(SUBJECT, [alias("https://theregister.com/a"), alias("https://amp.x/b")])
    )
    expect(asked).toHaveLength(1)
  })
})

describe("asking about the right domain", () => {
  it("strips www., because that is how Lobsters keys its domain pages", async () => {
    // Verified 2026-08-24: /domains/theregister.com.json answers with stories
    // whose own url is https://www.theregister.com/… . Asking for the www.
    // form asks about a domain that does not exist there — which answers 404,
    // which this connector reads as a Silence. A www-shaped bug would
    // therefore render as "Lobsters has never discussed this page" and be
    // CACHED as such.
    const { asked } = await run(
      () => ok(JSON.stringify([story()])),
      (lo) => lo.linked(SUBJECT, [])
    )
    expect(asked[0]).toBe("https://lobste.rs/domains/theregister.com.json")
  })

  it("leaves a deeper host alone", async () => {
    const { asked } = await run(
      () => ok(JSON.stringify([])),
      (lo) => lo.linked(SubjectUrl.make("https://blog.example.com/post"), [])
    )
    expect(asked[0]).toBe("https://lobste.rs/domains/blog.example.com.json")
  })

  it("withholds — without an Asking — when there is no host to ask about", async () => {
    // The Exclusion List should have caught this upstream. The connector is
    // still total about it, and it must not claim in Coverage to have asked.
    const { consultations, asked } = await run(
      () => ok(JSON.stringify([])),
      (lo) => lo.linked(SubjectUrl.make("file:///home/reader/notes.html"), [])
    )
    expect(asked).toEqual([])
    expect(consultations.map((c) => c._tag)).toEqual(["Withholding"])
  })
})

describe("a domain page is mostly about other pages", () => {
  it("makes a Linked Mention, keyed on short_id, from the story that matches", async () => {
    const { consultations } = await run(
      () => ok(JSON.stringify([story(), elsewhere(1), elsewhere(2)])),
      (lo) => lo.linked(SUBJECT, [])
    )
    const mentions = mentionsOf(terminal(consultations))

    expect(mentions).toHaveLength(1)
    const only = mentions[0]
    if (only?._tag !== "Linked") throw new Error("expected a Linked Mention")
    // The permalink is https://lobste.rs/s/<short_id>, so short_id IS the
    // identity. Keyed on anything else the row links nowhere.
    expect(only.discussion.nativeId as string).toBe("nzm4w4")
    expect(only.discussion.network).toBe("lobsters")
    expect(only.viaAlias).toBe(SUBJECT as string)
  })

  it("drops a same-domain story that matches no Alias, without a trace", async () => {
    // It was never evidence about this Subject — it is another article on the
    // same site — so there is nothing to fold or count. It must not become a
    // Mention, a row, or an Observation.
    const { consultations, noted, observed } = await run(
      () => ok(JSON.stringify([elsewhere(1), elsewhere(2)])),
      (lo) => lo.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Silence")
    expect(noted).toEqual([])
    expect(observed).toEqual([])
  })

  it("matches an Alias the Subject URL is not", async () => {
    // The Subject reachable under two addresses, submitted under the second, is
    // a strong-tier false negative that nobody files a bug for.
    const other = "https://theregister.com/2021/11/08/system76_developing_new_linux_desktop/?amp=1"
    const { consultations } = await run(
      () => ok(JSON.stringify([story({ short_id: "amp1", url: other })])),
      (lo) => lo.linked(SubjectUrl.make("https://www.theregister.com/some/other/page"), [alias(other)])
    )
    const mentions = mentionsOf(terminal(consultations))
    expect(mentions).toHaveLength(1)
    const only = mentions[0]
    if (only?._tag !== "Linked") throw new Error("expected a Linked Mention")
    expect(only.viaAlias).toBe(other)
  })

  it("drops a text post, which carries an empty url and can match nothing", async () => {
    const { consultations } = await run(
      () => ok(JSON.stringify([story({ short_id: "ask1", url: "" })])),
      (lo) => lo.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Silence")
  })
})

describe("what a panel row is drawn from", () => {
  it("carries the title, the author and the posting time", async () => {
    const { noted } = await run(
      () => ok(JSON.stringify([story(), elsewhere(1)])),
      (lo) => lo.linked(SUBJECT, [])
    )
    expect(noted).toHaveLength(1)
    expect(noted[0]?.title).toBe("System76 is building a new Linux desktop in Rust")
    expect(noted[0]?.author).toBe("radmind")
    expect(noted[0]?.submittedUrl).toBe(SUBJECT as string)
    // ISO 8601 with an offset, not epoch seconds: 2021-11-08T11:09:59-06:00.
    expect(noted[0]?.postedAt).toBe(Date.parse("2021-11-08T11:09:59.000-06:00"))
  })

  it("leaves venue null — tags are labels, not a place a reader names", async () => {
    const { noted } = await run(
      () => ok(JSON.stringify([story()])),
      (lo) => lo.linked(SUBJECT, [])
    )
    expect(noted[0]?.venue).toBeNull()
  })

  it("says it does not know when the posting time is missing or unreadable", async () => {
    // A zero would render as 1970 and read as older than any Last Look; a NaN
    // poisons every comparison downstream of it.
    const { noted } = await run(
      () =>
        ok(JSON.stringify([
          story({ short_id: "a", created_at: null }),
          story({ short_id: "b", created_at: "not a date" })
        ])),
      (lo) => lo.linked(SUBJECT, [])
    )
    expect(noted.map((row) => row.postedAt)).toEqual([null, null])
  })

  it("degrades to an unattributed row when submitter_user is an older object", async () => {
    // One field's shape changing on a volunteer-run site must not turn every
    // story on the page into a Garble.
    const { noted } = await run(
      () => ok(JSON.stringify([story({ submitter_user: { username: "alice" } })])),
      (lo) => lo.linked(SUBJECT, [])
    )
    expect(noted[0]?.author).toBe("alice")
  })

  it("notes a row for every Mention it made, and no others", async () => {
    const { consultations, noted } = await run(
      () => ok(JSON.stringify([story(), elsewhere(1), story({ short_id: "dup" })])),
      (lo) => lo.linked(SUBJECT, [])
    )
    const claimed = mentionsOf(terminal(consultations)).map((m) => m.discussion.nativeId as string)
    expect(noted.map((row) => row.id.nativeId as string).sort()).toEqual([...claimed].sort())
  })
})

describe("nothing found is never the same as nothing said", () => {
  it("reads a 404 from the domain page as a SILENCE, not a Refusal", async () => {
    // Lobsters has no empty domain page: a domain nobody ever submitted has no
    // route at all. That 404 is the site answering "nothing" — evidence about
    // the world, and the ordinary outcome for almost every page a reader opens.
    // Filed as a Refusal it would be un-cacheable and would render as "Lobsters
    // would not answer", which is false and permanently so.
    const { consultations } = await run(
      () => ({ status: 404, body: "<html>404</html>", headers: { "content-type": "text/html" } }),
      (lo) => lo.linked(SUBJECT, [])
    )
    const end = terminal(consultations)
    expect(end._tag).toBe("Silence")
    if (end._tag === "Silence") expect(end.windowed).not.toBe(true)
  })

  it("does not extend that reading to a 404 that came from anywhere else", async () => {
    // The Silence reading is bound to the URL this connector built. A 404 whose
    // own request was some other address — a proxy, a rewritten endpoint, a
    // second request added by a later wave — is the Refusal that Wire.ts makes
    // of it. Without the binding, "the endpoint moved" would read as "Lobsters
    // has never discussed this page" for every Subject at once, and would be
    // cached as such.
    const client = HttpClient.make(() =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          HttpClientRequest.get("https://lobste.rs/somewhere/else"),
          new Response("", { status: 404, headers: { "content-type": "text/plain" } })
        )
      )
    )

    const consultations = await Effect.runPromise(
      Effect.gen(function*() {
        const source = yield* Lobsters
        return yield* Stream.runCollect(source.linked(SUBJECT, []))
      }).pipe(
        Effect.provide(
          Lobsters.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)))
        )
      )
    )

    const end = terminal(consultations)
    expect(end._tag).toBe("Refusal")
  })

  it("answers Silence when the domain page is empty", async () => {
    const { consultations } = await run(() => ok("[]"), (lo) => lo.linked(SUBJECT, []))
    expect(terminal(consultations)._tag).toBe("Silence")
  })

  it("answers Garble — not Silence — when a 200 carries an interstitial", async () => {
    const { consultations } = await run(
      () => ({
        status: 200,
        body: "<html><body>Checking your browser…</body></html>",
        headers: { "content-type": "text/html; charset=utf-8" }
      }),
      (lo) => lo.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Garble")
  })

  it("answers Garble when the body is JSON but not a list of stories", async () => {
    const { consultations } = await run(
      () => ok(JSON.stringify({ message: "maintenance" })),
      (lo) => lo.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Garble")
  })

  it("answers Garble when a story is missing its identity", async () => {
    // Without short_id there is no permalink and no key. A row that cannot be
    // clicked is worse than an honest Garble.
    const { consultations } = await run(
      () => ok(JSON.stringify([{ title: "no id", url: SUBJECT as string }])),
      (lo) => lo.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Garble")
  })

  it("answers Refusal — never Silence — on a 403", async () => {
    const { consultations } = await run(() => refused(403), (lo) => lo.linked(SUBJECT, []))
    const end = terminal(consultations)
    expect(end._tag).toBe("Refusal")
    if (end._tag === "Refusal") expect(end.reason).toBe("forbidden")
  })

  it("answers Refusal on a 429, and does not lean on the site to check", async () => {
    // No retryTransient here at all, unlike Hacker News. Lobsters publishes no
    // limit to stay under and the request is from the reader's own IP, so a
    // refusal is taken at its word the first time.
    const { consultations, asked } = await run(() => refused(429), (lo) => lo.linked(SUBJECT, []))
    const end = terminal(consultations)
    expect(end._tag).toBe("Refusal")
    if (end._tag === "Refusal") expect(end.reason).toBe("rate-limited")
    expect(asked).toHaveLength(1)
  })

  it("answers Refusal on a 503, without retrying it either", async () => {
    const { consultations, asked } = await run(() => refused(503), (lo) => lo.linked(SUBJECT, []))
    expect(terminal(consultations)._tag).toBe("Refusal")
    expect(asked).toHaveLength(1)
  })

  it("hands over nothing when the Network refused", async () => {
    const { observed, noted } = await run(() => refused(403), (lo) => lo.linked(SUBJECT, []))
    expect(observed).toEqual([])
    expect(noted).toEqual([])
  })
})

describe("Observations are stamped with our receive time", () => {
  it("uses the Clock, not the story's created_at", async () => {
    // `created_at` is when the story was POSTED. Nothing in the payload says
    // when `score` was true, so the only honest stamp is when we received it.
    const at = 1_800_000_000_000
    const { observed } = await run(
      () => ok(JSON.stringify([story()])),
      (lo) => lo.linked(SUBJECT, []),
      at
    )
    expect(observed).toHaveLength(1)
    expect(observed[0]?.receivedAt).toBe(at)
  })

  it("carries the score and the comment count through", async () => {
    const { observed } = await run(
      () => ok(JSON.stringify([story()])),
      (lo) => lo.linked(SUBJECT, [])
    )
    expect(observed[0]?.score).toBe(75)
    expect(observed[0]?.comments).toBe(51)
  })

  it("says nothing rather than zero when a number is absent", async () => {
    // A zero would later render as "the score fell to 0" — a Movement we
    // invented.
    const { observed } = await run(
      () => ok(JSON.stringify([story({ score: null, comment_count: null })])),
      (lo) => lo.linked(SUBJECT, [])
    )
    expect(observed[0]?.score).toBeNull()
    expect(observed[0]?.comments).toBeNull()
  })
})

describe("page 1 is all we fetch, and a full page says so", () => {
  /** `count` stories on the domain, at most one of them this Subject's. */
  const page = (count: number, includeSubject: boolean): string =>
    JSON.stringify(
      Array.from({ length: count }, (_, i) =>
        includeSubject && i === 0 ? story() : elsewhere(i))
    )

  it("does not mark an answer that came back short of a full page", async () => {
    // Measured 2026-08-24: /domains/theregister.com.json returned 11 stories —
    // that domain's whole history. A note on every page is a note nobody reads.
    const { consultations, asked } = await run(
      () => ok(page(11, true)),
      (lo) => lo.linked(SUBJECT, [])
    )
    const end = terminal(consultations)
    expect(end._tag).toBe("Answered")
    if (end._tag === "Answered") expect(end.windowed).not.toBe(true)
    expect(asked).toHaveLength(1)
  })

  it("marks an Answered whose page came back full", async () => {
    // 25 is the measured page size; the rest is on /page/2.json, which we do
    // not fetch. "At least these", never a total.
    const { consultations } = await run(() => ok(page(25, true)), (lo) => lo.linked(SUBJECT, []))
    const end = terminal(consultations)
    expect(end._tag).toBe("Answered")
    if (end._tag === "Answered") expect(end.windowed).toBe(true)
  })

  it("marks the SILENCE whose page came back full — the one that would be cached", async () => {
    // 25 stories on this domain, none of them this page, and an unknown number
    // more behind them. Unmarked this is an ordinary Silence — "nobody
    // discussed this page" — written into the Lookup Record and believed.
    const { consultations } = await run(() => ok(page(25, false)), (lo) => lo.linked(SUBJECT, []))
    const end = terminal(consultations)
    expect(end._tag).toBe("Silence")
    if (end._tag === "Silence") expect(end.windowed).toBe(true)
  })

  it("never asks for page 2", async () => {
    const { asked } = await run(() => ok(page(25, false)), (lo) => lo.linked(SUBJECT, []))
    expect(asked.some((url) => url.includes("/page/"))).toBe(false)
  })
})
