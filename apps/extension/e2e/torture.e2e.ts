/**
 * The adversarial runs: runtime abuse no other check exercises.
 *
 * `pnpm --filter @parle/extension e2e:torture`
 *
 * Every scenario here is a thing that HAPPENS to an MV3 extension in the field
 * and that no unit test can reach: the platform kills the worker mid-flight,
 * the reader mashes back/forward, two tabs race on one Subject, settings move
 * under a Lookup, the disk fills or rots, the network goes away, the host page
 * fights back, the clock jumps. Each scenario is independent — its own Chrome,
 * its own profile — and each asserts on BEHAVIOUR: what went over the wire,
 * what is on the reader's disk, what a surface actually drew.
 *
 * **No request leaves this machine.** Algolia and Reddit are served by route
 * handlers inside the harness (`context.route` demonstrably intercepts the MV3
 * service worker's own `fetch` on this Playwright/Chromium pairing — measured
 * before this file relied on it), and every article is served at a fake
 * address nobody owns. ADR 0014's politeness ceiling is satisfied by
 * construction: sustained Algolia traffic from this suite is zero.
 *
 * **How the worker is killed**, because finding a way that works cost a spike:
 * a CDP session on any page, `ServiceWorker.enable` then
 * `ServiceWorker.stopAllWorkers`. Measured on Chromium 151 via Playwright
 * 1.62: the extension's background genuinely terminates (a marker planted on
 * `globalThis` is gone afterwards), the next navigation wakes a fresh worker
 * whose first turn re-arms every listener, and — the trap — Playwright emits
 * NO new `serviceworker` event for the revival and the OLD `Worker` handle
 * silently answers `evaluate` again. So nothing here trusts `h.worker` after a
 * kill: the living worker is re-read from `context.serviceWorkers()`, and
 * proof of death is the missing marker, never a dead handle.
 *
 * What scenario 1 proved before the fix it now guards: without the Lookup
 * Record wired, ten kills mid-Enquiry were ten fresh request budgets for the
 * SAME Subject — the exact failure `LookupRecord`'s intend-before-request was
 * designed against, never once executed until this file ran. The wiring
 * (`Enquiry.consult` + `Pipeline.on`) gates on the two-minute lease alone;
 * `src/app/LookupLease.test.ts` holds the fine grain of that, and scenario 1
 * holds the browser truth of it.
 */
import * as path from "node:path"
import type { Page, Worker } from "playwright"
import {
  launch,
  openOptions,
  pillPanel,
  SAFARI_EXTENSION_PATH,
  SHOTS_PATH,
  trustedClick,
  type Harness
} from "./harness.ts"

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface Check {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

const checks: Array<Check> = []
let scenario = ""
const record = (name: string, ok: boolean, detail = "") => {
  checks.push({ name: `${scenario}: ${name}`, ok, detail })
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const until = async (
  condition: () => boolean | Promise<boolean>,
  within = 20_000
): Promise<boolean> => {
  const deadline = Date.now() + within
  for (;;) {
    if (await condition()) return true
    if (Date.now() > deadline) return false
    await settle(250)
  }
}

// ---------------------------------------------------------------------------
// The served world
// ---------------------------------------------------------------------------

/** Pages that "Hacker News" has discussed, keyed on host+path. */
const DISCUSSED = new Map<string, ReadonlyArray<{ id: string; title: string; points: number; comments: number }>>()

const pageAddress = (host: string, pathname: string): string => `https://${host}${pathname}`

const ALPHA = pageAddress("parle-torture-alpha.com", "/story")
const ALPHA_TITLE = "Qvlmn Wrxtp Alpha 48213"
const ALPHA_SECOND = pageAddress("parle-torture-alpha.com", "/second")
const ALPHA_SECOND_TITLE = "Qvlmn Wrxtp Second 48214"
const ALPHA_THIRD = pageAddress("parle-torture-alpha.com", "/third")
const ALPHA_THIRD_TITLE = "Qvlmn Wrxtp Third 48215"
const BETA = pageAddress("parle-torture-beta.com", "/piece")
const BETA_TITLE = "Zzkrw Plvnt Beta 90311"
const GAMMA = pageAddress("parle-torture-gamma.com", "/note")
const GAMMA_TITLE = "Hjqld Mbvns Gamma 55712"
const DELTA = pageAddress("parle-torture-delta.com", "/report")
const DELTA_TITLE = "Trwpx Kkjhg Delta 33108"
const HOSTILE = pageAddress("parle-torture-hostile.com", "/trap")
const HOSTILE_TITLE = "Bwqzn Vfrml Hostile 77190"

DISCUSSED.set("parle-torture-alpha.com/story", [
  { id: "91000001", title: "Alpha, discussed at length", points: 212, comments: 87 },
  { id: "91000002", title: "Alpha, discussed again", points: 41, comments: 12 }
])
DISCUSSED.set("parle-torture-alpha.com/second", [
  { id: "91000003", title: "The second alpha page", points: 9, comments: 3 }
])
DISCUSSED.set("parle-torture-alpha.com/third", [
  { id: "91000004", title: "The third alpha page", points: 12, comments: 5 }
])
DISCUSSED.set("parle-torture-beta.com/piece", [
  { id: "92000001", title: "Beta, discussed once", points: 77, comments: 30 }
])
DISCUSSED.set("parle-torture-gamma.com/note", [
  { id: "93000001", title: "Gamma, discussed once", points: 15, comments: 4 }
])
DISCUSSED.set("parle-torture-delta.com/report", [
  { id: "94000001", title: "Delta, discussed once", points: 22, comments: 8 }
])
DISCUSSED.set("parle-torture-hostile.com/trap", [
  { id: "95000001", title: "Hostile, discussed once", points: 55, comments: 21 }
])

/**
 * The knobs a scenario turns mid-run, and the counters it asserts on.
 *
 * `delayMs` holds an Algolia/Reddit answer open, which is how "in flight" is
 * made long enough to kill a worker inside. `down` makes the wire refuse —
 * `route.abort("internetdisconnected")` reaches the service worker's `fetch`
 * as a genuine TransportError, which is the same seam a dead Wi-Fi is.
 */
interface World {
  delayMs: number
  down: boolean
  readonly algolia: Array<string>
  readonly reddit: Array<string>
}

const stubWorld = async (h: Harness): Promise<World> => {
  const world: World = { delayMs: 0, down: false, algolia: [], reddit: [] }

  const hitsFor = (query: string) => {
    try {
      const url = new URL(query)
      const rows = DISCUSSED.get(`${url.hostname.replace(/^www\./, "")}${url.pathname}`) ?? []
      return rows.map((row) => ({
        objectID: row.id,
        title: row.title,
        url: query,
        author: "torture",
        created_at_i: Math.floor(Date.now() / 1000) - 7200,
        points: row.points,
        num_comments: row.comments
      }))
    } catch {
      return []
    }
  }

  await h.context.route("**://hn.algolia.com/**", async (route) => {
    world.algolia.push(route.request().url())
    if (world.delayMs > 0) await settle(world.delayMs)
    if (world.down) return route.abort("internetdisconnected").catch(() => {})
    const url = new URL(route.request().url())
    const linked = (url.searchParams.get("restrictSearchableAttributes") ?? "") === "url"
    const hits = linked ? hitsFor(url.searchParams.get("query") ?? "") : []
    return route
      .fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ hits, nbHits: hits.length, hitsPerPage: 50 })
      })
      .catch(() => {})
  })

  await h.context.route(/reddit\.com/, async (route) => {
    world.reddit.push(route.request().url())
    if (world.delayMs > 0) await settle(world.delayMs)
    if (world.down) return route.abort("internetdisconnected").catch(() => {})
    return route
      .fulfill({ status: 403, contentType: "text/html", body: "<html>blocked</html>" })
      .catch(() => {})
  })

  return world
}

