/**
 * End-to-end checks against a real Chrome with the real extension loaded.
 *
 * These assert on BEHAVIOUR — which Networks were contacted, with what address,
 * what is on the reader's disk, and what is on screen — rather than on DOM text
 * for its own sake. That is deliberate: the copy and markup are still moving,
 * but the guarantees below are the product's actual promises and several of them
 * are ADR-level commitments that no unit test can verify. In particular, "we did
 * not contact X", "we did not contact anyone about your bank", and "nothing had
 * been written to your disk before you answered the question" are claims about
 * network traffic and about storage, and the only honest place to check them is
 * in a browser.
 *
 * Three things are exercised here that a vitest run cannot reach at all:
 *
 *   - **Harvest**, which only exists because a content script is in the
 *     manifest. Whether it runs, whether it runs too early, and what it leaves
 *     behind are facts about Chrome loading an extension.
 *   - **The Digest**, end to end from the reader's click to a link they can
 *     follow, through the real service worker, the real comment fetch against
 *     Hacker News, the real `Byok` layer carrying the real key out of the real
 *     settings document. Only the endpoint that would charge somebody is local —
 *     and `baseUrl` is a supported setting, so even that is a configuration a
 *     reader running a local model actually has.
 *   - **The panel as drawn**, inside the pill's shadow root on a real page,
 *     which is the only place the reader ever sees any of this.
 */
import * as path from "node:path"
import type { Page } from "playwright"
import {
  asidePanels,
  hasNativeAside,
  launch,
  openOptions,
  openPanel,
  pillPanel,
  SAFARI_EXTENSION_PATH,
  SHOTS_PATH,
  type Harness,
  type Surface,
  trustedClick
} from "./harness.ts"
import { startProvider } from "./provider.ts"
import { ratesOf } from "./traffic.ts"

interface Check {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

/**
 * When each Algolia request left, across every harness this run launches.
 *
 * ADR 0014 meters this box's IP, and this suite runs beside sweeps in a QA
 * battery — so its closing report states its own measured share rather than
 * leaving "the behaviour run is small" as an article of faith. Stamps, not a
 * count, so the battery can merge them with other runners' the way the sweep
 * merges its shards'. Purely reporting; no check reads this.
 */
const algoliaStamps: Array<number> = []

/**
 * Every root the extension is allowed to write under, because the settings page
 * names each of them to the reader.
 *
 * A list rather than a predicate so that adding a store means adding a line
 * here AND a sentence there. `parle/frontdoor/` holds which addresses turned out
 * to be a site's front page, and `parle/memory/salt` is what conceals its keys —
 * both are named under "Forget only the record of what was looked up", and both
 * are cleared by it.
 */
const NAMED_ROOTS = [
  "parle/recollection/",
  "parle/settings/",
  "parle/frontdoor/",
  "parle/memory/salt",
  "parle/lookup/"
]

const checks: Array<Check> = []
const record = (name: string, ok: boolean, detail = "") => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}

