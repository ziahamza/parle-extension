/**
 * Reading an X timeline the reader is already on.
 *
 * This is the one ADR 0012 says "partly reverses the accepted blind spot in
 * ADR 0001": links harvested from the reader's own timeline give X coverage
 * **with no search request at all**, which matters because ADR 0014 forbids
 * Network OAuth and ADR 0001 gates X Lookups behind a Linked Mention found
 * elsewhere. A post seen on the reader's own screen needs no such permission —
 * they were already looking at it.
 *
 * **Every outbound link here is a `t.co`.** X rewrites all of them, including
 * the one on a link card and the one inside a quoted post, and the visible text
 * of the anchor is a truncated display string that is not an address at all.
 * So the harvested link is the `t.co` URL, and the entire value of this file
 * depends on {@link ../LinkResolver.ts} turning it into a destination before it
 * is stored. A Mention keyed on `t.co/x7Kd2Ab` is a Mention no reader will ever
 * land on.
 *
 * A post's own link is treated as a **Linked Mention**. X has no "submitted
 * URL" field, but a post carrying a link is the closest structural equivalent
 * — it is the thing the author chose to post — and the reader arriving from
 * that post is precisely ADR 0012's marquee case. Links found in the reply
 * column below a post are attributed to the post as **Passing Mentions**, on
 * the same reasoning as a Hacker News comment.
 *
 * The anchor is `data-testid="tweet"`, which is a test hook rather than a
 * contract and will break. That is expected and is why breaking is reported:
 * a timeline with no such attribute is `Illegible`, not empty.
 */
import type { Network } from "@parle/domain/Network"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { absolute, anchorsIn, attribute, blocksAt, instantOf, leadingCount, textOfFirst, textOfFirstWith } from "./Markup.ts"
import { isOutbound } from "./Outbound.ts"
import { Discussion, type Legibility, type NetworkPage, type Numbers, type PageReading, type Sighting } from "./Page.ts"

const network: Network = "x"

const ANCHOR = "data-testid=\"tweet\""

const STATUS = /^\/([^/]+)\/status\/(\d+)/

const identify = (id: string): DiscussionId => DiscussionId.make({ network, nativeId: NativeId.make(id) })

/**
 * The count beside a reply or like control.
 *
 * X renders these inside `data-testid="app-text-transition-container"` and
 * abbreviates them — `1.2K`, `3M` — which {@link leadingCount} expands. An
 * expanded abbreviation is not the true number and never will be; it is
 * recorded because a Movement from 1,200 to 3,400 is worth showing and a
 * missing number is not.
 */
const countNear = (block: string, testid: string): number | null => {
  const [control] = blocksAt(block, `data-testid="${testid}"`)
  if (control === undefined) return null
  const text = textOfFirst(control, "span", "") ?? ""
  return leadingCount(text)
}

/** One post on the timeline: who wrote it, when, and how it is doing. */
interface Post {
  readonly discussion: Discussion
  readonly numbers: Numbers
  readonly links: ReadonlyArray<string>
}

const readPost = (block: string, base: string): Post | null => {
  const anchors = anchorsIn(block)

  let nativeId: string | null = null
  let author: string | null = null
  for (const anchor of anchors) {
    if (anchor.href === null) continue
    const found = STATUS.exec(anchor.href)
    if (found === null) continue
    author = found[1] ?? null
    nativeId = found[2] ?? null
    break
  }
  if (nativeId === null) return null

  const links: Array<string> = []
  for (const anchor of anchors) {
    if (anchor.href === null) continue
    const href = absolute(anchor.href, base)
    if (href === null || !isOutbound(network, href)) continue
    // The same `t.co` appears twice on a post that has a link card: once in
    // the text and once on the card. One post, one Mention.
    if (!links.includes(href)) links.push(href)
  }

  return {
    discussion: Discussion.make({
      id: identify(nativeId),
      // The post's own text is the nearest thing X has to a title. It is what a
      // panel row would show, and nothing else in the markup is a title at all.
      title: textOfFirstWith(block, "div", "data-testid", "tweetText") ?? "",
      submittedUrl: links[0] ?? null,
      postedAt: instantOf(attribute(block, "datetime")),
      author
    }),
    numbers: {
      // Likes stand in for a score. X publishes no single number and the reader
      // reads likes as one, which is the honest mapping available.
      score: countNear(block, "like"),
      comments: countNear(block, "reply")
    },
    links
  }
}

const legibility = (anchors: number, read: number): Legibility =>
  anchors === 0
    ? { _tag: "Illegible", expected: `an article carrying ${ANCHOR}` }
    : { _tag: "Legible", anchors, read }

/**
 * Every post on a timeline, with the `t.co` links it carries.
 *
 * `tier` is `Linked` throughout: this reads a timeline, where every article is
 * somebody's own post. A conversation page — one post plus its replies —
 * arrives through {@link readConversation}, which is where the distinction
 * between a post and a reply to it can actually be made.
 */
export const readTimeline = (page: NetworkPage): PageReading => {
  const blocks = blocksAt(page.markup, ANCHOR)
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
  return { network, sightings, legibility: legibility(blocks.length, read) }
}

/** The post id a conversation page is about, taken from its own address. */
const subjectPostOf = (url: string): string | null => {
  try {
    return STATUS.exec(new URL(url).pathname)?.[2] ?? null
  } catch {
    return null
  }
}

/**
 * One post and its replies.
 *
 * The post named in the address bar keeps the `Linked` tier; everything below
 * it is a reply, and its links are **Passing Mentions** of the same
 * conversation, recorded with the reply's own id in `inComment`. Replies are
 * deliberately not treated as Discussions of their own: a reply is a place
 * inside a conversation, and minting one Discussion per reply would turn a
 * single thread into forty Mentions the panel would have to fold back together.
 */
export const readConversation = (page: NetworkPage): PageReading => {
  const blocks = blocksAt(page.markup, ANCHOR)
  const root = subjectPostOf(page.url)
  const sightings: Array<Sighting> = []
  let read = 0
  let conversation: Post | null = null

  for (const block of blocks) {
    const post = readPost(block, page.url)
    if (post === null) continue
    const isRoot = conversation === null && (root === null || post.discussion.id.nativeId === root)
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
            inComment: post.discussion.id.nativeId
          }
      )
    }
  }

  return { network, sightings, legibility: legibility(blocks.length, read) }
}

/** True for the address of one conversation rather than a timeline. */
export const isConversation = (url: string): boolean => /\/status\/\d+/.test(url)

export const read = (page: NetworkPage): PageReading =>
  isConversation(page.url) ? readConversation(page) : readTimeline(page)
