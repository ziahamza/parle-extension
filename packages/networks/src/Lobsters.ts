/**
 * Lobsters, via the one anonymous JSON door it still has open: the domain page.
 *
 * There is no URL search here. `https://lobste.rs/search.json?q=…` and every
 * variant of it answer **400** — verified live 2026-08-24 — so the question
 * this connector can ask is not "who submitted this address" but "what has
 * this DOMAIN had submitted", and the address match happens on our side. One
 * request, `GET https://lobste.rs/domains/<domain>.json`, keyless and
 * anonymous, answering `application/json` with a newest-first array of stories
 * carrying `short_id`, `title`, `url`, `score`, `comment_count`, `created_at`,
 * `tags` and `submitter_user`.
 *
 * Four facts shape the file, each of them measured rather than assumed.
 *
 * **The answer is about a domain, so most of it is about other pages.** A story
 * on `theregister.com` whose `url` matches no Alias of this Subject is a
 * different article on the same site. It is dropped in silence and that is not
 * an ADR 0005 problem: it was never evidence about this Subject, so there is
 * nothing to fold, count or apologise for. Only the addresses we already
 * believe point at the Subject can make a Linked Mention, and they are compared
 * with {@link ./Address.ts} rather than with `===`.
 *
 * **Page 1 only, and page 1 is 25 stories.** Measured 2026-08-24:
 * `/domains/github.com.json` returns exactly 25 stories, newest first, covering
 * 17 days; `/domains/<domain>/page/2.json` carries the rest. A high-volume
 * domain therefore hides its older submissions behind a page we do not fetch,
 * and an old Discussion of this Subject can be missed. Per ADR 0005 that miss
 * must not be silent, so a full page of 25 is reported as `windowed` — on a
 * `Silence` as loudly as on an `Answered`, because the windowed Silence is the
 * one that would otherwise be CACHED as "Lobsters has never discussed this
 * page". The retrieval window means the same thing here as on Hacker News: at
 * least this many, never a total. Lobsters publishes no count of what it held
 * back, so unlike Algolia's `nbHits` there is nothing to cross-check against —
 * a full page is treated as windowed even in the case where the domain happens
 * to have exactly 25 stories and the answer was whole. Over-reporting a window
 * costs a note; under-reporting it caches a false negative.
 *
 * **A 404 from this endpoint is a Silence, not a Refusal.** Lobsters has no
 * empty domain page: a domain nobody has ever submitted has no route, and Rails
 * answers 404. That is the site answering our question with "nothing", which is
 * evidence about the world and the ordinary outcome for almost every page a
 * reader opens — filed as a Refusal it would be un-cacheable and would render
 * as "Lobsters would not answer", which is false and permanently so. The
 * reading is deliberately narrow: it is applied at the single call site that
 * BUILDS the domain URL, only to a response whose own request is that URL
 * ({@link askDomain}), so a 404 arriving from any other path — a moved
 * endpoint, a proxy, a future second request — stays the Refusal that
 * {@link ./Wire.ts} makes of it. This connector issues no other request, and if
 * one is ever added it inherits nothing from this decision.
 *
 * **Politeness is the whole rate-limit policy.** Lobsters is a volunteer-run
 * Rails site with no published limits and no API terms to hide behind, and the
 * request comes from the reader's own IP (ADR 0014). So: one request per
 * Lookup, and — unlike {@link ./HackerNews.ts} — no `retryTransient` at all. A
 * 429 or a 503 from this site means stop, not "back off 200ms and lean on it
 * twice more"; it is classified as a Refusal, never cached, and the next
 * Enquiry may ask again.
 *
 * Two things the integration wave has to know. Lobsters sends **no
 * `access-control-allow-origin` header** (verified on both responses above), so
 * this connector cannot run from a page context — it needs the extension's own
 * host permission for `https://lobste.rs/*`. And a Lobsters story's `tags` are
 * NOT a {@link ./Discussion.ts} `venue`: a subreddit is a place a reader names
 * and `["linux","rust"]` is a pair of labels on a story that lives on the front
 * page like every other one, so `venue` stays null and two Lobsters rows are
 * told apart by their titles.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { type Consultation, type Place } from "@parle/domain/Coverage"
import { Mention } from "@parle/domain/Mention"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import type { Alias, SubjectUrl } from "@parle/domain/Subject"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { matchingAddress } from "./Address.ts"
import { Discussion, DiscussionSink } from "./Discussion.ts"
import { Observation, ObservationSink, observeNow } from "./Observation.ts"
import {
  answeredWith,
  asking,
  type DiscussionSourceShape,
  type Unanswered,
  placeOf,
  placesOf,
  withheld
} from "./Source.ts"
import { expectJson } from "./Wire.ts"

/** The domain page. `<domain>.json` is appended; nothing else is ever asked. */
const DOMAINS = "https://lobste.rs/domains"

