/**
 * Hacker News, via the Algolia search API. The connector that has to work.
 *
 * Keyless, and CORS-open to any origin — verified live 2026-08-08 — so it is
 * the one Network that answers from every context on every platform with no
 * cookie, no account and no host permission argument. Everything else in the
 * product degrades around it.
 *
 * Two facts about Algolia shape this file more than anything else:
 *
 * **The URL search is fuzzy, and the strong tier cannot take its word.**
 * `?query=<url>&restrictSearchableAttributes=url` tokenizes the address and
 * scores partial overlap. Verified live: the query for
 * `nature.com/articles/d41586-024-02012-5` returns six hits and the sixth is
 * item 40802874, submitted under `d41586-024-02082-5` — a different article.
 * So every hit is re-checked against the Subject's own Aliases here, and one
 * that does not match is dropped rather than demoted. It is not a Topical
 * Mention: nobody searched a title, so there is no evidence of the weak tier
 * either. See {@link ../Address.ts}.
 *
 * **There is no as-of time for `points`.** A hit carries `created_at` (when the
 * thread was posted) and `updated_at` (Algolia's own reindex, verified as much
 * as 4.5 years later), and neither says when the score was true. So an
 * Observation is stamped with OUR receive time from `Clock`. See
 * {@link ./Observation.ts}.
 *
 * `tags=story` is not tidying. Without it the topical search returns comment
 * hits, which carry no `title` and no `url` of their own — only `story_title`
 * and `story_url` — and a Mention built from one names the parent thread while
 * claiming evidence from the child. That is a Passing Mention wearing a Topical
 * Mention's clothes, and Harvest is where those are supposed to come from.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { type Consultation, type Place } from "@parle/domain/Coverage"
import { Mention } from "@parle/domain/Mention"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import type { Alias, SubjectUrl } from "@parle/domain/Subject"
import * as Context from "effect/Context"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { matchingAddress, sameAddress } from "./Address.ts"
import { Discussion, DiscussionSink } from "./Discussion.ts"
import { Observation, ObservationSink, observeNow } from "./Observation.ts"
import {
  answeredWith,
  asking,
  type DiscussionSourceShape,
  Garbled,
  type Unanswered,
  placeOf,
  placesOf
} from "./Source.ts"
import { expectJson } from "./Wire.ts"

const ENDPOINT = "https://hn.algolia.com/api/v1/search"

/**
 * How many distinct addresses one `linked` Lookup will ask about.
 *
 * Algolia will not find a submission under Alias B when asked about Alias A, so
 * asking once is a strong-tier false negative on every syndicated or aliased
 * page. Asking about all of them is unbounded work driven by data we do not
 * control. Four is the compromise, and the Aliases are asked in the order the
 * caller gave them — `SubjectIdentity` puts its elected address first.
 */
const MAX_ADDRESSES = 4

/**
 * One Algolia hit.
 *
 * `title`, `url`, `points` and `num_comments` are all optional AND nullable.
 * That is not defensiveness: an Ask HN story has `url: null`, and a hit fetched
 * without `tags=story` omits `title` entirely. A schema that required them
 * would turn one text post in the answer into a Garble for the whole Lookup.
 */
const Hit = Schema.Struct({
  objectID: Schema.String,
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  author: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /**
   * When the thread was posted, in epoch SECONDS.
   *
   * The only time in the payload that means anything to a reader. `created_at`
   * is the same instant as a string and `updated_at` is Algolia's own reindex —
   * measured as much as 4.5 years later — so neither of those may be used for
   * an age, and none of the three says when `points` was true.
   */
  created_at_i: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  points: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  num_comments: Schema.optionalKey(Schema.NullOr(Schema.Number))
})
type Hit = typeof Hit.Type

/** What Algolia answers with. Only `hits` is load-bearing. */
const Answer = Schema.Struct({
  hits: Schema.Array(Hit)
})

const readAnswer = expectJson(Answer)

const scoreOf = (hit: Hit): number | null => hit.points ?? null
const commentsOf = (hit: Hit): number | null => hit.num_comments ?? null

const discussionOf = (hit: Hit): DiscussionId =>
  DiscussionId.make({ network: "hackernews", nativeId: NativeId.make(hit.objectID) })

/**
 * The row a panel draws, from the same hit the Mention was made of.
 *
 * An untitled hit falls back to the permalink's own words rather than to an
 * empty string: a row with no text at all reads as a rendering bug, and an Ask
 * HN story legitimately has no `url` while still having a title.
 */
const rowOf = (hit: Hit): Discussion =>
  Discussion.make({
    id: discussionOf(hit),
    title: hit.title ?? "",
    submittedUrl: hit.url ?? null,
    postedAt: hit.created_at_i === undefined || hit.created_at_i === null
      ? null
      : hit.created_at_i * 1000,
    author: hit.author ?? null
  })

/** Every address we will accept as evidence of the strong tier. */
const candidateAddresses = (
  subject: SubjectUrl,
  aliases: ReadonlyArray<Alias>
): ReadonlyArray<string> => {
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const address of [subject as string, ...aliases.map((alias) => alias.url)]) {
    if (seen.has(address)) continue
    seen.add(address)
    out.push(address)
  }
  return out
}

