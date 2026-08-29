/**
 * Lemmy, through one big instance's federated view.
 *
 * `GET https://lemmy.world/api/v3/search?q=<url>&type_=Url` is keyless,
 * anonymous, and CORS-open to an extension origin — verified live 2026-08-24,
 * which returned `access-control-allow-origin: chrome-extension://…` echoed
 * back for a made-up extension id, `cache-control: public, max-age=60`, and
 * `content-type: application/json`. So it clears the same bar Hacker News set
 * in ADR 0014: no account, no OAuth, no host permission argument.
 *
 * Three facts about that endpoint shape this file.
 *
 * **One instance answers for many.** Lemmy is federated, and there is no
 * fediverse-wide index to ask. A search on `lemmy.world` returns posts held by
 * every instance it subscribes to: the verified query for
 * `nature.com/articles/d41586-024-02012-5` came back with three posts, two of
 * them carrying `ap_id: https://lemmy.ml/post/…`. So we ask the largest
 * instance and accept that the answer is ITS view of the network rather than
 * the whole of it — a Silence from here is "lemmy.world's federation has
 * nothing", which is the strongest claim anyone can make anonymously, and is
 * why a filled window is reported rather than swallowed (below).
 *
 * **`type_=Url` matches the address EXACTLY**, which is the opposite failure
 * from Algolia's. Hacker News returns a near-miss article and has to be
 * re-checked (see {@link ./HackerNews.ts}); Lemmy returns nothing at all when
 * the post was submitted under `www.` and the Subject URL is bare, or with a
 * trailing slash, or carrying the `utm_` parameters the canonicalizer stripped.
 * That is a systematic STRONG-tier false negative — the kind nobody files a bug
 * for. The repair is one extra query on one materially different Alias, and no
 * more: {@link plausibleVariant} says what earns it, and the budget is capped at
 * {@link MAX_QUERIES} because instance limits are in the ~60-per-10-minutes
 * class and the requests come out of the READER's address.
 *
 * Exactness is not a licence to skip the re-check. Every hit is still matched
 * against the full Alias set with {@link matchingAddress}, and one that matches
 * no Alias is dropped: the two queries are asked independently and a hit
 * returned for query B is only evidence about query B until we have compared it
 * ourselves.
 *
 * **The counts carry no as-of time.** `counts.score` and `counts.comments` sit
 * beside `counts.published` and `counts.newest_comment_time`, and neither of
 * those says when the score was true — the same hole Algolia has. So an
 * Observation is stamped with OUR receive time from `Clock`. See
 * {@link ./Observation.ts}.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import { type Consultation, type Place } from "@parle/domain/Coverage"
import { Mention } from "@parle/domain/Mention"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import type { Alias, SubjectUrl } from "@parle/domain/Subject"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { matchingAddress } from "./Address.ts"
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

/**
 * The instance we ask, and the reason it is a constant.
 *
 * `lemmy.world` is the largest general instance and therefore subscribes to the
 * most communities elsewhere, which is the only lever anyone has over how much
 * of the fediverse an anonymous search can see. Asking several instances would
 * multiply the requests and the disclosure — every Lookup tells whoever answers
 * it what the reader is reading — for a heavily overlapping answer.
 */
const ENDPOINT = "https://lemmy.world/api/v3/search"

/**
 * How many hits one Lookup will read.
 *
 * Fifty is the server's own ceiling on `limit`, not our choice, so there is no
 * larger window to ask for and a full fifty is genuinely all we can see.
 */
const LINKED_WINDOW = 50

/**
 * How many live requests one Lookup may spend. Two.
 *
 * One for the Subject URL and, when the Alias set offers one, one for a
 * materially different variant. The rate limit is per-instance and in the
 * ~60/10min class, it is charged to the reader's own IP, and the answers are
 * CDN-cached for 60 seconds — so two is polite and three would be arguing with
 * the diminishing returns of an exact-match search.
 */
const MAX_QUERIES = 2

/** Query parameters that name the referrer rather than the document. */
const isCampaignParam = (key: string): boolean =>
  key.startsWith("utm_") ||
  ["fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "msclkid", "ref", "ref_src", "ref_url", "twclid"]
    .includes(key)

/**
 * The form of an address a submitter would plausibly have pasted.
 *
 * NOT {@link ./Address.ts}'s `comparableAddress`, and the difference is the
 * whole point of this function. `comparableAddress` answers "do these name the
 * same document", so it folds away scheme, `www.`, the trailing slash and the
 * query order — exactly the differences that decide whether Lemmy's EXACT
 * matcher finds a post. Those differences must survive here.
 *
 * What is dropped is only what a poster's address would carry by accident: the
 * fragment, and campaign parameters. An Alias that differs from the Subject URL
 * in nothing but those is not a second address anyone submitted under; it is
 * the same paste wearing a click id, and spending the one spare request on it
 * buys a second copy of the first answer.
 */
const submissionForm = (raw: string): string => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw.trim()
  }
  url.hash = ""
  for (const key of [...url.searchParams.keys()]) {
    if (isCampaignParam(key)) url.searchParams.delete(key)
  }
  return url.toString()
}