/**
 * How many stories one domain page carries.
 *
 * Measured, not guessed: `/domains/github.com.json` returned exactly 25 on
 * 2026-08-24, and `/domains/theregister.com.json` returned 11 — that domain's
 * whole history. So a short answer is a complete one and a full answer is a
 * window onto `/page/2`, which we do not fetch.
 */
const PAGE = 25

/**
 * One story on a domain page.
 *
 * `short_id` is the only field required, because it is the identity — everything
 * else is a row's decoration and a missing one must not turn the whole answer
 * into a Garble. `url` is present-but-empty on a Lobsters text post (an "Ask"
 * story has no submitted address), which no Alias can match, so those drop out
 * of the filter without a special case.
 */
const Story = Schema.Struct({
  short_id: Schema.String,
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /**
   * When the story was posted: ISO 8601 with an offset, e.g.
   * `2021-11-08T11:09:59.000-06:00`. It says nothing about when `score` was
   * true — see {@link ./Observation.ts}.
   */
  created_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  score: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  comment_count: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  /**
   * Who submitted it. A bare username string today (verified 2026-08-24);
   * older Lobsters releases nested it under `{ username }`, and an installation
   * running one of those must degrade to an unattributed row rather than to a
   * Garble for every story on the page.
   */
  submitter_user: Schema.optionalKey(
    Schema.NullOr(
      Schema.Union([
        Schema.String,
        Schema.Struct({ username: Schema.optionalKey(Schema.NullOr(Schema.String)) })
      ])
    )
  )
})
type Story = typeof Story.Type

/** The domain page is a bare array. Anything else is a Garble. */
const readStories = expectJson(Schema.Array(Story))

/** One page, and whether it was full enough to be hiding a second one. */
interface Page {
  readonly stories: ReadonlyArray<Story>
  readonly windowed: boolean
}

const authorOf = (story: Story): string | null => {
  const submitter = story.submitter_user
  if (submitter === undefined || submitter === null) return null
  return typeof submitter === "string" ? submitter : submitter.username ?? null
}

/**
 * The posting time in epoch milliseconds, or nothing.
 *
 * An unparseable date is null rather than `NaN` or zero: `NaN` poisons every
 * comparison it touches and a zero renders as 1970, which then reads as older
 * than any Last Look.
 */
const postedAtOf = (story: Story): number | null => {
  if (story.created_at === undefined || story.created_at === null) return null
  const at = Date.parse(story.created_at)
  return Number.isNaN(at) ? null : at
}

const discussionOf = (story: Story): DiscussionId =>
  DiscussionId.make({ network: "lobsters", nativeId: NativeId.make(story.short_id) })

/**
 * The row a panel draws.
 *
 * `venue` is null on purpose — see this file's header. `submittedUrl` is kept
 * verbatim, because it is the evidence the Linked Mention is made of.
 */
const rowOf = (story: Story): Discussion =>
  Discussion.make({
    id: discussionOf(story),
    title: story.title ?? "",
    submittedUrl: story.url === undefined || story.url === "" ? null : story.url,
    postedAt: postedAtOf(story),
    author: authorOf(story),
    venue: null
  })

/**
 * The domain Lobsters would have filed this Subject under.
 *
 * Verified 2026-08-24: `/domains/theregister.com.json` answers with stories
 * whose own `url` is `https://www.theregister.com/…`, so Lobsters keys its
 * domain pages on the host with `www.` stripped, and asking about the `www.`
 * form would be asking about a domain that does not exist there.
 *
 * A deeper host is asked about AS IT STANDS — `blog.example.com`, not
 * `example.com`. Whether Lobsters folds subdomains into a registrable domain is
 * NOT verified, and verifying it costs a request against a volunteer-run site,
 * so it is recorded as a known bound instead of guessed at: if it does fold
 * them, a Subject on a subdomain is a miss. Nothing else in this connector
 * pretends otherwise.
 *
 * Null when there is no host to ask about — a `file:`, `about:` or malformed
 * address, which the Exclusion List should have caught upstream and which this
 * connector must still be total about.
 */
