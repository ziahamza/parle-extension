/**
 * Reading what a Discussion actually says — the one thing a Lookup never does.
 *
 * `@parle/digest`'s `Comments` seam exists because nothing in the repo read
 * comment bodies: the connectors read what a Mention and an Observation need
 * and stop there, deliberately, because that is all Coverage requires. A Brief
 * needs more, and this is where the extension pays for it.
 *
 * **It is more traffic than a Lookup, and it is gated on the reader asking.**
 * A Lookup is one search request per Network per Question. Building a Brief is
 * one request per Discussion — up to `defaultLimits.discussions` of them — and
 * each one returns a whole comment tree. Nothing in this file may run on
 * navigation; `Enquiry.summarise` is its only caller and the reader's own click
 * is its only trigger. The panel says what it is about to do before it does it.
 *
 * **Every method is total, and that is the seam's own contract.** A Discussion
 * whose comments cannot be read contributes nothing to the Brief and costs the
 * reader that one Discussion rather than the Digest. Reddit answering 403 is
 * ADR 0013's ordinary path, not an edge case, so it must not be able to fail a
 * Digest that Hacker News could have carried on its own.
 *
 * X is absent by construction rather than by omission. `__PARLE_X__` is false
 * in this build, no X Mention can exist, and a comment reader for a Network
 * whose Lookups are compiled out would be code that could only ever run if the
 * gate had already been routed around.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { DiscussionId } from "@parle/domain/Network"
import type { Comment, Contents } from "@parle/digest/Brief"
import { Comments } from "@parle/digest/Comments"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpClient from "effect/unstable/http/HttpClient"

/** Algolia's item endpoint: one Hacker News thread, comments and all. */
const HN_ITEM = "https://hn.algolia.com/api/v1/items"

/** Reddit's own JSON for one post's comment tree. */
const REDDIT_COMMENTS = "https://www.reddit.com/comments"

/**
 * How many comments are read out of one Discussion before we stop descending.
 *
 * A 2,000-comment thread is real and its JSON is megabytes. Selection takes
 * twelve of whatever it is given (`@parle/digest`'s `Selection`), so reading
 * the whole tree buys a slightly better twelve at a cost the reader pays in
 * memory on a phone — ADR 0003 makes iOS the constraining platform. The tree is
 * walked breadth-first, so what this cap drops is the deepest replies rather
 * than the top of the conversation.
 */
const MOST_COMMENTS = 400

/** How much of one comment is kept before selection clips it further. */
const MOST_CHARACTERS = 4_000

// ---------------------------------------------------------------------------
// Hacker News
// ---------------------------------------------------------------------------

/**
 * One node of an Algolia item tree.
 *
 * Every field is optional and nullable for the same reason the search hits are:
 * a deleted comment has `text: null` and no author, and a schema that required
 * either would turn one dead comment into an unreadable Discussion.
 *
 * `children` is recursive, so the schema is declared with an explicit
 * annotation — `Schema.suspend` is what allows a schema to name itself.
 */
interface HnNodeShape {
  readonly id?: number | null | undefined
  readonly type?: string | null | undefined
  readonly author?: string | null | undefined
  readonly text?: string | null | undefined
  readonly title?: string | null | undefined
  readonly points?: number | null | undefined
  readonly children?: ReadonlyArray<HnNodeShape> | undefined
}

const HnNode: Schema.Codec<HnNodeShape> = Schema.Struct({
  id: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  author: Schema.optionalKey(Schema.NullOr(Schema.String)),
  text: Schema.optionalKey(Schema.NullOr(Schema.String)),
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  points: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  children: Schema.optionalKey(Schema.Array(Schema.suspend(() => HnNode)))
})

const readHnItem = Schema.decodeUnknownOption(HnNode)

/**
 * Hacker News comment bodies are HTML fragments, and a model must not be shown
 * markup.
 *
 * Not a general HTML parser and must not become one: the fragment shape Hacker
 * News emits is fixed and small — `<p>`, `<a>`, `<i>`, `<code>`, `<pre>` — and
 * everything here ends up as `textContent` on the way to the panel and as plain
 * text on the way to a Provider, so a tag that survives is ugly rather than
 * dangerous. Entities are decoded by hand rather than through the DOM because
 * this runs in a service worker, which has no `document`.
 */