/**
 * The one Alias worth a second exact query, if there is one.
 *
 * "Materially different" means it would be typed differently into a search box
 * that does string equality: a `www.`/bare flip, an `http`/`https` flip, a
 * trailing slash, an AMP path, a genuinely different address the reader
 * redirected through. Taken in the order the caller supplied — `SubjectIdentity`
 * puts the elected address first and the best-evidenced Aliases after it — so
 * the first qualifying one is the one we have most reason to believe in.
 */
const plausibleVariant = (
  subject: SubjectUrl,
  aliases: ReadonlyArray<Alias>
): string | undefined => {
  const asked = submissionForm(subject as string)
  const seen = new Set([asked])
  for (const alias of aliases) {
    const form = submissionForm(alias.url)
    if (seen.has(form)) continue
    seen.add(form)
    return alias.url
  }
  return undefined
}

/**
 * A post as `search` returns it.
 *
 * `ap_id` is the only required field, because it is the identity — a post
 * without one cannot be addressed, cited, or deduplicated, and there is nothing
 * to be gained from carrying it. Everything else is optional AND nullable: a
 * text post has no `url`, a defederated instance's post can arrive with its
 * `community` hollowed out, and a schema that insisted would turn one such post
 * into a Garble for the whole Lookup.
 */
const Post = Schema.Struct({
  /**
   * The post's ActivityPub id — a full URL on the instance that OWNS the post,
   * which is the only stable address a federated post has. `id` is the local
   * numeric id on whichever instance answered and means something different on
   * every other one, so it is deliberately not read.
   */
  ap_id: Schema.String,
  /** The title. Lemmy calls it `name`. */
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** ISO 8601 with microseconds, UTC — `2024-06-25T18:40:04.447403Z`. */
  published: Schema.optionalKey(Schema.NullOr(Schema.String)),
  removed: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  deleted: Schema.optionalKey(Schema.NullOr(Schema.Boolean))
})

const Counts = Schema.Struct({
  score: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  comments: Schema.optionalKey(Schema.NullOr(Schema.Number))
})

const Community = Schema.Struct({
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** `https://lemmy.world/c/fosai` — the instance half of the venue's name. */
  actor_id: Schema.optionalKey(Schema.NullOr(Schema.String))
})

const Creator = Schema.Struct({
  name: Schema.optionalKey(Schema.NullOr(Schema.String))
})

const PostView = Schema.Struct({
  post: Post,
  counts: Schema.optionalKey(Counts),
  community: Schema.optionalKey(Community),
  creator: Schema.optionalKey(Creator)
})
type PostView = typeof PostView.Type

/**
 * What `search` answers with.
 *
 * The response also carries `comments`, `communities` and `users` arrays.
 * `type_=Url` leaves all three empty and none of them could evidence a Linked
 * Mention anyway — a comment mentioning an address is Harvest's job — so they
 * are not decoded. `posts` is required: an object with no `posts` key is not an
 * answer we understand, and reading it as an empty one would manufacture a
 * Silence, which is the only outcome we are allowed to cache.
 */
const Answer = Schema.Struct({
  posts: Schema.Array(PostView)
})

const readAnswer = expectJson(Answer)

