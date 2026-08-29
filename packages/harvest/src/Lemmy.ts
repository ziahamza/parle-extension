/**
 * Reading Lemmy pages the reader is already on.
 *
 * Lemmy's default web client (`lemmy-ui`) renders on the server, so the markup
 * the content script hands over is the markup this parser was written against —
 * no SPA hydration problem, unlike {@link ./X.ts} and {@link ./Bluesky.ts}. A
 * **listing** — an instance front page, `/c/<community>` — is a column of
 * `div.post-listing` blocks, each a Discussion carrying its own submitted
 * address: **Linked Mentions**. A **post page** — `/post/<n>` — is that same
 * block followed by `article.comment-node` comments, whose addresses are
 * **Passing Mentions** of the post.
 *
 * ## Identity, and the federation wrinkle
 *
 * A Lemmy Discussion's native id is its **ActivityPub id** — the post's URL on
 * the instance that *owns* it. A federated copy has a different local address,
 * and keying on the local one would mint a separate Discussion per instance the
 * reader happens to browse, so the same conversation would appear three times
 * in the panel with three different comment counts.
 *
 * Verified against live markup on 2026-08-24: `lemmy.ml/post/51762294` is a
 * federated copy whose own page carries **both** — a local `/post/51762294`
 * anchor and, beside it, a "fedilink" anchor pointing at
 * `https://lemmy.ca/post/69795063`, which is the ap_id. lemmy-ui renders that
 * fedilink for every post including a local one, where it is simply the post's
 * own absolute URL. So the fedilink's href is preferred for identity and the
 * local `/post/<n>` anchor is the fallback; a block with neither is dropped,
 * because a Mention we cannot identify is one we can neither dedupe, nor
 * observe twice, nor cite.
 *
 * The fedilink is found by the icon inside it rather than by its class, because
 * lemmy-ui's classes are Bootstrap utilities that change with the theme while
 * `#icon-fedilink` is the thing that makes it a fedilink.
 *
 * ## Two things read narrowly on purpose
 *
 * **The post's own link comes only from the two anchors lemmy-ui gives it** —
 * the thumbnail and the italicised domain line. Sweeping the block for outbound
 * anchors would harvest the fedilink itself: it points at another instance,
 * and {@link ./Outbound.ts} only knows the three instances we ask, so
 * `lemmy.ca/post/69795063` reads as outbound and would be stored as a Mention
 * claiming a Lemmy post is the subject of a Lemmy post. That same narrowness of
 * `Outbound` means a *comment* linking to a fourth instance is still harvested;
 * that is `Outbound`'s decision to revise, not this parser's.
 *
 * **Nothing here reads a posting time.** lemmy-ui renders it as
 * `<span class="moment-time" data-tippy-content="Sunday, August 23rd, 2026 at
 * 1:55:21 PM GMT+00:00">1 day ago</span>` — a localised prose string with no
 * machine-readable twin. A `<time datetime=…>` fallback is attempted in case a
 * later lemmy-ui grows one; today it finds nothing, and `postedAt` is `null`
 * rather than a date we guessed at.
 */
import type { Network } from "@parle/domain/Network"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { absolute, anchorsIn, attribute, attributeOfFirst, blocksAt, instantOf, leadingCount, textOfFirst } from "./Markup.ts"
import { isOutbound } from "./Outbound.ts"
import { Discussion, type Legibility, type NetworkPage, type Numbers, type PageReading, type Sighting } from "./Page.ts"

const network: Network = "lemmy"

const POST = "class=\"post-listing"
const COMMENT = "comment-node"

/** The anchor carrying `#icon-fedilink`, whose href is the post's ap_id. */
const FEDILINK = /<a\b[^>]*\bhref="([^"]+)"[^>]*>(?:(?!<\/a>)[\s\S])*?icon-fedilink/i

/** A local permalink, which lemmy-ui renders as a root-relative path. */
const LOCAL_POST = /^\/post\/\d+$/

const identify = (apId: string): DiscussionId => DiscussionId.make({ network, nativeId: NativeId.make(apId) })

const openingTag = (block: string): string => {
  const close = block.indexOf(">")
  return close === -1 ? block : block.slice(0, close + 1)
}

/**
 * The markup above the comment tree.
 *
 * {@link blocksAt} runs a block from one marker to the next, so on a post page
 * — where there is exactly one `post-listing` — the post's block would run to
 * the end of the document and swallow every comment, including each comment's
 * own fedilink. Cutting at the first comment first is cheaper than bounding the
 * block, and on a listing page it changes nothing.
 */
const abovePosts = (markup: string): string => {
  const at = markup.indexOf(COMMENT)
  return at === -1 ? markup : markup.slice(0, at)
}

/** One post, whichever instance is showing it. */
interface Post {
  readonly discussion: Discussion
  readonly numbers: Numbers
  /** Its own outbound address, or `null` for a text post. */
  readonly link: string | null
}

