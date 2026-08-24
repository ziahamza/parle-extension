/**
 * Bluesky, via the public AppView's `app.bsky.feed.searchPosts`.
 *
 * Keyless and unauthenticated — `public.api.bsky.app` exists precisely to be
 * read without a session — which puts it in the same class as Hacker News:
 * a Network that can answer from any context on any platform with no cookie and
 * no account. Everything below is what makes it differ from Algolia.
 *
 * **`url=` is purpose-built, and still cannot be taken on its word.** The
 * lexicon (`bluesky-social/atproto`, `lexicons/app/bsky/feed/searchPosts.json`,
 * read 2026-08-24) defines it as "Filter to posts with links (facet links or
 * embeds) pointing to this URL. Server may apply URL normalization or fuzzy
 * matching." *May apply fuzzy matching* is the operative clause: it is the same
 * hazard {@link ./Address.ts} was written for on Algolia, where a query for
 * `d41586-024-02012-5` returned a submission of `d41586-024-02082-5`. So every
 * post that comes back is re-checked here against the Subject's own Aliases,
 * and one that matches none is DROPPED rather than demoted — nobody searched a
 * title, so there is no evidence of a weak tier either, and a Linked Mention is
 * the tier that discharges ADR 0001's disclosure argument.
 *
 * The re-check reads the same two places the server says it indexed: the link
 * facets on the record, and the external embed card — on the record and on the
 * hydrated view, since a post carries both and they can disagree.
 *
 * **`q` is REQUIRED, and that is a trap.** The lexicon marks `q` as the only
 * required parameter, so a URL filter cannot be sent on its own. Every value we
 * could put there ANDs a full-text term against the filter that is supposed to
 * be doing the work — and a post that links a page from an embed card, with the
 * address nowhere in its text, would then be silently excluded. That is a
 * strong-tier false negative, the failure ADR 0005 refuses outright, and it
 * would look exactly like a Silence. {@link MATCH_ANYTHING} is the alternative:
 * if the server rejects it the answer is a `BadQueryString` 400, which arrives
 * as a LOUD Refusal in Coverage rather than as a quiet absence in the panel.
 * **This choice is unverified against the live service** — see the note on
 * {@link MATCH_ANYTHING} — and it is one constant to change if it is wrong.
 *
 * **One request, and no pagination.** Unauthenticated cursor paging is broken
 * upstream, so the first page IS the retrieval window; per ADR 0005 a filled
 * window is reported as "at least N" and never as a total. The published rate
 * limit is ~3,000 requests per five minutes per IP, which one Lookup per
 * Subject does not come close to, so there is no politeness argument for asking
 * about fewer Aliases — but there is no *recall* argument for asking about more
 * either, because the server normalizes the address itself and our own
 * re-check accepts any Alias whatever we asked under. Hence one request keyed
 * on the Subject URL, where Hacker News needs four.
 *
 * **A 403 is the ordinary outcome from a datacenter IP.** Verified from this
 * box 2026-08-24: the CDN in front of `public.api.bsky.app` answers 403 with an
 * HTML block page before the request reaches the AppView at all. That is a
 * Refusal — a fact about the attempt, never cached, never softened into a
 * Silence — and it is the same condition ADR 0013 records for Reddit. It is
 * why there is no live test here that requires a 200.
 *
 * **There is no as-of time for the counts.** `likeCount` and `replyCount`
 * arrive beside `indexedAt`, which is when the AppView ingested the POST, not
 * when the counts were true. So an Observation is stamped with OUR receive time
 * from `Clock`, exactly as on Hacker News. See {@link ./Observation.ts}.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { Consultation, type Place } from "@parle/domain/Coverage"
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
  type Unanswered,
  placeOf,
  placesOf
} from "./Source.ts"
import { expectJson } from "./Wire.ts"

const ENDPOINT = "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts"

/**
 * The value sent for the required `q`, chosen to constrain nothing.
 *
 * `q` cannot be omitted, and every meaningful value is worse than none. Sending
 * the Subject URL as the query ANDs its tokens against the `url=` filter, so a
 * post whose only reference to the page is an embed card — the commonest shape
 * on Bluesky, since the client turns a pasted link into a card and the author
 * usually deletes the raw text — would never come back. That miss is invisible:
 * it renders as "nobody discussed this page" and is cacheable as a Silence.
 *
 * A wildcard is the Lucene idiom the lexicon's own note points at ("Lucene
 * query syntax is recommended"), and its failure mode is the opposite one — the
 * documented `BadQueryString` error, a 400, which {@link ./Source.ts} classifies
 * as a Refusal and Coverage says out loud.
 *
 * **Not verified live.** The CDN 403s this development box before any query
 * reaches the AppView, so neither value could be told from the other here.
 * Whoever first runs this from a residential IP should check that a page with
 * known Bluesky posts comes back non-empty; if it does not, this constant is
 * the single thing to change.
 */
