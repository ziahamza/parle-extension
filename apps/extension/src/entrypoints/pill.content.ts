/**
 * The mark, and the surface it opens: the only things Parle puts on a page.
 *
 * `registration: "runtime"` — this script is NOT in the manifest and is NOT
 * injected on page load. The background injects it into a tab only once that
 * tab's Enquiry has something to show. That is the difference between an
 * extension present on every page a reader opens and one that appears when
 * there is an answer, and it is structural rather than a policy: on a page with
 * nothing, this code never runs.
 *
 * **Nothing is added to the page until there is something to say, and nothing
 * is left behind when there stops being.** The host element is created on the
 * first frame that carries a Discussion, and removed again on any frame that
 * does not — a single-page navigation to an undiscussed address takes the mark
 * and the surface with it. So the guarantee is not "we inject a small thing",
 * it is "a page with nothing has no node of ours in it at all", which is a
 * property the browser harness can check by walking every shadow root.
 *
 * Everything renders inside a **closed Shadow DOM**. Not for tidiness — a host
 * page's CSS reaches any element in the light DOM, and `all: initial` does not
 * survive a page that sets `!important` on a tag selector. A shadow root is the
 * only boundary a hostile or merely careless stylesheet cannot cross, and this
 * surface has to stay legible on pages we have never seen.
 *
 * ## One surface, on every browser
 *
 * The Discussions live in this page, not in browser chrome. Chrome's
 * `sidePanel` is per-window and outlives the tab that opened it, so a click
 * about this article would leave a sidebar sitting on the next tab. That is
 * the wrong lifetime: this surface is about the page it is on, so leaving the
 * page — or switching away from it — takes the surface with it. Safari and iOS
 * never had another option; Chrome now uses the same one.
 *
 * The mark is a **stack of Network discs** the reader can drag. One Network →
 * one disc; two or three → a short overlapping stack, so the corner of the page
 * says where the chatter is before anything opens. Position is remembered as
 * viewport fractions via {@link ParkMark}, defaulting to the historic top-right.
 *
 * It owns text selection from day one (ADR 0008), which nothing in v1 reads.
 * That is intentional, and reviewers should not remove it on the grounds that
 * nothing calls it.
 */
import { defineContentScript } from "wxt/utils/define-content-script"
import { link } from "../platform/Surface.ts"
import { watchSelection } from "../selection/Selection.ts"
import {
  DEFAULT_MARK_PARK,
  type MarkPark,
  parkFromPixels,
  pixelsOf
} from "../view/MarkPark.ts"
import { networksOn, stackFace } from "../view/marks.ts"
import { foundCount, type Panel } from "../view/Panel.ts"
import type { Acts } from "../view/render.ts"
import { render } from "../view/render.ts"
import { PANEL_STYLES } from "../view/styles.ts"
import {
  Decide,
  LookAnyway,
  OpenDisclosure,
  OpenOut,
  OpenSettings,
  ParkMark,
  PauseSite,
  PILL_PORT,
  ResumeSite,
  Sighted,
  ReadDiscussion,
  Summarise,
  Watch
} from "../wire/Wire.ts"

const MOUNTED = "__parle_pill_mounted__"
/** Mark size used to convert park fractions ↔ pixels. Matches `.parle-pill`. */
const MARK_SIZE = 36
const DRAG_SLOP = 5

/**
 * Ask for the top layer, which is the only place `z-index` cannot reach.
 *
 * Measured on nature.com: its cookie banner is a `<dialog>` opened with
 * `showModal()`, so it paints in the top layer and covered the lower two thirds
 * of a surface sitting at the largest z-index there is. No number wins that —
 * the top layer is above the whole stacking order by definition — and the
 * answer is not to escalate but to use the platform's own mechanism for it.
 *
 * `manual` rather than `auto`: light dismiss is ours to decide, not the
 * platform's. An `auto` popover closes on any click elsewhere unconditionally
 * — including on a PINNED surface, whose whole point is that clicks on the
 * page beside it are just reading. The pointerdown listener below implements
 * the dismissal we actually mean: unpinned closes, pinned stays.
 *
 * Feature-detected and caught, so a browser without it falls back to exactly
 * what this did before — a fixed element at the top of the z-index range, which
 * is correct everywhere except above a modal dialog.
 */
