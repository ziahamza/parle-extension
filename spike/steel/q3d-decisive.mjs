/**
 * QUESTION 3, decisive — on a container that was just restarted, so the profile
 * is genuinely new and nothing is cached.
 *
 * q3c wiped `/tmp/steel-chrome` out from under a RUNNING Chrome, which is not a
 * fresh profile, it is a broken one; and `POST /v1/sessions` did not relaunch
 * the browser, so pages from the previous run were still open. Both of those
 * are recorded rather than hidden — they are things anyone standing Steel up
 * will hit. Here the container is restarted first, which is the only way this
 * spike found to get Steel to give a genuinely clean browser.
 *
 * Then two probes, in order of decisiveness:
 *
 *   1. A fetch issued BY HAND from inside the background worker
 *      (`worker.evaluate(() => fetch(...))`). Nothing about Parle is involved.
 *      If the observers cannot see that, they cannot see anything a service
 *      worker does, and every absence check in the suite is worthless on Steel.
 *   2. The product's own Lookup, on an address minted at run time.
 *
 * A page-issued fetch is thrown in as a positive control, so a run where the
 * observers saw literally nothing can be told apart from one where they only
 * missed the worker.
 */
import { chromium } from "playwright"
import { CDP, cdpWebSocket, record, settle, startSession, tally, until } from "./lib/steel.mjs"
import { RawCdp } from "./lib/rawcdp.mjs"
import { pillPanel } from "./lib/pill.mjs"

const stamp = Date.now().toString(36).toUpperCase()
const FRESH = `https://parle-steel-decisive-${stamp.toLowerCase()}.com/piece`
const FRESH_TITLE = `Xqzvb Wrlmt ${stamp} Nnkp`
const PROBE = `https://hn.algolia.com/api/v1/search?query=PARLE-SPIKE-PROBE-${stamp}`
const PAGE_PROBE = `https://hn.algolia.com/api/v1/search?query=PARLE-PAGE-PROBE-${stamp}`

const session = await startSession()
console.log(`session ${session.id}`)
await settle(3_000)

const raw = await RawCdp.open(CDP)
const rawUrls = []
await raw.watchEverything((r) => rawUrls.push(r))
await settle(1_500)
console.log(`raw CDP attached to ${raw.targets.size} target(s):`)
for (const label of raw.targets.values()) console.log(`  ${label.slice(0, 100)}`)

const browser = await chromium.connectOverCDP(await cdpWebSocket())
const context = browser.contexts()[0]
await until(() => context.serviceWorkers().length > 0, 20_000)
const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
const extensionId = new URL(worker.url()).host
console.log(`extension ${extensionId}`)

const pwUrls = []
context.on("request", (r) => pwUrls.push(r.url()))
const rawHit = (f) => rawUrls.filter((r) => r.url.includes(f))
const pwHit = (f) => pwUrls.filter((u) => u.includes(f))

/* --- probe 0: a PAGE fetch, as a positive control -------------------------- */
const page = context.pages().find((p) => p.url() === "about:blank") ?? (await context.newPage())
await page.goto("https://example.com/", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {})
const pageProbe = await page.evaluate(async (url) => {
  const response = await fetch(url).catch((e) => ({ status: `threw ${e}` }))
  return String(response.status)
}, PAGE_PROBE).catch((e) => `evaluate threw: ${e.message.split("\n")[0]}`)
await settle(2_000)
console.log(`page fetch status: ${pageProbe}`)
record(
  "[control] a fetch issued from a PAGE is seen by raw CDP",
  rawHit(`PARLE-PAGE-PROBE-${stamp}`).length > 0,
  `${rawHit(`PARLE-PAGE-PROBE-${stamp}`).length} sighting(s)`
)
record(
  "[control] a fetch issued from a PAGE is seen by Playwright",
  pwHit(`PARLE-PAGE-PROBE-${stamp}`).length > 0,
  `${pwHit(`PARLE-PAGE-PROBE-${stamp}`).length} sighting(s)`
)

/* --- probe 1: a fetch issued BY HAND from the background worker ------------ */
const workerProbe = await worker.evaluate(async (url) => {
  const response = await fetch(url).catch((e) => ({ status: `threw ${e}` }))
  return String(response.status)
}, PROBE).catch((e) => `evaluate threw: ${e.message.split("\n")[0]}`)
await settle(3_000)
console.log(`worker fetch status: ${workerProbe}`)
record(
  "the background worker can reach the network at all under Steel",
  workerProbe === "200",
  `fetch resolved with ${workerProbe}`
)
record(
  "[C] raw CDP sees a fetch issued from the background service worker",
  rawHit(`PARLE-SPIKE-PROBE-${stamp}`).length > 0,
  `${rawHit(`PARLE-SPIKE-PROBE-${stamp}`).length} sighting(s) of ${rawUrls.length} request(s) seen`
)
record(
  "[A] Playwright sees a fetch issued from the background service worker",
  pwHit(`PARLE-SPIKE-PROBE-${stamp}`).length > 0,
  `${pwHit(`PARLE-SPIKE-PROBE-${stamp}`).length} sighting(s) of ${pwUrls.length} request(s) seen`
)

/* --- probe 2: the product's own Lookup ------------------------------------- */
const welcome = await context.newPage()
await welcome.goto(`chrome-extension://${extensionId}/welcome.html`)
await welcome.bringToFront()
await welcome.locator("#on").click().catch(() => {})
await settle(800)
await welcome.close()

await context.route(FRESH, (route) =>
  route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><meta charset="utf-8"><title>${FRESH_TITLE}</title><h1>${FRESH_TITLE}</h1>`
  }))
rawUrls.length = 0
pwUrls.length = 0
await page.bringToFront()
await page.goto(FRESH, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {})
await settle(14_000)

console.log(`\nraw CDP saw ${rawUrls.length} request(s) after the navigation:`)
for (const r of rawUrls.slice(0, 20)) console.log(`  [${r.from.slice(0, 55)}] ${r.url.slice(0, 120)}`)

record(
  "[C] raw CDP sees the product's own Lookup go out",
  rawHit("hn.algolia.com").length > 0,
  `${rawHit("hn.algolia.com").length} request(s)`
)
record(
  "[A] Playwright sees the product's own Lookup go out",
  pwHit("hn.algolia.com").length > 0,
  `${pwHit("hn.algolia.com").length} request(s)`
)

/* Ground truth from inside the worker: did the Lookup happen regardless? */
const seen = await worker.evaluate(async () => {
  const store = await caches.open("parle")
  return (await store.keys()).map((r) => decodeURIComponent(new URL(r.url).pathname.slice(1)))
}).catch(() => ["<threw>"])
console.log(`keys: ${JSON.stringify(seen)}`)

raw.close()
await browser.close()
process.exit(tally() === 0 ? 0 : 1)
