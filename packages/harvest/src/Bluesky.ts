/**
 * Reading a Bluesky feed the reader is already on.
 *
 * The same problem as {@link ./X.ts} and solved the same way. `bsky.app` is a
 * client-rendered application: there is no server-rendered document to fetch
 * and check this parser against, so it is written against the app's
 * `data-testid` conventions — `feedItem-by-<handle>` on a feed,
 * `postThreadItem-by-<handle>` on a thread — with the defensive posture that
 * implies. A test hook is not a contract. It will change, and when it does the
 * page arrives carrying none of it and is reported `Illegible` rather than
 * harvested to nothing, because a Network reskin that manifests as a slowly
 * emptying Local Discussion Cache is the silent false negative ADR 0005 refuses.
 *
 * Unlike X, Bluesky does **not** rewrite outbound addresses: a link in a post's
 * text and the href on an external embed card are both the destination itself.
 * So nothing here depends on {@link ./LinkResolver.ts} the way `X.ts` does,
 * though the resolver still runs and still earns its keep on shorteners a poster
 * typed themselves.
 *
 * ## The identity decision, which the integration wave inherits
 *
 * `@parle/domain`'s `permalinkOf` documents a Bluesky `NativeId` as
 * `"<did>/<rkey>"` and rebuilds `bsky.app/profile/<did>/post/<rkey>` from it.
 * A DOM reader frequently cannot honour that. The permalink anchor the app
 * renders is `/profile/<handle>/post/<rkey>` — the *handle*, not the did —
 * whenever the reader reached the post by handle, which is the normal case; the
 * did appears nowhere in the rendered markup for those posts.
 *
 * Three options, and only one of them is honest:
 *
 *   1. Resolve the handle to a did. A DOM reader cannot: that is an XRPC call to
 *      a Network, which is a Lookup, which harvesting is defined not to make.
 *   2. Report the block unreadable. This throws away a real Mention on the
 *      Network whose Lookups ADR 0001 gates hardest — the one case where a
 *      harvest is the *only* way coverage is ever obtained.
 *   3. Store the handle in the did slot.
 *
 * **Option 3 is taken.** `bsky.app/profile/<handle>/post/<rkey>` is a valid
 * permalink and resolves identically to the did form, so every consumer of
 * `permalinkOf` keeps working unchanged. The cost is named rather than hidden:
 * a handle is *mutable*, so the same post harvested before and after its author
 * renames yields two Discussion identities, which the panel would show as two
 * rows. That is a duplicate, which is visible and complainable; option 2 is a
 * silent absence, which is not.
 *
 * **The NativeId contract for `bluesky` is therefore `"<did-or-handle>/<rkey>"`,
 * and `packages/domain/src/Network.ts`'s comment should be updated to say so by
 * whoever integrates this.** It is not edited here because this change owns the
 * harvest package and the domain is shared.
 */
import type { Network } from "@parle/domain/Network"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { absolute, anchorsIn, attribute, blocksAt, instantOf, leadingCount, textOfFirstWith } from "./Markup.ts"
import { isOutbound } from "./Outbound.ts"
import { Discussion, type Legibility, type NetworkPage, type Numbers, type PageReading, type Sighting } from "./Page.ts"

const network: Network = "bluesky"

const FEED_ITEM = "data-testid=\"feedItem-by-"
const THREAD_ITEM = "data-testid=\"postThreadItem-by-"

