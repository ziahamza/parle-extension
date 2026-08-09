/**
 * Reading Hacker News pages the reader is already on.
 *
 * Two shapes, and the difference between them is a tier rather than a
 * selector. A **list page** — the front page, `newest`, `best`, a user's
 * submissions — is thirty rows, each a Discussion whose own submitted URL is
 * right there: thirty Linked Mentions for one page load, and the single richest
 * harvest this extension gets. An **item page** is one Discussion plus its
 * comment tree: the submission is still a Linked Mention, but every address
 * inside a comment is a **Passing Mention**, because that Discussion is about
 * the submission and not about whatever somebody linked in reply.
 *
 * The glossary keeps those apart and so must this file. `@parle/memory` will
 * not let a Passing Mention displace a Linked one, so getting it wrong in the
 * safe direction costs a little; getting it wrong in the other direction
 * promotes a comment link to the tier that discharges ADR 0001's disclosure
 * argument, which is how X ends up asked about a page nobody submitted
 * anywhere.
 *
 * Everything is anchored on `class="athing"` with an `id`, because that is the
 * one structure carrying an item's native id and it has survived every Hacker
 * News change in fifteen years. A page with no `athing` in it is not an empty
 * Hacker News page — Hacker News has no empty pages — so it is reported as
 * {@link Legibility} `Illegible` rather than as a harvest that found nothing.
 */
import type { Network } from "@parle/domain/Network"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import {
  absolute,
  anchorsIn,
  attribute,
  blocksAt,
  instantOf,
  leadingCount,
  openingTagOf,
  textOfFirst
} from "./Markup.ts"
import { isOutbound } from "./Outbound.ts"
import { Discussion, type Legibility, type NetworkPage, type Numbers, type PageReading, type Sighting } from "./Page.ts"

const network: Network = "hackernews"

const ANCHOR = "athing"

const identify = (id: string): DiscussionId =>
  DiscussionId.make({ network, nativeId: NativeId.make(id) })

const openingTag = (block: string): string => {
  const close = block.indexOf(">")
  return close === -1 ? block : block.slice(0, close + 1)
}

/**
 * Hacker News stamps the age span with `title="2024-06-25T09:17:08 1719307028"`
 * — an ISO instant with no zone designator, followed by the same instant in
 * epoch seconds. The seconds are used when they are there: the ISO half would
 * otherwise be parsed as local time, which moves every harvested posting time
 * by the reader's own offset and turns "posted before your Last Look" into a
 * function of where they are sitting.
 */
const postedAtOf = (block: string): number | null => {
  const age = openingTagOf(block, "span", "age")
  if (age === null) return null
  const stamp = attribute(age, "title")
  if (stamp === null) return null
  const [iso, seconds] = stamp.split(" ")
  if (seconds !== undefined && /^\d+$/.test(seconds)) return Number.parseInt(seconds, 10) * 1000
  return instantOf(iso ?? null)
}

/** The submission row's own fields: what it links to, and how it is doing. */
interface Submission {
  readonly discussion: Discussion
  readonly numbers: Numbers
  /** The story's own outbound address, absolute, or `null` for an Ask HN. */
  readonly link: string | null
}

const readSubmission = (block: string, base: string, id: string): Submission | null => {
  const title = blocksAt(block, "titleline")[0]
  if (title === undefined) return null
  const [story] = anchorsIn(title)
  const anchors = anchorsIn(block)
  const comments = anchors.find((anchor) => anchor.text.toLowerCase().includes("comment"))
  const author = anchors.find((anchor) => anchor.classes.includes("hnuser"))

  const href = story?.href === undefined || story.href === null ? null : absolute(story.href, base)
  // An Ask HN, a Tell HN and a job post all point at the item itself. They are
  // real Discussions with no outbound link, so they yield no Mention and are
  // not a parse failure.
  const link = href !== null && isOutbound(network, href) ? href : null

  return {
    discussion: Discussion.make({
      id: identify(id),
      title: story?.text ?? "",
      submittedUrl: link,
      postedAt: postedAtOf(block),
      author: author?.text ?? null
    }),
    numbers: {
      score: leadingCount(textOfFirst(block, "span", "score") ?? ""),
      comments: comments === undefined ? null : leadingCount(comments.text)
    },
    link
  }
}

const legibility = (anchors: number, read: number): Legibility =>
  anchors === 0
    ? { _tag: "Illegible", expected: `an element with class "${ANCHOR}" carrying an id` }
    : { _tag: "Legible", anchors, read }

/**
 * Every story on a Hacker News list page, as a Linked Mention apiece.
 *
 * Rows whose `id` is missing are dropped rather than guessed at: a Mention we
 * cannot identify is one we can neither dedupe, nor observe twice, nor cite.
 */
export const readListing = (page: NetworkPage): PageReading => {
  const blocks = blocksAt(page.markup, ANCHOR)
  const sightings: Array<Sighting> = []
  let read = 0
  for (const block of blocks) {
    const id = attribute(openingTag(block), "id")
    if (id === null) continue
    const submission = readSubmission(block, page.url, id)
    if (submission === null || submission.link === null) continue
    read += 1
    sightings.push({
      link: submission.link,
      discussion: submission.discussion,
      numbers: submission.numbers,
      tier: "Linked",
      inComment: undefined
    })
  }
  return { network, sightings, legibility: legibility(blocks.length, read) }
}

/** The item id the page is about, taken from its own address. */
const itemOf = (url: string): string | null => /[?&]id=(\d+)/.exec(url)?.[1] ?? null

/**
 * One Hacker News thread: the submission, and the addresses its commenters
 * linked.
 *
 * The comment links are attributed to the STORY, not to the comment — a
 * Discussion is the conversation, and a comment is a place inside it, which is
 * what `inComment` records. Every one of them is a Passing Mention.
 */
export const readItem = (page: NetworkPage): PageReading => {
  const blocks = blocksAt(page.markup, ANCHOR)
  const sightings: Array<Sighting> = []
  let read = 0

  const fromUrl = itemOf(page.url)
  let story: Submission | null = null

  for (const block of blocks) {
    const tag = openingTag(block)
    const id = attribute(tag, "id")
    if (id === null) continue
    const classes = attribute(tag, "class") ?? ""
    if (!classes.includes("comtr")) {
      // The submission row. On an item page there is exactly one, and the
      // address bar agrees with it; where it does not, the address bar wins,
      // because that is the page the reader is actually on.
      const submission = readSubmission(block, page.url, fromUrl ?? id)
      if (submission === null) continue
      story = submission
      if (submission.link === null) continue
      read += 1
      sightings.push({
        link: submission.link,
        discussion: submission.discussion,
        numbers: submission.numbers,
        tier: "Linked",
        inComment: undefined
      })
      continue
    }

    if (story === null) continue
    let found = false
    for (const comment of blocksAt(block, "commtext")) {
      for (const anchor of anchorsIn(comment)) {
        if (anchor.href === null) continue
        const href = absolute(anchor.href, page.url)
        if (href === null || !isOutbound(network, href)) continue
        found = true
        sightings.push({
          link: href,
          discussion: story.discussion,
          numbers: story.numbers,
          tier: "Passing",
          inComment: id
        })
      }
    }
    if (found) read += 1
  }

  return { network, sightings, legibility: legibility(blocks.length, read) }
}

/** True for the address of one thread rather than a list of them. */
export const isItemPage = (url: string): boolean => url.includes("/item?") || /[?&]id=\d+/.test(url)

export const read = (page: NetworkPage): PageReading => isItemPage(page.url) ? readItem(page) : readListing(page)
