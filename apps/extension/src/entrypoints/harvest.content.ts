/**
 * The crawl, which is just the reader browsing.
 *
 * ADR 0012's first clause: "whenever the reader is on Hacker News, Reddit or X,
 * every outbound link visible on the page — with the thread it came from — is
 * recorded." This is the script that makes that true, now for Bluesky, Lemmy
 * and Lobsters as well. It runs on the hosts named below and nowhere else, it reads only what the reader's own browser has
 * already rendered, and it sends no address anywhere — it hands markup to our
 * own background, which parses it and keeps pointers.
 *
 * **This one IS in the manifest, and the pill is not.** The pill is injected
 * only into pages that have something to show, because an extension present on
 * every page a reader opens is a different product from one that answers when
 * there is an answer. Harvesting is the opposite case and the exception is
 * narrow: three hosts, named in the manifest, where being present is the entire
 * mechanism. A reader can read what it matches without running it.
 *
 * **It must not slow the page down.** Everything below is arranged around that,
 * and none of it is incidental:
 *
 *   - Every read happens in an *idle* callback, so serialising a long X timeline
 *     competes with nothing the reader is waiting for.
 *   - Nothing is read while the tab is hidden. A background tab is not a page
 *     the reader is on, and harvesting one costs battery for a page nobody is
 *     looking at.
 *   - The DOM observer is coalesced into one idle pass and rate-limited to at
 *     most one harvest per {@link QUIET_MS}. An infinite scroll fires mutations
 *     continuously and by design.
 *   - A page whose markup has not changed length since the last harvest is not
 *     sent again. It is a weak test on purpose — cheap, and wrong only in the
 *     direction of harvesting once more than needed, which the background dedupes.
 *   - `outerHTML` is capped at {@link LARGEST_PAGE}. The parsers are anchored on
 *     block structure and drop anything they cannot identify, so a truncated tail
 *     costs the last few Discussions on a very long scroll and nothing else.
 *
 * **It reads and it does not write.** There is no observer of what the reader
 * types, no selection watching, no event beyond `MutationObserver` on the
 * document and the two navigation events an SPA needs. On Reddit and X the
 * address changes with no new document, which is why those two are here at all.
 */
import { defineContentScript } from "wxt/utils/define-content-script"
import type { Network } from "@parle/domain/Network"
import { link } from "../platform/Surface.ts"
import { HARVEST_PORT, Harvested } from "../wire/Wire.ts"

/**
 * The same cap the background applies, applied here as well.
 *
 * Two bounds on one number, deliberately: this one keeps a several-megabyte
 * string off the message channel, and the background's keeps it out of the
 * parser — because on the far side of that boundary everything is `unknown` and
 * a content script is not a thing the background gets to trust about its size.
 */
const LARGEST_PAGE = 2_000_000

/** The least time between two harvests of one page. Infinite scroll needs a floor. */
const QUIET_MS = 4_000

/**
 * Which Network this page is, or nothing.
 *
 * Matched on the hostname the script is actually running in, never on anything
 * the page said about itself. The manifest already guarantees the match; this is
 * the second check, and it is what decides which parser the background may use.
 */
const LEMMY_INSTANCES: ReadonlyArray<string> = ["lemmy.world", "lemm.ee", "lemmy.ml"]

const networkOf = (host: string): Network | null => {
  const name = host.toLowerCase()
  if (name === "news.ycombinator.com") return "hackernews"
  if (name === "reddit.com" || name.endsWith(".reddit.com")) return "reddit"
  if (name === "x.com" || name.endsWith(".x.com")) return "x"
  if (name === "bsky.app") return "bluesky"
  if (name === "lobste.rs") return "lobsters"
  // Lemmy is a network of instances, not a site, and the enumeration is the
  // point: an instance we do not ask is one whose pages we have no parser
  // vocabulary for, and `@parle/harvest`'s Outbound rules are written against
  // exactly this list. Widening it means widening both together.
  if (LEMMY_INSTANCES.includes(name)) return "lemmy"
  return null
}

/** Run when the browser has nothing better to do, or soon, whichever comes first. */
const whenIdle = (work: () => void): void => {
  const idle = (globalThis as {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
  }).requestIdleCallback
  if (typeof idle === "function") idle(work, { timeout: 2_000 })
  else setTimeout(work, 0)
}

const start = (): void => {
  const network = networkOf(location.hostname)
  if (network === null) return

  const wire = link(HARVEST_PORT, () => {
    // The background says nothing on this port. Harvest is one-way by design:
    // what it produces is read by the Enquiry on the NEXT page, not by this one.
  })

  let lastAt = 0
  let lastKey = ""
  let scheduled = false

  const harvest = (): void => {
    scheduled = false
    // A tab the reader is not looking at is not a page they are on.
    if (document.visibilityState === "hidden") return
    const at = Date.now()
    if (at - lastAt < QUIET_MS) {
      schedule()
      return
    }

    const whole = document.documentElement.outerHTML
    const markup = whole.length > LARGEST_PAGE ? whole.slice(0, LARGEST_PAGE) : whole
    // Address and length together: an SPA that swapped the whole feed for one of
    // the same size is rarer than one that changed the address, and the cost of
    // being wrong here is one harvest the background will dedupe anyway.
    const key = `${location.href}#${markup.length}`
    if (key === lastKey) return

    if (!wire.say(Harvested(network, location.href, markup))) {
      // MV3 killed the worker and the link is between reconnects. Harvesting a
      // page happens once, so a dropped message is a Discussion that never
      // reaches the reader's cache — the invisible false negative every decision
      // in `@parle/harvest` is arranged against, arriving before that package
      // ever sees it. Nothing is recorded, so the next pass reads the same page.
      schedule()
      return
    }
    lastKey = key
    lastAt = at
  }

  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    // Coalesced twice: once by this flag, and once by the idle callback, which
    // is where the actual serialisation happens. An infinite scroll fires
    // mutations continuously and neither bound alone is enough.
    setTimeout(() => whenIdle(harvest), QUIET_MS)
  }

  whenIdle(harvest)

  // Reddit, X and Bluesky are single-page apps: the address changes with no new
  // document, and the new page is a different Discussion with different links.
  window.addEventListener("popstate", schedule)
  window.addEventListener("hashchange", schedule)
  // Infinite scroll, lazily hydrated comment trees, a feed that fills in after
  // paint. All of these are new Discussions on a page we have already read once.
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true
  })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedule()
  })
  window.addEventListener("pagehide", () => wire.close())
}

export default defineContentScript({
  /**
   * The Networks we read, and nothing else.
   *
   * ADR 0012 notes that these host permissions are already needed and that
   * harvesting does not widen them: WXT derives `http://*∕*` and `https://*∕*`
   * from the pill's own match patterns, so this adds no permission the manifest
   * did not already carry. It adds a *presence*, which is a different thing and
   * is why it is enumerated here rather than derived.
   */
  matches: [
    "*://news.ycombinator.com/*",
    "*://reddit.com/*",
    "*://*.reddit.com/*",
    "*://x.com/*",
    "*://*.x.com/*",
    "*://bsky.app/*",
    "*://lemmy.world/*",
    "*://lemm.ee/*",
    "*://lemmy.ml/*",
    "*://lobste.rs/*"
  ],
  runAt: "document_idle",
  // The top frame only, for the same reason a Reading is minted from the top
  // frame only: an embedded widget is not a page the reader is on.
  allFrames: false,
  main: start
})
