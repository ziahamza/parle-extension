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
 * {@link renderAside} draws the **surface beside the page**, and it is not a
 * third drawing — it is a rule for choosing between the two above. That is the
 * whole reason a native side panel costs so little here: the panel is a
 * different CONTAINER, not different rendering.
 *
 * All three are total. There is no arrangement of a Panel that draws nothing
 * from any of them, which is ADR 0011's requirement stated as code, and
 * `render.test.ts` walks every state through all three and asserts it.
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
import { NETWORK_SHORT, tabMark } from "./marks.ts"
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
   * this panel is not showing. Costs one request against the reader's own IP,
   * which is why nothing calls it except their click.
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

const commentsNode = (row: Row, acts: Acts): HTMLElement | null => {
  if (row.comments === null) return null
  const block = el("div", "parle-comments")
  if (row.comments._tag === "Reading") {
    block.appendChild(el("p", "parle-comments-note", "Reading the conversation…"))
    return block
  }
  if (row.comments._tag === "Unreadable") {
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
        `Continue ${count === 1 ? "this reply" : `these ${count} replies`} on ${row.networkName}`,
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
    tools.appendChild(el("span", "parle-comments-note", isFlat ? "All replies, one level" : "Top-level comments"))
    tools.appendChild(button("parle-comments-mode", isFlat ? "Show nested" : "Flatten", () => {
      if (flatDiscussions.has(row.key)) flatDiscussions.delete(row.key)
      else flatDiscussions.add(row.key)
      draw()
    }))
    block.appendChild(tools)

    if (isFlat) {
      const shown = read.comments.slice(0, FLAT_COMMENTS)
      for (const comment of shown) block.appendChild(commentNode(comment, 0, false))
      const hidden = Math.max(0, read.comments.length - shown.length) + read.beyond
      if (hidden > 0) {
        block.appendChild(button(
          "parle-comments-more",
          `Open ${hidden} more on ${row.networkName}`,
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
        `Open ${hidden} more on ${row.networkName}`,
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
 * The strip at the top of an open conversation — which room you stepped into.
 *
 * Tabs already say which Network; this repeats it in that Network's own
 * chrome so the body under the tabs feels like a place rather than a themed
 * card. Reddit gets the subreddit when we know it; HN and X get the Network
 * name the reader already recognises.
 */
const roomBar = (row: Row): HTMLElement => {
  const bar = el("header", "parle-room-bar")
  bar.appendChild(tabMark(row.network))
  const where =
    row.network === "reddit" && row.place !== null && row.place !== ""
      ? `r/${row.place}`
      : row.networkName
  bar.appendChild(el("span", "parle-room-where", where))
  bar.appendChild(el("span", "parle-room-short", NETWORK_SHORT[row.network]))
  return bar
}

/**
 * @param asHome — true inside a conversation tab: draw the Network room bar
 * and treat the title block as a post. Passing mentions stay a plain list row.
 */
const rowNode = (row: Row, acts: Acts, asHome = false): HTMLElement => {
  const holder = el("div", asHome ? "parle-row-holder parle-home" : "parle-row-holder")
  if (asHome) holder.appendChild(roomBar(row))

  const anchor = el("div", asHome ? "parle-row parle-post" : "parle-row")
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
 * Conversations we have already asked to read.
 *
 * `readDiscussion` is a TOGGLE, so the auto-open below has to be able to tell
 * "the reader has not opened this yet" from "we opened it and this is a later
 * frame". Without it, every re-render would close the thread it just opened.
 */
const requested = new Set<string>()

/**
 * The Discussions themselves, as a strip of tabs — one per conversation.
 *
 * This used to be a list of rows that each expanded, and before that a list
 * grouped by Network. Both were the wrong noun. A reader does not pick a
 * SOURCE, they pick a CONVERSATION, and what they want from it is the thing
 * itself rather than three lines of preview and a link away.
 *
 * Sorted by how much was said, across Networks together: a Reddit thread with
 * four hundred comments belongs in front of a Hacker News post with two, and
 * grouping by source would have buried it behind a tab.
 *
 * The loudest is opened without being asked. That costs one request on a panel
 * the reader deliberately opened — which is their click, not ours (ADR 0014) —
 * and it is the difference between "here is what was said" and "here are some
 * links, go and find out".
 */
const conversationsNode = (
  subject: string,
  rows: ReadonlyArray<Row>,
  acts: Acts
): HTMLElement | null => {
  if (rows.length === 0) return null
  const group = el("section", "parle-group parle-group-linked parle-group-talk")
  const heading = el("h2", "parle-group-name", "About this page")
  group.appendChild(heading)

  const byTalk = [...rows].sort((a, b) => b.commentCount - a.commentCount)
  const first = byTalk[0]
  if (first === undefined) return group
  const pick = chosen.get(subject)
  const current = byTalk.find((row) => row.key === pick) ?? first

  const tabs = el("div", "parle-tabs")
  tabs.setAttribute("role", "tablist")
  tabs.setAttribute("aria-label", "Discussions")
  const body = el("div", "parle-conversation")
  body.setAttribute("role", "tabpanel")
  const drawn: Array<{ readonly key: string; readonly tab: HTMLElement }> = []

  /**
   * Short name on every tile — HN / r/science / X — so the strip reads as a
   * map of rooms rather than a row of identical icons with numbers.
   */
  const tabLabel = (row: Row): string => {
    if (row.network === "reddit") {
      return row.place !== null && row.place !== "" ? `r/${row.place}` : "Reddit"
    }
    return NETWORK_SHORT[row.network]
  }

  const show = (row: Row): void => {
    for (const one of drawn) {
      const on = one.key === row.key
      one.tab.className = on ? "parle-tab parle-tab-on" : "parle-tab"
      one.tab.setAttribute("aria-selected", on ? "true" : "false")
    }
    body.dataset.network = row.network
    body.replaceChildren(rowNode(row, acts, true))
    // Only where there is something to fetch, and only once. A thread nobody
    // replied to has nothing to read, and asking twice would close it — the
    // act is a toggle. The comments arrive on a later frame.
    if (row.comments === null && row.commentCount > 0 && !requested.has(row.key)) {
      requested.add(row.key)
      acts.readDiscussion(row.key)
    }
  }
  for (const row of byTalk) {
    const tab = el("button", "parle-tab")
    tab.type = "button"
    tab.dataset.network = row.network
    tab.setAttribute("role", "tab")
    tab.appendChild(tabMark(row.network))
    const label = tabLabel(row)
    tab.appendChild(el("span", "parle-tab-name", label))
    const count = el("span", "parle-tab-count", String(row.commentCount))
    count.setAttribute("aria-hidden", "true")
    tab.appendChild(count)
    tab.setAttribute(
      "aria-label",
      `${label}, ${row.commentCount} ${row.commentCount === 1 ? "comment" : "comments"}`
    )
    tab.title = `${label} · ${row.commentCount}`
    drawn.push({ key: row.key, tab })
    tab.addEventListener("click", () => {
      chosen.set(subject, row.key)
      show(row)
    })
    tabs.appendChild(tab)
  }
  group.appendChild(tabs)
  group.appendChild(body)
  show(current)
  return group
}



/**
 * One tier's rows, split by where they came from when there is more than one.
 *
 * Tabs appear only at two or more Networks. A single tab is not a choice, and
 * drawing one would put a control on the screen that does nothing — on most
 * pages, where only Hacker News answered, the reader sees exactly what they saw
 * before this existed.
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
 * The page surface's footer: the one control whose moment is *on the page*.
 *
 * Everything else a reader can change — the switch every shipping analogue of
 * this product ends up with, what Parle sends, the whole settings page — is one
 * click away on the toolbar, which is where the status lives. Repeating it here
 * would be the panel arguing with itself over a page the reader opened to read.
 */
const pageFooter = (panel: Panel, acts: Acts): HTMLElement => {
  const footer = el("footer", "parle-footer")
  const row = el("div", "parle-footer-row")
  const pause = pauseNode(panel, acts)
  if (pause !== null) row.appendChild(pause)
  row.appendChild(button("parle-link", "Settings", acts.openSettings))
  footer.appendChild(row)
  return footer
}

/**
 * The toolbar surface's footer: the switch, the pause, and the two pages.
 *
 * The switch is the first thing a store reviewer looks for and the first thing
 * a reader reaches for, and this is the surface that is on every page whether
 * or not anything was found — so it is the only place it can live and always be
 * there.
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
 * The page surface: what was said about this page, and a Digest of it.
 *
 * Drawn inside the mark's shadow root, and only on a page that has Discussions
 * — so it opens straight into them. The one line at the bottom of the body is
 * there for the frames where that stops being true mid-Enquiry rather than as a
 * state this surface is expected to sit in.
 */
export const render = (root: HTMLElement, panel: Panel, acts: Acts): void => {
  root.textContent = ""
  root.className = "parle"
  root.appendChild(headNode(panel))

  const body = el("div", "parle-body")

  // Three names and three notes, and the notes are what keep the tiers apart.
  // The strongest says the conversation's own link points here; the weakest says
  // in as many words that it is not provably about this page. Losing that clause
  // to save four words would promote the weak claim, which is the one thing this
  // grouping exists to prevent.
  const groups = [
    conversationsNode(panel.address, panel.linked, acts),
    groupNode(
      "passing",
      "Came up elsewhere",
      "linked inside a conversation about something else",
      panel.passing,
      acts
    )
  ]
  for (const group of groups) if (group !== null) body.appendChild(group)

  // After the groups: what is shown comes first, and what was set aside is
  // read in the context of it.
  if (panel.folded !== null) body.appendChild(foldedNode(panel.folded, acts))

  // Directly under the rows it qualifies, on the surface that draws rows. It is
  // a statement about the length of the list above it — "this is at least this
  // many" — so anywhere else on the panel it would read as a general disclaimer
  // and mean nothing. See ADR 0018.
  if (panel.windowed !== null) body.appendChild(noteNode(panel.windowed, "parle-note"))

  if (foundCount(panel) === 0 && panel.folded === null) {
    body.appendChild(
      el("p", "parle-said", panel.restraint === null ? summaryOf(panel) : panel.restraint.says)
    )
  } else if (panel.stillLooking) {
    const waiting = el("div", "parle-notice parle-tone-waiting")
    const label = el("span", "")
    label.appendChild(el("span", "parle-spinner"))
    // Named, for the same reason `summaryOf` names them: they answer in waves,
    // and "still looking" over the whole page says nothing about whether more
    // is coming.
    label.appendChild(document.createTextNode(waitingWords(panel)))
    waiting.appendChild(label)
    body.appendChild(waiting)
  }

  const digest = digestNode(panel.digest, acts)
  if (digest !== null) body.appendChild(digest)

  root.appendChild(body)
  root.appendChild(pageFooter(panel, acts))
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

/**
 * The surface beside the page: whichever of the two above the moment calls for.
 *
 * The mark can vanish when a page turns out to hold nothing — `pill.content.ts`
 * takes the whole host element back off the page, and that is its central
 * promise. A panel docked in the browser's own chrome cannot do that. It is
 * open because the reader opened it, it survives navigation and tab switches
 * (measured on Chrome 151: the document is not even reloaded), and it will
 * therefore be sitting there on pages with nothing to show. So "nothing to
 * show" has to be a thing it SAYS.
 *
 * Which is exactly what the toolbar surface is for. On a page with Discussions
 * this opens straight into them, like the mark's surface; on a page without,
 * it becomes the account of every Place we turned to and what came back — ADR
 * 0011's degraded states, in the container the reader is already looking at,
 * rather than an empty box or a disappearing act.
 *
 * The header is drawn by both, so the swap keeps the page's title and address
 * in place and changes only what is underneath.
 */
export const renderAside = (root: HTMLElement, panel: Panel, acts: Acts): void => {
  // A page whose only rows are folded away goes to the toolbar surface, which
  // is the one that explains itself. The page surface opens straight into
  // Discussions and has no words for "and here is why there are none showing".
  if (foundCount(panel) === 0) {
    renderStatus(root, panel, acts)
    return
  }
  render(root, panel, acts)
}
