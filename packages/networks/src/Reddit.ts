/**
 * Reddit, as ADR 0013's ordered chain: cookies, then markup, then a Refusal.
 *
 * The tiering is not belt-and-braces. The two paths fail under *different*
 * conditions, which is what makes them worth having:
 *
 *   1. `www.reddit.com/api/info.json?url=…` with `credentials: "include"`.
 *      Exact-URL semantics, ~25 results, structured. Measured 2026-08-08:
 *      **403 with `credentials: "omit"` even from a good consumer IP, 200 with
 *      `"include"`.** An anonymous cookie jar is enough — no account, no OAuth.
 *   2. `old.reddit.com/search?sort=top&q=url:…`, HTML, cookie-free. Covers the
 *      reader with no Reddit cookies, the reader blocking third-party cookies,
 *      and Safari's FB15307169 credential-dropping bug, under which tier 1 is
 *      dead on Apple platforms and tier 2 carries iOS alone.
 *   3. A Refusal. Never a thrown error, and never a Silence — "Reddit would not
 *      talk to us" and "nobody on Reddit has discussed this page" are opposite
 *      claims and only the second may be cached.
 *
 * A 403 here is the ORDINARY outcome, not an exception, so nothing retries it:
 * 403 sits outside Effect's transient set, tier 1 falls through immediately,
 * and no part of this file treats reaching tier 2 as a problem. Verified from
 * this sandbox, which has a datacenter IP: both tiers 403 with a block page.
 * That is the expected local result and is exactly why the chain exists — so
 * both paths are exercised here against recorded bodies rather than the wire.
 *
 * Rate budget is shared with the reader's own Reddit browsing, so
 * `x-ratelimit-remaining` is read off every tier-1 response and a low reading
 * pauses tier 1 until the stated reset. Tier 2 is cookie-free and on a
 * different budget, so a paused tier 1 degrades to markup rather than to
 * nothing.
 */
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import { type Consultation, type Place } from "@parle/domain/Coverage"
import { Mention } from "@parle/domain/Mention"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { hrefOf, type Alias, type SubjectUrl } from "@parle/domain/Subject"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { matchingAddress, sameAddress } from "./Address.ts"
import { Discussion, DiscussionSink } from "./Discussion.ts"
import { Observation, ObservationSink, observeNow } from "./Observation.ts"
import { isBlockPage, readSearchPage, type SearchRow } from "./RedditPage.ts"
import {
  answeredWith,
  asking,
  Declined,
  type DiscussionSource,
  Garbled,
  type Unanswered,
  placeOf,
  placesOf
} from "./Source.ts"
import { expectHtml, expectJson } from "./Wire.ts"

const INFO = "https://www.reddit.com/api/info.json"
const SEARCH_JSON = "https://www.reddit.com/search.json"
const OLD_SEARCH = "https://old.reddit.com/search"

/**
 * Remaining-request floor at which tier 1 stops until the window resets.
 *
 * Not zero. The budget is shared with whatever the reader is doing on Reddit in
 * another tab, so spending the last request means the next thing THEY do is the
 * one that gets refused.
 */
const RATELIMIT_FLOOR = 3

/** How long a missing or unreadable `x-ratelimit-reset` is assumed to be. */
const DEFAULT_RESET_MILLIS = 60_000

/** A link post. `t1` is a comment and carries no submitted address. */
const LINK_KIND = "t3"

const Child = Schema.Struct({
  kind: Schema.String,
  data: Schema.Struct({
    id: Schema.String,
    title: Schema.optionalKey(Schema.NullOr(Schema.String)),
    url: Schema.optionalKey(Schema.NullOr(Schema.String)),
    author: Schema.optionalKey(Schema.NullOr(Schema.String)),
    subreddit: Schema.optionalKey(Schema.NullOr(Schema.String)),
    /** When the post was made, epoch SECONDS, UTC. `created` is the poster's zone. */
    created_utc: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    score: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    num_comments: Schema.optionalKey(Schema.NullOr(Schema.Number))
  })
})

const Listing = Schema.Struct({
  data: Schema.Struct({
    children: Schema.Array(Child)
  })
})

const readListing = expectJson(Listing)

