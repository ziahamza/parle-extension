/**
 * QUESTION 3, done properly — see `lib/rawcdp.mjs` for why q3 was thrown away.
 *
 * Two observers, on the same run, on the same bytes:
 *   A. Playwright's `context.on("request")` over `connectOverCDP` — what the 56
 *      existing checks are written against.
 *   C. Raw CDP browser-level auto-attach with `Network.enable` per target.
 *
 * And one control that decides how to read a disagreement: **the mark**. If the
 * mark appears on the article then the background really did ask Hacker News,
 * so an observer that saw nothing is broken rather than the product being quiet.
 * Without that control, "0 requests to hn.algolia.com" is unreadable — and it is
 * the exact shape every absence check in the suite has.
 */
import { chromium } from "playwright"
import { API, CDP, cdpWebSocket, record, settle, startSession, tally, until } from "./lib/steel.mjs"
import { RawCdp } from "./lib/rawcdp.mjs"
import { pillPanel } from "./lib/pill.mjs"

const ARTICLE = "https://www.nature.com/articles/d41586-024-02012-5"
const QUIET = "https://parle-e2e-nobody-has-discussed-this.com/piece"
const QUIET_TITLE = "Zmbrqx Ttlpwd Kvvn 91827"
const LOOPBACK = "http://127.0.0.1:9/never"

const session = await startSession()
console.log(`session ${session.id}`)
await settle(3_000)

/* Observer C first, so it is listening before anything is asked. */
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

/* Observer A. */
const pwUrls = []
context.on("request", (r) => pwUrls.push(r.url()))

const rawHit = (fragment) => rawUrls.filter((r) => r.url.includes(fragment))
const pwHit = (fragment) => pwUrls.filter((u) => u.includes(fragment))
const reset = () => {
  rawUrls.length = 0
  pwUrls.length = 0
}

/* --- consent --------------------------------------------------------------- */
const welcome = await context.newPage()
await welcome.goto(`chrome-extension://${extensionId}/welcome.html`)
await welcome.bringToFront()
reset()
await settle(2_000)
record(
  "[absence] asks nobody at all before the reader has answered",
  rawHit("hn.algolia.com").length === 0,
  `raw CDP saw ${rawUrls.length} request(s) in that window, 0 to algolia`
)
await welcome.locator("#on").click().catch(() => {})
await settle(800)
await welcome.close()

/* --- the article ------------------------------------------------------------ */
const page = context.pages().find((p) => !p.url().startsWith("chrome-extension://")) ?? (await context.newPage())
await context.route(ARTICLE, (route) =>
  route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><meta charset="utf-8">` +
      `<title>Not all 'open source' AI models are actually open</title>` +
      `<h1>Not all 'open source' AI models are actually open</h1>`
  }))
reset()
await page.bringToFront()
await page.goto(ARTICLE, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {})

/* THE CONTROL: did the Lookup actually happen? */
const pill = await pillPanel(page)
const marked = await until(async () => (await pill.count(".parle-pill")) > 0, 60_000)
record(
  "CONTROL — the mark appeared, so the background really did ask Hacker News",
  marked,
  marked ? `count ${await pill.textOf(".parle-pill-count")}` : "no mark; a 0 below would be ambiguous"
)
await settle(2_000)

const rawAlgolia = rawHit("hn.algolia.com")
const pwAlgolia = pwHit("hn.algolia.com")
console.log(`\nraw CDP:    ${rawUrls.length} request(s), ${rawAlgolia.length} to algolia`)
console.log(`playwright: ${pwUrls.length} request(s), ${pwAlgolia.length} to algolia`)
if (rawAlgolia.length > 0) console.log(`  [${rawAlgolia[0].from.slice(0, 70)}] ${rawAlgolia[0].url.slice(0, 130)}`)

record(
  "[C] raw CDP sees the service worker's Lookup and names the target that made it",
  rawAlgolia.length > 0 && rawAlgolia.every((r) => r.from.startsWith("service_worker")),
  rawAlgolia.length === 0 ? "none" : `${rawAlgolia.length} request(s) from ${rawAlgolia[0].from.slice(0, 60)}`
)
record(
  "[A] Playwright's context.on(\"request\") sees the service worker's Lookup",
  pwAlgolia.length > 0,
  `${pwAlgolia.length} of ${pwUrls.length} request(s) Playwright reported`
)
record(
  "sends the canonicalized address, not the raw one",
  rawAlgolia.some((r) => r.url.includes("nature.com")),
  rawAlgolia[0]?.url.slice(0, 110) ?? "none"
)
record(
  "[absence] does not contact X",
  rawHit("x.com").length === 0 && rawHit("api.twitter").length === 0,
  `x.com ${rawHit("x.com").length}, api.twitter ${rawHit("api.twitter").length}`
)

/* --- observer B: Steel's own log store -------------------------------------- */
let steel = { note: "no endpoint answered", algolia: 0, bytes: 0 }
for (const path of ["/v1/logs/query?limit=5000", "/v1/logs?limit=5000", "/v1/logs/stats"]) {
  const response = await fetch(`${API}${path}`).catch(() => null)
  if (response === null) continue
  const body = await response.text()
  const algolia = (body.match(/hn\.algolia\.com/g) ?? []).length
  steel = { note: `${path} -> ${response.status}`, algolia, bytes: body.length }
  if (algolia > 0) break
}
record(
  "[B] Steel's own log store records the Lookup",
  steel.algolia > 0,
  `${steel.note}, ${steel.algolia} mention(s) in ${steel.bytes} bytes`
)

/* --- a private address ------------------------------------------------------ */
reset()
await page.bringToFront()
await page.goto(LOOPBACK, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {})
await settle(4_000)
record(
  "[absence] asks nobody about a loopback address",
  rawHit("hn.algolia.com").length === 0 && rawHit("reddit.com").length === 0 && rawHit("x.com").length === 0,
  `raw CDP saw ${rawUrls.length} request(s) in that window`
)

/* --- a page nobody has discussed -------------------------------------------- */
await context.route(QUIET, (route) =>
  route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><title>${QUIET_TITLE}</title><p>A page nobody has discussed.</p>`
  }))
reset()
const quiet = await context.newPage()
await quiet.bringToFront()
await quiet.goto(QUIET, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {})
record(
  "context.route() fulfils a request in a CDP-connected context",
  (await quiet.title().catch(() => "")) === QUIET_TITLE
)
await settle(9_000)
const titleQuery = encodeURIComponent(QUIET_TITLE).replace(/%20/g, "+")
record(
  "asks about it by address AND by title",
  rawHit("hn.algolia.com").length > 0 && rawHit(titleQuery).length > 0,
  `${rawHit("hn.algolia.com").length} algolia request(s), ${rawHit(titleQuery).length} carrying the title`
)
record("[absence] stays quiet about X on a page with nothing", rawHit("x.com").length === 0)

const quietPill = await pillPanel(quiet)
record(
  "puts nothing at all on a page nobody has discussed",
  (await quietPill.roots()) === 0,
  `${await quietPill.roots()} shadow root(s)`
)

console.log("\nlast window, everything raw CDP saw:")
for (const r of rawUrls.slice(0, 20)) console.log(`  [${r.from.slice(0, 55)}] ${r.url.slice(0, 110)}`)

raw.close()
await browser.close()
process.exit(tally() === 0 ? 0 : 1)
