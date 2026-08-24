/**
 * Reading Lobsters pages the reader is already on.
 *
 * The closest Network to Hacker News in this package, and read the same way. A
 * **listing** — `/`, `/newest`, `/t/<tag>`, `/domains/<host>` — is a page of
 * `<li class="story" data-shortid="…">` rows, each one a Discussion whose own
 * submitted address is right there: a page of **Linked Mentions**. A **story
 * page** — `/s/<short_id>/<slug>` — is that same row followed by a comment
 * tree, and every address inside a comment is a **Passing Mention**, because
 * the Discussion is about the submission and not about whatever somebody linked
 * in reply.
 *
 * Everything is anchored on `data-shortid`, which is the one attribute carrying
 * a native id and which Lobsters puts on both a story `<li>` and a comment
 * `<div>`. A page with none of it is not an empty Lobsters page — Lobsters has
 * no empty pages — so it is `Illegible` rather than a harvest that found
 * nothing.
 *
 * **The story link is read from `a.u-url` and from nowhere else.** This is not
 * fussiness. Verified against the live markup on 2026-08-24, a story row also
 * carries a `<details class="caches">` holding `web.archive.org` and
 * `ghostarchive.org` links *about* the submitted URL. Both are outbound by
 * every test in {@link ./Outbound.ts}, so a parser that swept the row for
 * anchors would mint three Mentions per story, two of them claiming an archive
 * search page is what the conversation is about.
 *
 * Two things deliberately not read, both recorded rather than silently dropped:
 * a self/Ask story's `a.u-url` points back at `/s/<short_id>/…`, which
 * {@link isOutbound} rejects, so such a story yields nothing and that is
 * correct rather than a failure; and the `div.story_content` body of a text
 * story is not scanned for addresses, because the tiers here are "the story's
 * own URL" and "a comment", and a story's own body is neither.
 */
import type { Network } from "@parle/domain/Network"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { absolute, anchorsIn, attribute, attributeOfFirst, blocksAt, leadingCount, textOfFirst } from "./Markup.ts"
import { isOutbound } from "./Outbound.ts"
import { Discussion, type Legibility, type NetworkPage, type Numbers, type PageReading, type Sighting } from "./Page.ts"

const network: Network = "lobsters"

const ANCHOR = "data-shortid=\""

/** Where a comment's body lives, and the only place its addresses are read. */
const COMMENT_TEXT = "comment_text"

const identify = (shortId: string): DiscussionId =>
  DiscussionId.make({ network, nativeId: NativeId.make(shortId) })

const openingTag = (block: string): string => {
  const close = block.indexOf(">")
  return close === -1 ? block : block.slice(0, close + 1)
}

/**
 * Lobsters stamps every `<time>` three ways: a `title` and a `datetime` that
 * are both unzoned local strings, and `data-at-unix`, which is the same instant
 * in epoch seconds. The seconds win for the reason they win on Hacker News —
 * parsing `2026-08-24 02:32:45` moves every harvested posting time by the
 * reader's own offset, which makes "posted before your last look" a function of
 * where they are sitting.
 */
const postedAtOf = (block: string): number | null => {
  const stamp = attributeOfFirst(block, "time", "data-at-unix")
  if (stamp === null || !/^\d+$/.test(stamp)) return null
  return Number.parseInt(stamp, 10) * 1000
}

/** The story row's own fields: what it submitted, and how it is doing. */
interface Story {
  readonly discussion: Discussion
  readonly numbers: Numbers
  /** The story's own outbound address, absolute, or `null` for a text story. */
  readonly link: string | null
}