/**
 * Both tiers reduce to this before anything downstream sees them.
 *
 * The two paths know different amounts — `old.reddit.com` renders a relative
 * time and no author on a search row — so every field a tier may not have is
 * nullable here rather than defaulted. A zero posting time renders as 1970 and,
 * worse, would read as older than any Last Look.
 */
interface Found {
  readonly nativeId: string
  readonly submitted: string | null
  readonly title: string | null
  readonly author: string | null
  /** Epoch milliseconds. */
  readonly postedAt: number | null
  readonly score: number | null
  readonly comments: number | null
  /** Subreddit name without the `r/` prefix. */
  readonly venue: string | null
}

const fromListing = (listing: typeof Listing.Type): ReadonlyArray<Found> =>
  listing.data.children
    .filter((child) => child.kind === LINK_KIND)
    .map((child) => ({
      nativeId: child.data.id,
      submitted: child.data.url ?? null,
      title: child.data.title ?? null,
      author: child.data.author ?? null,
      postedAt: child.data.created_utc === undefined || child.data.created_utc === null
        ? null
        : child.data.created_utc * 1000,
      score: child.data.score ?? null,
      comments: child.data.num_comments ?? null,
      venue: child.data.subreddit ?? null
    }))

const fromSearchPage = (results: ReadonlyArray<SearchRow>): ReadonlyArray<Found> =>
  results.map((result) => ({
    nativeId: result.nativeId,
    submitted: result.submitted,
    title: result.title,
    author: null,
    postedAt: null,
    score: result.score,
    comments: result.comments,
    venue: result.venue
  }))

const discussionOf = (found: Found): DiscussionId =>
  DiscussionId.make({ network: "reddit", nativeId: NativeId.make(found.nativeId) })

const rowOf = (found: Found): Discussion =>
  Discussion.make({
    id: discussionOf(found),
    title: found.title ?? "",
    submittedUrl: found.submitted,
    postedAt: found.postedAt,
    author: found.author,
    venue: found.venue
  })

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

