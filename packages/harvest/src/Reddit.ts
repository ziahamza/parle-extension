/**
 * Reading Reddit pages the reader is already on.
 *
 * Reddit is two sites. `reddit.com` renders web components — `<shreddit-post>`,
 * `<shreddit-comment>` — that carry everything worth having as attributes on
 * the element itself, and `old.reddit.com`, which a large fraction of the
 * readers this extension is for still use exclusively, renders `data-`
 * attributes on `div.thing`. Both are supported because supporting one would
 * make harvesting silently depend on a preference the reader set years ago, and
 * the failure would look exactly like "nobody discusses the pages I read".
 *
 * The two dialects are read by separate functions rather than one union of
 * selectors, so that a change to one cannot quietly start matching the other's
 * markup — and so that {@link Legibility} can say which one was expected.
 *
 * As on Hacker News, a post's own `content-href` is a **Linked Mention** and an
 * address inside a comment is a **Passing Mention**. Reddit adds a wrinkle
 * Hacker News does not: a self post's `content-href` is its own permalink, so
 * the post links to itself. {@link ./Outbound.ts} drops those, which is why a
 * subreddit of text posts harvests to nothing rather than to a pile of Mentions
 * claiming Reddit threads are about Reddit threads.
 */
import type { Network } from "@parle/domain/Network"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { absolute, anchorsIn, attribute, blocksAt, instantOf, leadingCount } from "./Markup.ts"
import { isOutbound } from "./Outbound.ts"
import { Discussion, type Legibility, type NetworkPage, type Numbers, type PageReading, type Sighting } from "./Page.ts"

const network: Network = "reddit"

const SHREDDIT_POST = "<shreddit-post"
const SHREDDIT_COMMENT = "<shreddit-comment"
const OLD_POST = "data-fullname=\"t3_"
const OLD_COMMENT = "data-fullname=\"t1_"

const identify = (id: string): DiscussionId => DiscussionId.make({ network, nativeId: NativeId.make(id) })

const openingTag = (block: string): string => {
  const close = block.indexOf(">")
  return close === -1 ? block : block.slice(0, close + 1)
}

const numberOr = (raw: string | null): number | null => {
  if (raw === null) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? null : parsed
}

/** The base-36 id inside a permalink, which is where Reddit always puts it. */
const idInPermalink = (permalink: string | null): string | null =>
  permalink === null ? null : /\/comments\/([a-z0-9]+)/i.exec(permalink)?.[1] ?? null

const venueInPermalink = (permalink: string | null): string | null => {
  if (permalink === null) return null
  const named = /\/r\/([^/]+)\/comments\//i.exec(permalink)?.[1]
  return named === undefined || named === "" ? null : named
}