const readPostBlock = (block: string, base: string): Post | null => {
  const anchors = anchorsIn(block)

  const fedilink = FEDILINK.exec(block)?.[1] ?? null
  const local = anchors.find((anchor) => anchor.href !== null && LOCAL_POST.test(anchor.href))?.href ?? null
  const apId = absolute(fedilink ?? local ?? "", base)
  if (apId === null) return null

  // Only the two anchors lemmy-ui gives the post's own URL. See the header.
  let link: string | null = null
  for (const anchor of anchors) {
    if (anchor.href === null) continue
    if (!anchor.classes.includes("thumbnail") && !anchor.classes.includes("fst-italic")) continue
    const href = absolute(anchor.href, base)
    if (href === null || !isOutbound(network, href)) continue
    link = href
    break
  }

  const author = anchors.find((anchor) => anchor.classes.includes("person-listing"))
  const community = anchors.find((anchor) => anchor.classes.includes("community-link"))
  const comments = anchors.find((anchor) => anchor.href !== null && anchor.href.includes("scrollToComments"))

  return {
    discussion: Discussion.make({
      id: identify(apId),
      title: textOfFirst(block, "h1", "text-break") ?? "",
      submittedUrl: link,
      postedAt: instantOf(attributeOfFirst(block, "time", "datetime")),
      author: author?.text ?? null,
      // `/c/privacy` locally, `/c/privacy@lemmy.world` for a remote community.
      // Taken from the href rather than the anchor's text, which is the
      // community's display title and is neither stable nor unique.
      venue: community?.href === undefined || community.href === null
        ? null
        : community.href.replace(/^\/c\//, "") || null
    }),
    numbers: {
      // `<div class="… post-score">91</div>`. lemmy-ui renders each post twice —
      // once for narrow screens, once for wide — and only the wide copy carries
      // it, which is why the whole block is searched rather than one article.
      score: leadingCount(textOfFirst(block, "div", "post-score") ?? ""),
      comments: comments === undefined ? null : leadingCount(comments.text)
    },
    link
  }
}

/** Every post on a page, in document order. */
const postsIn = (markup: string, base: string): { readonly posts: ReadonlyArray<Post>; readonly anchors: number } => {
  // `post-listing` is a prefix of `post-listings`, the container lemmy-ui wraps
  // the whole column in. Left in, that container counts as an anchor, so a page
  // holding nothing but the empty wrapper would read Legible-with-nothing rather
  // than Illegible — the exact confusion `Legibility` exists to prevent.
  const blocks = blocksAt(abovePosts(markup), POST)
    .filter((block) => /\bpost-listing\b/.test(attribute(openingTag(block), "class") ?? ""))
  const posts: Array<Post> = []
  for (const block of blocks) {
    const post = readPostBlock(block, base)
    if (post !== null) posts.push(post)
  }
  return { posts, anchors: blocks.length }
}

const legibility = (anchors: number, read: number): Legibility =>
  anchors === 0
    ? { _tag: "Illegible", expected: `an element with ${POST}…" carrying a fedilink or a /post/<n> anchor` }
    : { _tag: "Legible", anchors, read }

/** An instance front page or a community: each post, a Linked Mention of what it submitted. */
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
  return { network, sightings, legibility: legibility(anchors, sightings.length) }
}

/**
 * One Lemmy post: the submission, and the addresses its commenters linked.
 *
 * Comment links are attributed to the POST's Discussion, with the comment's own
 * id in `inComment` — a Discussion is the conversation, and a comment is a
 * place inside it.
 */
export const readPost = (page: NetworkPage): PageReading => {
  const { anchors, posts } = postsIn(page.markup, page.url)
  const sightings: Array<Sighting> = []
  const [post] = posts

  if (post === undefined) return { network, sightings, legibility: legibility(anchors, 0) }

  if (post.link !== null) {
    sightings.push({
      link: post.link,
      discussion: post.discussion,
      numbers: post.numbers,
      tier: "Linked",
      inComment: undefined
    })
  }

  for (const block of blocksAt(page.markup, COMMENT)) {
    const id = /^comment-(\d+)$/.exec(attribute(openingTag(block), "id") ?? "")?.[1] ?? null
    for (const body of blocksAt(block, "comment-content")) {
      for (const anchor of anchorsIn(body)) {
        if (anchor.href === null) continue
        const href = absolute(anchor.href, page.url)
        if (href === null || !isOutbound(network, href)) continue
        sightings.push({
          link: href,
          discussion: post.discussion,
          numbers: post.numbers,
          tier: "Passing",
          inComment: id ?? undefined
        })
      }
    }
  }

  return { network, sightings, legibility: legibility(anchors, sightings.length) }
}

/** True for the address of one post rather than a list of them. */
export const isPostPage = (url: string): boolean => /\/post\/\d+/.test(url)

export const read = (page: NetworkPage): PageReading => isPostPage(page.url) ? readPost(page) : readListing(page)