/** `x-ratelimit-remaining: 94` / `x-ratelimit-reset: 190`, both as decimals. */
const readNumberHeader = (
  response: HttpClientResponse.HttpClientResponse,
  name: string
): number | null => {
  const raw = response.headers[name]
  if (raw === undefined) return null
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export class Reddit extends Context.Service<Reddit, DiscussionSource>()(
  "parle/source/Reddit"
) {
  static readonly layer = Layer.effect(
    Reddit,
    Effect.gen(function*() {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.retryTransient({
          schedule: Schedule.exponential(200).pipe(Schedule.jittered),
          times: 2
        })
      )

      /**
       * When tier 1 may be asked again. Epoch millis; 0 means "now".
       *
       * Held in a `Ref` on the layer rather than passed around because the
       * budget belongs to the reader's browser, not to any one Enquiry — two
       * Subjects looked up in the same minute share it.
       */
      const tierOneOpensAt = yield* Ref.make(0)

      const noteRateLimit = Effect.fn("Reddit.noteRateLimit")(function*(
        response: HttpClientResponse.HttpClientResponse
      ) {
        const remaining = readNumberHeader(response, "x-ratelimit-remaining")
        if (remaining === null || remaining > RATELIMIT_FLOOR) return
        const resetSeconds = readNumberHeader(response, "x-ratelimit-reset")
        const now = yield* Clock.currentTimeMillis
        const wait = resetSeconds === null ? DEFAULT_RESET_MILLIS : Math.max(0, resetSeconds) * 1000
        yield* Ref.set(tierOneOpensAt, now + wait)
      })

      const tierOneIsOpen = Effect.fn("Reddit.tierOneIsOpen")(function*() {
        const opensAt = yield* Ref.get(tierOneOpensAt)
        if (opensAt === 0) return true
        const now = yield* Clock.currentTimeMillis
        return now >= opensAt
      })

      /**
       * Tier 1. `credentials: "include"` is the entire point of this path and
       * is supplied per-request rather than on the shared client, so no other
       * connector inherits the reader's Reddit cookies.
       */
      const askWithCookies = Effect.fn("Reddit.askWithCookies")(function*(
        endpoint: string,
        urlParams: Record<string, string>
      ): Effect.fn.Return<ReadonlyArray<Found>, Unanswered> {
        const response = yield* client.get(endpoint, { urlParams }).pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" })
        )
        yield* noteRateLimit(response)
        const listing = yield* readListing(response)
        return fromListing(listing)
      })

      /** Tier 2. Cookie-free markup, on a different budget and a different host. */
      const askOldReddit = Effect.fn("Reddit.askOldReddit")(function*(
        urlParams: Record<string, string>
      ): Effect.fn.Return<ReadonlyArray<Found>, Unanswered> {
        const response = yield* client.get(OLD_SEARCH, { urlParams })
        const html = yield* expectHtml(response)
        if (isBlockPage(html)) {
          // A block page scans to zero rows. Left alone it would become a
          // Silence — the one outcome we are allowed to cache — so it is named
          // here as the Refusal it is.
          return yield* Effect.fail(new Declined({ reason: "forbidden" }))
        }
        return fromSearchPage(readSearchPage(html))
      })

      /**
       * The chain. Tier 1 unless it is paused, then tier 2, then whatever tier
       * 2 said.
       *
       * A tier-1 SUCCESS is final even when it found nothing: it answered, and
       * falling through would spend a second request to disagree with an
       * answer we have no reason to doubt.
       */
      const chain = Effect.fn("Reddit.chain")(function*(
        tierOne: Effect.Effect<ReadonlyArray<Found>, Unanswered>,
        tierTwo: Effect.Effect<ReadonlyArray<Found>, Unanswered>
      ): Effect.fn.Return<ReadonlyArray<Found>, Unanswered> {
        const open = yield* tierOneIsOpen()
        if (!open) return yield* tierTwo
        return yield* tierOne.pipe(Effect.catch(() => tierTwo))
      })

      const record = Effect.fn("Reddit.record")(function*(found: ReadonlyArray<Found>) {
        const observations: Array<Observation> = []
        for (const one of found) {
          observations.push(
            yield* observeNow(discussionOf(one), { score: one.score, comments: one.comments })
          )
        }
        // Before the Consultation, which is the signal a Place has answered.
        yield* (yield* DiscussionSink).note(found.map(rowOf))
        yield* (yield* ObservationSink).observe(observations)
      })

      const linkedAnswer = Effect.fn("Reddit.linkedAnswer")(function*(
        place: Place,
        subject: SubjectUrl,
        aliases: ReadonlyArray<Alias>
      ): Effect.fn.Return<Consultation, Unanswered> {
        // Reddit is asked about the ELECTED address only, unlike Hacker News,
        // which is asked about each Alias in turn. The budget here is shared
        // with whatever the reader is doing on Reddit in another tab and ADR
        // 0013 allows one request per page view; `api/info.json` takes one
        // `url` at a time, so widening the question means multiplying the
        // requests. The Alias set still widens what we ACCEPT back, below.
        const candidates = candidateAddresses(subject, aliases)
        const primary = candidates[0]
        if (primary === undefined) {
          return yield* Effect.fail(new Garbled({ detail: "no address to ask about" }))
        }

        const found = yield* chain(
          askWithCookies(INFO, { url: primary }),
          askOldReddit({ sort: "top", q: `url:${primary}` })
        )

        // Reddit's `url:` search is close to exact, but "close to" is not the
        // standard the strong tier is held to — the same re-check Hacker News
        // needs, for the same reason.
        const kept = new Map<string, { one: Found; viaAlias: string }>()
        for (const one of found) {
          if (kept.has(one.nativeId) || one.submitted === null) continue
          const viaAlias = matchingAddress(one.submitted, candidates)
          if (viaAlias === undefined) continue
          kept.set(one.nativeId, { one, viaAlias })
        }

        const linked = [...kept.values()]
        yield* record(linked.map(({ one }) => one))

        return answeredWith(
          place,
          linked.map(({ one, viaAlias }) =>
            Mention.cases.Linked.make({
              subject,
              discussion: discussionOf(one),
              viaAlias
            })
          )
        )
      })

      const place = placeOf("reddit")

      return Reddit.of({
        network: "reddit",
        places: placesOf("reddit"),
        linked: (subject, aliases) =>
          asking(place, linkedAnswer(place, subject, aliases))
      })
    })
  )
}