/** Epoch milliseconds, or nothing. A zero renders as 1970 and sorts as ancient. */
const postedAtOf = (view: PostView): number | null => {
  const raw = view.post.published
  if (raw === undefined || raw === null) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The venue, qualified by the instance that hosts it.
 *
 * A bare `technology` is ambiguous across a federated network — `technology` on
 * `lemmy.world` and on `beehaw.org` are different rooms with different people —
 * so the community is named the way a Lemmy reader names it, `name@instance`,
 * taken from the community's own `actor_id` host rather than from the instance
 * we happened to ask.
 */
const venueOf = (view: PostView): string | null => {
  const name = view.community?.name
  if (name === undefined || name === null || name === "") return null
  const actor = view.community?.actor_id
  if (actor === undefined || actor === null) return name
  try {
    return `${name}@${new URL(actor).host}`
  } catch {
    return name
  }
}

const discussionOf = (view: PostView): DiscussionId =>
  DiscussionId.make({ network: "lemmy", nativeId: NativeId.make(view.post.ap_id) })

const rowOf = (view: PostView): Discussion =>
  Discussion.make({
    id: discussionOf(view),
    title: view.post.name ?? "",
    submittedUrl: view.post.url ?? null,
    postedAt: postedAtOf(view),
    author: view.creator?.name ?? null,
    venue: venueOf(view)
  })

/**
 * A post nobody can read is not a Discussion.
 *
 * Reddit's connector learned this the expensive way — `api/info.json` hands
 * back removed posts and the panel led with one — and Lemmy states it plainly
 * on every post, so the filter is cheap here. `false` and absent both pass;
 * only an explicit `true` is a husk.
 */
const isReadable = (view: PostView): boolean =>
  view.post.removed !== true && view.post.deleted !== true

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

/** One query's answer, and whether it filled the window we asked for. */
interface Window {
  readonly posts: ReadonlyArray<PostView>
  readonly windowed: boolean
}

export class Lemmy extends Context.Service<Lemmy, DiscussionSourceShape>()(
  "parle/source/Lemmy"
) {
  static readonly layer = Layer.effect(
    Lemmy,
    Effect.gen(function*() {
      const client = (yield* HttpClient.HttpClient).pipe(
        // Transient responses only — 408, 429 and 5xx. 403 stays outside that
        // set: retrying a refusal spends the reader's own instance budget to
        // learn the same thing twice.
        HttpClient.retryTransient({
          schedule: Schedule.exponential(200).pipe(Schedule.jittered),
          times: 2
        })
      )

      const search = Effect.fn("Lemmy.search")(function*(
        address: string
      ): Effect.fn.Return<Window, Unanswered> {
        const response = yield* client.get(ENDPOINT, {
          urlParams: {
            q: address,
            type_: "Url",
            sort: "TopAll",
            limit: String(LINKED_WINDOW)
          }
        })
        const answer = yield* readAnswer(response)
        return {
          posts: answer.posts,
          /*
           * Unlike Algolia there is no total in the payload, so a full window
           * cannot be told apart from a complete answer that happens to be
           * fifty long. ADR 0005 decides which way that uncertainty falls: a
           * Silence off a filled window would be CACHED as "nobody discussed
           * this page", so the honest reading of "we saw as many as we asked
           * for" is that we may not have seen everything.
           */
          windowed: answer.posts.length >= LINKED_WINDOW
        }
      })

      /**
       * Hand over what the answer described, before the Consultation.
       *
       * The terminal Consultation is the signal that a Place has answered, so a
       * row deposited after it arrives at a panel that has already drawn.
       */
      const record = Effect.fn("Lemmy.record")(function*(found: ReadonlyArray<PostView>) {
        const observations: Array<Observation> = []
        for (const view of found) {
          observations.push(
            yield* observeNow(discussionOf(view), {
              score: view.counts?.score ?? null,
              comments: view.counts?.comments ?? null
            })
          )
        }
        yield* (yield* DiscussionSink).note(found.map(rowOf))
        yield* (yield* ObservationSink).observe(observations)
      })

      const linkedAnswer = Effect.fn("Lemmy.linkedAnswer")(function*(
        place: Place,
        subject: SubjectUrl,
        aliases: ReadonlyArray<Alias>
      ): Effect.fn.Return<Consultation, Unanswered> {
        const candidates = candidateAddresses(subject, aliases)
        const primary = candidates[0]
        if (primary === undefined) {
          return yield* Effect.fail(new Garbled({ detail: "no address to ask about" }))
        }

        const variant = plausibleVariant(subject, aliases)
        const asked = (variant === undefined ? [primary] : [primary, variant])
          .slice(0, MAX_QUERIES)

        const attempts = yield* Effect.forEach(
          asked,
          (address) => Effect.result(search(address)),
          // At most two in flight, which is the whole budget. Sequential would
          // double the latency of the aliased case to spare an instance a burst
          // of two against a ~60/10min allowance.
          { concurrency: 2 }
        )

        const answered = attempts.filter(Result.isSuccess)
        if (answered.length === 0) {
          // One endpoint, one instance: both queries fail the same way in
          // practice. Surface the first rather than inventing a Silence out of
          // a pair of Refusals.
          const firstTrouble = attempts.find(Result.isFailure)
          return yield* firstTrouble
            ? Effect.fail(firstTrouble.failure)
            : Effect.fail(new Garbled({ detail: "no address was asked about" }))
        }

        /*
         * Deduplicated by `ap_id`, which is what makes the second query safe to
         * issue: a post submitted under both forms — or federated to
         * lemmy.world twice — is one Discussion and must be one Mention.
         */
        const kept = new Map<string, { view: PostView; viaAlias: string }>()
        for (const attempt of answered) {
          for (const view of attempt.success.posts) {
            if (kept.has(view.post.ap_id)) continue
            if (!isReadable(view)) continue
            const submitted = view.post.url
            if (submitted === undefined || submitted === null) continue
            const viaAlias = matchingAddress(submitted, candidates)
            if (viaAlias === undefined) continue
            kept.set(view.post.ap_id, { view, viaAlias })
          }
        }

        const found = [...kept.values()]
        yield* record(found.map(({ view }) => view))

        // `some`, not `every`: the queries are independent and the reader is
        // shown their union, so an unbounded gap under either one is a gap in
        // what they see.
        return answeredWith(
          place,
          found.map(({ view, viaAlias }) =>
            Mention.cases.Linked.make({
              subject,
              discussion: discussionOf(view),
              viaAlias
            })
          ),
          answered.some((attempt) => attempt.success.windowed)
        )
      })

      const place = placeOf("lemmy")

      return Lemmy.of({
        network: "lemmy",
        places: placesOf("lemmy"),
        linked: (subject, aliases) => asking(place, linkedAnswer(place, subject, aliases))
      })
    })
  )
}
