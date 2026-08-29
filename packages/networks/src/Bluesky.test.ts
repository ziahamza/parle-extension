/**
 * Bluesky's `url=` filter is the closest thing any Network offers to the
 * question we actually want to ask, which is exactly why these tests are about
 * the ways it can be wrong.
 *
 * The lexicon reserves the right to apply "URL normalization or fuzzy matching"
 * and does not say which, so the fixtures below assume the worst shape it
 * permits: an answer containing a post that links a DIFFERENT page. If the
 * re-check against the Subject's Aliases ever goes away, that post becomes a
 * Linked Mention — the tier that discharges ADR 0001's disclosure argument.
 *
 * Nothing here talks to the live service. Verified from this box on
 * 2026-08-24: the CDN in front of `public.api.bsky.app` answers 403 with an
 * HTML block page to a datacenter IP before the request reaches the AppView, so
 * a test that reached for the wire would assert the Refusal path forever and
 * never once exercise the parse.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { type Consultation } from "@parle/domain/Coverage"
import { permalinkOf } from "@parle/domain/Network"
import { Alias, SubjectUrl } from "@parle/domain/Subject"
import { TestClock } from "effect/testing"
import { Bluesky } from "./Bluesky.ts"
import type { Discussion } from "./Discussion.ts"
import { DiscussionSink } from "./Discussion.ts"
import { ObservationSink } from "./Observation.ts"
import { type Exchange, recording, recordingRows, recordingSink } from "./Recording.ts"

const SUBJECT = SubjectUrl.make("https://www.nature.com/articles/d41586-024-02012-5")
const DID = "did:plc:z72i7hdynmk6r22z27h6tvur"

const alias = (url: string) => Alias.make({ url, evidence: { _tag: "Redirected", from: url } })

const ok = (body: string): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "application/json; charset=utf-8" }
})

const uriOf = (rkey: string, did = DID) => `at://${did}/app.bsky.feed.post/${rkey}`

/** A post whose only link is an external embed card — the commonest shape. */
const carded = (
  rkey: string,
  url: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  uri: uriOf(rkey),
  cid: `bafy${rkey}`,
  author: { did: DID, handle: "reader.bsky.social", displayName: "A Reader" },
  record: {
    $type: "app.bsky.feed.post",
    text: "Worth reading.",
    createdAt: "2024-06-25T10:17:08.000Z",
    embed: {
      $type: "app.bsky.embed.external",
      external: { uri: url, title: "Not all open source AI models are open", description: "" }
    }
  },
  embed: {
    $type: "app.bsky.embed.external#view",
    external: { uri: url, title: "Not all open source AI models are open", description: "" }
  },
  replyCount: 3,
  repostCount: 7,
  likeCount: 42,
  indexedAt: "2024-06-25T10:17:09.123Z",
  ...extra
})

/** A post whose only link is a rich-text facet over the raw address. */
const facetted = (rkey: string, url: string): Record<string, unknown> => ({
  uri: uriOf(rkey),
  author: { did: DID, handle: "linker.bsky.social" },
  record: {
    $type: "app.bsky.feed.post",
    text: `see ${url}`,
    createdAt: "2024-07-01T00:00:00.000Z",
    facets: [
      {
        index: { byteStart: 4, byteEnd: 4 + url.length },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: url }]
      }
    ]
  },
  replyCount: 1,
  likeCount: 9,
  indexedAt: "2024-07-01T00:00:01.000Z"
})