const domainOf = (subject: SubjectUrl): string | null => {
  let url: URL
  try {
    url = new URL(subject as string)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  const host = url.hostname.toLowerCase().replace(/^www\./, "")
  return host === "" ? null : host
}

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

/**
 * True only for the 404 that means "no such domain page".
 *
 * Bound to the URL we constructed, so the Silence reading cannot be inherited
 * by any other 404 this connector might one day receive.
 */
const isNoSuchDomain = (
  response: HttpClientResponse.HttpClientResponse,
  endpoint: string
): boolean => response.status === 404 && response.request.url === endpoint

export class Lobsters extends Context.Service<Lobsters, DiscussionSourceShape>()(
  "parle/source/Lobsters"
) {
  static readonly layer = Layer.effect(
    Lobsters,
    Effect.gen(function*() {
      /**
       * The client, with no retry wrapper at all.
       *
       * Deliberate, and the one place this connector differs structurally from
       * Hacker News': there is no published limit to stay under, so a refusal
       * from this site is taken at its word the first time.
       */
      const client = yield* HttpClient.HttpClient

      /**
       * Ask about one domain, and read the 404 that means "nothing".
       *
       * The URL is built and the 404 is interpreted in the same function on
       * purpose: the two cannot drift apart, and no other response in the
       * program is eligible for the reading.
       */
      const askDomain = Effect.fn("Lobsters.askDomain")(function*(
        domain: string
      ): Effect.fn.Return<Page | "no-such-domain", Unanswered> {
        const endpoint = `${DOMAINS}/${encodeURIComponent(domain)}.json`
        const response = yield* client.get(endpoint)
        if (isNoSuchDomain(response, endpoint)) return "no-such-domain"
        const stories = yield* readStories(response)
        return { stories, windowed: stories.length >= PAGE }
      })

      /**
       * Hand over what the answer described, before the Consultation is emitted.
       *
       * Ordering matters to a caller: the terminal Consultation is the signal
       * that a Place has answered, so a row deposited after it arrives at a
       * panel that has already decided what to draw.
       */
      const record = Effect.fn("Lobsters.record")(function*(stories: ReadonlyArray<Story>) {
        const observations: Array<Observation> = []
        for (const story of stories) {
          observations.push(
            yield* observeNow(discussionOf(story), {
              score: story.score ?? null,
              comments: story.comment_count ?? null
            })
          )
        }
        yield* (yield* DiscussionSink).note(stories.map(rowOf))
        yield* (yield* ObservationSink).observe(observations)
      })

      const linkedAnswer = Effect.fn("Lobsters.linkedAnswer")(function*(
        place: Place,
        domain: string,
        subject: SubjectUrl,
        aliases: ReadonlyArray<Alias>
      ): Effect.fn.Return<Consultation, Unanswered> {
        const page = yield* askDomain(domain)
        if (page === "no-such-domain") return answeredWith(place, [])

        const candidates = candidateAddresses(subject, aliases)
        const found: Array<{ story: Story; viaAlias: string }> = []
        const seen = new Set<string>()
        for (const story of page.stories) {
          if (seen.has(story.short_id)) continue
          const submitted = story.url
          if (submitted === undefined || submitted === null || submitted === "") continue
          const viaAlias = matchingAddress(submitted, candidates)
          if (viaAlias === undefined) continue
          seen.add(story.short_id)
          found.push({ story, viaAlias })
        }

        yield* record(found.map(({ story }) => story))

        return answeredWith(
          place,
          found.map(({ story, viaAlias }) =>
            Mention.cases.Linked.make({
              subject,
              discussion: discussionOf(story),
              viaAlias
            })
          ),
          page.windowed
        )
      })

      const place = placeOf("lobsters")

      return Lobsters.of({
        network: "lobsters",
        places: placesOf("lobsters"),
        linked: (subject, aliases) => {
          const domain = domainOf(subject)
          // No host, no question. `withheld` rather than a Withholding after an
          // `Asking`, because nothing was asked and the Coverage must not claim
          // otherwise.
          return domain === null
            ? withheld(place, "excluded")
            : asking(place, linkedAnswer(place, domain, subject, aliases))
        }
      })
    })
  )
}

/** The connector's own stream type, for callers that want it named. */
export type LobstersLookup = Stream.Stream<Consultation, never, never>
