/**
 * A real Chrome, with the real extension loaded, on a virtual display.
 *
 * This exists because the Node-level pipeline tests can prove the data is right
 * and still tell you nothing about whether anything appears on screen. An MV3
 * extension has failure modes that only exist in a browser: a service worker
 * that never registers, a content script blocked by the page's CSP, a Shadow
 * DOM that renders behind the host page, a manifest permission that was never
 * granted. None of those are visible from vitest.
 *
 * Two constraints shaped this:
 *
 *   - This machine has no desktop session (no DISPLAY, no Wayland), so Chrome
 *     runs under Xvfb. It is genuinely headed Chrome on a virtual display, not
 *     headless — `--load-extension` is ignored by Chrome 151's headless mode,
 *     which is the whole reason this file exists.
 *   - The profile is persistent and lives at a fixed path, so a run can be
 *     repeated, inspected, and reasoned about. It is NOT the reader's own Chrome
 *     profile — this never touches personal browsing data.
 */
import * as path from "node:path"
import * as fs from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium, type Browser, type BrowserContext, type Page, type Worker } from "playwright"

const here = path.dirname(fileURLToPath(import.meta.url))

/** The unpacked MV3 build, as produced by `wxt build`. */
export const EXTENSION_PATH = path.resolve(here, "../.output/chrome-mv3")

/**
 * The Safari-shaped build, loaded into Chrome to exercise the Safari surface.
 *
 * This is NOT Safari and nothing here pretends it is. What it is, is the only
 * way on this machine to run the branch Safari takes, in a browser, against
 * real DOM and real CSS — and that branch is not a corner case, it is the whole
 * product on two of the four targets ADR 0003 ships.
 *
 * It works because of one measured fact: `chrome.sidePanel` is `undefined`
 * unless the `sidePanel` permission is in the manifest, and `wxt build -b
 * safari` emits no such permission and no side-panel entrypoint. So
 * `armExtension`'s feature detection reports `in-page` from this build exactly
 * as it will on Safari, the mark opens its own surface, and the injected
 * overlay is drawn by the shipped code rather than by a flag we set for the
 * test. Measured, on both builds, before this was relied on:
 *
 *   chrome-mv3  sidePanel: "object",    open: "function"
 *   safari-mv3  sidePanel: "undefined", open: "undefined"
 *
 * What it does NOT check is anything Safari does differently from Chrome —
 * WebKit's layout, its extension lifetime, iOS's memory ceiling. Those still
 * need a Mac.
 */
export const SAFARI_EXTENSION_PATH = path.resolve(here, "../.output/safari-mv3")

/** A dedicated profile. Never the reader's own. */
export const PROFILE_PATH = path.resolve(here, "../.e2e-profile")

/** Where screenshots land, so a human can look at what the run actually saw. */
export const SHOTS_PATH = path.resolve(here, "../.e2e-shots")

export interface Harness {
  readonly context: BrowserContext
  /** The extension's runtime id, read off its own service worker. */
  readonly extensionId: string
  readonly worker: Worker
  readonly shot: (name: string) => Promise<string>
  /** Everything the background worker logged, including startup failures. */
  readonly workerLog: ReadonlyArray<string>
  /**
   * Every key on the reader's disk, read from the worker itself.
   *
   * The README tells the reader to run exactly this and look; so does this. It
   * is the ground truth for ADR 0012's claim about *provenance* — that a
   * Harvest-derived Mention may be persisted and a Lookup-derived one may not —
   * and that claim is about what is on the machine, not about which function was
   * called, so nothing short of reading the store can check it.
   */
  readonly storedKeys: () => Promise<ReadonlyArray<string>>
  readonly close: () => Promise<void>
}

/**
 * Launch Chrome with the extension loaded and wait until it is actually alive.
 *
 * "Alive" means its background service worker is LISTENING — not merely that
 * Chrome started, and not merely that a worker registered. That distinction is
 * the whole reason for the check at the bottom of this function: a background
 * that attaches no listeners still produces a healthy worker, a clean console
 * and a working `fetch`, and this harness used to call that launched. It is not
 * a claim about the product, and every check in `parle.e2e.ts` failed against
 * exactly that state while `e2e:smoke` reported OK.
 *
 * It answers "is anything listening", which is one of the two ways a background
 * can be inert. The other — listening and never acting on it — is what the
 * "asks Hacker News about the page" checks in `parle.e2e.ts` are for, and what
 * `src/app/Background.test.ts` catches in a second without a browser.
 */