const answerOf = (...posts: ReadonlyArray<unknown>): string => JSON.stringify({ posts })

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
  ask: (source: Bluesky["Service"]) => Stream.Stream<Consultation, never, never>,
  at = 1_700_000_000_000
): Promise<Run> => {
  const wire = recording(answer)
  const sink = recordingSink()
  const rows = recordingRows()

  const consultations = await Effect.runPromise(
    Effect.gen(function*() {
      yield* TestClock.setTime(at)
      const source = yield* Bluesky
      return yield* Stream.runCollect(ask(source))
    }).pipe(
      Effect.provideService(ObservationSink, sink.sink),
      Effect.provideService(DiscussionSink, rows.sink),
      Effect.provide(Bluesky.layer.pipe(Layer.provide(wire.layer))),
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

/**
 * The same, on the real clock.
 *
 * Retries sleep, and a `TestClock` nobody advances turns a retried status into
 * a hung test rather than a failed one.
 */
const runLive = async (
  answer: (url: string) => Exchange,
  ask: (source: Bluesky["Service"]) => Stream.Stream<Consultation, never, never>
): Promise<Run> => {
  const wire = recording(answer)
  const sink = recordingSink()
  const rows = recordingRows()

  const consultations = await Effect.runPromise(
    Effect.gen(function*() {
      const source = yield* Bluesky
      return yield* Stream.runCollect(ask(source))
    }).pipe(
      Effect.provideService(ObservationSink, sink.sink),
      Effect.provideService(DiscussionSink, rows.sink),
      Effect.provide(Bluesky.layer.pipe(Layer.provide(wire.layer)))
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

const idsOf = (consultation: Consultation) =>
  mentionsOf(consultation).map((m) => m.discussion.nativeId as string)

describe("the shape of every Lookup", () => {
  it("emits Asking first and exactly one terminal, whatever happened", async () => {
    const { consultations } = await run(
      () => ok(answerOf(carded("3kaaa", SUBJECT as string))),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    expect(consultations.map((c) => c._tag)).toEqual(["Asking", "Answered"])
  })

  it("still emits Asking then a terminal when the Network refuses", async () => {
    const { consultations } = await run(
      () => ({ status: 403, body: "<html>403</html>", headers: { "content-type": "text/html" } }),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    expect(consultations.map((c) => c._tag)).toEqual(["Asking", "Refusal"])
  })

  it("issues exactly one request per Lookup, however many Aliases there are", async () => {
    // The server normalizes the address itself and our own re-check accepts any
    // Alias whatever we asked under, so a second request buys recall Hacker
    // News needs and Bluesky does not. Unauthenticated cursor paging is broken
    // upstream, so there is no second page either.
    const { asked } = await run(
      () => ok(answerOf()),
      (bsky) =>
        bsky.linked(SUBJECT, [
          alias("https://nature.com/articles/d41586-024-02012-5"),
          alias("https://www.nature.com/articles/d41586-024-02012-5.amp")
        ])
    )
    expect(asked).toHaveLength(1)
  })

  it("sends the Subject URL as the url filter, and a q that constrains nothing", async () => {
    // `q` is the lexicon's only REQUIRED parameter, so it cannot be dropped.
    // Any meaningful value ANDs a full-text term against the filter doing the
    // real work, and a post that links the page from an embed card with the
    // address nowhere in its text would then be silently excluded — a
    // strong-tier false negative that renders as a cacheable Silence.
    const { asked } = await run(
      () => ok(answerOf()),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    const url = asked[0] ?? ""
    expect(url).toContain(`url=${encodeURIComponent(SUBJECT as string)}`)
    expect(url).toContain("q=*")
    expect(url).toContain("sort=top")
    expect(url).toContain("limit=100")
  })
})

describe("the strong tier is not taken on the AppView's word", () => {
  it("makes a Linked Mention of a post whose embed card is one of our Aliases", async () => {
    const { consultations } = await run(
      () => ok(answerOf(carded("3kaaa", SUBJECT as string))),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    const mentions = mentionsOf(terminal(consultations))

    expect(mentions).toHaveLength(1)
    const only = mentions[0]
    if (only?._tag !== "Linked") throw new Error("expected a Linked Mention")
    expect(only.viaAlias).toBe(SUBJECT as string)
    expect(only.subject).toBe(SUBJECT)
  })

  it("makes a Linked Mention from a rich-text link facet with no embed at all", async () => {
    // The two places the lexicon says `url=` indexes are "facet links or
    // embeds". A re-check that read only the embed would drop half of them and
    // the loss would be invisible.
    const { consultations } = await run(
      () => ok(answerOf(facetted("3kbbb", SUBJECT as string))),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    expect(idsOf(terminal(consultations))).toEqual([`${DID}/3kbbb`])
  })

  it("ignores a facet that is a mention or a tag rather than a link", async () => {
    const mentionOnly = {
      uri: uriOf("3kmmm"),
      author: { did: DID, handle: "someone.bsky.social" },
      record: {
        text: "hey @friend.bsky.social #ai",
        createdAt: "2024-07-01T00:00:00.000Z",
        facets: [
          {
            index: { byteStart: 4, byteEnd: 25 },
            features: [{ $type: "app.bsky.richtext.facet#mention", did: "did:plc:friend" }]
          },
          {
            index: { byteStart: 26, byteEnd: 29 },
            features: [{ $type: "app.bsky.richtext.facet#tag", tag: "ai" }]
          }
        ]
      },
      likeCount: 1,
      indexedAt: "2024-07-01T00:00:01.000Z"
    }
    const { consultations } = await run(
      () => ok(answerOf(mentionOnly)),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Silence")
  })

  it("drops the fuzzy hit that links a DIFFERENT article", async () => {
    // The lexicon reserves the right to apply "URL normalization or fuzzy
    // matching" to `url=`. Kept, this post is a Linked Mention — the only tier
    // that discharges ADR 0001's disclosure argument — on the strength of one
    // differing digit, which is precisely the Algolia failure `Address.ts` was
    // written for.
    const near = "https://www.nature.com/articles/d41586-024-02082-5"
    const { consultations } = await run(
      () => ok(answerOf(carded("3kaaa", SUBJECT as string), carded("3kfuzz", near))),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    const ids = idsOf(terminal(consultations))

    expect(ids).toEqual([`${DID}/3kaaa`])
    expect(ids).not.toContain(`${DID}/3kfuzz`)
  })

  it("accepts an Alias the Lookup did not ask under", async () => {
    // We ask once, under the Subject URL. A post that linked the AMP address is
    // still about this page, and the server's own normalization is what brought
    // it back — so the re-check has to accept every Alias, not only the one we
    // typed into the query.
    const amp = "https://nature.com/articles/d41586-024-02012-5.amp"
    const { consultations } = await run(
      () => ok(answerOf(carded("3kamp", amp))),
      (bsky) => bsky.linked(SUBJECT, [alias(amp)])
    )
    const mentions = mentionsOf(terminal(consultations))

    expect(mentions).toHaveLength(1)
    const only = mentions[0]
    if (only?._tag !== "Linked") throw new Error("expected a Linked Mention")
    expect(only.viaAlias).toBe(amp)
  })

  it("does not take a QUOTED post's link as this post's evidence", async () => {
    // `recordWithMedia` carries the author's own attachment under `media` and
    // somebody else's post under `record`. Reading the quoted post's embed
    // would make every quote of a submission a Mention of the page.
    const quoting = {
      uri: uriOf("3kquote"),
      author: { did: DID, handle: "quoter.bsky.social" },
      record: { text: "this thread", createdAt: "2024-07-02T00:00:00.000Z" },
      embed: {
        $type: "app.bsky.embed.record#view",
        record: {
          uri: uriOf("3koriginal"),
          embeds: [
            {
              $type: "app.bsky.embed.external#view",
              external: { uri: SUBJECT as string, title: "t", description: "" }
            }
          ]
        }
      },
      likeCount: 5,
      indexedAt: "2024-07-02T00:00:01.000Z"
    }
    const { consultations } = await run(
      () => ok(answerOf(quoting)),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Silence")
  })

  it("does take the author's own media half of a recordWithMedia", async () => {
    const quotingWithCard = {
      uri: uriOf("3kboth"),
      author: { did: DID, handle: "quoter.bsky.social" },
      record: { text: "with a card of my own", createdAt: "2024-07-02T00:00:00.000Z" },
      embed: {
        $type: "app.bsky.embed.recordWithMedia#view",
        record: { record: { uri: uriOf("3kother") } },
        media: {
          $type: "app.bsky.embed.external#view",
          external: { uri: SUBJECT as string, title: "t", description: "" }
        }
      },
      likeCount: 5,
      indexedAt: "2024-07-02T00:00:01.000Z"
    }
    const { consultations } = await run(
      () => ok(answerOf(quotingWithCard)),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    expect(idsOf(terminal(consultations))).toEqual([`${DID}/3kboth`])
  })
})

describe("Discussion identity round-trips to a permalink", () => {
  it("splits the at-uri into the two halves permalinkOf expects", async () => {
    const { consultations } = await run(
      () => ok(answerOf(carded("3k7xyzabc123", SUBJECT as string))),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    const mention = mentionsOf(terminal(consultations))[0]
    if (mention === undefined) throw new Error("expected a Mention")

    expect(mention.discussion.network).toBe("bluesky")
    expect(mention.discussion.nativeId as string).toBe(`${DID}/3k7xyzabc123`)
    expect(permalinkOf(mention.discussion)).toBe(
      `https://bsky.app/profile/${encodeURIComponent(DID)}/post/3k7xyzabc123`
    )
  })

  it("skips a record that is not a post rather than keying a permalink that 404s", async () => {
    const notAPost = {
      uri: `at://${DID}/app.bsky.feed.repost/3knope`,
      author: { did: DID, handle: "someone.bsky.social" },
      record: {
        text: "x",
        createdAt: "2024-07-01T00:00:00.000Z",
        embed: {
          $type: "app.bsky.embed.external",
          external: { uri: SUBJECT as string, title: "t", description: "" }
        }
      },
      likeCount: 1,
      indexedAt: "2024-07-01T00:00:01.000Z"
    }
    const { consultations } = await run(
      () => ok(answerOf(notAPost, carded("3kok", SUBJECT as string))),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    // One bad uri is not a reason to tell the reader Bluesky was unreadable.
    expect(idsOf(terminal(consultations))).toEqual([`${DID}/3kok`])
  })

  it("keeps one Mention when the same post appears twice in the answer", async () => {
    const { consultations, noted } = await run(
      () => ok(answerOf(carded("3kdupe", SUBJECT as string), carded("3kdupe", SUBJECT as string))),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    expect(idsOf(terminal(consultations))).toEqual([`${DID}/3kdupe`])
    expect(noted).toHaveLength(1)
  })
})

describe("what a panel row is drawn from", () => {
  it("titles the row with the post's own words and names its author by handle", async () => {
    const { noted } = await run(
      () => ok(answerOf(carded("3kaaa", SUBJECT as string))),
      (bsky) => bsky.linked(SUBJECT, [])
    )

    expect(noted).toHaveLength(1)
    expect(noted[0]?.title).toBe("Worth reading.")
    expect(noted[0]?.author).toBe("reader.bsky.social")
    expect(noted[0]?.submittedUrl).toBe(SUBJECT as string)
    expect(noted[0]?.venue).toBeNull()
  })

  it("folds a multi-line post to one line and cuts a long one at a word", async () => {
    const long = `First line.\n\n${"seven-letter words go here ".repeat(12)}end`
    const { noted } = await run(
      () => ok(answerOf(carded("3klong", SUBJECT as string, { record: {
        text: long,
        createdAt: "2024-06-25T10:17:08.000Z",
        embed: {
          $type: "app.bsky.embed.external",
          external: { uri: SUBJECT as string, title: "t", description: "" }
        }
      } }))),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    const title = noted[0]?.title ?? ""

    expect(title).not.toContain("\n")
    expect(title.startsWith("First line. seven-letter")).toBe(true)
    expect(title.endsWith("…")).toBe(true)
    // 140 plus the ellipsis, and never mid-word.
    expect(title.length).toBeLessThanOrEqual(141)
    expect(title).not.toContain("  ")
  })

  it("dates the row from indexedAt, not from the client-written createdAt", async () => {
    // `createdAt` is whatever the posting client said — routinely skewed,
    // occasionally in the future, backdated wholesale by import tools. A
    // postedAt in the future sorts above everything and reads as newer than any
    // Last Look. `indexedAt` is the AppView's own stamp and cannot be authored.
    const skewed = carded("3kskew", SUBJECT as string, {
      record: {
        text: "later",
        createdAt: "2099-01-01T00:00:00.000Z",
        embed: {
          $type: "app.bsky.embed.external",
          external: { uri: SUBJECT as string, title: "t", description: "" }
        }
      }
    })
    const { noted } = await run(() => ok(answerOf(skewed)), (bsky) => bsky.linked(SUBJECT, []))

    expect(noted[0]?.postedAt).toBe(Date.parse("2024-06-25T10:17:09.123Z"))
  })

  it("says it does not know when the answer carries no time at all", async () => {
    // A zero would render as 1970 and, worse, would read as OLDER than any
    // Last Look — so "we were not told" has to survive as its own answer.
    const undated = {
      uri: uriOf("3kundated"),
      author: { did: DID, handle: "someone.bsky.social" },
      record: {
        text: "x",
        embed: {
          $type: "app.bsky.embed.external",
          external: { uri: SUBJECT as string, title: "t", description: "" }
        }
      }
    }
    const { noted } = await run(() => ok(answerOf(undated)), (bsky) => bsky.linked(SUBJECT, []))

    expect(noted).toHaveLength(1)
    expect(noted[0]?.postedAt).toBeNull()
  })

  it("notes a row for every Mention it went on to make, and no others", async () => {
    const near = "https://www.nature.com/articles/d41586-024-02082-5"
    const { consultations, noted } = await run(
      () =>
        ok(answerOf(
          carded("3kaaa", SUBJECT as string),
          carded("3kfuzz", near),
          facetted("3kbbb", SUBJECT as string)
        )),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    const claimed = idsOf(terminal(consultations))

    expect(noted.map((row) => row.id.nativeId as string).sort()).toEqual([...claimed].sort())
  })
})

describe("nothing found is never the same as nothing said", () => {
  it("answers Silence — not Answered with no Mentions — when the search is empty", async () => {
    const { consultations } = await run(() => ok(answerOf()), (bsky) => bsky.linked(SUBJECT, []))
    const end = terminal(consultations)
    expect(end._tag).toBe("Silence")
    // A short window with nothing in it is evidence about the world, and it is
    // the one outcome it is safe to cache.
    if (end._tag === "Silence") expect(end.windowed).not.toBe(true)
  })

  it("answers Silence when every post the AppView returned was about something else", async () => {
    const { consultations } = await run(
      () => ok(answerOf(carded("3kelse", "https://elsewhere.example/a"))),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Silence")
  })

  it("answers Garble — not Silence — when a 200 carries an interstitial", async () => {
    // A CDN or captive-portal page arrives as text/html with a 200 and parses
    // to zero posts. Filed as a Silence it would be cached as evidence about
    // the world and would close the X gate as a promise kept.
    const { consultations } = await run(
      () => ({
        status: 200,
        body: "<html><body>Checking your browser…</body></html>",
        headers: { "content-type": "text/html; charset=utf-8" }
      }),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Garble")
  })

  it("answers Garble when the body is JSON but not an answer we know", async () => {
    const { consultations } = await run(
      () => ok(JSON.stringify({ error: "InvalidRequest", message: "unknown parameter" })),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Garble")
  })

  it("answers Garble when the body is truncated mid-JSON", async () => {
    const whole = answerOf(carded("3kaaa", SUBJECT as string))
    const { consultations } = await run(
      () => ok(whole.slice(0, whole.length - 40)),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    expect(terminal(consultations)._tag).toBe("Garble")
  })

  it("answers Refusal — never Silence — on the 403 this box always gets", async () => {
    // Verified live 2026-08-24: the CDN in front of `public.api.bsky.app`
    // answers 403 with an HTML block page to a datacenter IP, before the
    // request reaches the AppView. That is a fact about the attempt.
    const { consultations, observed, noted } = await run(
      () => ({ status: 403, body: "<html>403 Forbidden</html>", headers: { "content-type": "text/html" } }),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    const end = terminal(consultations)

    expect(end._tag).toBe("Refusal")
    if (end._tag === "Refusal") expect(end.reason).toBe("forbidden")
    expect(observed).toEqual([])
    expect(noted).toEqual([])
  })

  it("never retries a 403, and does retry a 429", async () => {
    // 403 is outside Effect's transient set and must stay there: from a
    // datacenter IP it is the ORDINARY answer, and retrying it spends the
    // reader's own budget to learn the same thing three times.
    const forbidden = await runLive(
      () => ({ status: 403, body: "", headers: { "content-type": "text/plain" } }),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    expect(forbidden.asked).toHaveLength(1)

    const limited = await runLive(
      () => ({ status: 429, body: "", headers: { "content-type": "text/plain" } }),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    expect(limited.asked.length).toBeGreaterThan(1)

    const end = terminal(limited.consultations)
    expect(end._tag).toBe("Refusal")
    if (end._tag === "Refusal") expect(end.reason).toBe("rate-limited")
  })
})

describe("Observations are stamped with our receive time", () => {
  it("uses the Clock, not indexedAt", async () => {
    // `indexedAt` is when the AppView ingested the POST. Nothing in the payload
    // says when `likeCount` was true, so the only honest stamp is ours.
    const at = 1_800_000_000_000
    const { observed } = await run(
      () => ok(answerOf(carded("3kaaa", SUBJECT as string), facetted("3kbbb", SUBJECT as string))),
      (bsky) => bsky.linked(SUBJECT, []),
      at
    )

    expect(observed).toHaveLength(2)
    expect(observed.every((o) => o.receivedAt === at)).toBe(true)
  })

  it("carries likeCount as the score and replyCount as the comments", async () => {
    const { observed } = await run(
      () => ok(answerOf(carded("3kaaa", SUBJECT as string), facetted("3kbbb", SUBJECT as string))),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    expect(observed.map((o) => o.score)).toEqual([42, 9])
    expect(observed.map((o) => o.comments)).toEqual([3, 1])
  })

  it("says it does not know rather than claiming zero when a count is absent", async () => {
    // A zero would later render as "the score fell to 0" — a Movement we
    // invented out of a field the AppView simply did not hydrate.
    const countless = {
      uri: uriOf("3knocount"),
      author: { did: DID, handle: "someone.bsky.social" },
      record: {
        text: "x",
        createdAt: "2024-07-01T00:00:00.000Z",
        embed: {
          $type: "app.bsky.embed.external",
          external: { uri: SUBJECT as string, title: "t", description: "" }
        }
      },
      indexedAt: "2024-07-01T00:00:01.000Z"
    }
    const { observed } = await run(() => ok(answerOf(countless)), (bsky) => bsky.linked(SUBJECT, []))

    expect(observed).toHaveLength(1)
    expect(observed[0]?.score).toBeNull()
    expect(observed[0]?.comments).toBeNull()
  })
})

describe("saying when the answer was cut off by our own window", () => {
  /** `count` posts, all carding `url`. */
  const windowOf = (count: number, url: string): string =>
    answerOf(...Array.from({ length: count }, (_, i) => carded(`3kw${i}`, url)))

  it("does not mark an answer that came back short of the window", async () => {
    const { consultations } = await run(
      () => ok(windowOf(3, SUBJECT as string)),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    const end = terminal(consultations)
    expect(end._tag).toBe("Answered")
    if (end._tag === "Answered") expect(end.windowed).not.toBe(true)
  })

  it("marks an Answered whose window filled", async () => {
    // There is no trustworthy total to compare against — `hitsTotal` is
    // documented as possibly rounded — and no usable cursor to go and look. So
    // 100 back out of a request for 100 is reported as "at least 100", which
    // is what ADR 0005 requires.
    const { consultations } = await run(
      () => ok(windowOf(100, SUBJECT as string)),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    const end = terminal(consultations)
    expect(end._tag).toBe("Answered")
    if (end._tag === "Answered") expect(end.windowed).toBe(true)
  })

  it("marks a SILENCE whose window filled — the case that would otherwise be cached", async () => {
    // A hundred fuzzy matches, none of them this page, and no way to see past
    // them. Unmarked it is an ordinary Silence: "nobody discussed this page",
    // written into `LookupRecord` and believed for as long as `silenceTtl`
    // allows.
    const { consultations } = await run(
      () => ok(windowOf(100, "https://elsewhere.example/a")),
      (bsky) => bsky.linked(SUBJECT, [])
    )
    const end = terminal(consultations)
    expect(end._tag).toBe("Silence")
    if (end._tag === "Silence") expect(end.windowed).toBe(true)
  })
})