const raise = (element: HTMLElement): void => {
  if (!("showPopover" in element)) return
  try {
    element.setAttribute("popover", "manual")
    element.showPopover()
  } catch {
    // Not connected, or the attribute was refused. The stylesheet already
    // places it; losing the top layer costs one page in a hundred.
    element.removeAttribute("popover")
  }
}

const discussionWords = (found: number): string =>
  `${found} discussion${found === 1 ? "" : "s"}`

const mount = (): void => {
  const marked = window as unknown as Record<string, boolean>
  // The background may inject more than once — a reload, or a race with the
  // port connecting. A second mark on one page is the visible bug this stops.
  if (marked[MOUNTED] === true) return
  marked[MOUNTED] = true

  let standing: Panel | null = null
  let park: MarkPark = DEFAULT_MARK_PARK
  /** Null until the first frame that carries a Discussion. */
  let hostNode: HTMLDivElement | null = null
  let shadow: ShadowRoot | null = null
  let mark: HTMLButtonElement | null = null
  let count: HTMLSpanElement | null = null
  let face: HTMLElement | null = null
  /** Null whenever the surface is closed. Closing removes it; it is not hidden. */
  let dock: HTMLDivElement | null = null
  let board: HTMLDivElement | null = null
  /**
   * Whether the reader pinned the surface to the page.
   *
   * Unpinned — the default — the surface light-dismisses: a click on the page
   * closes it, because the reader's attention went back to the page. Pinned,
   * it stays and makes room instead (see {@link holdRoom}), which is the state
   * for reading the page and the conversation together. The choice outlives
   * one open/close on this page: a reader who pinned meant it, and reopening
   * unpinned would make the button a per-open chore.
   *
   * Only the docked layout can HOLD ROOM — under 640px the surface is the
   * screen and there is no page beside it. The stylesheet hides the button
   * there, but the flag itself survives a squeeze: pinned at a desktop width
   * and resized narrow, {@link holdRoom} releases the margin and this stays
   * true, so growing back re-holds without asking for another click.
   */
  let pinned = false

  /**
   * What the page's own `margin-right` said before we held room, restored
   * verbatim on release. Inline style only — a stylesheet margin survives
   * underneath and comes back untouched when the property is removed.
   */
  let roomHeld: string | null = null

  /**
   * Push the page over so the pinned surface sits beside it, not on it.
   *
   * A margin on the root element is the narrowest lever there is: one inline
   * property, restored on release, no cloning and no wrapping. Elements the
   * page fixed to the viewport do not move — that is the accepted cost, and
   * the reader who finds it wrong has the same click to unpin.
   */
  /**
   * The docked layout's own boundary, and it must match the stylesheet's
   * `@media (min-width: 640px)`: below it the surface is the whole screen,
   * there is no page beside it, and held room is a stale margin under a
   * fullscreen overlay. Measured at 390px: the dock's width (~375) is less
   * than the viewport, so a "would it fit" guard alone kept writing the
   * margin — the guard has to RELEASE, not merely decline.
   */
  const DOCKED_MIN_WIDTH = 640

  const holdRoom = (): void => {
    if (window.innerWidth < DOCKED_MIN_WIDTH) {
      releaseRoom()
      return
    }
    if (dock === null || !pinned) return
    const width = dock.getBoundingClientRect().width
    if (width === 0 || width >= window.innerWidth) return
    if (roomHeld === null) roomHeld = document.documentElement.style.marginRight
    document.documentElement.style.setProperty("margin-right", `${width}px`, "important")
  }

  const releaseRoom = (): void => {
    if (roomHeld === null) return
    if (roomHeld === "") document.documentElement.style.removeProperty("margin-right")
    else document.documentElement.style.marginRight = roomHeld
    roomHeld = null
  }

  const placeMark = (): void => {
    if (mark === null) return
    const { left, top } = pixelsOf(park, MARK_SIZE, {
      width: window.innerWidth,
      height: window.innerHeight
    })
    mark.style.left = `${left}px`
    mark.style.top = `${top}px`
    mark.style.right = "auto"
  }

  /**
   * Drag without turning every pointer move into an open.
   *
   * A click opens; a drag that travels past {@link DRAG_SLOP} parks. The two
   * must not share a path: a drag that also fired `click` would open on every
   * park.
   */
  const bindDrag = (button: HTMLButtonElement): void => {
    let originX = 0
    let originY = 0
    let startLeft = 0
    let startTop = 0
    let dragging = false
    let moved = false

    const onMove = (event: PointerEvent): void => {
      const dx = event.clientX - originX
      const dy = event.clientY - originY
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_SLOP) return
        dragging = true
        moved = true
        button.dataset.dragging = "1"
        button.setPointerCapture(event.pointerId)
      }
      const maxLeft = Math.max(16, window.innerWidth - MARK_SIZE - 16)
      const maxTop = Math.max(16, window.innerHeight - MARK_SIZE - 16)
      const left = Math.min(maxLeft, Math.max(16, startLeft + dx))
      const top = Math.min(maxTop, Math.max(16, startTop + dy))
      button.style.left = `${left}px`
      button.style.top = `${top}px`
      button.style.right = "auto"
    }

    const onUp = (event: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove, true)
      window.removeEventListener("pointerup", onUp, true)
      window.removeEventListener("pointercancel", onUp, true)
      if (dragging) {
        button.dataset.dragging = "0"
        try {
          button.releasePointerCapture(event.pointerId)
        } catch {
          // Already released.
        }
        const left = Number.parseFloat(button.style.left || "0")
        const top = Number.parseFloat(button.style.top || "0")
        park = parkFromPixels(left, top, MARK_SIZE, {
          width: window.innerWidth,
          height: window.innerHeight
        })
        placeMark()
        wire.say(ParkMark(park))
      }
      dragging = false
    }

    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return
      originX = event.clientX
      originY = event.clientY
      const rect = button.getBoundingClientRect()
      startLeft = rect.left
      startTop = rect.top
      moved = false
      dragging = false
      window.addEventListener("pointermove", onMove, true)
      window.addEventListener("pointerup", onUp, true)
      window.addEventListener("pointercancel", onUp, true)
    })

    button.addEventListener("click", (event) => {
      if (moved) {
        event.preventDefault()
        event.stopPropagation()
        moved = false
        return
      }
      openFromMark()
    })
  }

  /**
   * Put the mark on the page. Idempotent, and called on every frame that has
   * something to show.
   *
   * The two announcement animations are declared on the element itself, so they
   * run exactly once — when it is created here — and never again while it sits
   * there. Nothing in this file starts, stops or repeats them.
   */
  const attach = (): void => {
    if (hostNode !== null) return
    const made = document.createElement("div")
    made.style.setProperty("all", "initial")
    const root = made.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = PANEL_STYLES
    root.appendChild(style)

    const button = document.createElement("button")
    button.className = "parle-pill"
    button.type = "button"
    const stack = stackFace([])
    button.appendChild(stack)
    const bubble = document.createElement("span")
    bubble.className = "parle-pill-count"
    button.appendChild(bubble)
    bindDrag(button)
    root.appendChild(button)

    document.documentElement.appendChild(made)
    // After the host is connected: `showPopover` on a detached element throws.
    raise(button)
    hostNode = made
    shadow = root
    mark = button
    count = bubble
    face = stack
    placeMark()
  }

  /** Take everything of ours off the page, surface included. */
  const detach = (): void => {
    if (hostNode === null) return
    releaseRoom()
    // The pin is a choice about THIS page. A single-page move to another
    // article detaches, and the next page starts unpinned — "reopening on the
    // same page holds room again" stops at the page boundary.
    pinned = false
    hostNode.remove()
    hostNode = null
    shadow = null
    mark = null
    count = null
    face = null
    dock = null
    board = null
  }

  /**
   * Toggle the in-page surface. It is about this page, so the mark opens and
   * closes it the way a control on the page should — leaving the page, or
   * switching away from it, takes the surface with the document.
   */
  const openFromMark = (): void => {
    if (dock === null) openSurface()
    else closeSurface()
  }

  const openSurface = (): void => {
    if (shadow === null || dock !== null || standing === null) return
    const surface = document.createElement("div")
    surface.className = "parle-dock"
    surface.setAttribute("role", "dialog")
    surface.setAttribute("aria-label", "Parle")

    const close = document.createElement("button")
    close.className = "parle-close"
    close.type = "button"
    close.setAttribute("aria-label", "Close")
    close.textContent = "×"
    close.addEventListener("click", closeSurface)
    surface.appendChild(close)

    // The pin, beside the close button. Hidden by the stylesheet under 640px,
    // where the surface is the whole screen and there is nothing to pin
    // against. SVG rather than a glyph: 📌 renders as emoji and takes the
    // page's colour scheme with it.
    const keep = document.createElement("button")
    keep.className = "parle-pin"
    keep.type = "button"
    keep.setAttribute("aria-label", pinned ? "Unpin" : "Pin beside the page")
    keep.setAttribute("aria-pressed", pinned ? "true" : "false")
    keep.innerHTML =
      "<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path d=\"M9.5 1.5 14.5 6.5 13 8l-.7-.2-2.6 2.6.3 2.1-1.2 1.2-3-3-3.6 3.6-1-1 3.6-3.6-3-3L3 5.5l2.1.3 2.6-2.6L7.5 2.5z\"/></svg>"
    keep.addEventListener("click", () => {
      pinned = !pinned
      keep.setAttribute("aria-pressed", pinned ? "true" : "false")
      keep.setAttribute("aria-label", pinned ? "Unpin" : "Pin beside the page")
      if (pinned) holdRoom()
      else releaseRoom()
    })
    surface.appendChild(keep)

    const inner = document.createElement("div")
    inner.className = "parle"
    surface.appendChild(inner)

    shadow.appendChild(surface)
    // Raised after the mark, so it is later in the top layer and therefore
    // above it. Both live in the same corner, and the mark must never end up
    // sitting on the surface's own close button.
    raise(surface)
    dock = surface
    board = inner
    // A reader who pinned meant it — reopening on the same page holds room
    // again without asking.
    holdRoom()
    render(inner, standing, acts)
    // Focus goes to the close button, so Escape and Tab both start somewhere
    // sensible. `preventScroll` because moving the reader's page under them is
    // exactly the kind of fighting with the host this surface must not do.
    close.focus({ preventScroll: true })
  }

  /**
   * Closing removes the surface rather than hiding it.
   *
   * The reader said they were done with it; leaving a display:none subtree in
   * their page would make "nothing of ours is on a page that has nothing to
   * show" a claim about a CSS property instead of about the DOM.
   */
  const closeSurface = (): void => {
    if (dock === null) return
    releaseRoom()
    dock.remove()
    dock = null
    board = null
    mark?.focus({ preventScroll: true })
  }

  const paintFace = (panel: Panel): void => {
    if (mark === null) return
    const networks = networksOn([...panel.linked, ...panel.passing])
    const next = stackFace(networks)
    if (face !== null) face.replaceWith(next)
    else mark.insertBefore(next, count)
    face = next
  }

  const draw = (): void => {
    if (standing === null) return
    const found = foundCount(standing)
    // A page whose Enquiry turns out to hold nothing — or one the reader has
    // navigated away from without a new document — gets everything taken back.
    if (found === 0) {
      detach()
      return
    }
    attach()
    paintFace(standing)
    placeMark()
    if (count !== null) count.textContent = String(Math.min(found, 99))
    if (mark !== null) {
      mark.dataset.found = String(found)
      const networks = networksOn([...standing.linked, ...standing.passing])
      const where = networks.length === 0
        ? ""
        : ` on ${networks.map((network) => {
          if (network === "hackernews") return "Hacker News"
          if (network === "reddit") return "Reddit"
          return "X"
        }).join(" · ")}`
      const words = `Parle — ${discussionWords(found)}${where}`
      mark.setAttribute("aria-label", words)
      mark.title = `${words}. Drag to move.`
    }
    if (board !== null) render(board, standing, acts)
  }

  const wire = link(PILL_PORT, (word) => {
    if (word._tag !== "Standing") return
    standing = word.panel
    park = word.markPark
    draw()
  })

  const acts: Acts = {
    openOut: (address) => wire.say(OpenOut(address)),
    lookAnyway: () => wire.say(LookAnyway()),
    summarise: () => wire.say(Summarise()),
    readDiscussion: (key) => wire.say(ReadDiscussion(key)),
    decide: (automatic) => wire.say(Decide(automatic)),
    openDisclosure: () => wire.say(OpenDisclosure()),
    openSettings: () => wire.say(OpenSettings()),
    pauseSite: (host) => wire.say(PauseSite(host)),
    resumeSite: (host) => wire.say(ResumeSite(host))
  }

  // On `window` and in the capture phase, because the keystroke happens
  // wherever the reader's focus is — inside our closed root, or on the host
  // page behind it — and a listener on the surface would only hear half of
  // them. It answers only while the surface is open, so nothing of ours is
  // watching a reader type on a page with the surface closed.
  const onKey = (event: KeyboardEvent): void => {
    if (dock === null || event.key !== "Escape") return
    event.stopPropagation()
    closeSurface()
  }
  window.addEventListener("keydown", onKey, true)

  /**
   * A click on the page closes the unpinned surface.
   *
   * The surface is about the page, and a reader whose pointer went back to
   * the page went back to reading it — the surface should get out of the way
   * without asking for a second, aimed click on its own close button. The pin
   * is the reader's way of saying otherwise: pinned, the surface holds room
   * beside the page and clicks on the page are just reading.
   *
   * `pointerdown` in the capture phase, so pages that swallow clicks (and
   * they do) cannot keep the surface open by accident. `composedPath` rather
   * than `target`, because everything of ours lives in a closed shadow root
   * and `target` outside it is retargeted to the host — the path is the only
   * honest answer to "was this ours".
   */
  const onPointerDown = (event: PointerEvent): void => {
    if (dock === null || pinned || hostNode === null) return
    // The primary button only. A right-click is a menu, a middle-click is a
    // background tab — neither is the reader's attention going back to the
    // page. `pointerdown` rather than `click` is deliberate and stays: pages
    // swallow clicks, and the START of a text selection on the page is
    // attention on the page — light dismiss on it is the behaviour every
    // native light-dismiss surface has.
    if (event.button !== 0) return
    if (event.composedPath().includes(hostNode)) return
    closeSurface()
  }
  window.addEventListener("pointerdown", onPointerDown, true)

  const onResize = (): void => {
    placeMark()
    // The docked width is a clamp of the viewport, so held room tracks it.
    if (pinned && dock !== null) holdRoom()
  }
  window.addEventListener("resize", onResize)

  wire.say(Watch(null), true)

  // Braced rather than a concise body: `say` reports whether the port took it,
  // and this is a surface that sends STATE — the next frame is whole, so a
  // dropped Sighted costs nothing and the answer is deliberately discarded here.
  const announce = (): void => {
    wire.say(Sighted(location.href, document.title, document.referrer), true)
  }
  announce()

  // Single-page navigation: the address changes with no new document, so the
  // Reading boundary has to be noticed here as well as in the background. The
  // surface goes with it — it is about the page it was opened on.
  /**
   * The fragment is not part of the Reading, so it must not close the surface.
   *
   * `Canonical` drops `#...` unconditionally, which means a fragment-only move
   * produces the *same* Subject — but this compared full `location.href` and
   * called `detach()`, so clicking any table-of-contents link took the panel
   * away and left the mark. That is the Wikipedia article in store shots 01
   * and 03: the panel closing on a heading click was reachable from the
   * screenshot we ship.
   *
   * Path and query changes are still real moves and still detach.
   */
  const withoutFragment = (href: string): string => {
    const cut = href.indexOf("#")
    return cut === -1 ? href : href.slice(0, cut)
  }

  let lastAddress = withoutFragment(location.href)
  const noticeMove = (): void => {
    const moved = withoutFragment(location.href)
    if (moved === lastAddress) return
    lastAddress = moved
    detach()
    announce()
  }
  window.addEventListener("popstate", noticeMove)
  window.addEventListener("hashchange", noticeMove)
  const watchTitle = new MutationObserver(noticeMove)
  const titleNode = document.querySelector("title")
  if (titleNode !== null) watchTitle.observe(titleNode, { childList: true })

  // ADR 0008: selection is owned here from day one. v1 reads none of it.
  const stopWatchingSelection = watchSelection(() => {})
  window.addEventListener("pagehide", () => {
    stopWatchingSelection()
    watchTitle.disconnect()
    window.removeEventListener("keydown", onKey, true)
    window.removeEventListener("pointerdown", onPointerDown, true)
    window.removeEventListener("resize", onResize)
    detach()
    wire.close()
  })
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  registration: "runtime",
  runAt: "document_idle",
  allFrames: false,
  main: mount
})