const MATCH_ANYTHING = "*"

/**
 * How many posts one Lookup will read before it stops.
 *
 * 100 is the lexicon's own maximum for `limit`, and it is taken whole because
 * the window cannot be extended: unauthenticated cursor pagination does not
 * work against the public AppView, so there is no second page to fall back on.
 * Asking for less would narrow the only look we get, and asking for more is not
 * a request the server will honour.
 */
const SEARCH_WINDOW = 100

/** Ranking: the busiest conversations first, since the window may truncate. */
const SORT = "top"

/** The facet feature that carries a link. Anything else is a mention or a tag. */
const LINK_FACET = "app.bsky.richtext.facet#link"

/** The collection an at-uri must name for the record to be a post. */
const POST_COLLECTION = "app.bsky.feed.post"

/**
 * The record inside a post view.
 *
 * Every field optional and nullable, for the reason {@link Post} is: this is a
 * lexicon-typed `unknown` in the schema, and one post carrying a shape we did
 * not anticipate must not turn the whole Lookup into a Garble.
 *
 * `facets` and `embed` are left as `Unknown` on purpose. Both are open unions —
 * `app.bsky.embed.external`, `#images`, `#record`, `#recordWithMedia`, and
 * whatever is added next — and a schema that enumerated them would fail closed
 * on the first new member. They are walked structurally instead, in
 * {@link addressesOf}.
 */
const PostRecord = Schema.Struct({
  text: Schema.optionalKey(Schema.NullOr(Schema.String)),
  createdAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  facets: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
  embed: Schema.optionalKey(Schema.NullOr(Schema.Unknown))
})

const Author = Schema.Struct({
  did: Schema.String,
  handle: Schema.optionalKey(Schema.NullOr(Schema.String)),
  displayName: Schema.optionalKey(Schema.NullOr(Schema.String))
})

/**
 * One `app.bsky.feed.defs#postView`.
 *
 * `uri` and `author.did` are the only required fields, because they are the
 * only ones without which there is nothing to identify. The counts are optional
 * AND nullable: a post with no likes may carry `likeCount: 0` or omit the field
 * entirely depending on the AppView's hydration, and a schema that demanded
 * them would make one un-liked post a Garble for every other post in the answer.
 */
const Post = Schema.Struct({
  uri: Schema.String,
  author: Author,
  record: Schema.optionalKey(Schema.NullOr(PostRecord)),
  /** The hydrated embed view, which can carry a card the record does not. */
  embed: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
  replyCount: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  likeCount: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  /** When the AppView ingested the post. Says nothing about when the counts were true. */
  indexedAt: Schema.optionalKey(Schema.NullOr(Schema.String))
})
type Post = typeof Post.Type

/**
 * What the AppView answers with.
 *
 * `hitsTotal` is in the lexicon and is deliberately NOT read. It is documented
 * as "may be rounded/truncated", so a total that rounds DOWN to the size of the
 * page we received would let us claim we saw everything when we did not — and
 * that claim is what makes an empty answer cacheable as a Silence. A filled
 * window is reported as a window on its own evidence instead. See
 * {@link Window}.
 */
const Answer = Schema.Struct({
  posts: Schema.Array(Post)
})

const readAnswer = expectJson(Answer)

/**
 * One answer, and whether we saw all of it.
 *
 * Unlike Hacker News there is no trustworthy total to compare against, and no
 * usable cursor to go and find out. So a filled window is treated as a window,
 * full stop: the honest reading of 100 posts back out of a request for 100 is
 * "at least 100 exist", which is exactly what ADR 0005 requires us to say
 * rather than papering over.
 */
interface Window {
  readonly posts: ReadonlyArray<Post>
  readonly windowed: boolean
}