const asPlainText = (html: string): string =>
  html
    .replace(/<\s*\/?\s*(?:p|br|li)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;|&apos;|&#39;/g, "'")
    .replace(/&#x2F;|&#47;/g, "/")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&nbsp;/g, " ")
    // Last, so that an escaped entity in the original text — `&amp;lt;` — comes
    // back as the literal `&lt;` the author wrote rather than as `<`.
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

/** Keep a comment tree in breadth-first wire order, retaining its reply edges. */
const commentsUnder = (root: HnNodeShape): ReadonlyArray<Comment> => {
  const taken: Array<Comment> = []
  const queue: Array<{
    readonly node: HnNodeShape
    readonly parentId: string | null
    readonly depth: number
  }> = (root.children ?? []).map((node) => ({ node, parentId: null, depth: 0 }))
  while (queue.length > 0 && taken.length < MOST_COMMENTS) {
    const entry = queue.shift()
    if (entry === undefined) continue
    const { node, parentId, depth } = entry
    const ownId = node.id === undefined || node.id === null ? null : String(node.id)
    for (const child of node.children ?? []) {
      queue.push({ node: child, parentId: ownId ?? parentId, depth: depth + 1 })
    }
    if (node.id === undefined || node.id === null) continue
    if (node.text === undefined || node.text === null) continue
    const text = asPlainText(node.text).slice(0, MOST_CHARACTERS)
    if (text === "") continue
    taken.push({
      id: String(node.id),
      parentId,
      depth,
      author: node.author ?? null,
      // Algolia's item endpoint reports `points: null` for almost every
      // comment. `null` is "the Network did not say", never zero — Selection
      // ranks a missing score last rather than as the worst comment in the
      // thread.
      score: typeof node.points === "number" ? node.points : null,
      text
    })
  }
  return taken
}

// ---------------------------------------------------------------------------
// Reddit
// ---------------------------------------------------------------------------

/**
 * One node of Reddit's comment listing.
 *
 * `replies` is either a nested Listing or the empty string, which is Reddit's
 * own spelling of "none" and the single most common reason a strict schema
 * fails on a real thread.
 */
interface RedditNodeShape {
  readonly kind?: string | null | undefined
  readonly data?: {
    readonly id?: string | null | undefined
    readonly author?: string | null | undefined
    readonly body?: string | null | undefined
    readonly score?: number | null | undefined
    readonly title?: string | null | undefined
    readonly num_comments?: number | null | undefined
    readonly children?: ReadonlyArray<RedditNodeShape> | undefined
    readonly replies?: RedditNodeShape | string | null | undefined
  } | undefined
}

const RedditNode: Schema.Codec<RedditNodeShape> = Schema.Struct({
  kind: Schema.optionalKey(Schema.NullOr(Schema.String)),
  data: Schema.optionalKey(Schema.Struct({
    id: Schema.optionalKey(Schema.NullOr(Schema.String)),
    author: Schema.optionalKey(Schema.NullOr(Schema.String)),
    body: Schema.optionalKey(Schema.NullOr(Schema.String)),
    score: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    title: Schema.optionalKey(Schema.NullOr(Schema.String)),
    num_comments: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    children: Schema.optionalKey(Schema.Array(Schema.suspend(() => RedditNode))),
    replies: Schema.optionalKey(
      Schema.NullOr(Schema.Union([Schema.suspend(() => RedditNode), Schema.String]))
    )
  }))
})

const readRedditThread = Schema.decodeUnknownOption(Schema.Array(RedditNode))

const repliesOf = (node: RedditNodeShape): ReadonlyArray<RedditNodeShape> => {
  const replies = node.data?.replies
  if (replies === undefined || replies === null || typeof replies === "string") return []
  return replies.data?.children ?? []
}

const redditCommentsUnder = (listing: RedditNodeShape): ReadonlyArray<Comment> => {
  const taken: Array<Comment> = []
  const queue: Array<{
    readonly node: RedditNodeShape
    readonly parentId: string | null
    readonly depth: number
  }> = (listing.data?.children ?? []).map((node) => ({ node, parentId: null, depth: 0 }))
  while (queue.length > 0 && taken.length < MOST_COMMENTS) {
    const entry = queue.shift()
    if (entry === undefined) continue
    const { node, parentId, depth } = entry
    const ownId = typeof node.data?.id === "string" ? node.data.id : null
    for (const reply of repliesOf(node)) {
      queue.push({ node: reply, parentId: ownId ?? parentId, depth: depth + 1 })
    }
    // `more` nodes are Reddit's "load 47 more replies" placeholder. They carry
    // no text and following them is a second request per node.
    if (node.kind !== "t1") continue
    const id = node.data?.id
    const body = node.data?.body
    if (typeof id !== "string" || typeof body !== "string") continue
    const text = body.trim().slice(0, MOST_CHARACTERS)
    if (text === "") continue
    taken.push({
      id,
      parentId,
      depth,
      author: node.data?.author ?? null,
      score: typeof node.data?.score === "number" ? node.data.score : null,
      text
    })
  }
  return taken
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/**
 * Comment bodies, read from the Networks themselves.
 *
 * `Effect.result` around each read is what makes the seam's totality real: a
 * refusal, a timeout, an interstitial served as a 200 and a body that will not
 * decode all become "we could not read this Discussion", which is what the
 * caller is contractually able to handle.
 */
export const layer: Layer.Layer<Comments, never, HttpClient.HttpClient> = Layer.effect(
  Comments,
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient

    const hackerNews = Effect.fn("Comments.hackerNews")(function*(id: string) {
      const response = yield* client.get(`${HN_ITEM}/${encodeURIComponent(id)}`)
      if (response.status < 200 || response.status >= 300) return Option.none<Contents>()
      const body = yield* response.text
      const parsed = readHnItem(JSON.parse(body) as unknown)
      if (Option.isNone(parsed)) return Option.none<Contents>()
      const item = parsed.value
      const comments = commentsUnder(item)
      if (comments.length === 0) return Option.none<Contents>()
      return Option.some<Contents>({
        title: item.title ?? "",
        score: typeof item.points === "number" ? item.points : null,
        // What the Network says it has, not what we took. Algolia's item
        // endpoint does not carry a count, and inventing one from the tree we
        // happened to walk would report our own cap as the size of the thread.
        commentCount: null,
        comments
      })
    })

    const reddit = Effect.fn("Comments.reddit")(function*(id: string) {
      const response = yield* client.get(
        `${REDDIT_COMMENTS}/${encodeURIComponent(id)}.json`,
        { urlParams: { raw_json: "1", limit: "200", sort: "top" } }
      ).pipe(
        // The same credential argument as the Reddit connector's tier one, and
        // for the same measured reason: `www.reddit.com` JSON answers 403
        // without a cookie jar even from a good consumer IP, and an anonymous
        // one is enough. No account is required and none is asked for.
        Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" })
      )
      if (response.status < 200 || response.status >= 300) return Option.none<Contents>()
      const body = yield* response.text
      const parsed = readRedditThread(JSON.parse(body) as unknown)
      if (Option.isNone(parsed)) return Option.none<Contents>()
      const [post, thread] = parsed.value
      if (thread === undefined) return Option.none<Contents>()
      const comments = redditCommentsUnder(thread)
      if (comments.length === 0) return Option.none<Contents>()
      const head = post?.data?.children?.[0]?.data
      return Option.some<Contents>({
        title: head?.title ?? "",
        score: typeof head?.score === "number" ? head.score : null,
        commentCount: typeof head?.num_comments === "number" ? head.num_comments : null,
        comments
      })
    })

    const of = (discussion: DiscussionId): Effect.Effect<Option.Option<Contents>> => {
      const read = discussion.network === "hackernews"
        ? hackerNews(discussion.nativeId)
        : discussion.network === "reddit"
        ? reddit(discussion.nativeId)
        : Effect.succeed(Option.none<Contents>())
      // Total by construction. Anything at all going wrong costs this one
      // Discussion, which is exactly what the seam promises its caller.
      return read.pipe(
        Effect.catchCause(() => Effect.succeed(Option.none<Contents>()))
      )
    }

    return Comments.of({ of })
  })
)

/** Exported for the tests that hold the plain-text rules to account. */
export const plainTextOf = asPlainText