/** `/profile/<handle-or-did>/post/<rkey>` — the anchor carrying identity. */
const PERMALINK = /^\/profile\/([^/?#]+)\/post\/([^/?#]+)/

const identify = (id: string): DiscussionId => DiscussionId.make({ network, nativeId: NativeId.make(id) })

/**
 * The count beside a reply or like control.
 *
 * Read from the app's own count element where it has one, and from the control's
 * `aria-label` — `Like (1234 likes)` — where it does not, because the two have
 * traded places across releases and a number read from neither is a number that
 * renders as absent on a post that plainly has one. Absent, never zero: a zero
 * we invented shows up later as a score that fell.
 */
const countOf = (block: string, testid: string, label: RegExp): number | null => {
  const direct = textOfFirstWith(block, "span", "data-testid", testid) ??
    textOfFirstWith(block, "div", "data-testid", testid)
  if (direct !== null) {
    const counted = leadingCount(direct)
    if (counted !== null) return counted
  }
  const found = label.exec(block)
  return found === null ? null : leadingCount(found[1] ?? "")
}

const LIKE_LABEL = /aria-label="Like[^"]*\(([^)"]*)\)"/i
const REPLY_LABEL = /aria-label="Repl[^"]*\(([^)"]*)\)"/i

/** One post in the feed: who wrote it, and the addresses it carries. */
interface Post {
  readonly discussion: Discussion
  readonly numbers: Numbers
  readonly links: ReadonlyArray<string>
  /** The record key on its own, used to tell a thread's root from a reply. */
  readonly rkey: string
}

const readPost = (block: string, base: string): Post | null => {
  const anchors = anchorsIn(block)

  let authority: string | null = null
  let rkey: string | null = null
  for (const anchor of anchors) {
    if (anchor.href === null) continue
    const found = PERMALINK.exec(anchor.href)
    if (found === null) continue
    authority = found[1] ?? null
    rkey = found[2] ?? null
    break
  }
  if (authority === null || rkey === null) return null

  const links: Array<string> = []
  for (const anchor of anchors) {
    if (anchor.href === null) continue
    const href = absolute(anchor.href, base)
    if (href === null || !isOutbound(network, href)) continue
    // A post with an external embed carries the same address twice — once in
    // the text and once on the card. One post, one Mention.
    if (!links.includes(href)) links.push(href)
  }

  return {
    discussion: Discussion.make({
      id: identify(`${authority}/${rkey}`),
      // The post's own text is the nearest thing Bluesky has to a title, and is
      // what a panel row would show.
      title: textOfFirstWith(block, "div", "data-testid", "postText") ?? "",
      submittedUrl: links[0] ?? null,
      postedAt: instantOf(attribute(block, "datetime")),
      author: authority,
      venue: null
    }),
    numbers: {
      // Likes stand in for a score. Bluesky publishes no single number and a
      // reader reads likes as one, which is the honest mapping available.
      score: countOf(block, "likeCount", LIKE_LABEL),
      comments: countOf(block, "replyCount", REPLY_LABEL)
    },
    links,
    rkey
  }
}

const legibility = (anchors: number, read: number, expected: string): Legibility =>
  anchors === 0 ? { _tag: "Illegible", expected } : { _tag: "Legible", anchors, read }

const FEED_EXPECTED = `an element carrying ${FEED_ITEM}…" or ${THREAD_ITEM}…"`

/**
 * Every post on a feed, with the addresses it linked.
 *
 * `tier` is `Linked` throughout: a feed is a column of people's own posts, and
 * a post carrying a link is the closest structural equivalent Bluesky has to a
 * submitted URL — it is the thing the author chose to post. The distinction
 * between a post and a reply to it can only be made on a thread page, which is
 * where {@link readThread} makes it.
 */
export const readFeed = (page: NetworkPage): PageReading => {
  const blocks = blocksAt(page.markup, FEED_ITEM)
  const sightings: Array<Sighting> = []
  let read = 0
  for (const block of blocks) {
    const post = readPost(block, page.url)
    if (post === null || post.links.length === 0) continue
    read += 1
    for (const link of post.links) {
      sightings.push({
        link,
        discussion: post.discussion,
        numbers: post.numbers,
        tier: "Linked",
        inComment: undefined
      })
    }
  }
  return { network, sightings, legibility: legibility(blocks.length, read, FEED_EXPECTED) }
}

/** The record key a thread page is about, taken from its own address. */
const subjectOf = (url: string): string | null => {
  try {
    return PERMALINK.exec(new URL(url).pathname)?.[2] ?? null
  } catch {
    return null
  }
}

/**
 * One post and its replies.
 *
 * The post named in the address bar keeps the `Linked` tier; everything below it
 * is a reply, and its addresses are **Passing Mentions** of the same
 * conversation, carrying the reply's own id in `inComment`. Replies are
 * deliberately not Discussions of their own, for the reason X's are not: a reply
 * is a place inside a conversation, and minting one Discussion per reply turns a
 * single thread into forty Mentions the panel would have to fold back together.
 */
export const readThread = (page: NetworkPage): PageReading => {
  const blocks = blocksAt(page.markup, THREAD_ITEM)
  const root = subjectOf(page.url)
  const sightings: Array<Sighting> = []
  let read = 0
  let conversation: Post | null = null

  for (const block of blocks) {
    const post = readPost(block, page.url)
    if (post === null) continue
    const isRoot = conversation === null && (root === null || post.rkey === root)
    if (isRoot) conversation = post
    if (post.links.length === 0) continue
    read += 1
    const held = conversation
    for (const link of post.links) {
      sightings.push(
        isRoot || held === null
          ? { link, discussion: post.discussion, numbers: post.numbers, tier: "Linked", inComment: undefined }
          : {
            link,
            discussion: held.discussion,
            numbers: held.numbers,
            tier: "Passing",
            inComment: post.rkey
          }
      )
    }
  }

  return { network, sightings, legibility: legibility(blocks.length, read, FEED_EXPECTED) }
}

/** True for the address of one thread rather than a feed. */
export const isThread = (url: string): boolean => /\/profile\/[^/]+\/post\/[^/?#]+/.test(url)

export const read = (page: NetworkPage): PageReading => isThread(page.url) ? readThread(page) : readFeed(page)
