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
import { Consultation, type Place } from "@parle/domain/Coverage"
import { Mention } from "@parle/domain/Mention"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { hrefOf, type Alias, type SubjectUrl } from "@parle/domain/Subject"
import * as Context from "effect/Context"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { matchingAddress, sameAddress } from "./Address.ts"
import { Discussion, DiscussionSink } from "./Discussion.ts"
import { Observation, ObservationSink, observeNow } from "./Observation.ts"
import {
  answeredWith,
  asking,
  type DiscussionSource,
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
 * How many hits one `linked` Lookup will read before it stops.
 *
 * Fifty, and the number is measured rather than inherited. Against 305 pages
 * known to have been submitted — sampled across 2010–2026 at three popularity
 * levels — raising this to Algolia's maximum of 1,000 recovered **nothing**:
 * not one page gained a submission a reader would want. Five pages filled the
 * window and three genuinely lost submissions, and all three were site front
 * doors (`facebook.com`, `stripe.com`, `swift.org`) whose extra submissions
 * ADR 0017 folds out of sight anyway.
 *
 * The cost of raising it is not spread evenly, which is why the average looks
 * free and is not. On an ordinary article the answer is a handful of hits and
 * `hitsPerPage` changes nothing at all — measured 5.5 KB and 266 ms at both 50
 * and 1,000. On a front door it changes everything: `github.com` goes from
 * 75 KB / 410 ms to 1.24 MB / 813 ms. So the window is kept, and the honest
 * part — that a filled window is not an exhaustive answer — is REPORTED rather
 * than papered over. See {@link Consultation}'s `windowed`.
 */
const LINKED_WINDOW = 50

/**
 * Typo tolerance, off, on the URL search — the single highest-recall change
 * this connector has.
 *
 * Algolia applies typo tolerance to a URL query the same way it would to prose,
 * and on long addresses the expansion does not widen the answer, it ANNIHILATES
 * it. Measured live against the same 305 known-submitted pages: with typo
 * tolerance on, four of them returned `nbHits: 0` — not a truncated answer, not
 * a mis-ranked one, but a flat "Hacker News has never seen this page" about
 * pages carrying 2,594, 2,611, 2,504 and 1,032 points. Turning it off returned
 * all four, and regressed **zero** of the other 301.
 *
 * Named casualties, reproducible at any time:
 *
 * ```
 * raspberrypi.org/blog/raspberry-pi-400-the-70-desktop-pc/    2,594 pts  0 -> 1
 * redhat.com/en/blog/red-hat-ibm-creating-leading-hybrid-...   2,611 pts  0 -> 1
 * raspberrypi.org/blog/raspberry-pi-4-on-sale-now-from-35      2,504 pts  0 -> 1
 * avc.com/a_vc/2011/06/enough-is-enough.html                   1,032 pts  0 -> 1
 * ```
 *
 * `typoTolerance=min` and `=strict` are NOT enough — both still return zero on
 * all four. Only `false` recovers them.
 *
 * It costs nothing in the currency ADR 0014 cares about: no extra request, no
 * extra byte, no measurable latency (439 ms against 508 ms on `github.com`,
 * inside the noise). And it makes the answer strictly cleaner — the false
 * positive this file's header is built around, `d41586-024-02082-5` returned
 * for a query about `d41586-024-02012-5`, is one of the hits typo tolerance was
 * inventing. Six hits become five, all five exact.
 *
 * Deliberately NOT applied to {@link topicalAnswer}. That query is a title, in
 * prose, typed by a human — the case typo tolerance is for.
 */
const NO_FUZZ = "false"

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

/**
 * What Algolia answers with.
 *
 * `hits` is load-bearing. `nbHits` is the total Algolia matched, and it is the
 * only way to tell a whole answer from a window: fifty hits back could mean
 * fifty exist or that fifty is all we asked for. Optional and nullable because
 * the alternative is that Algolia dropping one advisory field turns a good
 * answer into a Garble — the exact trade {@link Hit} already makes.
 */
const Answer = Schema.Struct({
  hits: Schema.Array(Hit),
  nbHits: Schema.optionalKey(Schema.NullOr(Schema.Number))
})

const readAnswer = expectJson(Answer)

/**
 * One answer, and whether we saw all of it.
 *
 * `windowed` is not derivable later: it needs `nbHits` and the `hitsPerPage` we
 * asked for, and neither survives into the Mentions. So it is decided here, at
 * the only point in the program where both are in scope, and carried.
 */
interface Window {
  readonly hits: ReadonlyArray<Hit>
  readonly windowed: boolean
}

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
    author: hit.author ?? null,
    venue: null
  })

/** Every address we will accept as evidence of the strong tier. */
const candidateAddresses = (
  subject: SubjectUrl,
  aliases: ReadonlyArray<Alias>
): ReadonlyArray<string> => {
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const address of [hrefOf(subject), ...aliases.map((alias) => alias.url)]) {
    if (seen.has(address)) continue
    seen.add(address)
    out.push(address)
  }
  return out
}

export class HackerNews extends Context.Service<HackerNews, DiscussionSource>()(
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
      ): Effect.fn.Return<Window, Unanswered> {
        const response = yield* client.get(ENDPOINT, { urlParams })
        const answer = yield* readAnswer(response)
        const asked = Number(urlParams["hitsPerPage"])
        return {
          hits: answer.hits,
          // Both halves are needed and neither alone will do. `hits.length`
          // short of the window means Algolia had nothing more to give; a
          // `nbHits` no bigger than what arrived means the same. Only a full
          // window WITH more behind it is a window.
          windowed: Number.isFinite(asked) &&
            answer.hits.length >= asked &&
            (answer.nbHits ?? 0) > answer.hits.length
        }
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
                hitsPerPage: String(LINKED_WINDOW),
                typoTolerance: NO_FUZZ
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
          for (const hit of attempt.success.hits) {
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

        // One Alias out of four hitting its window is enough to make the whole
        // answer a window. `some`, not `every`: the Aliases are asked
        // independently and the union is what the reader is shown, so an
        // unbounded gap under any one of them is a gap in that union.
        return answeredWith(
          place,
          found.map(({ hit, viaAlias }) =>
            Mention.cases.Linked.make({
              subject,
              discussion: discussionOf(hit),
              viaAlias
            })
          ),
          answered.some((attempt) => attempt.success.windowed)
        )
      })

      const place = placeOf("hackernews")

      return HackerNews.of({
        network: "hackernews",
        places: placesOf("hackernews"),
        linked: (subject, aliases) =>
          asking(place, linkedAnswer(place, subject, aliases))
      })
    })
  )
}

/** The connector's own stream type, for callers that want it named. */
export type HackerNewsLookup = Stream.Stream<Consultation, never, never>
