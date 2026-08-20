/**
 * Drawing a Panel, with the DOM and nothing else.
 *
 * No framework, by decision rather than by taste. ADR 0003 makes iOS the
 * constraining platform — tighter memory, a per-site permission model, and a
 * review queue that a large bundle does not help with — so the surface that
 * gets injected into the reader's page is a few kilobytes of DOM calls rather
 * than a runtime.
 *
 * ## Two surfaces, one shape, and the split between them
 *
 * {@link render} draws the **page surface**: the Discussions themselves, and
 * the Digest written from them. It is injected only where there is something to
 * read, so it never has to explain itself.
 *
 * {@link renderStatus} draws the **toolbar surface**: what happened and why,
 * per Place, including everything refused and everything deliberately not
 * asked. ADR 0011's degraded states live here now. That is not a demotion — it
 * is the only surface reachable on *every* page, including the ones where
 * nothing was asked and nothing was injected, so moving the account here makes
 * it more reachable rather than less. What it stops doing is competing with the
 * conversations for the reader's attention on a page that has some.
 *
 * Both are total. There is no arrangement of a Panel that draws nothing from
 * either of them, which is ADR 0011's requirement stated as code, and
 * `render.test.ts` walks every state through both and asserts it.
 *
 * Everything is set through `textContent` and `href`. Nothing here ever
 * interpolates a Network's string into markup: a Discussion title is attacker-
 * controlled text arriving from a third party, and this is the one place in the
 * extension where that text meets a page.
 *
 * Rendering is a full replace on each frame. The panel is at most a few dozen
 * rows and frames arrive in waves, so the diffing a framework would do buys
 * nothing and costs the thing it is here to avoid.
 */
import type { Network } from "@parle/domain/Network"
import {
  externalGlyph,
  moreGlyph,
  nestedGlyph,
  NETWORK_SHORT,
  networksOn,
  settingsGlyph,
  summaryGlyph,
  tabMark
} from "./marks.ts"
import type {
  Account,
  DigestView,
  FindingView,
  Folded,
  Note,
  Panel,
  PanelComment,
  Restraint,
  Row
} from "./Panel.ts"
import { foundCount } from "./Panel.ts"

export interface Acts {
  readonly openOut: (address: string) => void
  /** Look this page up on purpose, overriding whatever held it back. */
  readonly lookAnyway: () => void
  /**
   * Write a Digest of this page's Discussions.
   *
   * Separate from every other act because it is the only one that costs the
   * reader something they can run out of: several requests for comment bodies,
   * and their own Provider's quota. The panel says both before this can be
   * called, and nothing calls it on their behalf.
   */
  readonly summarise: () => void
  /**
   * Read one Discussion's comments, or close it again.
   *
   * Keyed rather than passed a Row so a surface cannot ask about a Discussion
   * this panel is not showing. Costs a request against the reader's own IP —
   * two on Hacker News, for the thread page that carries its order.
   *
   * `networkRoom` fires this when it paints a Discussion, because the comments
   * are what the room is for — so this is not click-only, and the disclosures
   * say so. What it is NOT is a page-load fetch: a room only paints for a panel
   * the reader opened, on a Discussion they chose.
   */
  readonly readDiscussion: (key: string) => void
  /** Turn automatic lookups on or off, everywhere. */
  readonly decide: (automatic: boolean) => void
  /** Open the page that says what Parle sends and to whom. */
  readonly openDisclosure: () => void
  /** Open the settings page. */
  readonly openSettings: () => void
  /**
   * Stop, or start again, on the site the reader is looking at.
   *
   * On both surfaces, and that is the point: the moment someone wants to pause
   * a site is the moment they are on it, and a control that requires them to go
   * and find a page, then type the host in, is one they will not use. It
   * carries the host rather than the tab because a pause is about the site and
   * holds on the next tab too.
   */
  readonly pauseSite: (host: string) => void
  readonly resumeSite: (host: string) => void
}

/**
 * The site an address is on, as a person would name it, or nothing when there
 * is no site to name.
 *
 * The scheme is checked, not just the parse. `chrome-extension://` addresses
 * parse fine and hand back the extension's own id as a hostname — which is how
 * the toolbar came to offer "Pause on lmdkfhnbcgmoihaanegdaciafdebffia" while
 * looking at one of our own pages. A pause is about a site the reader browses,
 * so an address that is not one gets no button rather than a meaningless one.
 *
 * Local to this module rather than imported: `render.ts` is the code that ends
 * up inside the reader's page, and ADR 0003 makes every import here a byte on
 * the constraining platform.
 */