/** Every outbound request Chrome made, so we can assert on absence as well as presence. */
const watchTraffic = (h: Harness) => {
  const urls: Array<string> = []
  h.context.on("request", (r) => {
    urls.push(r.url())
    if (r.url().includes("hn.algolia.com")) algoliaStamps.push(Date.now())
  })
  return {
    urls,
    hit: (fragment: string) => urls.filter((u) => u.includes(fragment)),
    reset: () => (urls.length = 0)
  }
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Wait for something to become true, or give up and let the check report it. */
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

/**
 * Navigate the tab the reader is actually looking at.
 *
 * Parle only mints a Reading for the tab in front — a deliberate restraint, and
 * the reason a link opened in a background tab costs nothing. Playwright's
 * `goto` does not focus a tab, so a check that navigates without this is really
 * asking "what does Parle do about a background tab", and answers to that are
 * silence whatever the extension is doing. This used to be true by luck: nothing
 * else ever opened a tab, because the disclosure that is supposed to open on
 * install was never reached. It is now, so the assumption has to be stated.
 */
const read = async (page: Page, address: string) => {
  await page.bringToFront()
  await page.goto(address, { waitUntil: "domcontentloaded" }).catch(() => {})
}

/**
 * `CONTEXT.md`, binding: Discussion, Digest, Finding, Spread and Provider are
 * the reader-facing terms; everything else in that file is how the code talks
 * about itself. This is the same pair of lists `src/view/render.test.ts` holds
 * the derivation to, applied to what a browser actually painted.
 */
const NEVER = [
  "subject",
  "alias",
  "enquiry",
  "mention",
  "observation",
  "consultation",
  "coverage",
  "withholding",
  "withheld",
  "garble",
  "garbled",
  "harvest",
  "brief",
  "citation",
  "watermark",
  "exclusion list"
]
const NEVER_CAPITALISED = [
  "Lookup",
  "Lookups",
  "Place",
  "Places",
  "Reading",
  "Network",
  "Networks",
  "Exclusion List",
  "Discussion Index",
  "Local Discussion Cache",
  "Silence",
  "Refusal",
  "Movement"
]

/** Which banned terms are in this text. The address is not our prose. */
const vocabularyIn = (text: string, address = ""): ReadonlyArray<string> => {
  const prose = address === "" ? text : text.split(address).join(" ")
  return [
    ...NEVER.filter((term) => new RegExp(`\\b${term}\\b`, "i").test(prose)),
    ...NEVER_CAPITALISED.filter((term) => prose.includes(term))
  ]
}

/** A stable Hacker News thread whose submitted address is the article below. */
const HN_THREAD = "https://news.ycombinator.com/item?id=40786237"
const ARTICLE = "https://www.nature.com/articles/d41586-024-02012-5"
const ARTICLE_MARK = "d41586-024-02012-5"
const KEY = "sk-parle-e2e-0000-DO-NOT-USE-1234567890"

/**
 * A page nobody has posted, under a title nobody has used.
 *
 * Served by the harness rather than fetched, so it is stable and offline; the
 * address is an ordinary public `https` one, so it is not on the exclusion list
 * and both Lookups really go out. Verified: Hacker News is asked about the
 * address and about the title, and answers with nothing to both.
 */
const QUIET = "https://parle-e2e-nobody-has-discussed-this.com/piece"
const QUIET_TITLE = "Zmbrqx Ttlpwd Kvvn 91827"

/**
 * A second served page, for the one check that needs the reader to move.
 *
 * Its own address rather than a reuse of {@link QUIET}: reading a Subject runs
 * its Enquiry once, and the quiet checks below assert that the Lookups for
 * THEIR page go out for the first time when they run.
 */
const ELSEWHERE = "https://parle-e2e-another-page.com/second"
const ELSEWHERE_TITLE = "Qwtrbn Flxkd Zzmv 33104"

/** For the second CDP client that reaches the panel document. See `harness.ts`. */
const DEBUG_PORT = 9412

/**
 * The same in-page surface, on the Safari-shaped build.
 *
 * Chrome and Safari now open the same dock. This pass still loads the Safari
 * artifact — see `SAFARI_EXTENSION_PATH` — so a future change that puts a
 * side-panel permission back on one target and not the other is visible here,
 * and so Escape / close / "nothing on an undiscussed page" stay checked on
 * the build ADR 0003 calls constraining.
 *
 * It is not Safari. It is the Safari branch, in a browser, drawn by shipped
 * code. What still needs a Mac is anything about WebKit itself.
 */
const overlayPass = async () => {
  console.log("\n=== The surface Safari and iOS get (the Safari-shaped build) ===\n")
  const h = await launch({
    extensionPath: SAFARI_EXTENSION_PATH,
    profilePath: path.resolve(SHOTS_PATH, "..", ".e2e-profile-safari")
  })
  // This harness's Lookups are as real as the main run's; stamp them too.
  h.context.on("request", (r) => {
    if (r.url().includes("hn.algolia.com")) algoliaStamps.push(Date.now())
  })
  try {
    record(
      "a build without the side-panel permission falls back to our own surface",
      !(await hasNativeAside(h))
    )
    const page = h.context.pages()[0] ?? (await h.context.newPage())
    const welcome = await h.context.newPage()
    await welcome.goto(`chrome-extension://${h.extensionId}/welcome.html`)
    await welcome.bringToFront()
    await welcome.locator("#on").click().catch(() => {})
    await settle(800)
    await welcome.close()

    // Served, for the same reason the Chrome run serves it: this pass is about
    // a real click reaching the mark, and nature.com's modal cookie dialog
    // makes that impossible. See the Chrome run for the measurement.
    await h.context.route(ARTICLE, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><meta charset="utf-8">` +
          `<title>Not all 'open source' AI models are actually open</title>` +
          `<h1>Not all 'open source' AI models are actually open</h1>`
      }))
    await read(page, ARTICLE)
    const pill = await pillPanel(page)
    const marked = await until(async () => (await pill.count(".parle-pill")) > 0, 40_000)
    record("puts a mark on a page that has discussions", marked)

    // Trusted, so this is the same click the Chrome run makes — and here it has
    // to open our own surface rather than ask for the browser's.
    await trustedClick(page, pill, ".parle-pill")
    await settle(1500)
    const discussions = await pill.count("a.parle-room-title")
    record(
      "the mark opens our own surface, on the page, where the browser has none",
      (await pill.count(".parle-dock")) === 1 && discussions > 0,
      `${discussions} discussion link(s)`
    )
    const desktopNav = await pill.boxOf(".parle-nav")
    const desktopBody = await pill.boxOf(".parle-body")
    record(
      "puts navigation above the discussion on desktop",
      desktopNav !== null && desktopBody !== null && desktopNav.y < desktopBody.y,
      `nav y=${desktopNav?.y ?? "missing"}; discussion y=${desktopBody?.y ?? "missing"}`
    )
    const desktopSettings = await pill.boxOf(".parle-nav-settings")
    const desktopClose = await pill.boxOf(".parle-close")
    record(
      "keeps Settings clear of the desktop overlay's close button",
      desktopSettings !== null && desktopClose !== null &&
        desktopSettings.x + desktopSettings.width <= desktopClose.x,
      `Settings right=${desktopSettings === null ? "missing" : desktopSettings.x + desktopSettings.width}; ` +
        `close left=${desktopClose?.x ?? "missing"}`
    )
    await h.shot("07-overlay-safari-shaped")

    await page.setViewportSize({ width: 390, height: 844 })
    await settle(500)
    const mobileNav = await pill.boxOf(".parle-nav")
    const mobileBody = await pill.boxOf(".parle-body")
    record(
      "keeps navigation below the discussion on a phone",
      mobileNav !== null && mobileBody !== null && mobileNav.y > mobileBody.y,
      `discussion y=${mobileBody?.y ?? "missing"}; nav y=${mobileNav?.y ?? "missing"}`
    )

    await page.bringToFront()
    await page.keyboard.press("Escape")
    await settle(500)
    record(
      "Escape closes the surface and leaves the mark",
      (await pill.count(".parle-dock")) === 0 && (await pill.count(".parle-pill")) === 1
    )
    await trustedClick(page, pill, ".parle-pill")
    await settle(700)
    const reopened = (await pill.count(".parle-dock")) === 1
    await pill.click(".parle-close")
    await settle(500)
    record(
      "the close button closes it too, and it can be opened again",
      reopened && (await pill.count(".parle-dock")) === 0
    )

    // The promise this surface is built around, and the one the browser's panel
    // cannot make: a page with nothing gets no node of ours in it at all.
    await h.context.route(QUIET, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><title>${QUIET_TITLE}</title><p>A page nobody has discussed.</p>`
      }))
    const quiet = await h.context.newPage()
    await read(quiet, QUIET)
    await settle(6000)
    const quietPage = await pillPanel(quiet)
    record(
      "puts nothing at all on a page nobody has discussed",
      (await quietPage.roots()) === 0,
      `${await quietPage.roots()} shadow root(s)`
    )
  } finally {
    await h.close()
  }
}

