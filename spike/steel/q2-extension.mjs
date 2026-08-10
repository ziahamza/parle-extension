/**
 * QUESTION 2 — does the unpacked MV3 build really load, all of it?
 *
 * "Loads" is four separate things and they fail independently:
 *   - the manifest's `sidePanel` permission survives, so `chrome.sidePanel.open`
 *     exists (this is the exact feature detection `armExtension` does, and the
 *     Safari-shaped build is defined by its absence);
 *   - the DECLARED content script (`harvest.js`, three hosts, in the manifest)
 *     gets an isolated world on a page it matches;
 *   - the PROGRAMMATICALLY injected one (`pill.js`, via
 *     `chrome.scripting.executeScript`) reaches a page that has something to
 *     show;
 *   - and the browser's own side panel actually opens, on a real gesture,
 *     confirmed by Chrome's `getContexts` rather than by a screenshot.
 *
 * The last one is the hard one, and it is where the harness's `trustedClick`
 * earns its keep: `sidePanel.open()` is refused unless it is called inside the
 * turn of a genuine user gesture, so a synthetic `element.click()` proves
 * nothing.
 */
import { chromium } from "playwright"
import { cdpWebSocket, record, settle, startSession, tally, until } from "./lib/steel.mjs"
import { pillPanel, trustedClick } from "./lib/pill.mjs"

const ARTICLE = "https://www.nature.com/articles/d41586-024-02012-5"
const HN = "https://news.ycombinator.com/item?id=40786237"

const session = await startSession()
console.log(`session ${session.id}`)
await settle(3_000)

const browser = await chromium.connectOverCDP(await cdpWebSocket())
const context = browser.contexts()[0]
await until(() => context.serviceWorkers().length > 0, 20_000)
const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
const extensionId = new URL(worker.url()).host
console.log(`extension ${extensionId}`)

/* --- the manifest actually took ------------------------------------------- */
const surfaces = await worker.evaluate(() => ({
  sidePanel: typeof chrome.sidePanel,
  open: typeof chrome.sidePanel?.open,
  scripting: typeof chrome.scripting?.executeScript,
  webNavigation: typeof chrome.webNavigation?.onCommitted,
  permissions: chrome.runtime.getManifest().permissions,
  contentScripts: chrome.runtime.getManifest().content_scripts?.[0]?.js
}))
console.log("surfaces:", JSON.stringify(surfaces))
record(
  "chrome.sidePanel.open exists — the manifest's sidePanel permission survived the load",
  surfaces.sidePanel === "object" && surfaces.open === "function",
  `sidePanel: ${surfaces.sidePanel}, open: ${surfaces.open}`
)

/* --- the reader says yes --------------------------------------------------- */
const welcome = await context.newPage()
await welcome.goto(`chrome-extension://${extensionId}/welcome.html`)
await welcome.bringToFront()
const consentText = await welcome.innerText("body").catch(() => "")
record(
  "the extension's own welcome page renders in Steel's Chrome",
  consentText.length > 40,
  `${consentText.length} chars`
)
await welcome.locator("#on").click().catch(() => {})
await settle(800)
await welcome.close()

/* --- the DECLARED content script, on a host it matches --------------------- */
const hn = await context.newPage()
const worlds = []
const cdpHn = await context.newCDPSession(hn)
await cdpHn.send("Runtime.enable")
cdpHn.on("Runtime.executionContextCreated", (e) => {
  worlds.push({ name: e.context.name, isDefault: e.context.auxData?.isDefault, origin: e.context.origin })
})
await hn.bringToFront()
await hn.goto(HN, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e) => console.log(`  hn goto: ${e.message.split("\n")[0]}`))
await settle(4_000)
console.log("execution contexts on news.ycombinator.com:", JSON.stringify(worlds))
record(
  "the declared content script gets an isolated world on news.ycombinator.com",
  worlds.some((w) => w.isDefault === false),
  worlds.map((w) => `${w.name || "(unnamed)"}${w.isDefault === false ? " [isolated]" : ""}`).join(", ") || "none"
)

/* --- the PROGRAMMATIC one, and the mark it draws --------------------------- */
const page = context.pages()[0] ?? (await context.newPage())
await context.route(ARTICLE, (route) =>
  route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><meta charset="utf-8">` +
      `<title>Not all 'open source' AI models are actually open</title>` +
      `<h1>Not all 'open source' AI models are actually open</h1>` +
      `<p>Served flat so a real click can reach the mark.</p>`
  })).catch((e) => console.log(`  context.route: ${e.message}`))
await page.bringToFront()
await page.goto(ARTICLE, { waitUntil: "domcontentloaded" }).catch(() => {})

const pill = await pillPanel(page)
const marked = await until(async () => (await pill.count(".parle-pill")) > 0, 60_000)
record(
  "chrome.scripting injects the mark into a page that has discussions",
  marked,
  marked ? await pill.textOf(".parle-pill-count") : "no mark after 60s"
)

/* --- the browser's own side panel, on a real gesture ----------------------- */
const asidePanels = async () =>
  worker.evaluate(async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })
    return contexts.map((c) => c.documentUrl ?? "")
  }).catch(() => [])

record(
  "nothing is open before the reader asks",
  (await pill.count(".parle-dock")) === 0 && (await asidePanels()).length === 0
)

const widthBefore = await page.evaluate(() => window.innerWidth)
const clicked = await trustedClick(page, pill, ".parle-pill")
await settle(2_000)
const widthAfter = await page.evaluate(() => window.innerWidth)
const panels = await asidePanels()
record(
  "a trusted click on the mark opens the browser's own side panel",
  clicked && panels.length === 1,
  panels.length === 1 ? panels[0].split("/").pop() : `${panels.length} panel(s), clicked=${clicked}`
)
record(
  "and it sits BESIDE the article — the page's own viewport shrinks",
  widthAfter < widthBefore,
  `${widthBefore}px -> ${widthAfter}px`
)

/* Can we read the panel document at all? Our harness needs a second CDP client
 * for this locally; over Steel there is only one endpoint, so ask it directly. */
const listed = await (await fetch(`${process.env.STEEL_CDP ?? "http://localhost:9223"}/json/list`)).json()
const panelTarget = listed.find((t) => t.url.endsWith("sidepanel.html"))
record(
  "the side panel document is a target we can attach to",
  panelTarget !== undefined,
  panelTarget?.url ?? listed.map((t) => `${t.type}:${t.url.slice(0, 60)}`).join(" | ")
)

if (panelTarget !== undefined) {
  const panelPage = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().endsWith("sidepanel.html"))
  const rows = panelPage === undefined ? -1 : await panelPage.locator(".parle-row").count().catch(() => -1)
  record(
    "and the panel has drawn the discussions it found",
    rows > 0,
    panelPage === undefined ? "playwright did not adopt the panel page" : `${rows} row(s)`
  )
}

await browser.close()
process.exit(tally() === 0 ? 0 : 1)