export class HackerNews extends Context.Service<HackerNews, DiscussionSourceShape>()(
  "parle/source/HackerNews"
) {
  static readonly layer = Layer.effect(
    HackerNews,
    Effect.gen(function*() {
      const client = (yield* HttpClient.HttpClient).pipe(
        // Transient responses only — 408, 429 and 5xx. 403 is deliberately
        // outside Effect's transient set and must stay there: retrying a
        // refusal burns the reader's own rate budget to learn the same thing.
        HttpClient.retryTransient({
          schedule: Schedule.exponential(200).pipe(Schedule.jittered),
          times: 2
        })
      )

      const search = Effect.fn("HackerNews.search")(function*(
        urlParams: Record<string, string>
      ): Effect.fn.Return<ReadonlyArray<Hit>, Unanswered> {
        const response = yield* client.get(ENDPOINT, { urlParams })
        const answer = yield* readAnswer(response)
        return answer.hits
      })

      /**
       * Hand over what the answer described, before the Consultation is emitted.
       *
       * The ordering is what a caller relies on: the terminal Consultation is
       * the signal that a Place has answered, so a row deposited after it would
       * arrive at a panel that has already decided what to draw.
       */
      const record = Effect.fn("HackerNews.record")(function*(hits: ReadonlyArray<Hit>) {
        const observations: Array<Observation> = []
        for (const hit of hits) {
          observations.push(
            yield* observeNow(discussionOf(hit), { score: scoreOf(hit), comments: commentsOf(hit) })
          )
        }
        yield* (yield* DiscussionSink).note(hits.map(rowOf))
        yield* (yield* ObservationSink).observe(observations)
      })

      const linkedAnswer = Effect.fn("HackerNews.linkedAnswer")(function*(
        place: Place,
        subject: SubjectUrl,
        aliases: ReadonlyArray<Alias>
      ): Effect.fn.Return<Consultation, Unanswered> {
        const candidates = candidateAddresses(subject, aliases)
        const asked = candidates.slice(0, MAX_ADDRESSES)

        const attempts = yield* Effect.forEach(
          asked,
          (address) =>
            Effect.result(
              search({
                query: address,
                restrictSearchableAttributes: "url",
                tags: "story",
                hitsPerPage: "50"
              })
            ),
          { concurrency: 2 }
        )

        const answered = attempts.filter(Result.isSuccess)
        if (answered.length === 0) {
          // Every address failed the same way in practice — one endpoint, one
          // outage. Surface the first, rather than inventing a Silence from a
          // set of Refusals.
          const firstTrouble = attempts.find(Result.isFailure)
          return yield* firstTrouble
            ? Effect.fail(firstTrouble.failure)
            : Effect.fail(new Garbled({ detail: "no address was asked about" }))
        }

        const kept = new Map<string, { hit: Hit; viaAlias: string }>()
        for (const attempt of answered) {
          for (const hit of attempt.success) {
            if (kept.has(hit.objectID)) continue
            const submitted = hit.url
            if (!submitted) continue
            const viaAlias = matchingAddress(submitted, candidates)
            if (viaAlias === undefined) continue
            kept.set(hit.objectID, { hit, viaAlias })
          }
        }

        const found = [...kept.values()]
        yield* record(found.map(({ hit }) => hit))

        return answeredWith(
          place,
          found.map(({ hit, viaAlias }) =>
            Mention.cases.Linked.make({
              subject,
              discussion: discussionOf(hit),
              viaAlias
            })
          )
        )
      })

      const topicalAnswer = Effect.fn("HackerNews.topicalAnswer")(function*(
        place: Place,
        subject: SubjectUrl,
        title: string
      ): Effect.fn.Return<Consultation, Unanswered> {
        const hits = yield* search({ query: title, tags: "story", hitsPerPage: "30" })

        // A hit submitted under the Subject's own address is a Linked Mention
        // and `linked` already reported it. Reporting it again at the weak tier
        // puts the same Discussion in Coverage twice, once with evidence that
        // understates what we know.
        const kept = new Map<string, Hit>()
        for (const hit of hits) {
          if (kept.has(hit.objectID)) continue
          if (hit.url && sameAddress(hit.url, subject)) continue
          kept.set(hit.objectID, hit)
        }

        const found = [...kept.values()]
        yield* record(found)

        return answeredWith(
          place,
          found.map((hit) =>
            Mention.cases.Topical.make({
              subject,
              discussion: discussionOf(hit),
              matchedTitle: title
            })
          )
        )
      })

      const linkedPlace = placeOf("hackernews", "linked")
      const topicalPlace = placeOf("hackernews", "topical")

      return HackerNews.of({
        network: "hackernews",
        places: placesOf("hackernews"),
        linked: (subject, aliases) =>
          asking(linkedPlace, linkedAnswer(linkedPlace, subject, aliases)),
        topical: (subject, title) =>
          asking(topicalPlace, topicalAnswer(topicalPlace, subject, title))
      })
    })
  )
}

/** The connector's own stream type, for callers that want it named. */
export type HackerNewsLookup = Stream.Stream<Consultation, never, never>
