/**
 * Reading what a Discussion actually says — the one thing a Lookup never does.
 *
 * `@parle/digest`'s `Comments` seam exists because nothing in the repo read
 * comment bodies: the connectors read what a Mention and an Observation need
 * and stop there, deliberately, because that is all Coverage requires. A Brief
 * needs more, and this is where the extension pays for it.
 *
 * **It is more traffic than a Lookup, and it is gated on the reader asking.**
 * A Lookup is one search request per Network per Question. Reading is a
 * request per Discussion, and a Hacker News Discussion costs a second one, to
 * the thread's own page, because that page is the only place its order lives
 * (see {@link hnRankOf}). Both carry the thread's id and never the address
 * being read. Nothing in this file may run on navigation, and it has exactly
 * two callers, each behind the reader's own click: `Enquiry.readDiscussion`,
 * when a Discussion is opened in the panel (its comments are what the panel
 * shows), and `Enquiry.summarise`, which reads up to
 * `defaultLimits.discussions` of them for a Digest — and says how many, and
 * where their text would go, before its button does anything.
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

/** The thread's own page — the only place Hacker News publishes its order. */
const HN_PAGE = "https://news.ycombinator.com/item"

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

/**
 * Where each comment sits on the thread's own page, by id.
 *
 * Algolia's item endpoint returns every `children` array oldest-first, and
 * Hacker News does not show its threads oldest-first — it ranks them, the rank
 * moves with votes, and nothing machine-readable carries it. Firebase's `kids`
 * array is close but was measured disagreeing with the live page on the same
 * thread at the same moment, and the page is by definition what a reader who
 * clicks through will see. So the page is asked, once per Discussion, and its
 * comment rows are the ranking.
 *
 * Not a parser, a scan: comment rows have carried `class="athing comtr"` with
 * their item id for many years, in both single- and double-quoted spellings,
 * and both are accepted. So are rows carrying MORE classes — a collapsed
 * thread's row is `athing comtr coll` and its hidden children are
 * `athing comtr noshow`, and on a measured live thread those were 4 of 131
 * rows. A row a reader collapsed is still a comment at a position; dropping
 * the suffixed spellings sent exactly those four to the back in oldest-first
 * order, which is the bug this scan exists to fix. A page that stops matching
 * yields an empty map, and an empty map means Algolia's own order is kept —
 * the fix degrades to the bug, never to a broken Discussion.
 */