const servePage = (h: Harness, address: string, title: string, extra = "") =>
  h.context.route(address, (route) =>
    route
      .fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
          `<style>body{font:16px/1.6 system-ui;margin:0;padding:48px}</style>` +
          `<h1>${title}</h1><p>Served by the torture harness.</p>${extra}`
      })
      .catch(() => {}))

/** Answer the first-run question the way a reader who said yes would. */
const agree = async (h: Harness) => {
  const welcome = await h.context.newPage()
  await welcome.goto(`chrome-extension://${h.extensionId}/welcome.html`)
  await welcome.bringToFront()
  await welcome.locator("#on").click().catch(() => {})
  await settle(800)
  await welcome.close()
}

const read = async (page: Page, address: string) => {
  await page.bringToFront()
  await page.goto(address, { waitUntil: "domcontentloaded" }).catch(() => {})
}

// ---------------------------------------------------------------------------
// Killing the worker
// ---------------------------------------------------------------------------

/** The worker that is actually alive now — never a handle from before a kill. */
const livingWorker = (h: Harness): Worker | undefined => h.context.serviceWorkers()[0]

/**
 * Terminate the background service worker the way MV3 does: no warning, no
 * finalizers. See the file header for how this was found and what it leaves
 * behind.
 */
const kill = async (h: Harness, page: Page) => {
  const cdp = await h.context.newCDPSession(page)
  await cdp.send("ServiceWorker.enable")
  await cdp.send("ServiceWorker.stopAllWorkers")
  await cdp.detach().catch(() => {})
  await settle(400)
}

const markWorker = (h: Harness) =>
  livingWorker(h)?.evaluate(() => {
    ;(globalThis as { __parleTortureMark?: boolean }).__parleTortureMark = true
  }).catch(() => {})

const markerGone = async (h: Harness): Promise<boolean> => {
  const worker = livingWorker(h)
  if (worker === undefined) return true
  return worker
    .evaluate(() => (globalThis as { __parleTortureMark?: boolean }).__parleTortureMark === undefined)
    .catch(() => true)
}

const listenersArmed = async (h: Harness): Promise<boolean> => {
  const worker = livingWorker(h)
  if (worker === undefined) return false
  return worker
    .evaluate(() => ({
      nav: chrome.webNavigation.onCommitted.hasListeners(),
      tabs: chrome.tabs.onUpdated.hasListeners(),
      connect: chrome.runtime.onConnect.hasListeners()
    }))
    .then((armed) => Object.values(armed).every(Boolean), () => false)
}