const main = async () => {
  console.log("\n=== Parle end-to-end ===\n")
  const h = await launch({ debugPort: DEBUG_PORT })
  console.log(`extension ${h.extensionId}\n`)
  const traffic = watchTraffic(h)
  const provider = await startProvider()
  const page = h.context.pages()[0] ?? (await h.context.newPage())
  record(
    "the Chrome build has no native side panel to open",
    !(await hasNativeAside(h))
  )

  // ------------------------------------------------------------- first run
  // A fresh profile has `decided: false`, and until the reader has been ASKED
  // nothing automatic runs whatever the default says. That is the whole
  // compliance posture — disclosure before collection — so a harness that skips
  // it is not testing the product, it is testing an unconfigured one. This cost
  // a false "the extension is inert" conclusion before it was understood.
  console.log("First run — the reader is asked before anything is looked up:")
  const welcome = await h.context.newPage()
  await welcome.goto(`chrome-extension://${h.extensionId}/welcome.html`)
  const asked = await welcome.locator("#on").count()
  record("the first-run screen offers a real choice", asked > 0)

  traffic.reset()
  await settle(1500)
  record(
    "asks nobody at all before the reader has answered",
    traffic.hit("hn.algolia.com").length === 0
  )

  // The harvester is IN the manifest, unlike the pill, so it starts the first
  // time the reader opens one of the three Networks — whether or not they have
  // read anything. Resolving a shortened link is a real request to a third
  // party, and the rows it keeps go to disk. Both must wait for the answer.
  await read(page, HN_THREAD)
  await settle(4000)
  const earlyKeys = await h.storedKeys()
  record(
    "harvests nothing, and stores nothing, before the reader has answered",
    earlyKeys.filter((k) => k.startsWith("parle/recollection/")).length === 0,
    `${earlyKeys.length} key(s) on disk: ${earlyKeys.join(", ") || "none"}`
  )
  await welcome.screenshot({ path: path.join(SHOTS_PATH, "00-first-run.png") }).catch(() => {})
  await welcome.bringToFront()
  await welcome.locator("#on").click()
  await settle(800)
  await welcome.close()

  // ---------------------------------------------------------------- discovery
  // Done BEFORE anything is harvested, so that what is on the disk afterwards
  // has exactly one possible provenance.
  console.log("\nA page that Hacker News has discussed:")
  traffic.reset()
  await read(page, ARTICLE)
  await settle(6000)

  const algolia = traffic.hit("hn.algolia.com")
  record("asks Hacker News about the page", algolia.length > 0, `${algolia.length} request(s)`)
  record(
    "sends the canonicalized address, not the raw one",
    algolia.some((u) => u.includes("nature.com")),
    algolia[0]?.slice(0, 110) ?? "none"
  )
  record(
    "does not contact X — no Linked Mention yet, and the gate is shut",
    traffic.hit("x.com").length === 0 && traffic.hit("api.twitter").length === 0
  )
  await h.shot("01-article")

  // The whole of ADR 0012's disclosure argument, on the actual bytes. That page
  // was looked up and Hacker News answered with real Mentions; nothing has been
  // harvested yet, so the Local Discussion Cache must still be empty. A cache
  // filled by Lookups would be a dated record of everywhere the reader went.
  const afterLookup = await h.storedKeys()
  record(
    "writes nothing a Lookup produced to the reader's disk",
    afterLookup.filter((k) => k.startsWith("parle/recollection/")).length === 0,
    afterLookup.join(", ") || "nothing at all"
  )
  record(
    "keeps what it does write under the roots the disclosure names",
    afterLookup.every((k) => NAMED_ROOTS.some((root) => k.startsWith(root))),
    afterLookup.filter((k) => !NAMED_ROOTS.some((root) => k.startsWith(root))).join(", ") ||
      "all accounted for"
  )

  // The toolbar surface. Opened as a page, it describes its own tab — which is
  // one of ours, and therefore a page Parle will not look up. That is a real
  // ADR 0011 state and the strictest one to draw: there is nothing to report,
  // and it still has to say the specific true thing and offer no button that
  // would do nothing.
  const panel = await openPanel(h)
  await settle(2500)
  const panelText = await panel.innerText("body").catch(() => "")
  record("the toolbar surface renders something", panelText.trim().length > 0, `${panelText.trim().length} chars`)
  record(
    "says why it will not look a page up, and offers no button that would do nothing",
    panelText.includes("not a public web page") &&
      (await panel.locator(".parle-act").count()) === 0,
    panelText.split("\n").find((l) => l.includes("public web page")) ?? panelText.slice(0, 120)
  )
  record(
    "the toolbar surface is the account, not a second list of discussions",
    (await panel.locator(".parle-row").count()) === 0
  )
  const panelLeak = vocabularyIn(panelText)
  record("no engineering vocabulary reaches the toolbar surface", panelLeak.length === 0, panelLeak.join(", "))
  await panel.screenshot({ path: path.join(SHOTS_PATH, "02-panel.png") }).catch(() => {})
  await panel.close()

  // ---------------------------------------------------------------- harvest
  // ADR 0012: the cache is filled by the reader browsing, and by nothing else.
  console.log("\nA Hacker News thread the reader was already reading:")
  traffic.reset()
  await read(page, HN_THREAD)
  const harvested = await until(async () =>
    (await h.storedKeys()).some((k) => k.startsWith("parle/recollection/")))
  const afterHarvest = (await h.storedKeys()).filter((k) => k.startsWith("parle/recollection/"))
  record(
    "records what was on the page, now that the reader has said yes",
    harvested,
    `${afterHarvest.length} row(s)`
  )
  record(
    "keys a harvested Mention on the address the link actually goes to",
    afterHarvest.some((k) => k.includes("mentions") && k.includes(ARTICLE_MARK)),
    afterHarvest.find((k) => k.includes("mentions")) ?? "no Mention row"
  )

  // ------------------------------------------------------------------ the mark
  // What the reader actually sees on the page: a small mark in the corner, and
  // the surface it opens — read back out of the closed shadow root they are
  // deliberately drawn inside.
  console.log("\nThe mark, and the surface it opens:")
  /**
   * The article's own address, served as plain markup, from here on.
   *
   * Everything above met the real nature.com, which is where the claims about
   * a hostile host page belong. From here the checks are about the READER's
   * click, and the real page cannot answer that question: nature.com opens a
   * cookie consent `<dialog>` with `showModal()`, and a modal dialog makes the
   * rest of the document inert. Measured — the mark sits at (1217, 16) and
   * `document.elementFromPoint` at its centre returns
   * `<dialog class="cc-banner cc-banner--is-tcf">`, so a genuine mouse click
   * never reaches it.
   *
   * That is a real bug in the product and it is recorded as one; it is not this
   * check's subject. The old synthetic `element.click()` never noticed because
   * it bypasses hit-testing altogether — which is precisely why the gesture
   * checks below had to stop using it.
   *
   * The address is unchanged, so the Subject, the Lookups and the Discussions
   * found are all exactly as before. Only the host page's own furniture is
   * gone.
   */
  await h.context.route(ARTICLE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><meta charset="utf-8">` +
        `<title>Not all 'open source' AI models are actually open</title>` +
        `<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;padding:48px;max-width:38rem}</style>` +
        `<h1>Not all 'open source' AI models are actually open</h1>` +
        `<p>The article's own address, served without its cookie banner, so that a ` +
        `real click can reach the mark.</p>`
    }))
  await read(page, ARTICLE)
  const pill = await pillPanel(page)
  const shown = await until(async () => (await pill.count(".parle-pill")) > 0)
  record("puts a mark on a page that has discussions", shown)
  record(
    "and nothing else — the surface is not on the page until it is asked for",
    (await pill.count(".parle-dock")) === 0 && (await asidePanels(h)).length === 0
  )
  const counted = await pill.textOf(".parle-pill-count")
  record("the mark carries the count, so its size is known before opening it", /^\d+$/.test(counted), counted)
  await h.shot("04-mark")

  /**
   * The mark opens the in-page dock — the same surface Safari and iOS already
   * had. A trusted click is still the reader's click; it no longer has to
   * survive a hop into `chrome.sidePanel.open()`.
   */
  const clicked = await trustedClick(page, pill, ".parle-pill")
  await settle(1600)
  record(
    "the reader's click on the mark opens the in-page surface",
    clicked && (await pill.count(".parle-dock")) === 1,
    `${await pill.count(".parle-dock")} dock(s)`
  )
  record(
    "and does not open a browser side panel",
    (await asidePanels(h)).length === 0
  )

  const surface: Surface = pill

  await settle(1200)
  const discussions = await surface.count("a.parle-room-title")
  record(
    "draws the selected Discussion title as a link",
    discussions > 0,
    `${discussions} discussion link(s)`
  )
  // Hacker News really did take this article five times — two threads with
  // replies, three postings with none. Exactly how many is the live world's
  // business, so what is checked here is that when a fold happens it is drawn
  // as a clause on the surviving row. `Pipeline.test.ts` pins the numbers
  // against the recorded body.
  const folded = await surface.count(".parle-repeat")
  const foldWords = folded === 0 ? "" : await surface.textOf(".parle-repeat")
  record(
    "folds repeat submissions into a clause rather than into rows of their own",
    folded === 0 || /^also submitted (once|\d+ times)$/.test(foldWords),
    folded === 0 ? "nothing was submitted twice" : foldWords
  )
  await h.shot("04-pill")

  const drawn = await surface.text()
  const leaked = vocabularyIn(drawn, ARTICLE)
  record("no engineering vocabulary reaches the drawn panel", leaked.length === 0, leaked.join(", "))
  record(
    "the page surface shows the discussions, and leaves the account to the toolbar",
    !drawn.includes("Where Parle asked")
  )

  /**
   * The in-page panel is about this page. Switching tabs must not leave a
   * sidebar on the next tab; coming back to this document must still show the
   * dock that was opened here. Navigating this tab away takes the dock with
   * the document.
   */
  await h.context.route(ELSEWHERE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><meta charset="utf-8"><title>${ELSEWHERE_TITLE}</title>` +
        `<h1>${ELSEWHERE_TITLE}</h1>`
    }))
  const elsewhere = await h.context.newPage()
  await read(elsewhere, ELSEWHERE)
  const elsePill = await pillPanel(elsewhere)
  record(
    "switching tabs does not put the panel on the new page",
    (await elsePill.count(".parle-dock")) === 0 && (await asidePanels(h)).length === 0,
    `${await elsePill.count(".parle-dock")} dock(s) on the new tab`
  )
  await page.bringToFront()
  await settle(500)
  record(
    "coming back to the original page, the in-page panel is still open",
    (await pill.count(".parle-dock")) === 1
  )
  await elsewhere.close()

  /**
   * A fragment is not a move, and the panel must not treat it as one.
   *
   * `Canonical` drops `#...` unconditionally, so `#one` and `#two` are the same
   * Subject — but `noticeMove` compared raw `location.href` and detached, so any
   * table-of-contents click closed the dock. That was reachable from the article
   * in store screenshots 01 and 03, and it shipped without a check.
   *
   * RED against the pre-fix code: this reads 0 docks after the first hop.
   */
  await page.evaluate(() => { window.location.hash = "#parle-fragment-one" })
  await settle(700)
  const afterFirstHash = await pill.count(".parle-dock")
  await page.evaluate(() => { window.location.hash = "#parle-fragment-two" })
  await settle(700)
  const afterSecondHash = await pill.count(".parle-dock")
  record(
    "a #fragment change keeps the panel — it is the same page",
    afterFirstHash === 1 && afterSecondHash === 1,
    `${afterFirstHash} dock(s) after the first hop, ${afterSecondHash} after the second`
  )

  await page.goto(ELSEWHERE, { waitUntil: "domcontentloaded" }).catch(() => {})
  await settle(800)
  const afterNav = await pillPanel(page)
  record(
    "navigating this tab away takes the panel with the page",
    (await afterNav.count(".parle-dock")) === 0 && (await asidePanels(h)).length === 0
  )
  await page.bringToFront()

  // ------------------------------------------------------------------- digest
  // Everything up to here happens whether or not a Provider is connected. This
  // is the part that spends the reader's own money, and it must not begin
  // without their click.
  console.log("\nConnecting a Provider, and asking for a Digest:")
  // Each edit is written, then the whole page is redrawn from what was written.
  // So every step here waits: typing into a field that a pending redraw is
  // about to replace types into nothing, and the reader never sees that because
  // they cannot move as fast as this can.
  const options = await openOptions(h)
  await options.getByRole("radio", { name: "An API key of your own" }).check()
  await settle(700)
  await options.getByRole("textbox", { name: "API key" }).fill(KEY)
  await options.getByRole("button", { name: "Save this key" }).click()
  await options.getByRole("button", { name: "Forget this key" }).first()
    .waitFor({ timeout: 10_000 }).catch(() => {})
  await settle(500)
  // Read now: the one line of feedback for an act is cleared by the NEXT act,
  // deliberately, so that a message about destruction cannot be missed.
  const saidOnSave = await options.innerText("body").catch(() => "")
  record(
    "takes the key, and says so without showing it back",
    saidOnSave.includes("Key saved.") && !saidOnSave.includes(KEY),
    saidOnSave.includes("Paste a key first.") ? "the page rejected it" : ""
  )
  const endpoint = options.getByRole("textbox", { name: "Address to send it to" })
  await endpoint.fill(provider.baseUrl)
  await endpoint.press("Enter")
  await settle(700)
  const model = options.getByRole("textbox", { name: "Model", exact: true }).first()
  await model.fill("an-e2e-model")
  await model.press("Enter")
  await settle(800)

  const optionsText = await options.innerText("body").catch(() => "")
  const optionsHtml = await options.content().catch(() => "")
  record(
    "never renders the key it just saved",
    !optionsText.includes(KEY) && !optionsHtml.includes(KEY),
    "checked the text and the markup of the settings page"
  )
  record(
    "says plainly where the key is kept, in the reader's words",
    optionsText.includes("as ordinary text") &&
      !/encrypted|stored securely|kept safe/i.test(optionsText)
  )
  const optionsLeak = vocabularyIn(optionsText)
  record("no engineering vocabulary reaches the settings page", optionsLeak.length === 0, optionsLeak.join(", "))
  await options.screenshot({ path: path.join(SHOTS_PATH, "05-settings.png") }).catch(() => {})
  await options.close()

  // A fresh tab rather than the one above, and deliberately so: the background
  // will not re-offer a pill to the same tab within `PILL_PATIENCE_MS`, and a
  // second visit that settles inside that window would never be offered one at
  // all. That is correct behaviour and a bad thing to build a check on.
  traffic.reset()
  const reader = await h.context.newPage()
  await read(reader, ARTICLE)
  const readerPill = await pillPanel(reader)
  const pillAgain = await until(async () => (await readerPill.count(".parle-pill")) > 0, 30_000)
  record("offers the panel again once a Provider is connected", pillAgain)
  await trustedClick(reader, readerPill, ".parle-pill")
  const reading: Surface = readerPill
  await reading.click('[data-dock="summary"]')
  const offered = await until(async () => (await reading.count(".parle-act-digest")) > 0)
  const digestText = await reading.text()
  record(
    "offers a Digest, and says what it will cost before it costs it",
    offered && /read the comments of \d+ discussion/.test(digestText) &&
      digestText.includes("It has not done that yet"),
    digestText.split("\n").find((l) => l.includes("read the comments")) ??
      `panel said: ${digestText.replace(/\n/g, " | ").slice(0, 200) || "(nothing drawn)"}`
  )
  record(
    "has fetched no comment and asked no Provider merely by drawing that",
    traffic.hit("/api/v1/items/").length === 0 && provider.prompts.length === 0
  )
  await h.shot("06-offer")

  await reading.click(".parle-act-digest")
  const wrote = await until(() => provider.prompts.length > 0, 40_000)
  record(
    "reads the comments only once the reader presses the button",
    traffic.hit("/api/v1/items/").length > 0,
    `${traffic.hit("/api/v1/items/").length} comment request(s)`
  )
  record(
    "sends the key the reader pasted, to the address they named",
    wrote && provider.authorizations.some((a) => a === `Bearer ${KEY}`),
    provider.authorizations.map((a) => a.slice(0, 12)).join(", ") || "nothing arrived"
  )
  record(
    "sends the comments themselves, which is what the panel said it would",
    provider.prompts.some((p) => p.includes("COMMENT id:")),
    `${provider.prompts.length} prompt(s)`
  )

  const written = await until(async () => (await reading.count(".parle-finding")) > 0, 40_000)
  const digestDrawn = await reading.text()
  record(
    "draws the Digest the Provider wrote",
    written,
    `${await reading.count(".parle-finding")} finding(s)`
  )
  await h.shot("07-digest")

  // ADR 0006, in a browser: the Provider produced one Finding it could point at
  // and one it invented, along with the source it invented for it. `admit`
  // cannot be run without the material, so the second cannot decode — and the
  // reader is told something was dropped rather than shown a shortened answer
  // presented as the whole one.
  record(
    "drops the Finding that cited a discussion nobody read",
    !digestDrawn.includes("A study nobody in these discussions mentioned"),
    digestDrawn.slice(0, 120).replace(/\n/g, " ")
  )
  record(
    "says the answer it is showing is only part of one",
    digestDrawn.includes("This is part of an answer")
  )

  const href = await reading.attribute(".parle-source", "href")
  record(
    "gives every Finding a source the reader can actually open",
    (await reading.count(".parle-source")) > 0 && href !== null &&
      /news\.ycombinator\.com\/item\?id=\d+$/.test(href),
    href ?? "no source"
  )
  // The other half of ADR 0006, and the half a working `href` says nothing
  // about: a pointer the reader cannot SEE is a pointer. This was drawn as
  // plain grey text for as long as the reset's `.parle a` out-specified the
  // rule that underlines it, which is invisible to every check above.
  const underlined = await reading.styleOf(".parle-source", "text-decoration-line")
  record(
    "and draws it as something visibly followable, not as grey text",
    underlined.includes("underline"),
    underlined || "nothing computed"
  )

  const digestLeak = vocabularyIn(digestDrawn, ARTICLE)
  record("no engineering vocabulary reaches the Digest", digestLeak.length === 0, digestLeak.join(", "))

  const pageHtml = await reader.content().catch(() => "")
  record(
    "never puts the key on the page it drew the Digest into",
    !pageHtml.includes(KEY) && !digestDrawn.includes(KEY)
  )
  record(
    "never logs the key from the background, on any path",
    !h.workerLog.some((line) => line.includes(KEY)),
    `${h.workerLog.length} line(s) of worker log`
  )
  record(
    "never sends the key anywhere but the address the reader named",
    traffic.urls.filter((u) => u.includes(KEY)).length === 0
  )

  await reader.close()

  // ---------------------------------------------------------------- exclusion
  console.log("\nA private address, which must never be looked up:")
  traffic.reset()
  await read(page, "http://127.0.0.1:9/never")
  await settle(3500)
  record(
    "asks nobody about a loopback address",
    traffic.hit("hn.algolia.com").length === 0 &&
      traffic.hit("reddit.com").length === 0 &&
      traffic.hit("x.com").length === 0
  )

  // ------------------------------------------------------------------ quiet
  //
  // A page that really has nothing, which is harder to arrange than it sounds:
  // `example.com` is discussed — a title search for "Example Domain" returns
  // Hacker News threads — so a check written against it would be vacuous. This
  // one is served by the harness at an address nobody has posted, under a title
  // nobody has used, so both Lookups go out for real and both come back empty.
  console.log("\nA page nobody has discussed:")
  await h.context.route(QUIET, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>${QUIET_TITLE}</title><p>A page nobody has discussed.</p>`
    }))
  traffic.reset()
  const quiet = await h.context.newPage()
  await read(quiet, QUIET)
  await settle(6000)
  record(
    "asks about it by address, and does not crash",
    traffic.hit("hn.algolia.com").length > 0,
    `${traffic.hit("hn.algolia.com").length} request(s)`
  )
  // The other half of what this check used to assert, inverted by ADR 0020:
  // the title search is gone, so the page's TITLE must never leave the machine.
  // This is the wire-level guarantee that the deletion is real and not merely
  // hidden behind a view — and it is the check that would go red if anything
  // ever put a title back on the query string.
  record(
    "and never sends the page's title anywhere",
    traffic.hit(encodeURIComponent(QUIET_TITLE).replace(/%20/g, "+")).length === 0 &&
      traffic.urls.filter((url) => url.includes("Zmbrqx")).length === 0,
    `${traffic.urls.filter((url) => url.includes("Zmbrqx")).length} request(s) carried it`
  )
  record("stays quiet about X", traffic.hit("x.com").length === 0)

  // The whole of the injection promise, checked on the page rather than on our
  // intentions: Parle asked, everywhere answered, nobody had anything, and the
  // reader's page is untouched. Counting `.parle-pill` alone would not catch a
  // host element left behind holding an empty root, so this counts every shadow
  // root in the document — this page has none of its own, so one would be ours.
  const quietPage = await pillPanel(quiet)
  record(
    "puts nothing at all on a page nobody has discussed",
    (await quietPage.roots()) === 0 && (await quietPage.count(".parle-pill")) === 0,
    `${await quietPage.roots()} shadow root(s), ${await quietPage.count(".parle-pill")} mark(s)`
  )
  await quiet.screenshot({ path: path.join(SHOTS_PATH, "03-undiscussed.png") }).catch(() => {})
  await quiet.close()

  // ---------------------------------------------------------------- forgetting
  // ADR 0015's larger control, on the store the reader was told to go and look
  // at. A control that reports success and leaves the bytes behind is worse
  // than none, because the next worker answers from what was supposed to be gone.
  console.log("\nForgetting everything:")
  const before = (await h.storedKeys()).filter((k) => k.startsWith("parle/recollection/"))
  const settings = await openOptions(h)
  await settings.getByRole("button", { name: "Forget everything" }).click()
  await settle(2500)
  const after = (await h.storedKeys()).filter((k) => k.startsWith("parle/recollection/"))
  record(
    "clears the whole of what this device remembered",
    before.length > 0 && after.length === 0,
    `${before.length} row(s) before, ${after.length} after`
  )
  await settings.close()

  await provider.close()
  await h.close()

  await overlayPass()

  // ------------------------------------------------------------------ report
  const algoliaAudit = ratesOf(algoliaStamps)
  console.log(
    `\nalgolia traffic (this run's own, measured): ${algoliaAudit.total} request(s), ` +
      `peak ${algoliaAudit.peakPerSecond}/s, sustained ${algoliaAudit.sustainedPerSecond}/s`
  )
  const failed = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  console.log(`screenshots: apps/extension/.e2e-shots/\n`)
  if (failed.length > 0) process.exit(1)
}

main().catch((e) => {
  console.error("\nHARNESS FAILED:", e)
  process.exit(1)
})