const hnRankOf = (html: string): ReadonlyMap<string, number> => {
  const rank = new Map<string, number>()
  for (const row of html.matchAll(/class=["']athing comtr(?:\s[^"']*)?["'] id=["'](\d+)["']/g)) {
    const id = row[1]
    if (id !== undefined && !rank.has(id)) rank.set(id, rank.size)
  }
  return rank
}

/** Ranks below every comment the page did show. `sort` is stable, so the wire order breaks ties. */
const UNRANKED = Number.MAX_SAFE_INTEGER

/**
 * The whole Discussion, read off the thread's own page — the fallback for when
 * Algolia cannot say.
 *
 * Measured 2026-08-24 on item 49413320 ("Everything I own, owned", 327
 * comments, on the front page at the time): Algolia's item endpoint answered
 * 404 and its search index had no story for the address, while
 * `news.ycombinator.com/item` served every comment. A fresh thread is indexed
 * late, and a fresh thread is exactly the one a reader is most likely to be
 * standing on — so "Could not read this one." was shown for precisely the
 * Discussions that were busiest. The page is already this file's authority on
 * order ({@link hnRankOf}); when Algolia has no tree at all, it can be the
 * authority on the comments too, at the cost it already costs: one request,
 * carrying the thread's id and never the address being read.
 *
 * The same scan-not-parse contract as {@link hnRankOf}, held to the same
 * markup: rows are `athing comtr` with the item id, depth is `td.ind`'s
 * `indent` attribute, the author is the `hnuser` link, the body is the
 * `commtext` block — single- and double-quoted spellings both accepted. A row
 * missing any of those (a deleted or flagged comment) is skipped, exactly as
 * the Algolia path skips a node with no text. Reply edges are rebuilt from the
 * indent stack, so the tree the panel folds is the tree the page shows. The
 * {@link MOST_COMMENTS} cap here drops the page's tail — its deepest and
 * latest rows — rather than breadth-first depth, because the page is walked in
 * its own display order.
 *
 * A page that stops matching yields nothing, and nothing means the Discussion
 * stays Unreadable — this fallback can only ever add comments the primary
 * path lost, never lose ones it had.
 */
const hnThreadPageOf = (html: string): Option.Option<Contents> => {
  const rows = html.split(/(?=<tr class=["']athing comtr(?:\s[^"']*)?["'])/)
  const taken: Array<Comment> = []
  /** The last comment seen at each indent, so a row knows its parent. */
  const stack: Array<string> = []
  // The first chunk is everything before the first comment row — or the first
  // row itself when nothing precedes it. The anchored id match below is the
  // filter, so nothing is sliced off by position.
  for (const row of rows) {
    if (taken.length >= MOST_COMMENTS) break
    const id = row.match(/^<tr class=["']athing comtr(?:\s[^"']*)?["'] id=["'](\d+)["']/)?.[1]
    const indent = row.match(/class=["']ind["'] indent=["'](\d+)["']/)?.[1]
    const author = row.match(/<a[^>]*class=["']hnuser["'][^>]*>([^<]+)</)?.[1]
    const body = row.match(/<(?:div|span) class=["']commtext[^"']*["']>([\s\S]*?)<\/(?:div|span)>/)?.[1]
    if (id === undefined || indent === undefined || body === undefined) continue
    const text = asPlainText(body).slice(0, MOST_CHARACTERS)
    if (text === "") continue
    const depth = Number(indent)
    stack.length = depth
    const parentId = depth === 0 ? null : stack[depth - 1] ?? null
    stack[depth] = id
    taken.push({
      id,
      parentId,
      depth,
      author: author === undefined ? null : asPlainText(author),
      // The page shows scores only to the comment's own author. Absent is
      // honest: `null` is "the Network did not say", never zero.
      score: null,
      text
    })
  }
  if (taken.length === 0) return Option.none()
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""
  const score = html.match(/class=["']score["'][^>]*>(\d+)\s+point/)?.[1]
  return Option.some<Contents>({
    title: asPlainText(title).replace(/\s*\|\s*Hacker News$/, ""),
    score: score === undefined ? null : Number(score),
    // What the Network says it holds. The page states no total, and counting
    // the rows we happened to keep would report our own cap as the size of
    // the thread.
    commentCount: null,
    comments: taken
  })
}

/**
 * Keep a comment tree in the page's own order, retaining its reply edges.
 *
 * Breadth-first, so the {@link MOST_COMMENTS} cap drops the deepest replies
 * rather than the top of the conversation. Every sibling group is sorted by
 * {@link hnRankOf}'s page order on the way in; comments the page did not show
 * (a very deep thread's later pages) trail their ranked siblings in wire order.
 */
const commentsUnder = (
  root: HnNodeShape,
  rank: ReadonlyMap<string, number>
): ReadonlyArray<Comment> => {
  const inPageOrder = (nodes: ReadonlyArray<HnNodeShape>): ReadonlyArray<HnNodeShape> =>
    rank.size === 0 ? nodes : [...nodes].sort((a, b) =>
      (rank.get(String(a.id)) ?? UNRANKED) - (rank.get(String(b.id)) ?? UNRANKED))
  const taken: Array<Comment> = []
  const queue: Array<{
    readonly node: HnNodeShape
    readonly parentId: string | null
    readonly depth: number
  }> = inPageOrder(root.children ?? []).map((node) => ({ node, parentId: null, depth: 0 }))
  while (queue.length > 0 && taken.length < MOST_COMMENTS) {
    const entry = queue.shift()
    if (entry === undefined) continue
    const { node, parentId, depth } = entry
    const ownId = node.id === undefined || node.id === null ? null : String(node.id)
    for (const child of inPageOrder(node.children ?? [])) {
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

    /**
     * The thread's live order, or an empty map when the page will not say.
     *
     * Total on its own, because it is an *ordering* and must never cost the
     * reader the comments themselves: a refusal, a timeout or a redesign all
     * degrade to Algolia's oldest-first, which is what shipped before this
     * existed. Asked with the thread's id only — never the address being read.
     */
    const hackerNewsOrder = Effect.fn("Comments.hackerNewsOrder")(function*(id: string) {
      const response = yield* client.get(HN_PAGE, { urlParams: { id } })
      if (response.status < 200 || response.status >= 300) {
        return new Map<string, number>() as ReadonlyMap<string, number>
      }
      const body = yield* response.text
      return hnRankOf(body)
    })

    /**
     * The thread's own page as the whole answer — see {@link hnThreadPageOf}.
     *
     * Runs only when Algolia could not carry the Discussion, so the common
     * path's request count is unchanged: this is the same single page request
     * the ranked path would have spent, spent on the comments themselves.
     */
    const hackerNewsFromPage = Effect.fn("Comments.hackerNewsFromPage")(function*(id: string) {
      const response = yield* client.get(HN_PAGE, { urlParams: { id } })
      if (response.status < 200 || response.status >= 300) return Option.none<Contents>()
      const body = yield* response.text
      return hnThreadPageOf(body)
    })

    /**
     * "Algolia refused or garbled" and "Algolia answered: nothing" are
     * different facts and the fallback keys on the difference. The first —
     * measured as a 404 on a front-page thread the index had not reached —
     * means the page may still carry the whole Discussion. The second is
     * authoritative, and acting on it anyway would spend the page request the
     * "never costs the page request" test holds this file to.
     */
    const UNANSWERED = Symbol.for("parle/Comments/unanswered")

    const hackerNewsFromAlgolia = Effect.fn("Comments.hackerNews")(function*(id: string) {
      const response = yield* client.get(`${HN_ITEM}/${encodeURIComponent(id)}`)
      if (response.status < 200 || response.status >= 300) return UNANSWERED
      const body = yield* response.text
      const parsed = readHnItem(JSON.parse(body) as unknown)
      if (Option.isNone(parsed)) return UNANSWERED
      const item = parsed.value
      // Only once the tree is worth ordering — a thread that did not parse or
      // has nothing under it never costs the page request.
      const rank = (item.children ?? []).length === 0
        ? new Map<string, number>()
        : yield* hackerNewsOrder(id).pipe(
          Effect.catchCause(() => Effect.succeed(new Map<string, number>()))
        )
      const comments = commentsUnder(item, rank)
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

    /**
     * Algolia first — it carries scores and a clean tree — and the thread's
     * own page only when Algolia could not answer at all. Each leg fails
     * alone: a fallback that could only run behind an unbroken primary would
     * never have caught the 404 it exists for, so a refusal, a timeout and an
     * undecodable body on the first leg all mean "ask the page", never "give
     * up".
     */
    const hackerNews = (id: string): Effect.Effect<Option.Option<Contents>> =>
      hackerNewsFromAlgolia(id).pipe(
        Effect.catchCause(() => Effect.succeed(UNANSWERED)),
        Effect.flatMap((found) =>
          found === UNANSWERED
            ? hackerNewsFromPage(id).pipe(
              Effect.catchCause(() => Effect.succeed(Option.none<Contents>()))
            )
            : Effect.succeed(found)
        )
      )

    const reddit = Effect.fn("Comments.reddit")(function*(id: string) {
      const response = yield* client.get(
        `${REDDIT_COMMENTS}/${encodeURIComponent(id)}.json`,
        // No `sort`, deliberately. Unsorted, Reddit answers in the post's own
        // default — its suggested sort where the subreddit set one, "best"
        // otherwise — which is exactly the order the thread shows a reader who
        // clicks through. `sort=top` was measurably a different conversation.
        //
        // With `credentials: "include"` (below), a signed-in reader who set a
        // preferred sort gets THAT order — the same order reddit.com itself
        // would show them. That is the intended meaning of "native order":
        // parity with what this reader sees on a click-through, not with what
        // a logged-out stranger would see.
        { urlParams: { raw_json: "1", limit: "200" } }
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

/** Exported for the tests that hold the page-order scan to account. */
export const pageRankOf = hnRankOf

/** Exported for the tests that hold the whole-page fallback to account. */
export const threadPageOf = hnThreadPageOf