const venueOf = (tag: string, permalink: string | null): string | null => {
  const prefixed = attribute(tag, "subreddit-prefixed-name")
  if (prefixed !== null) {
    const bare = prefixed.replace(/^r\//i, "")
    if (bare !== "") return bare
  }
  const named = attribute(tag, "subreddit-name") ?? attribute(tag, "data-subreddit")
  if (named !== null && named !== "") return named.replace(/^r\//i, "")
  return venueInPermalink(permalink ?? attribute(tag, "permalink") ?? attribute(tag, "data-permalink"))
}

/** One post, however it was rendered. */
interface Post {
  readonly discussion: Discussion
  readonly numbers: Numbers
  /** Its own outbound address, or `null` for a self post. */
  readonly link: string | null
}

const shredditPost = (block: string, base: string): Post | null => {
  const tag = openingTag(block)
  const permalink = attribute(tag, "permalink")
  const id = idInPermalink(permalink) ?? attribute(tag, "id")?.replace(/^t3_/, "") ?? null
  if (id === null || id === "") return null
  const href = attribute(tag, "content-href")
  const outbound = href === null ? null : absolute(href, base)
  const link = outbound !== null && isOutbound(network, outbound) ? outbound : null
  return {
    discussion: Discussion.make({
      id: identify(id),
      title: attribute(tag, "post-title") ?? "",
      submittedUrl: link,
      postedAt: instantOf(attribute(tag, "created-timestamp")),
      author: attribute(tag, "author"),
      venue: venueOf(tag, permalink)
    }),
    numbers: {
      score: numberOr(attribute(tag, "score")),
      comments: numberOr(attribute(tag, "comment-count"))
    },
    link
  }
}

const oldPost = (block: string, base: string): Post | null => {
  const tag = openingTag(block)
  const id = /t3_([a-z0-9]+)/i.exec(attribute(tag, "data-fullname") ?? "")?.[1] ?? null
  if (id === null) return null
  const href = attribute(tag, "data-url")
  const outbound = href === null ? null : absolute(href, base)
  const link = outbound !== null && isOutbound(network, outbound) ? outbound : null
  const title = anchorsIn(block).find((anchor) => anchor.classes.includes("title"))
  const timestamp = numberOr(attribute(tag, "data-timestamp"))
  return {
    discussion: Discussion.make({
      id: identify(id),
      title: title?.text ?? "",
      submittedUrl: link,
      // old.reddit's `data-timestamp` is already milliseconds.
      postedAt: timestamp,
      author: attribute(tag, "data-author"),
      venue: venueOf(tag, attribute(tag, "data-permalink"))
    }),
    numbers: {
      score: numberOr(attribute(tag, "data-score")),
      comments: numberOr(attribute(tag, "data-comments-count"))
    },
    link
  }
}

/** Every post on a page, in whichever dialect it was rendered. */
const postsIn = (markup: string, base: string): { readonly posts: ReadonlyArray<Post>; readonly anchors: number } => {
  const shreddit = blocksAt(markup, SHREDDIT_POST)
  if (shreddit.length > 0) {
    const posts: Array<Post> = []
    for (const block of shreddit) {
      const post = shredditPost(block, base)
      if (post !== null) posts.push(post)
    }
    return { posts, anchors: shreddit.length }
  }
  const old = blocksAt(markup, OLD_POST)
  const posts: Array<Post> = []
  for (const block of old) {
    const post = oldPost(block, base)
    if (post !== null) posts.push(post)
  }
  return { posts, anchors: old.length }
}

const legibility = (anchors: number, read: number, expected: string): Legibility =>
  anchors === 0 ? { _tag: "Illegible", expected } : { _tag: "Legible", anchors, read }

const POST_EXPECTED = `${SHREDDIT_POST}> or a div carrying ${OLD_POST}…"`

/**
 * A subreddit listing, a multireddit, the front page, a search page: every post
 * on it, each a Linked Mention of whatever it submitted.
 */
export const readListing = (page: NetworkPage): PageReading => {
  const { anchors, posts } = postsIn(page.markup, page.url)
  const sightings: Array<Sighting> = []
  for (const post of posts) {
    if (post.link === null) continue
    sightings.push({
      link: post.link,
      discussion: post.discussion,
      numbers: post.numbers,
      tier: "Linked",
      inComment: undefined
    })
  }
  return { network, sightings, legibility: legibility(anchors, sightings.length, POST_EXPECTED) }
}

/** One comment, and the addresses in its body. */
const linksInComment = (
  block: string,
  base: string,
  body: string
): { readonly id: string | null; readonly links: ReadonlyArray<string> } => {
  const tag = openingTag(block)
  const id = /t1_([a-z0-9]+)/i.exec(attribute(tag, "thingid") ?? attribute(tag, "data-fullname") ?? "")?.[1] ?? null
  const links: Array<string> = []
  for (const section of blocksAt(block, body)) {
    for (const anchor of anchorsIn(section)) {
      if (anchor.href === null) continue
      const href = absolute(anchor.href, base)
      if (href === null || !isOutbound(network, href)) continue
      links.push(href)
    }
  }
  return { id, links }
}

/**
 * One Reddit thread: the post, and the addresses its commenters linked.
 *
 * The comment links are **Passing Mentions** attributed to the post's own
 * Discussion — a Discussion is the conversation, and a comment is a place
 * inside it, which is what `inComment` records. A comment page harvested after
 * the listing therefore adds Passing Mentions without ever weakening the Linked
 * one the listing produced.
 */
export const readCommentPage = (page: NetworkPage): PageReading => {
  const { anchors, posts } = postsIn(page.markup, page.url)
  const sightings: Array<Sighting> = []
  const [post] = posts

  if (post !== undefined && post.link !== null) {
    sightings.push({
      link: post.link,
      discussion: post.discussion,
      numbers: post.numbers,
      tier: "Linked",
      inComment: undefined
    })
  }

  if (post !== undefined) {
    const shreddit = blocksAt(page.markup, SHREDDIT_COMMENT)
    const blocks = shreddit.length > 0 ? shreddit : blocksAt(page.markup, OLD_COMMENT)
    // A prefix, not a whole attribute value: shreddit has shipped both
    // `slot="comment"` and `slot="comment-body"` for the same element.
    const body = shreddit.length > 0 ? "slot=\"comment" : "class=\"md\""
    for (const block of blocks) {
      const { id, links } = linksInComment(block, page.url, body)
      for (const link of links) {
        sightings.push({
          link,
          discussion: post.discussion,
          numbers: post.numbers,
          tier: "Passing",
          inComment: id ?? undefined
        })
      }
    }
  }

  return { network, sightings, legibility: legibility(anchors, sightings.length, POST_EXPECTED) }
}

/** True for the address of one thread rather than a list of them. */
export const isCommentPage = (url: string): boolean => /\/comments\/[a-z0-9]+/i.test(url)

export const read = (page: NetworkPage): PageReading =>
  isCommentPage(page.url) ? readCommentPage(page) : readListing(page)