export const launch = async (
  options: {
    readonly slowMo?: number
    readonly debugPort?: number
    /** Which build to load. Defaults to Chrome; see {@link SAFARI_EXTENSION_PATH}. */
    readonly extensionPath?: string
    /** Its own profile, so two builds can be run in one process without collision. */
    readonly profilePath?: string
    /**
     * `null` to let every page's viewport be the browser window's own.
     *
     * A trap that produces a confident wrong answer, so it is an option here
     * rather than something worked around at a call site. Playwright's default
     * pins each page with `Emulation.setDeviceMetricsOverride`, and a pinned
     * page reports the same `innerWidth` whatever the browser does around it —
     * so the one measurement that tells the browser's side panel apart from an
     * overlay, *does the article's own viewport shrink to make room*, reads as
     * "no" against a panel that is demonstrably working.
     *
     * Measured, because the obvious workaround does not work either: clearing
     * the override from a second CDP session leaves the page pinned at 1280
     * even after `Browser.setWindowBounds` resizes the window to 900. Playwright
     * owns that override and only `viewport: null` at launch avoids it.
     *
     * The cost is that `page.setViewportSize()` then throws, which is why the
     * design shots keep the default and photograph the panel from a run of
     * their own.
     */
    readonly viewport?: { readonly width: number; readonly height: number } | null
  } = {}
): Promise<Harness> => {
  const extensionPath = options.extensionPath ?? EXTENSION_PATH
  const profilePath = options.profilePath ?? PROFILE_PATH
  if (!fs.existsSync(extensionPath)) {
    throw new Error(
      `No build at ${extensionPath}. Run: pnpm --filter @parle/extension build`
    )
  }

  fs.mkdirSync(SHOTS_PATH, { recursive: true })

  /**
   * Throw away the profile's service-worker registration before every launch.
   *
   * Measured, and it invalidates every result taken without it: Chrome keeps the
   * background script it registered *in the profile*, and an unpacked extension
   * reloaded at the same manifest version does not replace it. A background
   * built with `console.info("MARKER-A")`, rebuilt to log `MARKER-B` and rerun
   * against this profile, logged `MARKER-A`. A run can therefore pass against
   * code that no longer exists, which is worse than no run at all — and it is
   * how a deliberately broken build was observed passing `e2e:smoke`.
   *
   * Only this directory goes. Cookies, history and the rest of the profile
   * survive, so a run is still repeatable and inspectable. It takes the
   * extension's own Cache API storage with it, which is the right default
   * anyway: the first-run checks are about a reader who has not answered yet,
   * and against a profile carrying `decided: true` they pass without testing
   * anything.
   */
  fs.rmSync(path.join(profilePath, "Default", "Service Worker"), {
    recursive: true,
    force: true
  })

  const context = await chromium.launchPersistentContext(profilePath, {
    // Headed. Xvfb supplies the display; see the file comment for why.
    headless: false,
    channel: "chromium",
    slowMo: options.slowMo ?? 0,
    viewport: options.viewport === undefined ? { width: 1280, height: 900 } : options.viewport,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=DisableLoadExtensionCommandLineSwitch",
      /**
       * A second CDP client, for the one target Playwright will not hand over.
       *
       * The toolbar popup is a real `page` target — `Target.getTargets` lists
       * it — but `context.pages()` never contains it, because Playwright does
       * not adopt extension popups into a persistent context. Connecting a
       * second client over the port does surface it, which is the only way to
       * photograph the surface as a popup rather than as a tab. Off unless a
       * caller asks, so the behaviour run is unaffected.
       */
      ...(options.debugPort === undefined ? [] : [`--remote-debugging-port=${options.debugPort}`])
    ]
  })


  // Attach diagnostics BEFORE awaiting the worker. A worker that throws during
  // startup does so within milliseconds of being created, so a handler attached
  // after `waitForEvent` resolves has already missed the only message that
  // matters. This cost an hour to learn.
  const workerLog: Array<string> = []
  const attach = (w: Worker) => {
    w.on("console", (m) => workerLog.push(`[${m.type()}] ${m.text()}`))
    w.on("pageerror", (e) => workerLog.push(`[ERROR] ${e.message}\n${e.stack ?? ""}`))
  }
  context.on("serviceworker", attach)
  context.serviceWorkers().forEach(attach)

  const existing = context.serviceWorkers()
  const worker = existing[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }))

  const extensionId = new URL(worker.url()).host

  /**
   * Is anything actually listening?
   *
   * The extension registers every listener during the worker's first turn, so
   * by the time Playwright can evaluate anything at all this is already true.
   * The retry tolerates the worker's script still loading — it is NOT waiting
   * for a late registration, and a fix that needed the wait would be no fix.
   */
  const listening = async (): Promise<Record<string, boolean>> =>
    worker.evaluate(() => ({
      "webNavigation.onCommitted": chrome.webNavigation.onCommitted.hasListeners(),
      "tabs.onUpdated": chrome.tabs.onUpdated.hasListeners(),
      "runtime.onConnect": chrome.runtime.onConnect.hasListeners()
    }))

  let attached: Record<string, boolean> = {}
  for (let attempt = 0; attempt < 20; attempt += 1) {
    attached = await listening().catch(() => ({}))
    if (Object.values(attached).length > 0 && Object.values(attached).every(Boolean)) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const silent = Object.entries(attached).filter(([, on]) => !on).map(([name]) => name)
  if (silent.length > 0 || Object.keys(attached).length === 0) {
    throw new Error(
      `The extension loaded but is not listening: ${silent.join(", ") || "the worker would not answer"}.\n` +
        `Its background registered no listeners, so no navigation will ever reach it.\n` +
        `Worker log:\n${workerLog.join("\n") || "  (silent — see background.ts on why silence is not health)"}`
    )
  }

  const shot = async (name: string): Promise<string> => {
    const page = context.pages()[0]
    const file = path.join(SHOTS_PATH, `${name}.png`)
    if (page) await page.screenshot({ path: file, fullPage: false })
    return file
  }

  /**
   * `caches.open("parle")` in the worker, decoded back into our own key space.
   *
   * `@parle/browser` stores each entry as a `Response` at
   * `https://parle.invalid/<encodeURIComponent(key)>` — `.invalid` is reserved
   * by RFC 2606, so nothing here can collide with a cached real address.
   */
  const storedKeys = async (): Promise<ReadonlyArray<string>> =>
    worker.evaluate(async () => {
      const globals = globalThis as { caches?: CacheStorage }
      if (globals.caches === undefined) return []
      const store = await globals.caches.open("parle")
      const held = await store.keys()
      return held.map((request) => decodeURIComponent(new URL(request.url).pathname.slice(1)))
    }).catch(() => [])

  return {
    context,
    extensionId,
    worker,
    shot,
    workerLog,
    storedKeys,
    close: () => context.close()
  }
}