const siteOf = (address: string): string | null => {
  try {
    const parsed = new URL(address)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    return parsed.hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

/** "Hacker News and Reddit" — a list a person would read aloud. */
const namesOf = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? names[0] ?? "Nowhere"
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] => {
  const made = document.createElement(tag)
  if (className !== "") made.className = className
  if (text !== undefined) made.textContent = text
  return made
}

const button = (className: string, text: string, act: () => void): HTMLElement => {
  const made = el("button", className, text)
  made.addEventListener("click", (event) => {
    event.preventDefault()
    act()
  })
  return made
}

const iconButton = (
  className: string,
  label: string,
  icon: SVGElement,
  act: () => void
): HTMLButtonElement => {
  const made = el("button", className)
  made.type = "button"
  made.setAttribute("aria-label", label)
  made.title = label
  made.appendChild(icon)
  made.addEventListener("click", (event) => {
    event.preventDefault()
    act()
  })
  return made
}

// ---------------------------------------------------------------------------
// Discussions
// ---------------------------------------------------------------------------

/**
 * How many times else this same page was posted to the same Network.
 *
 * Kept because it is true and worth knowing — a page reposted five times had
 * something happen to it — and kept to three words because four dead reposts
 * are not what the reader opened this for. See `panelOf.repeatsFolded`, which
 * decides what may be folded away and never folds a thread anyone replied to.
 */
const repeatWords = (times: number): string =>
  times === 1 ? "also submitted once" : `also submitted ${times} times`

/**
 * What a Discussion is actually saying, under the row that names it.
 *
 * The reason this exists: a row is a title and two numbers, which tells a
 * reader a conversation happened and nothing about what was said in it, so the
 * only way to find out was to leave. Reading the comments is a request per
 * Discussion against the reader's own IP (ADR 0014), so it happens on their
 * click and never on their behalf — which is also why "could not read it" has
 * to be drawn rather than swallowed: they asked, and they are owed the answer.
 */
const TOP_LEVEL_COMMENTS = 8
const FLAT_COMMENTS = 40
const PANEL_REPLY_DEPTH = 3

/** Per-surface reading choices. Frames replace the DOM, so keep them outside it. */
const flatDiscussions = new Set<string>()
const openReplies = new Set<string>()

const replyKey = (row: Row, comment: PanelComment): string => `${row.key}\u0000${comment.id}`

const commentsNode = (row: Row, acts: Acts, panel?: Panel): HTMLElement | null => {
  const block = el("div", "parle-comments")

  const appendActions = (tools: HTMLElement): void => {
    tools.appendChild(el("span", "parle-comments-spacer"))
    tools.appendChild(iconButton(
      "parle-comments-open",
      "Open discussion",
      externalGlyph(),
      () => acts.openOut(row.permalink)
    ))

    const menuWrap = el("span", "parle-comments-menu-wrap")
    const menu = el("span", "parle-comments-menu")
    menu.hidden = true
    const site = panel === undefined ? null : siteOf(panel.address)
    if (site !== null && panel !== undefined) {
      const paused = panel.restraint !== null && panel.restraint.kind === "site-paused"
      menu.appendChild(button(
        "parle-comments-menu-item",
        paused ? `Resume on ${site}` : `Pause on ${site}`,
        () => paused ? acts.resumeSite(site) : acts.pauseSite(site)
      ))
    }
    menu.appendChild(button(
      "parle-comments-menu-item",
      "What Parle sends",
      acts.openDisclosure
    ))
    const more = iconButton(
      "parle-comments-more-actions",
      "More actions",
      moreGlyph(),
      () => {
        menu.hidden = !menu.hidden
        more.setAttribute("aria-expanded", menu.hidden ? "false" : "true")
      }
    )
    more.setAttribute("aria-haspopup", "menu")
    more.setAttribute("aria-expanded", "false")
    menuWrap.appendChild(more)
    menuWrap.appendChild(menu)
    tools.appendChild(menuWrap)
  }

  const stateTools = (): HTMLElement => {
    const tools = el("div", "parle-comments-tools")
    appendActions(tools)
    return tools
  }

  if (row.comments === null && row.commentCount === 0) {
    block.appendChild(stateTools())
    block.appendChild(el("p", "parle-comments-note", "No comments yet."))
    return block
  }
  if (row.comments === null || row.comments._tag === "Reading") {
    block.appendChild(stateTools())
    block.appendChild(el("p", "parle-comments-note", "Loading comments…"))
    return block
  }
  if (row.comments._tag === "Unreadable") {
    block.appendChild(stateTools())
    block.appendChild(el("p", "parle-comments-note", "Could not read this one."))
    return block
  }
  const read = row.comments
  const known = new Map(read.comments.map((comment) => [comment.id, comment]))
  const children = new Map<string | null, Array<PanelComment>>()
  for (const comment of read.comments) {
    const parent = comment.parentId !== null && comment.parentId !== comment.id && known.has(comment.parentId)
      ? comment.parentId
      : null
    const held = children.get(parent)
    if (held === undefined) children.set(parent, [comment])
    else held.push(comment)
  }

  const descendants = (comment: PanelComment): number => {
    let total = 0
    const queue = [...(children.get(comment.id) ?? [])]
    while (queue.length > 0) {
      const next = queue.shift()
      if (next === undefined) continue
      total += 1
      queue.push(...(children.get(next.id) ?? []))
    }
    return total
  }

  /** How each Network writes a name — X wants a handle, the others do not. */
  const whoSaid = (author: string): string => {
    if (row.network !== "x") return author
    return author.startsWith("@") ? author : `@${author}`
  }

  const commentNode = (
    comment: PanelComment,
    visibleDepth: number,
    includeReplyControls = true
  ): HTMLElement => {
    const said = el("article", "parle-comment")
    const who = el("div", "parle-comment-who", whoSaid(comment.author))
    if (comment.age !== "") who.appendChild(el("span", "parle-comment-age", comment.age))
    said.appendChild(who)
    said.appendChild(el("p", "parle-comment-text", comment.text))

    const replies = children.get(comment.id) ?? []
    if (replies.length === 0 || !includeReplyControls) return said
    const count = descendants(comment)
    if (visibleDepth >= PANEL_REPLY_DEPTH) {
      said.appendChild(button(
        "parle-comment-more",
        `Continue ${count === 1 ? "this reply" : `these ${count} replies`} on the discussion`,
        () => acts.openOut(row.permalink)
      ))
      return said
    }

    const key = replyKey(row, comment)
    const opened = openReplies.has(key)
    said.appendChild(button(
      "parle-comment-more",
      opened ? "Hide replies" : `${count} ${count === 1 ? "reply" : "replies"}`,
      () => {
        if (openReplies.has(key)) openReplies.delete(key)
        else openReplies.add(key)
        draw()
      }
    ))
    if (opened) {
      const nested = el("div", "parle-replies")
      for (const reply of replies) nested.appendChild(commentNode(reply, visibleDepth + 1))
      said.appendChild(nested)
    }
    return said
  }

  const draw = (): void => {
    block.replaceChildren()
    const tools = el("div", "parle-comments-tools")
    const isFlat = flatDiscussions.has(row.key)
    const mode = el("button", "parle-comments-mode")
    mode.type = "button"
    mode.setAttribute("aria-label", isFlat ? "Flat" : "Nested")
    mode.appendChild(nestedGlyph())
    mode.appendChild(el("span", "", isFlat ? "Flat" : "Nested"))
    mode.appendChild(el("span", "parle-comments-chevron", "⌄"))
    mode.addEventListener("click", (event) => {
      event.preventDefault()
      if (flatDiscussions.has(row.key)) flatDiscussions.delete(row.key)
      else flatDiscussions.add(row.key)
      draw()
    })
    mode.setAttribute("aria-pressed", isFlat ? "false" : "true")
    tools.appendChild(mode)
    tools.appendChild(button("parle-comments-collapse", "Collapse all", () => {
      for (const key of [...openReplies]) {
        if (key.startsWith(`${row.key}\u0000`)) openReplies.delete(key)
      }
      draw()
    }))
    appendActions(tools)
    block.appendChild(tools)

    if (isFlat) {
      const shown = read.comments.slice(0, FLAT_COMMENTS)
      for (const comment of shown) block.appendChild(commentNode(comment, 0, false))
      const hidden = Math.max(0, read.comments.length - shown.length) + read.beyond
      if (hidden > 0) {
        block.appendChild(button(
          "parle-comments-more",
          `Open ${hidden} more on the discussion`,
          () => acts.openOut(row.permalink)
        ))
      }
      return
    }

    const roots = children.get(null) ?? []
    const shownRoots = roots.slice(0, TOP_LEVEL_COMMENTS)
    for (const comment of shownRoots) block.appendChild(commentNode(comment, 0))
    const omittedKnown = roots.slice(shownRoots.length)
      .reduce((total, comment) => total + 1 + descendants(comment), 0)
    const hidden = omittedKnown + read.beyond
    if (hidden > 0) {
      block.appendChild(button(
        "parle-comments-more",
        `Open ${hidden} more on the discussion`,
        () => acts.openOut(row.permalink)
      ))
    }
  }
  draw()
  return block
}

/** Score/comment wording that matches how each Network usually says it. */
const factWords = (row: Row): { readonly score: string; readonly comments: string } => {
  switch (row.network) {
    case "hackernews":
      return {
        score: `${row.score} points`,
        comments: `${row.commentCount} ${row.commentCount === 1 ? "comment" : "comments"}`
      }
    case "reddit":
      return {
        score: `${row.score} upvotes`,
        comments: `${row.commentCount} ${row.commentCount === 1 ? "comment" : "comments"}`
      }
    case "x":
      return {
        score: `${row.score} likes`,
        comments: `${row.commentCount} ${row.commentCount === 1 ? "reply" : "replies"}`
      }
  }
}

/**
 * A list row for Passing mentions — title and facts stay, because that list
 * is how the reader judges a weaker claim. The open Linked room is denser and
 * uses {@link homeNode} instead.
 */
const rowNode = (row: Row, acts: Acts): HTMLElement => {
  const holder = el("div", "parle-row-holder")
  const anchor = el("div", "parle-row")
  const title = el("a", "parle-title")
  title.textContent = row.title
  title.href = row.permalink
  title.target = "_blank"
  title.rel = "noreferrer noopener"
  title.addEventListener("click", (event) => {
    event.preventDefault()
    acts.openOut(row.permalink)
  })
  anchor.appendChild(title)

  const facts = el("div", "parle-facts")
  const words = factWords(row)
  facts.appendChild(el("span", "parle-network", row.networkName))
  facts.appendChild(el("span", "", words.score))
  facts.appendChild(el("span", "", words.comments))
  if (row.age !== "") facts.appendChild(el("span", "", row.age))
  if (row.alsoSubmitted > 0) {
    facts.appendChild(el("span", "parle-repeat", repeatWords(row.alsoSubmitted)))
  }
  anchor.appendChild(facts)
  holder.appendChild(anchor)

  const said = commentsNode(row, acts)
  if (said !== null) holder.appendChild(said)
  return holder
}

/**
 * The open Linked conversation — comments first.
 *
 * No thread title (the reader is already on the page), no Network name or
 * score row (the dock icon and its badge are enough). The comments toolbar is
 * all the chrome the room needs.
 */
const homeNode = (row: Row, acts: Acts, panel: Panel): HTMLElement => {
  const holder = el("div", "parle-row-holder parle-home")
  holder.dataset.network = row.network

  const title = el("a", "parle-room-title")
  title.textContent = row.title
  title.href = row.permalink
  title.target = "_blank"
  title.rel = "noreferrer noopener"
  title.addEventListener("click", (event) => {
    event.preventDefault()
    acts.openOut(row.permalink)
  })
  holder.appendChild(title)

  if (row.alsoSubmitted > 0) {
    holder.appendChild(el(
      "div",
      "parle-repeat parle-room-repeat",
      repeatWords(row.alsoSubmitted)
    ))
  }
  const said = commentsNode(row, acts, panel)
  if (said !== null) holder.appendChild(said)
  else if (row.commentCount === 0) {
    holder.appendChild(el("p", "parle-comments-note", "No comments yet."))
  }
  return holder
}

/**
 * Which conversation the reader is looking at, per page.
 *
 * View state, held here rather than in the Panel, because it is a fact about
 * this surface and not about the page — the toolbar and the panel beside the
 * article can be looking at different threads at the same time, and neither is
 * more right. A frame is a full replace, so without this the reader's choice
 * would be lost every time a Lookup landed.
 */
const chosen = new Map<string, string>()

/**
 * Which navigation destination is open: Digest, or a Network.
 *
 * Digest will become the default once it is the first thing a reader sees;
 * until then the loudest Network opens first and Digest is one tap away.
 */
type DockPick = "summary" | Network
const dockPick = new Map<string, DockPick>()

/**
 * Conversations we have already asked to read.
 *
 * `readDiscussion` is a TOGGLE, so the auto-open below has to be able to tell
 * "the reader has not opened this yet" from "we opened it and this is a later
 * frame". Without it, every re-render would close the thread it just opened.
 */
const requested = new Set<string>()

/** Clears per-surface view state. Tests call this between cases. */
export const resetViewState = (): void => {
  flatDiscussions.clear()
  openReplies.clear()
  chosen.clear()
  dockPick.clear()
  requested.clear()
}

const badgeCount = (rows: ReadonlyArray<Row>): number =>
  rows.reduce((total, row) => total + row.commentCount, 0)

const loudest = (rows: ReadonlyArray<Row>): Row | undefined =>
  [...rows].sort((a, b) => b.commentCount - a.commentCount)[0]

/**
 * Linked Discussions for one Network — the room under the compact navigation.
 *
 * One icon per Network. Several threads on the same Network pick the loudest
 * by default; a compact place/title strip appears only when there is a choice.
 */
const networkRoom = (
  subject: string,
  network: Network,
  rows: ReadonlyArray<Row>,
  panel: Panel,
  acts: Acts,
  redraw: () => void
): HTMLElement => {
  const room = el("section", "parle-group parle-group-linked parle-room")
  room.dataset.network = network
  room.setAttribute("role", "tabpanel")

  const mine = rows.filter((row) => row.network === network)
  const pick = chosen.get(subject)
  const current =
    mine.find((row) => row.key === pick) ??
    loudest(mine)
  if (current === undefined) {
    room.appendChild(el("p", "parle-comments-note", "Nothing here yet."))
    return room
  }

  if (mine.length > 1) {
    const picks = el("div", "parle-thread-picks")
    picks.setAttribute("role", "tablist")
    picks.setAttribute("aria-label", "Threads")
    for (const row of [...mine].sort((a, b) => b.commentCount - a.commentCount)) {
      const chip = el("button", row.key === current.key ? "parle-thread-pick parle-thread-pick-on" : "parle-thread-pick")
      chip.type = "button"
      chip.setAttribute("role", "tab")
      chip.setAttribute("aria-selected", row.key === current.key ? "true" : "false")
      const label =
        row.place !== null && row.place !== ""
          ? `r/${row.place}`
          : row.title.length > 28
            ? `${row.title.slice(0, 27)}…`
            : row.title
      chip.textContent = label
      chip.title = row.title
      chip.addEventListener("click", () => {
        chosen.set(subject, row.key)
        redraw()
      })
      picks.appendChild(chip)
    }
    room.appendChild(picks)
  }

  room.appendChild(homeNode(current, acts, panel))
  if (current.comments === null && current.commentCount > 0 && !requested.has(current.key)) {
    requested.add(current.key)
    acts.readDiscussion(current.key)
  }
  return room
}

/**
 * Compact navigation — icon-only destinations with iOS-style count badges.
 *
 * Its placement is deliberately CSS-owned: touch and mobile surfaces keep it
 * at the bottom, pointer-driven desktop ones put it at the top, and the whole
 * decision is `@media (min-width: 640px) and (hover: hover) and (pointer: fine)`
 * in `styles.ts` rather than anything this module knows. It used to name
 * browser-owned sidebars as a third case; ADR 0021 removed that surface, so
 * there is one container now and the media query is the only input.
 *
 * Order: Digest (soon the default) · Networks that spoke · Settings. Counts
 * overlap the top-right of each Network icon and do not add layout height.
 */
const navNode = (
  subject: string,
  panel: Panel,
  pick: DockPick,
  acts: Acts,
  onPick: (next: DockPick) => void
): HTMLElement => {
  const nav = el("nav", "parle-nav")
  nav.setAttribute("aria-label", "Discussions")

  const strip = el("div", "parle-nav-strip")
  strip.setAttribute("role", "tablist")

  const summary = el("button", pick === "summary" ? "parle-nav-item parle-nav-on" : "parle-nav-item")
  summary.type = "button"
  summary.dataset.dock = "summary"
  summary.setAttribute("role", "tab")
  summary.setAttribute("aria-selected", pick === "summary" ? "true" : "false")
  summary.setAttribute("aria-label", "Digest")
  summary.title = "Digest"
  const summaryMark = el("span", "parle-nav-mark")
  summaryMark.appendChild(summaryGlyph())
  const summaryIcon = el("span", "parle-nav-icon")
  summaryIcon.appendChild(summaryMark)
  // Digests are not the default destination yet — a quiet cue, not a count.
  if (panel.digest.findings.length === 0) {
    summaryIcon.appendChild(el("span", "parle-nav-soon"))
  }
  summary.appendChild(summaryIcon)
  summary.addEventListener("click", () => onPick("summary"))
  strip.appendChild(summary)

  for (const network of networksOn(panel.linked)) {
    const rows = panel.linked.filter((row) => row.network === network)
    const count = badgeCount(rows)
    const item = el("button", pick === network ? "parle-nav-item parle-nav-on" : "parle-nav-item")
    item.type = "button"
    item.dataset.network = network
    item.setAttribute("role", "tab")
    item.setAttribute("aria-selected", pick === network ? "true" : "false")
    item.setAttribute(
      "aria-label",
      `${NETWORK_SHORT[network]}, ${count} ${count === 1 ? "comment" : "comments"}`
    )
    item.title = `${NETWORK_SHORT[network]} · ${count}`
    const icon = el("span", "parle-nav-icon")
    icon.appendChild(tabMark(network))
    if (count > 0) {
      const badge = el("span", "parle-nav-badge", count > 999 ? "999+" : String(count))
      badge.setAttribute("aria-hidden", "true")
      icon.appendChild(badge)
    }
    item.appendChild(icon)
    item.addEventListener("click", () => {
      const row = loudest(rows)
      if (row !== undefined) chosen.set(subject, row.key)
      onPick(network)
    })
    strip.appendChild(item)
  }

  nav.appendChild(strip)

  const utilities = el("div", "parle-nav-utilities")
  utilities.appendChild(iconButton(
    "parle-nav-item parle-nav-settings",
    "Settings",
    settingsGlyph(),
    acts.openSettings
  ))
  nav.appendChild(utilities)
  return nav
}

/**
 * One tier's rows, split by where they came from when there is more than one.
 *
 * The page surface no longer draws Network tabs up top — the bottom nav does
 * that — but Passing mentions still need their own labelled list so the weaker
 * claim is never blended into Linked.
 */
const groupNode = (
  tier: "linked" | "passing",
  name: string,
  note: string,
  rows: ReadonlyArray<Row>,
  acts: Acts
): HTMLElement | null => {
  if (rows.length === 0) return null
  const group = el("section", `parle-group parle-group-${tier}`)
  const heading = el("h2", "parle-group-name", `${name} `)
  heading.appendChild(el("span", "parle-group-note", note))
  group.appendChild(heading)

  for (const row of rows) group.appendChild(rowNode(row, acts))
  return group
}

/**
 * What was folded away on a site's front page, and the one click that opens it.
 *
 * This is the only place in the product that keeps a Discussion the reader
 * could otherwise see off the screen, so three things are true of it by
 * construction and each is load-bearing under ADR 0005.
 *
 * **The count is in the sentence.** "Some conversations were hidden" is a claim
 * nobody can check; "8 Discussions link to this address" is one they can open
 * and judge. A suppression the reader cannot quantify is the invisible false
 * negative the ADR is about.
 *
 * **The rows are already here.** Opening it is a `hidden` flip, not a request
 * and not a message to the background — so there is no state in which the
 * reader clicks and gets nothing because a worker was killed between frames.
 *
 * **There is no way to make it smaller.** The control only opens. A collapse
 * affordance would be a second thing to get wrong for a section that is at most
 * a few dozen rows and is closed by default anyway.
 *
 * Drawn by BOTH surfaces. On the toolbar it is what makes the restraint
 * checkable rather than a claim; on the page it is where the reader actually
 * is.
 */
const foldedNode = (folded: Folded, acts: Acts): HTMLElement => {
  const block = el("section", "parle-folded")
  block.appendChild(el("p", "parle-folded-says", folded.says))

  const rows = el("div", "parle-folded-rows")
  rows.hidden = true
  for (const row of folded.rows) rows.appendChild(rowNode(row, acts))

  const open = button("parle-act parle-act-folded", folded.label, () => {
    rows.hidden = false
    open.remove()
  })
  block.appendChild(open)
  block.appendChild(rows)
  return block
}

// ---------------------------------------------------------------------------
// The Digest
// ---------------------------------------------------------------------------

/**
 * Where one Finding can be checked, as a link that goes to the sentence.
 *
 * ADR 0006 allows a Digest to report a claim as disputed only because the
 * reader can go and read the objection themselves; a source they cannot follow
 * is not that. So every one of these is an anchor with a real `href`, opened
 * through the background exactly as a Discussion row is — the surface needs no
 * permission of its own, and a middle-click still works because the `href` is
 * really there.
 */
const sourceNode = (
  source: { readonly label: string; readonly permalink: string; readonly comment: boolean },
  acts: Acts
): HTMLElement => {
  const anchor = el("a", "parle-source")
  anchor.href = source.permalink
  anchor.target = "_blank"
  anchor.rel = "noreferrer noopener"
  anchor.addEventListener("click", (event) => {
    event.preventDefault()
    acts.openOut(source.permalink)
  })
  anchor.appendChild(
    el("span", "parle-source-label", source.comment ? `${source.label} — the comment` : source.label)
  )
  // Never a bare identifier and never an unlinked label: ADR 0006's whole
  // permission to report a claim as disputed rests on this being followable.
  return anchor
}

/**
 * One Finding: what was said, whether anyone there disputed it, and where.
 *
 * The disputed mark is deliberately understated. ADR 0006 records that most
 * people read "contested" as "this is wrong" and requires copy and treatment to
 * work against that, so the mark is phrased as a report about the conversation
 * — someone in it disagreed — and rendered in the same visual family as the
 * rest of the panel rather than as a warning. It is never a colour that means
 * danger and never an icon that means error; what makes it different is that it
 * is labelled and that its source is a comment you can go and read.
 */
const findingNode = (finding: FindingView, acts: Acts): HTMLElement => {
  const block = el(
    "div",
    finding.contested ? "parle-finding parle-finding-disputed" : "parle-finding"
  )
  if (finding.contested) {
    // "Someone there disagreed", not "this is wrong". The mark reports the
    // conversation; the source underneath is where the reader judges it.
    block.appendChild(el("span", "parle-disputed", "Someone there disagreed"))
  }
  block.appendChild(el("p", "parle-finding-says", finding.statement))
  const sources = el("div", "parle-sources")
  for (const source of finding.sources) sources.appendChild(sourceNode(source, acts))
  block.appendChild(sources)
  return block
}

/**
 * The Digest slot, in whatever state it is in.
 *
 * There is no arrangement of a `DigestView` that draws nothing except the one
 * the derivation uses to say "not now" — an empty `says`, no findings and no
 * offer — which is the panel deliberately not having a Digest section rather
 * than having an empty one.
 */
const digestNode = (digest: DigestView, acts: Acts): HTMLElement | null => {
  if (digest.says.text === "" && digest.findings.length === 0 && digest.offer === null) {
    return null
  }
  const block = el("section", `parle-digest parle-tone-${digest.says.tone}`)
  if (digest.says.text !== "") {
    block.appendChild(el("h2", "parle-digest-title", digest.says.text))
  }
  for (const finding of digest.findings) block.appendChild(findingNode(finding, acts))
  if (digest.partial) {
    block.appendChild(
      el(
        "p",
        "parle-digest-partial",
        "This is part of an answer — some of it could not be traced to a comment."
      )
    )
  }
  const offer = digest.offer
  if (offer !== null) {
    // The sentence goes ABOVE the button, always. It is what the reader is
    // agreeing to — several requests for comment text, sent to a third party —
    // and a disclosure underneath the thing it discloses has been read by
    // nobody.
    if (offer.says !== "") block.appendChild(el("p", "parle-digest-says", offer.says))
    block.appendChild(
      button(
        "parle-act parle-act-digest",
        offer.label,
        offer.kind === "connect" ? acts.openSettings : acts.summarise
      )
    )
  }
  if (digest.wrote !== null) {
    block.appendChild(el("p", "parle-digest-wrote", digest.wrote))
  }
  return block
}

// ---------------------------------------------------------------------------
// Status: what happened, and why
// ---------------------------------------------------------------------------

/**
 * What is true about this page right now, in one line.
 *
 * Terse is fine; vague is not. Every branch names the specific thing that
 * happened, and the two that look identical on screen — nobody discussed it,
 * and nobody would tell us — never wear the same words, because they are
 * opposite facts. The first is evidence about the world; the second is evidence
 * about us.
 */
const waitingWords = (panel: Panel): string =>
  // Named, because they answer in waves: "still looking" over the whole page
  // says nothing about whether it is worth waiting, and a reader watching
  // Hacker News finish while Reddit hangs deserves to know which is which.
  panel.waitingOn.length === 0
    ? "Still looking."
    : `Still looking — ${panel.waitingOn.join(", ")}`

const summaryOf = (panel: Panel): string => {
  const found = foundCount(panel)
  if (found > 0) return `${found} discussion${found === 1 ? "" : "s"} on this page.`
  if (panel.stillLooking) return waitingWords(panel)
  // Said BEFORE `foundNothing`, and the order is the whole point. A front door
  // with everything folded has `found === 0` and has plainly been discussed;
  // reaching the sentence below it would tell a reader that nobody discussed a
  // page while the line underneath offers to show them eight conversations
  // about it. The fold's own words say the true thing, so they are what is
  // said, and the block underneath carries the count and the way in.
  if (panel.folded !== null) return panel.folded.says
  // Named from `answeredBy` rather than written out, because the sentence is a
  // claim about who was asked: on a page where the reader had switched Reddit
  // off, the old wording said Reddit had answered.
  if (panel.foundNothing) {
    return `Nobody has discussed this page. ${namesOf(panel.answeredBy)} answered, with nothing.`
  }
  if (panel.couldNotAsk) {
    return "Parle could not find out. Nowhere answered — which is not the same as nobody discussing it."
  }
  return "Nothing has been asked about this page yet."
}

/**
 * The way out of a restraint, or nothing when there honestly is not one.
 *
 * A page that is not a public web address gets no button, because there is no
 * page for anyone to have discussed and a button offering to try would be a
 * lie. Every other kind gets exactly one, because ADR 0005 promises the reader
 * can always ask on purpose.
 */
const wayOutNode = (restraint: Restraint, acts: Acts): HTMLElement | null => {
  switch (restraint.kind) {
    case "not-a-web-page":
      return null
    case "undecided":
      return button("parle-act parle-act-strong", "Read this and choose", acts.openDisclosure)
    case "automatic-off":
      return button("parle-act", "Look this page up", acts.lookAnyway)
    // Deliberately NOT "look it up anyway": a Network the reader switched off
    // stays off even for an explicit Ask (ADR 0014), so that button would be
    // one that does nothing on the one page it appears on.
    case "networks-off":
      return button("parle-act", "Choose where Parle looks", acts.openSettings)
    case "excluded":
    case "site-paused":
    case "over-budget":
    case "switched-off":
    // Honest here: the front-door rule is checked only on the automatic branch
    // of `LookupPolicy.permits`, so an explicit Ask really does override it.
    case "front-door":
      return button("parle-act", "Look it up anyway", acts.lookAnyway)
  }
}

const restraintNode = (restraint: Restraint, acts: Acts): HTMLElement => {
  const block = el("div", `parle-restraint parle-restraint-${restraint.kind}`)
  block.appendChild(el("p", "parle-restraint-says", restraint.says))
  const wayOut = wayOutNode(restraint, acts)
  if (wayOut !== null) block.appendChild(wayOut)
  return block
}

const noteNode = (note: Note, className: string): HTMLElement =>
  el("div", `${className} parle-tone-${note.tone}`, note.text)

/**
 * The account of every Place, on every frame, unabridged.
 *
 * Open rather than folded away behind a summary. This surface exists to be
 * read: it is the whole reason a reader can tell "Reddit refused us" from
 * "nobody has discussed this", and a disclosure one click further in is one
 * fewer reader who ever sees it.
 */
const accountsNode = (accounts: ReadonlyArray<Account>): HTMLElement => {
  const section = el("section", "parle-coverage")
  section.appendChild(el("h2", "parle-coverage-name", "Where Parle asked"))
  for (const account of accounts) {
    const line = el("div", "parle-account")
    line.appendChild(el("span", "parle-account-place", account.place))
    line.appendChild(el("span", `parle-account-${account.tone}`, account.standing))
    section.appendChild(line)
  }
  return section
}

/**
 * Pausing, offered on the site the reader is actually on.
 *
 * Nothing to pause on an address that names no site — a `chrome://` surface or
 * a blank tab — so there is no button there. Offering it would be one that does
 * nothing.
 */
const pauseNode = (panel: Panel, acts: Acts): HTMLElement | null => {
  const site = siteOf(panel.address)
  if (site === null) return null
  const paused = panel.restraint !== null && panel.restraint.kind === "site-paused"
  return button(
    "parle-link",
    paused ? `Resume on ${site}` : `Pause on ${site}`,
    () => paused ? acts.resumeSite(site) : acts.pauseSite(site)
  )
}

/**
 * The toolbar surface's footer: the switch, the pause, and the two pages.
 *
 * The switch is the first thing a store reviewer looks for and the first thing
 * a reader reaches for, and this is the surface that is on every page whether
 * or not anything was found — so it is the only place it can live and always be
 * there. The page surface puts Settings on the bottom nav and Pause beside the
 * open conversation's tools, so this footer is toolbar-only.
 *
 * Two rows, declared rather than wrapped into. A popup is 360px wide, five
 * controls do not fit on one line there, and left to `flex-wrap` the last one
 * lands alone under the state label looking like an accident. The switch and
 * the sentence describing its position belong together; the three ways out
 * belong together; so that is what the markup says.
 */
const statusFooter = (panel: Panel, acts: Acts): HTMLElement => {
  const footer = el("footer", "parle-footer")

  const switching = el("div", "parle-footer-row")
  switching.appendChild(
    el(
      "span",
      "parle-footer-state",
      panel.automatic ? "Looking pages up automatically" : "Only when you ask"
    )
  )
  switching.appendChild(
    button(
      "parle-link",
      panel.automatic ? "Turn off" : "Turn on",
      () => acts.decide(!panel.automatic)
    )
  )
  footer.appendChild(switching)

  const ways = el("div", "parle-footer-row")
  const pause = pauseNode(panel, acts)
  if (pause !== null) ways.appendChild(pause)
  ways.appendChild(button("parle-link", "What Parle sends", acts.openDisclosure))
  ways.appendChild(button("parle-link", "Settings", acts.openSettings))
  footer.appendChild(ways)
  return footer
}

const headNode = (panel: Panel): HTMLElement => {
  const head = el("header", "parle-head")
  head.appendChild(el("h1", "parle-heading", panel.heading))
  head.appendChild(el("div", "parle-address", panel.address))
  return head
}

// ---------------------------------------------------------------------------
// The two surfaces
// ---------------------------------------------------------------------------

/**
 * The page surface: comments first, adaptive icon nav, Digest in its own destination.
 *
 * No page-title head — the reader is already on the page. No Network names or
 * thread titles in the open room — the dock icon is enough. Nested replies
 * stay collapsed until asked for.
 */
export const render = (root: HTMLElement, panel: Panel, acts: Acts): void => {
  root.textContent = ""
  root.className = "parle parle-compact"

  const body = el("div", "parle-body")
  const subject = panel.address
  const loud = loudest(panel.linked)
  const initial: DockPick =
    dockPick.get(subject) ??
    (loud !== undefined ? loud.network : "summary")

  const main = el("div", "parle-main")
  const extras = el("div", "parle-extras")

  const passing = groupNode(
    "passing",
    "Came up elsewhere",
    "linked inside a conversation about something else",
    panel.passing,
    acts
  )
  if (passing !== null) extras.appendChild(passing)
  if (panel.folded !== null) extras.appendChild(foldedNode(panel.folded, acts))
  if (panel.windowed !== null) extras.appendChild(noteNode(panel.windowed, "parle-note"))
  if (foundCount(panel) === 0 && panel.folded === null) {
    extras.appendChild(
      el("p", "parle-said", panel.restraint === null ? summaryOf(panel) : panel.restraint.says)
    )
  } else if (panel.stillLooking) {
    const waiting = el("div", "parle-notice parle-tone-waiting")
    const label = el("span", "")
    label.appendChild(el("span", "parle-spinner"))
    label.appendChild(document.createTextNode(waitingWords(panel)))
    waiting.appendChild(label)
    extras.appendChild(waiting)
  }

  const drawMain = (pick: DockPick): void => {
    dockPick.set(subject, pick)
    main.replaceChildren()
    if (pick === "summary") {
      const digest = digestNode(panel.digest, acts)
      if (digest !== null) main.appendChild(digest)
      else {
        main.appendChild(el(
          "p",
          "parle-comments-note",
          "A Digest of these discussions will live here."
        ))
      }
      return
    }
    if (panel.linked.some((row) => row.network === pick)) {
      main.appendChild(networkRoom(subject, pick, panel.linked, panel, acts, () => drawMain(pick)))
    }
  }

  const navSlot = el("div", "parle-nav-slot")
  const paintNav = (pick: DockPick): void => {
    navSlot.replaceChildren(
      navNode(subject, panel, pick, acts, (chosenPick) => {
        drawMain(chosenPick)
        paintNav(chosenPick)
      })
    )
  }

  drawMain(initial)
  body.appendChild(main)
  body.appendChild(extras)
  root.appendChild(body)
  root.appendChild(navSlot)
  paintNav(initial)
}

/**
 * The toolbar surface: what happened, and why, in every state there is.
 *
 * Reachable on every page — including the ones nothing was injected into,
 * which is most of them — so this is where ADR 0011's degraded states are
 * guaranteed to be readable. Every one of them draws words, and each names the
 * specific thing rather than a generic one: `summaryOf` above and
 * `panelOf.accountOf` below it are where that promise is actually kept.
 */
export const renderStatus = (root: HTMLElement, panel: Panel, acts: Acts): void => {
  root.textContent = ""
  root.className = "parle"
  root.appendChild(headNode(panel))

  const body = el("div", "parle-body")

  if (panel.restraint !== null) body.appendChild(restraintNode(panel.restraint, acts))
  // The restraint IS the summary when there is one, so it is not repeated — but
  // a page held back now can still be showing what was found before it was, and
  // that count is not something the restraint says.
  //
  // The fold is the summary too, on a front door where nothing is showing:
  // `summaryOf` falls through to `panel.folded.says` there, and the block below
  // draws the same sentence with the way in attached. Printing both put it on
  // screen twice, which is what the first browser run of this actually showed.
  const foldIsTheSummary = panel.folded !== null && foundCount(panel) === 0
  if ((panel.restraint === null || foundCount(panel) > 0) && !foldIsTheSummary) {
    body.appendChild(el("p", "parle-said", summaryOf(panel)))
  }

  // The one suppression this product performs, on the surface that is
  // reachable from every page — including the ones where the mark never
  // appeared, which is exactly the case a front door produces. ADR 0005 asks
  // that anything which hides Discussions be visible where it fires; on a page
  // with nothing fresh, THIS is where it fires.
  if (panel.folded !== null) body.appendChild(foldedNode(panel.folded, acts))

  // Still shown on a held-back page, and that is the point: there it is the
  // list of what was not asked and why, which is the only thing that makes the
  // restraint checkable rather than a claim.
  if (panel.accounts.length > 0) body.appendChild(accountsNode(panel.accounts))
  // Above the offline-list note, because it is a fact about THIS page and that
  // one is a fact about the build. On this surface it sits under the accounts,
  // which is where it belongs: the accounts already name the Place, and this
  // says how far that Place was read.
  if (panel.windowed !== null) body.appendChild(noteNode(panel.windowed, "parle-note"))
  if (panel.index !== null) body.appendChild(noteNode(panel.index, "parle-note"))

  root.appendChild(body)
  // No switch to flip until the reader has read the one screen that asks.
  if (panel.restraint === null || panel.restraint.kind !== "undecided") {
    root.appendChild(statusFooter(panel, acts))
  }
}