const readStoryRow = (block: string, base: string, shortId: string): Story => {
  const anchors = anchorsIn(block)
  const title = anchors.find((anchor) => anchor.classes.includes("u-url"))
  const comments = anchors.find((anchor) => anchor.text.toLowerCase().includes("comment"))
  // The first `/~user` anchor is the avatar, whose text is an image and so
  // strips to nothing. The named one is the submitter — "via" — or the author.
  const author = anchors.find((anchor) => anchor.href !== null && anchor.href.startsWith("/~") && anchor.text !== "")

  const href = title?.href === undefined || title.href === null ? null : absolute(title.href, base)
  const link = href !== null && isOutbound(network, href) ? href : null

  return {
    discussion: Discussion.make({
      id: identify(shortId),
      title: title?.text ?? "",
      submittedUrl: link,
      postedAt: postedAtOf(block),
      author: author?.text ?? null,
      // Lobsters tags are a taxonomy, not a venue: a story carries several at
      // once, so none of them is "where it was posted".
      venue: null
    }),
    numbers: {
      // Logged out this is `<a class="upvoter" href="/login">148</a>`; logged
      // in it is the same element with the reader's vote state on it.
      score: leadingCount(textOfFirst(block, "a", "upvoter") ?? ""),
      // "13 comments" yields 13; "no comments" yields nothing, which is the
      // right answer — a zero we invented renders later as a count that fell.
      comments: comments === undefined ? null : leadingCount(comments.text)
    },
    link
  }
}

const legibility = (anchors: number, read: number): Legibility =>
  anchors === 0
    ? { _tag: "Illegible", expected: `an element carrying ${ANCHOR}…" — li.story or div.comment` }
    : { _tag: "Legible", anchors, read }

/** True for a block that is a story row rather than a comment. */
const isStoryBlock = (tag: string): boolean => (attribute(tag, "class") ?? "").includes("story")

/**
 * Every story on a listing page, as a Linked Mention apiece.
 *
 * Rows whose `data-shortid` is missing or empty are dropped rather than guessed
 * at — the comment form carries `data-shortid=""` and is exactly such a row.
 */
export const readListing = (page: NetworkPage): PageReading => {
  const blocks = blocksAt(page.markup, ANCHOR)
  const sightings: Array<Sighting> = []
  let read = 0
  for (const block of blocks) {
    const tag = openingTag(block)
    const shortId = attribute(tag, "data-shortid")
    if (shortId === null || shortId === "") continue
    if (!isStoryBlock(tag)) continue
    const story = readStoryRow(block, page.url, shortId)
    if (story.link === null) continue
    read += 1
    sightings.push({
      link: story.link,
      discussion: story.discussion,
      numbers: story.numbers,
      tier: "Linked",
      inComment: undefined
    })
  }
  return { network, sightings, legibility: legibility(blocks.length, read) }
}

/**
 * One Lobsters story: the submission, and the addresses its commenters linked.
 *
 * The comment links are attributed to the STORY, not to the comment — a
 * Discussion is the conversation, and a comment is a place inside it, which is
 * what `inComment` records. Every one of them is a Passing Mention.
 */
export const readStory = (page: NetworkPage): PageReading => {
  const blocks = blocksAt(page.markup, ANCHOR)
  const sightings: Array<Sighting> = []
  let read = 0
  let story: Story | null = null

  for (const block of blocks) {
    const tag = openingTag(block)
    const shortId = attribute(tag, "data-shortid")
    if (shortId === null || shortId === "") continue

    if (isStoryBlock(tag)) {
      // The first story row on a story page is the one the page is about.
      if (story !== null) continue
      story = readStoryRow(block, page.url, shortId)
      if (story.link === null) continue
      read += 1
      sightings.push({
        link: story.link,
        discussion: story.discussion,
        numbers: story.numbers,
        tier: "Linked",
        inComment: undefined
      })
      continue
    }

    if (story === null) continue
    let found = false
    for (const body of blocksAt(block, COMMENT_TEXT)) {
      for (const anchor of anchorsIn(body)) {
        if (anchor.href === null) continue
        const href = absolute(anchor.href, page.url)
        if (href === null || !isOutbound(network, href)) continue
        found = true
        sightings.push({
          link: href,
          discussion: story.discussion,
          numbers: story.numbers,
          tier: "Passing",
          inComment: shortId
        })
      }
    }
    if (found) read += 1
  }

  return { network, sightings, legibility: legibility(blocks.length, read) }
}

/** True for the address of one story rather than a list of them. */
export const isStoryPage = (url: string): boolean => /\/s\/[a-z0-9]+/i.test(url)

export const read = (page: NetworkPage): PageReading => isStoryPage(page.url) ? readStory(page) : readListing(page)