/** Open the extension's own popup as a page, which is how it renders in tests. */
export const openPanel = async (h: Harness, forTabUrl?: string) => {
  const page = await h.context.newPage()
  const query = forTabUrl ? `?subject=${encodeURIComponent(forTabUrl)}` : ""
  await page.goto(`chrome-extension://${h.extensionId}/popup.html${query}`)
  return page
}

/** Open the options page. */
export const openOptions = async (h: Harness) => {
  const page = await h.context.newPage()
  await page.goto(`chrome-extension://${h.extensionId}/options.html`)
  return page
}

/**
 * Does this build have the browser's own panel to open?
 *
 * Read off the loaded extension rather than off the file we told Chrome to
 * load, so it is the same question `armExtension` asks itself.
 */
export const hasNativeAside = async (h: Harness): Promise<boolean> =>
  h.worker.evaluate(() =>
    typeof (chrome as unknown as { sidePanel?: { open?: unknown } }).sidePanel?.open === "function"
  ).catch(() => false)

/**
 * Whichever container this build actually shows the Discussions in.
 *
 * The point of the whole arrangement is that the rendering does not change with
 * the container, so the checks about what the reader READS should not change
 * either. They are written once against this and run against the browser's own
 * panel on Chrome and against the injected overlay on the Safari-shaped build —
 * and a check that passes on one and fails on the other is exactly the drift
 * worth being told about.
 *
 * {@link PillPanel} already satisfies it; {@link asideSurface} wraps the panel
 * document in it.
 */
export interface Surface {
  readonly text: () => Promise<string>
  readonly count: (selector: string) => Promise<number>
  readonly click: (selector: string) => Promise<boolean>
  readonly textOf: (selector: string) => Promise<string>
  readonly styleOf: (selector: string, property: string) => Promise<string>
  readonly attribute: (selector: string, name: string) => Promise<string | null>
}

/** The panel document as a {@link Surface} — no shadow root, so ordinary DOM. */
export const asideSurface = (page: Page): Surface => ({
  text: () => page.innerText(".parle").catch(() => ""),
  count: (selector) => page.locator(selector).count().catch(() => 0),
  textOf: (selector) => page.locator(selector).first().innerText({ timeout: 2_000 }).catch(() => ""),
  styleOf: (selector, property) =>
    page.locator(selector).first().evaluate(
      (node, name) => getComputedStyle(node).getPropertyValue(name),
      property
    ).catch(() => ""),
  attribute: (selector, name) =>
    page.locator(selector).first().getAttribute(name, { timeout: 2_000 }).catch(() => null),
  click: (selector) =>
    page.locator(selector).first().click({ timeout: 5_000 }).then(() => true, () => false)
})