const workerErrors = (h: Harness): ReadonlyArray<string> =>
  h.workerLog.filter((line) => line.startsWith("[ERROR]"))

/** Move the living worker's clock. Patches `Date.now`, which is what every read of Effect's Clock resolves to at call time. */
const skewClock = (h: Harness, byMs: number) =>
  livingWorker(h)?.evaluate((skew) => {
    const real = Date.now.bind(Date)
    Date.now = () => real() + skew
  }, byMs)

/**
 * The toolbar's one-line account of a tab, read off the button itself.
 *
 * `hintOf` in `background.ts` writes the panel's own sentence into the action
 * title on every frame the usher draws, so this is a real rendered surface —
 * the one a reader who never opens the popup still sees — and it is per-TAB,
 * which no popup opened as a page can be: a page-hosted popup carries its own
 * `tabId` on its port, so `Watch(null)` resolves to itself, by design. (That
 * dead end was measured here before this helper existed.)
 */
const actionHint = async (h: Harness, addressPrefix: string): Promise<string> => {
  const worker = livingWorker(h)
  if (worker === undefined) return ""
  return worker
    .evaluate(async (prefix) => {
      const tabs = await chrome.tabs.query({})
      const tab = tabs.find((t) => (t.url ?? "").startsWith(prefix))
      if (tab?.id === undefined) return ""
      return chrome.action.getTitle({ tabId: tab.id })
    }, addressPrefix)
    .catch(() => "")
}

const hintBecomes = (h: Harness, addressPrefix: string, fragment: string, within = 15_000) =>
  until(async () => (await actionHint(h, addressPrefix)).includes(fragment), within)

/** How many keys the Lookup Record holds on disk right now. */
const lookupKeys = async (h: Harness): Promise<number> =>
  (await h.storedKeys()).filter((key) => key.startsWith("parle/lookup/")).length

const profile = (name: string) => path.resolve(SHOTS_PATH, "..", `.e2e-profile-torture-${name}`)

// ---------------------------------------------------------------------------
// Scenario 1: MV3 worker death mid-Enquiry
// ---------------------------------------------------------------------------

const workerDeath = async () => {
  scenario = "worker death"
  console.log("\n=== 1. MV3 worker death mid-Enquiry ===\n")
  const h = await launch({ profilePath: profile("death") })
  try {
    const world = await stubWorld(h)
    world.delayMs = 8000
    await servePage(h, ALPHA, ALPHA_TITLE)
    await agree(h)

    const page = h.context.pages()[0] ?? (await h.context.newPage())
    await read(page, ALPHA)
    const inFlight = await until(() => world.algolia.length >= 2, 15_000)
    await settle(800)
    record(
      "Lookups are genuinely in flight before the first kill",
      inFlight,
      `${world.algolia.length} Algolia request(s) held open`
    )

    await markWorker(h)
    const atFirstKill = world.algolia.length
    const redditAtFirstKill = world.reddit.length

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await kill(h, page)
      await page.goto("about:blank").catch(() => {})
      await read(page, ALPHA)
      await settle(1000)
    }

    record(
      "the worker really died — a fresh global, not a survivor",
      await markerGone(h)
    )
    record(
      "the restarted worker re-armed every listener in its first turn",
      await listenersArmed(h)
    )

    const grownAlgolia = world.algolia.length - atFirstKill
    const grownReddit = world.reddit.length - redditAtFirstKill
    record(
      "ten kills do not produce ten fresh request budgets — the intent survives the worker",
      grownAlgolia === 0 && grownReddit === 0,
      `${grownAlgolia} Algolia and ${grownReddit} Reddit request(s) across 9 revisits after the first kill ` +
        `(${atFirstKill} Algolia before it)`
    )

    // The recovered surface, read off the toolbar button — the account every
    // frame writes and the reader sees without opening anything. Under held
    // leases the truthful sentence is the over-budget restraint's own.
    const recovered = await hintBecomes(h, "https://parle-torture-alpha.com", "stopped for now")
    record(
      "the panel recovers and says the true, overridable thing",
      recovered,
      await actionHint(h, "https://parle-torture-alpha.com")
    )

    // The other half of the guard: it is a LEASE, not a verdict. Once the
    // window passes the Subject is asked again and the mark comes back — the
    // crash cost one window, never the feature. The clock is moved instead of
    // waited on (the lease is two minutes; the skew is six) — and the worker
    // is killed FIRST, because the warm Enquiry's idle teardown is a real
    // `setTimeout` that no clock patch can shorten, and a rejoined warm entry
    // never re-runs its Lookups at all.
    world.delayMs = 0
    await kill(h, page)
    await page.goto("about:blank").catch(() => {})
    await settle(800)
    await skewClock(h, 6 * 60 * 1000)
    const beforeExpiry = world.algolia.length
    await read(page, ALPHA)
    const reasked = await until(() => world.algolia.length > beforeExpiry, 20_000)
    const pill = await pillPanel(page)
    const markBack = await until(async () => (await pill.count(".parle-pill")) > 0, 25_000)
    record(
      "after the lease window the Subject is asked again and the mark returns",
      reasked && markBack,
      `${world.algolia.length - beforeExpiry} request(s) after expiry; mark drawn: ${markBack}`
    )
    record("no worker-side errors across ten violent restarts", workerErrors(h).length === 0, workerErrors(h).join(" | ").slice(0, 200))
  } finally {
    await h.close()
  }
}