/** One post reduced to what a Mention, a row, and an Observation need. */
interface Found {
  readonly post: Post
  readonly id: DiscussionId
  readonly viaAlias: string
  /** The address found IN the post that matched, kept verbatim as the evidence. */
  readonly submitted: string
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const asArray = (value: unknown): ReadonlyArray<unknown> => Array.isArray(value) ? value : []

const asText = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null

/** Every link the record's facets point at. */
const collectFacetLinks = (facets: unknown, into: Array<string>): void => {
  for (const facet of asArray(facets)) {
    const held = asObject(facet)
    if (held === null) continue
    for (const feature of asArray(held["features"])) {
      const named = asObject(feature)
      if (named === null || named["$type"] !== LINK_FACET) continue
      const uri = asText(named["uri"])
      if (uri !== null) into.push(uri)
    }
  }
}

/**
 * Every link an embed points at — record form and hydrated view form alike.
 *
 * One branch covers both because `app.bsky.embed.external` and its `#view`
 * agree on the shape that matters: an `external` object carrying a `uri`.
 *
 * `recordWithMedia` is descended into via `media`, which is this post's own
 * attachment. A quoted post's embed is deliberately NOT descended into: the
 * link belongs to somebody else's post, and treating it as evidence would make
 * every quote of a submission a Mention of the page.
 */
const collectEmbedLinks = (embed: unknown, into: Array<string>): void => {
  const held = asObject(embed)
  if (held === null) return
  const external = asObject(held["external"])
  if (external !== null) {
    const uri = asText(external["uri"])
    if (uri !== null) into.push(uri)
  }
  if ("media" in held) collectEmbedLinks(held["media"], into)
}

/** Every address this post links to, in the order the post carries them. */
const addressesOf = (post: Post): ReadonlyArray<string> => {
  const found: Array<string> = []
  collectFacetLinks(post.record?.facets, found)
  collectEmbedLinks(post.record?.embed, found)
  collectEmbedLinks(post.embed, found)
  return [...new Set(found)]
}

/**
 * The two halves of the at-uri that identify the post.
 *
 * `at://<did>/app.bsky.feed.post/<rkey>`. A uri that is not that shape returns
 * `null` and the post is skipped rather than failing the Lookup — one
 * unexpected record type in an answer is not a reason to tell the reader
 * Bluesky was unreadable. The collection is checked because `searchPosts` is
 * documented to return posts and an id built from anything else would key a
 * permalink that 404s.
 */
const identityOf = (uri: string): { readonly did: string; readonly rkey: string } | null => {
  if (!uri.startsWith("at://")) return null
  const parts = uri.slice("at://".length).split("/")
  if (parts.length !== 3) return null
  const [did, collection, rkey] = parts
  if (collection !== POST_COLLECTION) return null
  if (did === undefined || rkey === undefined || did === "" || rkey === "") return null
  return { did, rkey }
}

/**
 * The identity `permalinkOf` expects: the two at-uri halves, joined.
 *
 * Neither half can contain a `/`, so the join is reversible — which is the
 * property `@parle/domain`'s `permalinkOf` relies on to rebuild a bsky.app
 * address without holding the whole uri.
 */
const discussionOf = (did: string, rkey: string): DiscussionId =>
  DiscussionId.make({ network: "bluesky", nativeId: NativeId.make(`${did}/${rkey}`) })

/**
 * How much post text becomes a row's title.
 *
 * A Bluesky post has no title — it is a body, up to 300 graphemes, and the row
 * has to say something. 140 is long enough that the first sentence of a
 * link-sharing post survives intact and short enough that a row stays a row.
 */
const TITLE_LIMIT = 140

/**
 * The post's own words, folded to one line and cut where a reader would cut.
 *
 * Whitespace is collapsed because a post is written in paragraphs and a title
 * is one line; a raw newline in a row renders as a gap or as nothing depending
 * on the surface. The cut prefers the last word boundary so a truncated title
 * does not end mid-word, and falls back to the hard cut when the boundary would
 * throw away more than half of what we were allowed.
 */
const titleOf = (text: string | null | undefined): string => {
  const oneLine = (text ?? "").replace(/\s+/g, " ").trim()
  if (oneLine.length <= TITLE_LIMIT) return oneLine
  const cut = oneLine.slice(0, TITLE_LIMIT)
  const boundary = cut.lastIndexOf(" ")
  const kept = boundary > TITLE_LIMIT / 2 ? cut.slice(0, boundary) : cut
  return `${kept.trimEnd()}…`
}

/**
 * When the conversation started, in epoch milliseconds.
 *
 * `indexedAt` is preferred over the record's `createdAt` even though
 * `createdAt` is the more obvious field, because `createdAt` is written by the
 * posting client and is therefore whatever that client said — routinely skewed,
 * occasionally in the future, and backdated wholesale by import tools. A
 * postedAt in the future sorts above everything and reads as newer than any
 * Last Look. `indexedAt` is the AppView's own stamp on ingest and cannot be
 * authored. `createdAt` is the fallback for an answer that omits it, and a
 * post with neither says it does not know rather than claiming 1970.
 */
const postedAtOf = (post: Post): number | null => {
  for (const stamp of [post.indexedAt, post.record?.createdAt]) {
    if (typeof stamp !== "string") continue
    const at = Date.parse(stamp)
    if (Number.isFinite(at)) return at
  }
  return null
}

/**
 * The row a panel draws.
 *
 * `author` is the handle rather than the display name: the handle is what the
 * permalink is built from and what a reader can go and check, and a display
 * name is neither unique nor stable. The did is the last resort — ugly, but a
 * row attributed to nobody reads as a rendering bug.
 *
 * `venue` is null. Bluesky has no place a reader names — no subreddit, no
 * board — so there is nothing to disambiguate two rows with.
 */
const rowOf = (found: Found): Discussion =>
  Discussion.make({
    id: found.id,
    title: titleOf(found.post.record?.text),
    submittedUrl: found.submitted,
    postedAt: postedAtOf(found.post),
    author: found.post.author.handle ?? found.post.author.displayName ?? found.post.author.did,
    venue: null
  })

const scoreOf = (post: Post): number | null => post.likeCount ?? null
const commentsOf = (post: Post): number | null => post.replyCount ?? null

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

export class Bluesky extends Context.Service<Bluesky, DiscussionSourceShape>()(
  "parle/source/Bluesky"
) {
  static readonly layer = Layer.effect(
    Bluesky,
    Effect.gen(function*() {
      const client = (yield* HttpClient.HttpClient).pipe(
        // Transient responses only — 408, 429 and 5xx. 403 is deliberately
        // outside Effect's transient set and must stay there: from a datacenter
        // IP it is the ORDINARY answer, and retrying it spends the reader's own
        // budget to learn the same thing three times.
        HttpClient.retryTransient({
          schedule: Schedule.exponential(200).pipe(Schedule.jittered),
          times: 2
        })
      )

      const search = Effect.fn("Bluesky.search")(function*(
        subject: SubjectUrl
      ): Effect.fn.Return<Window, Unanswered> {
        const response = yield* client.get(ENDPOINT, {
          urlParams: {
            q: MATCH_ANYTHING,
            url: subject as string,
            sort: SORT,
            limit: String(SEARCH_WINDOW)
          }
        })
        const answer = yield* readAnswer(response)
        return {
          posts: answer.posts,
          windowed: answer.posts.length >= SEARCH_WINDOW
        }
      })

      /**
       * Hand over what the answer described, before the Consultation is emitted.
       *
       * The ordering is what a caller relies on: the terminal Consultation is
       * the signal that a Place has answered, so a row deposited after it would
       * arrive at a panel that has already decided what to draw.
       */
      const record = Effect.fn("Bluesky.record")(function*(found: ReadonlyArray<Found>) {
        const observations: Array<Observation> = []
        for (const one of found) {
          observations.push(
            yield* observeNow(one.id, { score: scoreOf(one.post), comments: commentsOf(one.post) })
          )
        }
        yield* (yield* DiscussionSink).note(found.map(rowOf))
        yield* (yield* ObservationSink).observe(observations)
      })

      const linkedAnswer = Effect.fn("Bluesky.linkedAnswer")(function*(
        place: Place,
        subject: SubjectUrl,
        aliases: ReadonlyArray<Alias>
      ): Effect.fn.Return<Consultation, Unanswered> {
        const candidates = candidateAddresses(subject, aliases)
        const window = yield* search(subject)

        const kept = new Map<string, Found>()
        for (const post of window.posts) {
          const identity = identityOf(post.uri)
          if (identity === null) continue
          const id = discussionOf(identity.did, identity.rkey)
          if (kept.has(id.nativeId as string)) continue

          // The server's own matching is documented as possibly fuzzy, so a
          // post that came back is evidence of nothing until one of the
          // addresses IN it names one of the Subject's Aliases.
          let matched: { readonly viaAlias: string; readonly submitted: string } | null = null
          for (const address of addressesOf(post)) {
            const viaAlias = matchingAddress(address, candidates)
            if (viaAlias === undefined) continue
            matched = { viaAlias, submitted: address }
            break
          }
          if (matched === null) continue

          kept.set(id.nativeId as string, {
            post,
            id,
            viaAlias: matched.viaAlias,
            submitted: matched.submitted
          })
        }

        const found = [...kept.values()]
        yield* record(found)

        return answeredWith(
          place,
          found.map((one) =>
            Mention.cases.Linked.make({
              subject,
              discussion: one.id,
              viaAlias: one.viaAlias
            })
          ),
          window.windowed
        )
      })

      const place = placeOf("bluesky")

      return Bluesky.of({
        network: "bluesky",
        places: placesOf("bluesky"),
        linked: (subject, aliases) => asking(place, linkedAnswer(place, subject, aliases))
      })
    })
  )
}

/** The connector's own stream type, for callers that want it named. */
export type BlueskyLookup = Stream.Stream<Consultation, never, never>