/**
 * Is the browser's own panel beside the page open, and on what?
 *
 * Asked of Chrome rather than inferred from anything we drew. `getContexts` is
 * the extension's own view of its live documents, so a `SIDE_PANEL` in the list
 * means the browser really has one open — not that we called `open()`, not that
 * a promise resolved, and not that a screenshot has a light rectangle in it.
 * Every claim in this run about the panel being open goes through here.
 */
export const asidePanels = async (h: Harness): Promise<ReadonlyArray<string>> =>
  h.worker.evaluate(async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })
    return contexts.map((context) => context.documentUrl ?? "")
  }).catch(() => [])

/**
 * The panel document as a Page, for reading and photographing it.
 *
 * Same problem as the toolbar popup and the same answer: Playwright's
 * persistent context never adopts it, and a second CDP client sees it as an
 * ordinary page. Connect AFTER it is open — a client attached beforehand does
 * not reliably adopt a target that appears later, which costs an hour every
 * time it is rediscovered.
 *
 * The caller must have launched with `debugPort`.
 */
export const asideDocument = async (
  debugPort: number,
  tries = 12
): Promise<{ readonly page: Page; readonly remote: Browser } | null> => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const remote = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`).catch(() => null)
    if (remote !== null) {
      const found = remote.contexts()
        .flatMap((context) => context.pages())
        .find((page) => page.url().endsWith("sidepanel.html"))
      if (found !== undefined) return { page: found, remote }
      await remote.close().catch(() => {})
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return null
}

/**
 * The mark and its surface, from outside a shadow root that is deliberately
 * closed.
 *
 * `pill.content.ts` uses `mode: "closed"` on purpose — an open root is reachable
 * from the host page's own scripts, and this surface has to stay intact on pages
 * we have never seen. The cost is that nothing outside it can read it:
 * Playwright's selectors cannot pierce it, and neither can an init script, since
 * a content script's `Element.prototype` lives in its own isolated world.
 *
 * Flipping the mode for the test was the tempting way through and it is the
 * wrong one — it would mean the thing being checked is not the thing that ships.
 * So this asks the browser instead. `DOM.getDocument({ pierce: true })` returns
 * closed roots because DevTools has to be able to show them, and `resolveNode`
 * hands back the `ShadowRoot` itself as an object to call methods on. What comes
 * back is what the reader is looking at, drawn by the shipped code.
 *
 * `roots` is the one that can prove an ABSENCE. Counting `.parle-pill` says
 * nothing about a host element left behind holding an empty root, and "a page
 * with nothing gets no DOM from us at all" is a claim about the page rather
 * than about one selector — so the check that matters walks every shadow root
 * in the document, ours included, and expects to find none.
 */
export interface PillPanel {
  /** The surface's own text, or "" when it is not open. */
  readonly text: () => Promise<string>
  readonly count: (selector: string) => Promise<number>
  /**
   * A SYNTHETIC click — `element.click()` from inside the root.
   *
   * Fine for everything the surface does to itself, and **useless for anything
   * that needs a user gesture**. Measured on Chrome 151: a synthetic click on a
   * page where no real click has happened leaves `navigator.userActivation
   * .isActive` false and `event.isTrusted` false, and
   * `chrome.sidePanel.open()` called on the back of one is refused with
   * "`sidePanel.open()` may only be called in response to a user gesture." Use
   * {@link trustedClick} where the gesture is the thing under test.
   *
   * (The trap that makes this worth spelling out: a real click a couple of
   * seconds earlier leaves the frame activated for about five seconds, so a
   * synthetic click can appear to work. It is the earlier click doing it.)
   */
  readonly click: (selector: string) => Promise<boolean>
  readonly attribute: (selector: string, name: string) => Promise<string | null>
  /** One element's own text, or "" when there is no such element. */
  readonly textOf: (selector: string) => Promise<string>
  /**
   * What the browser actually resolved a property to, not what a rule asked for.
   *
   * The only way to catch a stylesheet that says one thing and paints another.
   * `.parle-source` declared `text-decoration: underline` and rendered without
   * one for as long as `.parle a { text-decoration: none }` out-specified it —
   * a state no assertion on `textContent` or on markup can reach, and one that
   * quietly cost ADR 0006 the visible half of its promise.
   */
  readonly styleOf: (selector: string, property: string) => Promise<string>
  /** Where an element inside the closed root actually is, in page coordinates. */
  readonly boxOf: (
    selector: string
  ) => Promise<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null>
  /** How many shadow roots are in this page at all, closed ones included. */
  readonly roots: () => Promise<number>
}

/**
 * Click something inside the closed shadow root the way a reader does.
 *
 * The mark is the gesture source for the browser's own side panel, and a
 * gesture is the one thing the CDP-inside-the-root route above cannot produce.
 * So this asks the root where the element is and then drives the mouse at it:
 * Playwright's `page.mouse` goes through `Input.dispatchMouseEvent`, which
 * Chrome treats as genuine input — `isTrusted` true, transient activation
 * granted — and that activation is what has to survive the hop into the
 * background.
 *
 * This is the only click in the suite that proves anything about the gesture,
 * and the check that uses it is the guard on the whole arrangement: move
 * `sidePanel.open()` out of the raw port listener and into an Effect fiber, and
 * this is what goes red.
 */
export const trustedClick = async (
  page: Page,
  pill: PillPanel,
  selector: string
): Promise<boolean> => {
  const box = await pill.boxOf(selector)
  if (box === null || box.width === 0) return false
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  return true
}

export const pillPanel = async (page: Page): Promise<PillPanel> => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("DOM.enable")
  await cdp.send("Runtime.enable")

  /** Every shadow root in the page, closed ones included. */
  const shadowRoots = async (): Promise<ReadonlyArray<number>> => {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true }) as {
      root: CdpNode
    }
    const found: Array<number> = []
    const walk = (node: CdpNode): void => {
      for (const shadow of node.shadowRoots ?? []) {
        found.push(shadow.backendNodeId)
        walk(shadow)
      }
      for (const child of node.children ?? []) walk(child)
      for (const child of node.contentDocument === undefined ? [] : [node.contentDocument]) {
        walk(child)
      }
    }
    walk(root)
    return found
  }

  /** Run one function against every shadow root, and take the first real answer. */
  const inEach = async <A>(
    body: string,
    args: ReadonlyArray<unknown>,
    empty: A
  ): Promise<A> => {
    for (const backendNodeId of await shadowRoots()) {
      const resolved = await cdp.send("DOM.resolveNode", { backendNodeId }).catch(() => null) as
        | { object: { objectId?: string } }
        | null
      const objectId = resolved?.object.objectId
      if (objectId === undefined) continue
      const answer = await cdp.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: body,
        arguments: args.map((value) => ({ value })),
        returnByValue: true
      }).catch(() => null) as { result?: { value?: A } } | null
      const value = answer?.result?.value
      if (value !== undefined && value !== null && value !== empty) return value
    }
    return empty
  }

  return {
    roots: async () => (await shadowRoots()).length,
    text: () =>
      inEach(
        `function () { const d = this.querySelector(".parle-dock"); return d === null ? "" : d.innerText }`,
        [],
        ""
      ),
    count: (selector) =>
      inEach(`function (s) { return this.querySelectorAll(s).length }`, [selector], 0),
    textOf: (selector) =>
      inEach(
        `function (s) { const e = this.querySelector(s); return e === null ? "" : e.textContent }`,
        [selector],
        ""
      ),
    styleOf: (selector, property) =>
      inEach(
        `function (s, p) { const e = this.querySelector(s); return e === null ? "" : getComputedStyle(e).getPropertyValue(p) }`,
        [selector, property],
        ""
      ),
    click: (selector) =>
      inEach(
        `function (s) { const e = this.querySelector(s); if (e === null) return false; e.click(); return true }`,
        [selector],
        false
      ),
    boxOf: (selector) =>
      inEach<{ x: number; y: number; width: number; height: number } | null>(
        `function (s) { const e = this.querySelector(s); if (e === null) return null;` +
          ` const r = e.getBoundingClientRect();` +
          ` return { x: r.x, y: r.y, width: r.width, height: r.height } }`,
        [selector],
        null
      ),
    attribute: (selector, name) =>
      inEach<string | null>(
        `function (s, a) { const e = this.querySelector(s); return e === null ? null : e.getAttribute(a) }`,
        [selector, name],
        null
      )
  }
}

/** As much of a CDP `DOM.Node` as the walk above needs. */
interface CdpNode {
  readonly backendNodeId: number
  readonly children?: ReadonlyArray<CdpNode>
  readonly shadowRoots?: ReadonlyArray<CdpNode>
  readonly contentDocument?: CdpNode
}
