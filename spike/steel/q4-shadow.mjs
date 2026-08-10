/**
 * QUESTION 4 — can we read a CLOSED shadow root through Steel?
 *
 * Run against the SAFARI-SHAPED build, deliberately. On the Chrome build the
 * closed root holds only the mark; on the Safari-shaped one the mark opens the
 * injected overlay and the entire surface — every row, every link, every
 * computed style — lives inside that closed root. So this is where the
 * technique either holds up or does not.
 *
 * Every method of `harness.ts`'s `PillPanel` is exercised, because they fail
 * for different reasons: `count`/`textOf` need `DOM.resolveNode` +
 * `Runtime.callFunctionOn` to work against a closed root, `styleOf` needs
 * `getComputedStyle` inside it, `boxOf` feeds the only trusted click in the
 * suite, and `roots()` is the one that can prove an ABSENCE — "a page with
 * nothing gets no DOM from us at all", which no selector count can establish.
 *
 * Nothing here flips `mode: "closed"` to make the test easier. That would mean
 * testing something other than what ships.
 */
import { chromium } from "playwright"
import { cdpWebSocket, record, settle, startSession, tally, until } from "./lib/steel.mjs"
import { pillPanel, trustedClick } from "./lib/pill.mjs"

const stamp = Date.now().toString(36).toUpperCase()
const ARTICLE = "https://www.nature.com/articles/d41586-024-02012-5"
const QUIET = `https://parle-steel-quiet-${stamp.toLowerCase()}.com/piece`
const QUIET_TITLE = `Zmbrqx Ttlpwd ${stamp} Kvvn`

const session = await startSession({ extensions: ["parle-safari"] })
console.log(`session ${session.id} (safari-shaped build)`)
await settle(3_000)

const browser = await chromium.connectOverCDP(await cdpWebSocket())
const context = browser.contexts()[0]
await until(() => context.serviceWorkers().length > 0, 20_000)
const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
const extensionId = new URL(worker.url()).host

const native = await worker.evaluate(() => typeof chrome.sidePanel?.open === "function").catch(() => false)
record(
  "the Safari-shaped build really takes the Safari branch (no browser panel)",
  native === false,
  `chrome.sidePanel.open is ${native ? "a function" : "absent"}`
)

const welcome = await context.newPage()
await welcome.goto(`chrome-extension://${extensionId}/welcome.html`)
await welcome.bringToFront()
await welcome.locator("#on").click().catch(() => {})
await settle(800)
await welcome.close()

const page = context.pages().find((p) => !p.url().startsWith("chrome-extension://")) ?? (await context.newPage())
await context.route(ARTICLE, (route) =>
  route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><meta charset="utf-8">` +
      `<title>Not all 'open source' AI models are actually open</title>` +
      `<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;padding:48px;max-width:38rem}</style>` +
      `<h1>Not all 'open source' AI models are actually open</h1>`
  }))
await page.bringToFront()
await page.goto(ARTICLE, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {})

const pill = await pillPanel(page)

const marked = await until(async () => (await pill.count(".parle-pill")) > 0, 90_000)
record("DOM.getDocument({pierce:true}) reaches the closed root — the mark is countable", marked)

const count = await pill.textOf(".parle-pill-count")
record("textOf reads text from inside the closed root", /^\d+$/.test(count), `count reads ${JSON.stringify(count)}`)

const box = await pill.boxOf(".parle-pill")
record(
  "boxOf gives real page coordinates for an element inside the closed root",
  box !== null && box.width > 0 && box.height > 0,
  box === null ? "null" : `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`
)

const zIndex = await pill.styleOf(".parle-pill", "z-index")
const position = await pill.styleOf(".parle-pill", "position")
record(
  "styleOf reads COMPUTED style from inside the closed root",
  position !== "" ,
  `position: ${JSON.stringify(position)}, z-index: ${JSON.stringify(zIndex)}`
)

const clicked = await trustedClick(page, pill, ".parle-pill")
await settle(2_000)
const rows = await pill.count(".parle-row")
record(
  "a trusted click at those coordinates opens the overlay inside the closed root",
  clicked && (await pill.count(".parle-dock")) === 1 && rows > 0,
  `${rows} row(s)`
)

const href = await pill.attribute(".parle-row", "href")
const rowText = await pill.textOf(".parle-row")
record(
  "attribute() reads an attribute from inside the closed root",
  href !== null || rowText.length > 0,
  href === null ? `no href; row text ${JSON.stringify(rowText.slice(0, 60))}` : href.slice(0, 80)
)

const dockText = await pill.text()
record(
  "text() returns the whole surface's rendered text",
  dockText.length > 50,
  `${dockText.length} chars, starts ${JSON.stringify(dockText.slice(0, 60))}`
)

await page.bringToFront()
await page.keyboard.press("Escape")
await settle(700)
record(
  "Escape closes the surface and leaves the mark — a state change read back through the closed root",
  (await pill.count(".parle-dock")) === 0 && (await pill.count(".parle-pill")) === 1
)

/* --- the ABSENCE claim, which is what roots() exists for -------------------- */
await context.route(QUIET, (route) =>
  route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><title>${QUIET_TITLE}</title><p>A page nobody has discussed.</p>`
  }))
const quiet = await context.newPage()
await quiet.bringToFront()
await quiet.goto(QUIET, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {})
await settle(12_000)
const quietPill = await pillPanel(quiet)
const quietRoots = await quietPill.roots()
record(
  "roots() proves an absence — a page nobody has discussed carries no shadow root of ours",
  quietRoots === 0 && (await quietPill.count(".parle-pill")) === 0,
  `${quietRoots} shadow root(s)`
)

/* And that roots() is not simply always zero. */
const articleRoots = await pill.roots()
record(
  "and roots() is not vacuous — the article's page does carry one",
  articleRoots > 0,
  `${articleRoots} shadow root(s) on the article`
)

await browser.close()
process.exit(tally() === 0 ? 0 : 1)
