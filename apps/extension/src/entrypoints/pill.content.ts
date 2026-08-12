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
 * ## Why this surface still exists now that Chrome has a real side panel
 *
 * Because half the shipped targets still have no sidebar to use, and they are
 * the half ADR 0003 calls constraining. Safari has no such API on macOS or on
 * iOS, and there is no third API that docks anything beside page content. So
 * this is not a fallback and it is not deprecated: on Safari it is the entire
 * product, and iOS is the platform everything else is sized for. Nothing the
 * reader can do may exist only in the native panel.
 *
 * What HAS changed is one sentence. This file used to argue that a native
 * sidebar was the wrong choice; it is now measured to be the right one where it
 * exists — Chrome's really does sit beside the article and shrink the page's
 * own viewport to make room, which an injected overlay cannot do at any price.
 * The reasoning recorded here was never about that. It was about there being
 * nowhere to put it on two of the four targets, and that is still true.
 *
 * So the mark no longer assumes it owns what it opens. It is told, on every
 * frame, what this browser can put beside the page (`Standing.aside`), and it
 * either opens the surface below or asks the background to open the browser's
 * own. It never names a browser and never touches an extension API — the
 * branch is on a state that arrived over the wire, which is ADR 0011's shape
 * and keeps ADR 0003's `grep` honest.
 *
 * Where this surface IS the surface, the cost is that it does not survive
 * navigation, and that is the right behaviour rather than a limitation
 * absorbed: this surface is about the page it is on, so leaving the page should
 * close it. Note that the native panel is the opposite — it outlives tabs — and
 * that difference is real and is not abstracted away.
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
import type { AsideKind } from "../wire/Wire.ts"
import {
  Decide,
  LookAnyway,
  OpenAside,
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
 * `manual` rather than `auto`: an auto popover light-dismisses on a click
 * anywhere else, and the docked surface exists precisely so the reader can go
 * on using the page beside it. Escape and the close button are ours.
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
  /**
   * What this browser can put beside the page, as of the last frame.
   *
   * `in-page` until told otherwise, and the default is never read: the mark is
   * not created until a frame carrying a Discussion has arrived, and every
   * frame carries this. So there is no window in which the mark exists and this
   * is a guess.
   */
  let aside: AsideKind = "in-page"
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
   * must not share a path: opening the side panel needs the click's user
   * activation, and a drag that also fired `click` would open on every park.
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
   * What the mark does, which is not the same thing on every browser.
   *
   * Where the browser has a real surface beside the page, this says so and the
   * background opens it. **The `say` must happen in this handler's own turn**:
   * `chrome.sidePanel.open()` is only legal while the click's transient user
   * activation is live and only from the turn the message is delivered in, and
   * the whole chain from here to that call is synchronous for that reason —
   * measured to survive this exact hop, out of a closed shadow root, through
   * the port, into `platform/Extension.ts`. An `await` anywhere along it and
   * the mark stops working with no error the reader can see. Nothing may be
   * put in front of this line.
   *
   * It opens and never closes, and that is a decision rather than an omission.
   * The native panel is per-WINDOW and outlives this page; the mark is per-page
   * and dies with it. A mark that toggled would let a click on one tab shut the
   * panel another tab is reading, and the panel already has the browser's own
   * way out. Where the surface is ours it is per-page too, so there the mark
   * toggles, which is what it has always done.
   */
  const openFromMark = (): void => {
    if (aside === "native") {
      wire.say(OpenAside())
      return
    }
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
    // The wire carries more than one kind of word now; a surface that
    // assumed otherwise would read a field that is not there.
    if (word._tag !== "Standing") return
    standing = word.panel
    aside = word.aside
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
  window.addEventListener("resize", placeMark)

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
  let lastAddress = location.href
  const noticeMove = (): void => {
    if (location.href === lastAddress) return
    lastAddress = location.href
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
    window.removeEventListener("resize", placeMark)
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