// ---------------------------------------------------------------------------
// Scenario 2: rapid navigation
// ---------------------------------------------------------------------------

const rapidNavigation = async () => {
  scenario = "rapid navigation"
  console.log("\n=== 2. Rapid navigation: 20 back/forward flips in ~10s ===\n")
  const h = await launch({ profilePath: profile("rapid") })
  try {
    const world = await stubWorld(h)
    await servePage(h, ALPHA, ALPHA_TITLE)
    await servePage(h, BETA, BETA_TITLE)
    await agree(h)

    const page = h.context.pages()[0] ?? (await h.context.newPage())
    await read(page, ALPHA)
    await until(() => world.algolia.length >= 2, 15_000)
    await settle(2000)
    await read(page, BETA)
    await until(() => world.algolia.length >= 4, 15_000)
    await settle(2000)
    const afterFirstVisits = world.algolia.length

    const heapBefore = await livingWorker(h)
      ?.evaluate(() => (performance as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize)
      .catch(() => undefined)

    const started = Date.now()
    for (let flip = 0; flip < 20; flip += 1) {
      await (flip % 2 === 0 ? page.goBack() : page.goForward()).catch(() => {})
      await settle(350)
    }
    const took = Date.now() - started

    const grown = world.algolia.length - afterFirstVisits
    record(
      "twenty flips cost zero further Lookups — the warm Enquiry is rejoined, not restarted",
      grown === 0,
      `${grown} request(s) during ${took}ms of flipping; ${afterFirstVisits} for the two first visits`
    )

    const heapAfter = await livingWorker(h)
      ?.evaluate(() => (performance as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize)
      .catch(() => undefined)
    if (typeof heapBefore === "number" && typeof heapAfter === "number") {
      record(
        "the worker heap did not balloon",
        heapAfter < heapBefore * 3 + 8_000_000,
        `${heapBefore} -> ${heapAfter} bytes`
      )
    } else {
      // `performance.memory` is a Window-only Chrome API and this worker does
      // not expose it; the leak is bounded instead by the request count above
      // and the responsiveness below, and that is said rather than hidden.
      const alive = Date.now()
      const answers = await livingWorker(h)?.evaluate(() => true).catch(() => false)
      record(
        "the worker is still responsive after the storm (heap not measurable here)",
        answers === true && Date.now() - alive < 2_000,
        "performance.memory is not exposed in a service worker"
      )
    }

    record(
      "the reader ends on the page they ended on",
      page.url().startsWith(BETA),
      page.url()
    )
    // Beta has one discussion, alpha has two; the toolbar's account of the tab
    // must carry beta's number, not a stale frame from a page flipped through.
    const rightPage = await hintBecomes(h, "https://parle-torture-beta.com", "1 discussion")
    const hint = await actionHint(h, "https://parle-torture-beta.com")
    record(
      "and the toolbar describes that page, not one flipped through",
      rightPage && !hint.includes("2 discussions"),
      hint
    )
    record("no worker-side errors", workerErrors(h).length === 0, workerErrors(h).join(" | ").slice(0, 200))
  } finally {
    await h.close()
  }
}

// ---------------------------------------------------------------------------
// Scenario 3: two tabs, one Subject
// ---------------------------------------------------------------------------

const twoTabs = async () => {
  scenario = "two tabs"
  console.log("\n=== 3. Two tabs, one Subject (Safari-shaped build, so each tab draws its own surface) ===\n")
  const h = await launch({
    extensionPath: SAFARI_EXTENSION_PATH,
    profilePath: profile("twotabs")
  })
  try {
    const world = await stubWorld(h)
    await servePage(h, ALPHA, ALPHA_TITLE)
    await agree(h)

    const one = h.context.pages()[0] ?? (await h.context.newPage())
    await read(one, ALPHA)
    const pillOne = await pillPanel(one)
    await until(async () => (await pillOne.count(".parle-pill")) > 0, 30_000)
    await settle(1000)
    const afterOne = world.algolia.length

    const two = await h.context.newPage()
    await read(two, ALPHA)
    const pillTwo = await pillPanel(two)
    const secondMarked = await until(async () => (await pillTwo.count(".parle-pill")) > 0, 30_000)

    record(
      "the second tab joins the first tab's Enquiry — one set of Lookups, not two",
      world.algolia.length === afterOne,
      `${world.algolia.length - afterOne} extra request(s) for the second tab; ${afterOne} total`
    )
    record("both tabs get the mark", secondMarked)

    await two.bringToFront()
    await trustedClick(two, pillTwo, ".parle-pill")
    await settle(1200)
    const dockTwo = await pillTwo.count(".parle-dock")
    const discussionsTwo = await pillTwo.count("a.parle-room-title")

    await one.bringToFront()
    await trustedClick(one, pillOne, ".parle-pill")
    await settle(1200)
    const dockOne = await pillOne.count(".parle-dock")
    const discussionsOne = await pillOne.count("a.parle-room-title")

    record(
      "both panels are open at once and both drew the discussions",
      dockOne === 1 && dockTwo === 1 &&
        discussionsOne > 0 && discussionsOne === discussionsTwo,
      `tab one: ${discussionsOne} discussion(s); tab two: ${discussionsTwo}`
    )

    await two.close()
    await settle(1000)
    record(
      "closing one tab does not tear down the other's view",
      (await pillOne.count(".parle-dock")) === 1 &&
        (await pillOne.count("a.parle-room-title")) === discussionsOne,
      `${await pillOne.count("a.parle-room-title")} discussion(s) still drawn`
    )
    record("no worker-side errors", workerErrors(h).length === 0, workerErrors(h).join(" | ").slice(0, 200))
  } finally {
    await h.close()
  }
}

// ---------------------------------------------------------------------------
// Scenario 4: settings flipped mid-flight
// ---------------------------------------------------------------------------

const settingsMidFlight = async () => {
  scenario = "settings mid-flight"
  console.log("\n=== 4a. A Network switched off while its Lookup is in flight ===\n")
  const h = await launch({ profilePath: profile("settings") })
  try {
    const world = await stubWorld(h)
    world.delayMs = 3000
    await servePage(h, ALPHA, ALPHA_TITLE)
    await servePage(h, BETA, BETA_TITLE)
    await agree(h)

    const page = h.context.pages()[0] ?? (await h.context.newPage())
    await read(page, ALPHA)
    await until(() => world.algolia.length >= 1, 15_000)

    // The Lookups are in the air. Turn both Networks off under them.
    const options = await openOptions(h)
    await options.getByRole("checkbox", { name: "Hacker News" }).first().uncheck()
    await settle(500)
    await options.getByRole("checkbox", { name: "Reddit" }).first().uncheck()
    await settle(4000)
    await options.close()
    record("no crash when the switches move under in-flight Lookups", workerErrors(h).length === 0, workerErrors(h).join(" | ").slice(0, 200))

    world.delayMs = 0
    const beforeNext = world.algolia.length
    const beforeNextReddit = world.reddit.length
    await read(page, BETA)
    await settle(4000)
    record(
      "the next decision honours the new settings — nobody is asked",
      world.algolia.length === beforeNext && world.reddit.length === beforeNextReddit,
      `${world.algolia.length - beforeNext} Algolia and ${world.reddit.length - beforeNextReddit} Reddit ` +
        `request(s) for the page read after the switches`
    )

    const truthful = await hintBecomes(
      h,
      "https://parle-torture-beta.com",
      "You switched Hacker News and Reddit off"
    )
    record(
      "and the surface says so in the reader's words",
      truthful,
      await actionHint(h, "https://parle-torture-beta.com")
    )
  } finally {
    await h.close()
  }

  console.log("\n=== 4b. A site paused while its panel is open (Safari-shaped build, so the surface is on the page) ===\n")
  scenario = "pause mid-open"
  const s = await launch({
    extensionPath: SAFARI_EXTENSION_PATH,
    profilePath: profile("pause")
  })
  try {
    const world = await stubWorld(s)
    await servePage(s, ALPHA, ALPHA_TITLE)
    await servePage(s, ALPHA_SECOND, ALPHA_SECOND_TITLE)
    await servePage(s, ALPHA_THIRD, ALPHA_THIRD_TITLE)
    await agree(s)

    const page = s.context.pages()[0] ?? (await s.context.newPage())
    await read(page, ALPHA)
    const pill = await pillPanel(page)
    await until(async () => (await pill.count(".parle-pill")) > 0, 30_000)
    await trustedClick(page, pill, ".parle-pill")
    await settle(1200)
    const open = (await pill.count(".parle-dock")) === 1

    // Low-frequency page actions moved under the compact toolbar's overflow.
    const menu = await pill.click(".parle-comments-more-actions")
    const paused = menu && await pill.click(".parle-comments-menu-item")
    await settle(1500)
    record(
      "pausing from the open panel neither crashes nor blanks the surface",
      open && paused && workerErrors(s).length === 0,
      workerErrors(s).join(" | ").slice(0, 200)
    )

    const beforePaused = world.algolia.length
    await read(page, ALPHA_SECOND)
    await settle(4000)
    record(
      "the pause is in force for the next page on that site",
      world.algolia.length === beforePaused,
      `${world.algolia.length - beforePaused} request(s) for a paused site's page`
    )

    // And the way back works: resume from the settings page, then the site is
    // looked up again.
    const options = await openOptions(s)
    await options.getByRole("button", { name: "Resume" }).first().click().catch(() => {})
    await settle(1000)
    await options.close()
    const beforeResume = world.algolia.length
    await read(page, ALPHA_THIRD)
    const resumed = await until(() => world.algolia.length > beforeResume, 15_000)
    record(
      "resuming takes effect without a restart",
      resumed,
      `${world.algolia.length - beforeResume} request(s) after resume`
    )
  } finally {
    await s.close()
  }
}

// ---------------------------------------------------------------------------
// Scenario 5: storage full / corrupt
// ---------------------------------------------------------------------------

const storageAbuse = async () => {
  scenario = "storage"
  console.log("\n=== 5. Storage: a corrupt settings document, then a starved quota ===\n")
  const h = await launch({ profilePath: profile("storage") })
  try {
    const world = await stubWorld(h)
    await servePage(h, ALPHA, ALPHA_TITLE)
    await servePage(h, BETA, BETA_TITLE)
    await servePage(h, GAMMA, GAMMA_TITLE)
    await servePage(h, DELTA, DELTA_TITLE)
    await agree(h)

    const page = h.context.pages()[0] ?? (await h.context.newPage())
    await read(page, ALPHA)
    const working = await until(() => world.algolia.length >= 2, 15_000)
    record("the baseline works before anything is abused", working)

    // Rot the settings document in place — the bytes any crashed write can
    // leave behind.
    await livingWorker(h)?.evaluate(async () => {
      const store = await caches.open("parle")
      await store.put(
        `https://parle.invalid/${encodeURIComponent("parle/settings/reader")}`,
        new Response("{ definitely not a settings document ][")
      )
    })

    const beforeCorrupt = world.algolia.length
    await read(page, BETA)
    const stillWorking = await until(() => world.algolia.length > beforeCorrupt, 15_000)
    record(
      "the running worker falls back to the last settings it actually read — the reader's yes still stands",
      stillWorking,
      `${world.algolia.length - beforeCorrupt} request(s) after corruption`
    )

    // A fresh lifetime has no last-known-good. The floor must be the SAFE
    // direction: ask nobody until the reader is asked again — never the
    // permissive defaults.
    await kill(h, page)
    const beforeFresh = world.algolia.length
    await read(page, GAMMA)
    await settle(5000)
    record(
      "a fresh lifetime over the corrupt document asks nobody at all",
      world.algolia.length === beforeFresh,
      `${world.algolia.length - beforeFresh} request(s) from the fresh worker`
    )

    // And nothing is unrecoverable: answering the question again writes a
    // clean document and the product comes back.
    await agree(h)
    const beforeRecovery = world.algolia.length
    await read(page, DELTA)
    const recovered = await until(() => world.algolia.length > beforeRecovery, 15_000)
    record("answering the first-run question again recovers everything", recovered)
    record("no worker-side errors through corruption and recovery", workerErrors(h).length === 0, workerErrors(h).join(" | ").slice(0, 200))

    // Quota starvation, if this Chromium honours the override for an extension
    // origin. Writes must fail; Lookups and the panel must not.
    const cdp = await h.context.newCDPSession(page)
    let writesFail = false
    try {
      await cdp.send("Storage.overrideQuotaForOrigin" as never, {
        origin: `chrome-extension://${h.extensionId}`,
        quotaSize: 1024
      } as never)
      writesFail = await livingWorker(h)?.evaluate(async () => {
        try {
          const store = await caches.open("parle")
          await store.put(
            "https://parle.invalid/torture-quota-probe",
            new Response("x".repeat(512 * 1024))
          )
          return false
        } catch {
          return true
        }
      }).catch(() => false) ?? false
    } catch {
      writesFail = false
    }
    if (writesFail) {
      const beforeStarved = world.algolia.length
      await read(page, ALPHA)
      await settle(1000)
      await read(page, BETA)
      const survives = await until(() => world.algolia.length > beforeStarved, 15_000)
      record(
        "with the disk refusing writes, Lookups and the panel still work",
        survives && workerErrors(h).length === 0,
        `${world.algolia.length - beforeStarved} request(s) under a 1KB quota`
      )
    } else {
      console.log(
        "  NOTE  quota starvation could not be arranged — Storage.overrideQuotaForOrigin did not make " +
          "this origin's writes fail, so that half is a measurement that did not happen, not a pass"
      )
    }
  } finally {
    await h.close()
  }
}

// ---------------------------------------------------------------------------
// Scenario 6: offline
// ---------------------------------------------------------------------------

const offline = async () => {
  scenario = "offline"
  console.log("\n=== 6. Offline: on a fresh page, and cut mid-Enquiry ===\n")
  const h = await launch({ profilePath: profile("offline") })
  try {
    const world = await stubWorld(h)
    await servePage(h, ALPHA, ALPHA_TITLE)
    await servePage(h, BETA, BETA_TITLE)
    await agree(h)

    world.down = true
    const page = h.context.pages()[0] ?? (await h.context.newPage())
    await read(page, ALPHA)
    await until(() => world.algolia.length >= 2, 15_000)

    // The refusal takes its honest time to land: transport failures are
    // retried a bounded number of times and Reddit's retries queue behind its
    // own pacing, so "settled" here is a matter of ten-odd seconds, measured.
    const rendered = await hintBecomes(h, "https://parle-torture-alpha.com", "could not find out", 30_000)
    record(
      "a Refusal is a rendered state, not a claim that nobody discussed the page",
      rendered,
      await actionHint(h, "https://parle-torture-alpha.com")
    )

    // "Never cached" is a fact about the disk once the attempt has settled:
    // every lease the attempt took out is discharged by its Refusal, and
    // nothing else about it is ever written.
    const discharged = await until(async () => (await lookupKeys(h)) === 0, 40_000)
    record(
      "a Refusal is never cached — nothing about the attempt stays on the disk",
      discharged,
      `${await lookupKeys(h)} lookup key(s) on disk`
    )

    // Cut mid-Enquiry this time: the answers get as far as being held open,
    // then the wire dies under them.
    world.down = false
    // Keep the answers observably in flight, without making every bounded
    // transport retry spend four seconds before it can discharge its lease.
    // At 4s this assertion raced the retry budget on slower machines and
    // reported the two live intents rather than the settled Refusals.
    world.delayMs = 1000
    const cut = world.algolia.length
    await read(page, BETA)
    await until(() => world.algolia.length > cut, 15_000)
    world.down = true
    const cutDischarged = await until(async () => (await lookupKeys(h)) === 0, 40_000)
    record(
      "a connection cut mid-Enquiry neither crashes nor writes anything down",
      workerErrors(h).length === 0 && cutDischarged,
      `${await lookupKeys(h)} key(s); ${workerErrors(h).join(" | ").slice(0, 160)}`
    )

    // Reconnect. The page is NOT reloaded: the worker is killed the way MV3
    // kills it anyway, and looking back at the tab is what re-sights it. The
    // refusal left no lease and no cache entry, so the fresh Enquiry asks
    // again — that is the recovery.
    world.down = false
    world.delayMs = 0
    await kill(h, page)
    const beforeRecovery = world.algolia.length
    const blank = await h.context.newPage()
    await blank.goto("about:blank").catch(() => {})
    await blank.bringToFront()
    await settle(600)
    await page.bringToFront()
    const reasked = await until(() => world.algolia.length > beforeRecovery, 20_000)
    const pill = await pillPanel(page)
    const marked = await until(async () => (await pill.count(".parle-pill")) > 0, 25_000)
    await blank.close()
    record(
      "on reconnect the page recovers without a reload — asked again, mark drawn",
      reasked && marked,
      `${world.algolia.length - beforeRecovery} request(s) after reconnect; mark: ${marked}`
    )
  } finally {
    await h.close()
  }
}

// ---------------------------------------------------------------------------
// Scenario 7: hostile page
// ---------------------------------------------------------------------------

const hostilePage = async () => {
  scenario = "hostile page"
  console.log("\n=== 7. A hostile host page (Safari-shaped build, so the whole surface is in-page) ===\n")
  const h = await launch({
    extensionPath: SAFARI_EXTENSION_PATH,
    profilePath: profile("hostile")
  })
  try {
    const world = await stubWorld(h)
    void world
    await servePage(
      h,
      HOSTILE,
      HOSTILE_TITLE,
      `<script>
        // A page that fights: no shadow roots for anyone, a fake extension
        // API, a DOM that never sits still, and a thief that reads every
        // shadow root it can reach.
        Element.prototype.attachShadow = function () { throw new Error("no shadow for you") }
        try {
          Object.defineProperty(window, "chrome", {
            value: { runtime: { sendMessage: () => { throw new Error("trap") }, id: "fake" } },
            configurable: false
          })
        } catch {}
        window.__stolen = []
        window.__hostErrors = []
        window.addEventListener("error", (e) => { window.__hostErrors.push(String(e.message)) })
        setInterval(() => {
          const noise = document.createElement("div")
          noise.textContent = "noise " + Math.random()
          document.body.appendChild(noise)
          while (document.body.children.length > 60) document.body.firstElementChild.remove()
          for (const el of document.querySelectorAll("*")) {
            if (el.shadowRoot) window.__stolen.push(el.shadowRoot.innerHTML)
          }
        }, 50)
      </script>`
    )
    await agree(h)

    const page = h.context.pages()[0] ?? (await h.context.newPage())
    const pageErrors: Array<string> = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    await read(page, HOSTILE)

    const pill = await pillPanel(page)
    const marked = await until(async () => (await pill.count(".parle-pill")) > 0, 30_000)
    record(
      "the mark still works — the page's attachShadow override cannot reach the isolated world",
      marked
    )

    await trustedClick(page, pill, ".parle-pill")
    await settle(1500)
    const discussions = await pill.count("a.parle-room-title")
    record(
      "the surface opens and draws on a DOM that never sits still",
      discussions > 0,
      `${discussions} discussion(s)`
    )

    await settle(4000)
    const stolen = await page.evaluate(() =>
      (window as unknown as { __stolen: ReadonlyArray<string> }).__stolen.length
    )
    const reachable = await page.evaluate(() => {
      let open = 0
      for (const el of document.querySelectorAll("*")) {
        if (el.shadowRoot !== null) open += 1
      }
      return open
    })
    record(
      "nothing the page runs can read the closed shadow root",
      stolen === 0 && reachable === 0,
      `${stolen} stolen fragment(s), ${reachable} reachable root(s)`
    )

    const ours = pageErrors.filter((message) => message.toLowerCase().includes("parle"))
    record(
      "no exception escapes our content script into the page",
      ours.length === 0,
      ours.join(" | ").slice(0, 160)
    )
    record(
      "the surface survives four seconds of DOM churn",
      (await pill.count(".parle-dock")) === 1 &&
        (await pill.count("a.parle-room-title")) === discussions,
      `${await pill.count("a.parle-room-title")} discussion(s) still drawn`
    )
    record("no worker-side errors", workerErrors(h).length === 0, workerErrors(h).join(" | ").slice(0, 200))
  } finally {
    await h.close()
  }
}

// ---------------------------------------------------------------------------
// Scenario 8: clock skew
// ---------------------------------------------------------------------------

const clockSkew = async () => {
  scenario = "clock skew"
  console.log("\n=== 8. Clock skew: eight days forward, past every TTL ===\n")
  const h = await launch({ profilePath: profile("clock") })
  try {
    const world = await stubWorld(h)
    await servePage(h, ALPHA, ALPHA_TITLE)
    await agree(h)

    const page = h.context.pages()[0] ?? (await h.context.newPage())
    await read(page, ALPHA)
    await until(() => world.algolia.length >= 2, 15_000)
    // One and exactly one, once everything settles: Hacker News's address
    // answer persists, while Reddit's refusals discharge their own leases.
    // Title search was removed, so there is no second topical record.
    const onRecord = await until(async () => (await lookupKeys(h)) === 1, 25_000)
    record(
      "a settled Enquiry leaves its answers on record under the named root",
      onRecord,
      `${await lookupKeys(h)} key(s) under parle/lookup/ (Hacker News address answer; Reddit's refusals dropped)`
    )

    // A fresh worker whose whole sense of "now" is eight days ahead — past the
    // 6h Hacker News retention, the 7d X floor, and every Silence rung.
    await kill(h, page)
    await page.goto("about:blank").catch(() => {})
    await settle(800)
    const skewed = await until(async () => {
      const worker = livingWorker(h)
      if (worker === undefined) return false
      await skewClock(h, 8 * 24 * 60 * 60 * 1000)
      return true
    }, 10_000)
    record("the fresh worker's clock was moved eight days forward", skewed)

    const beforeSkewedVisit = world.algolia.length
    await read(page, ALPHA)
    const reasked = await until(() => world.algolia.length > beforeSkewedVisit, 20_000)
    const pill = await pillPanel(page)
    const marked = await until(async () => (await pill.count(".parle-pill")) > 0, 25_000)
    record(
      "expired records expire gracefully — the Subject is asked again and the mark returns",
      reasked && marked,
      `${world.algolia.length - beforeSkewedVisit} request(s) under skew`
    )

    // One again once the skewed visit settles — the expired entry is replaced
    // under its own key, Reddit's fresh lease is discharged by its refusal,
    // and nothing is duplicated.
    const replaced = await until(async () => (await lookupKeys(h)) === 1, 25_000)
    record(
      "the record is replaced in place, not duplicated",
      replaced,
      `${await lookupKeys(h)} key(s) after the skewed visit`
    )
    record("nothing throws under skew", workerErrors(h).length === 0, workerErrors(h).join(" | ").slice(0, 200))
  } finally {
    await h.close()
  }
}

// ---------------------------------------------------------------------------

const main = async () => {
  console.log("\n=== Parle torture: the runs that abuse the runtime ===")
  const scenarios: ReadonlyArray<readonly [string, () => Promise<void>]> = [
    ["worker death", workerDeath],
    ["rapid navigation", rapidNavigation],
    ["two tabs", twoTabs],
    ["settings mid-flight", settingsMidFlight],
    ["storage", storageAbuse],
    ["offline", offline],
    ["hostile page", hostilePage],
    ["clock skew", clockSkew]
  ]

  /**
   * `TORTURE_ONLY="worker death"` (comma-separated names) runs a subset.
   *
   * For flakiness hunts: a scenario that passes once and fails on repetition is
   * a finding about the product, and repetition of one scenario must not cost
   * seven others' wall time per rep. Full suite when unset; an unknown name is
   * an error, never an empty green run.
   */
  const only = (process.env.TORTURE_ONLY ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "")
  const unknown = only.filter((name) => !scenarios.some(([known]) => known === name))
  if (unknown.length > 0) {
    console.error(`TORTURE_ONLY names no scenario: ${unknown.join(", ")}`)
    process.exit(1)
  }
  const chosen = only.length === 0 ? scenarios : scenarios.filter(([name]) => only.includes(name))
  if (chosen.length < scenarios.length) {
    console.log(`(TORTURE_ONLY: ${chosen.map(([name]) => name).join(", ")})`)
  }

  for (const [name, run] of chosen) {
    try {
      await run()
    } catch (error) {
      scenario = name
      record(
        "the scenario itself survived",
        false,
        error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
      )
    }
  }

  const failed = checks.filter((check) => !check.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} torture checks passed`)
  for (const check of failed) console.log(`  FAILED  ${check.name} — ${check.detail}`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error("\nTORTURE HARNESS FAILED:", error)
  process.exit(1)
})
