/**
 * SUPERSEDED — kept because the mistake in it is worth seeing.
 *
 * This version observed traffic with
 * `playwrightCdpSession.send(method, params, sessionId)`. Playwright's
 * `CDPSession.send` takes TWO arguments; the third was dropped, `Network.enable`
 * went to the browser session, the rejection was swallowed by a `.catch`, and
 * the observer reported zero requests while looking perfectly healthy. It also
 * ran against a profile Steel had already used, so the extension answered out
 * of its own cache and made no request to observe either — two independent
 * reasons for the same zero.
 *
 * Read `q3b-traffic.mjs` (raw CDP client), `q3c-fresh.mjs` (the failed attempt
 * to get a clean profile) and `q3d-decisive.mjs` (the answer) instead.
 */
/**
 * QUESTION 3 — can we see what left the browser?
 *
 * Half the existing checks are assertions about traffic, and the ones that
 * matter most are assertions about its ABSENCE: "asks nobody about a loopback
 * address", "stays quiet about X", "never sends the key anywhere but the
 * address the reader named". An absence claim is only worth something if the
 * observer would definitely have seen the thing had it happened — so this
 * measures the observer first and the product second.
 *
 * The awkward part, and the whole reason this is question 3 rather than a
 * footnote: **almost every request Parle makes is made by the background
 * SERVICE WORKER**, not by a page. `hn.algolia.com`, the comment fetches, the
 * Provider call — all of them originate in the worker. A network observer that
 * only sees page traffic would pass every absence check for the wrong reason,
 * which is the most dangerous failure mode available to us.
 *
 * Three observers are run side by side over the same run so they can be
 * compared on the same bytes:
 *   A. Playwright's `context.on("request")` — what our 56 checks are written on.
 *   B. Steel's own recorded logs (`/v1/logs/query`).
 *   C. Raw CDP: browser-level `Target.setAutoAttach` + `Network.enable` on every
 *      attached target, service worker included.
 */
import { chromium } from "playwright"
import { API, CDP, cdpWebSocket, record, settle, startSession, tally, until } from "./lib/steel.mjs"

const ARTICLE = "https://www.nature.com/articles/d41586-024-02012-5"
const QUIET = "https://parle-e2e-nobody-has-discussed-this.com/piece"
const QUIET_TITLE = "Zmbrqx Ttlpwd Kvvn 91827"
const LOOPBACK = "http://127.0.0.1:9/never"

const session = await startSession()
console.log(`session ${session.id}`)
await settle(3_000)

const browser = await chromium.connectOverCDP(await cdpWebSocket())
const context = browser.contexts()[0]
await until(() => context.serviceWorkers().length > 0, 20_000)
const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
const extensionId = new URL(worker.url()).host

/* --- observer A: Playwright ------------------------------------------------ */
const playwrightUrls = []
context.on("request", (r) => playwrightUrls.push(r.url()))

/* --- observer C: raw CDP, every target, service worker included ------------- */
const rawUrls = []
const rawByTarget = new Map()
const browserSession = await browser.newBrowserCDPSession()
const wire = (sessionId, targetInfo) => {
  const label = `${targetInfo.type}:${targetInfo.url.slice(0, 60)}`
  browserSession.send("Network.enable", {}, sessionId).catch(() => {})
  browserSession.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {})
  rawByTarget.set(sessionId, label)
}
browserSession.on("Target.attachedToTarget", (e) => wire(e.sessionId, e.targetInfo))
browserSession.on("Network.requestWillBeSent", (e) => {
  rawUrls.push({ url: e.request.url, from: rawByTarget.get(e.sessionId) ?? "?" })
})
await browserSession.send("Target.setAutoAttach", {
  autoAttach: true,
  waitForDebuggerOnStart: false,
  flatten: true
})
await settle(1_000)
console.log(`raw CDP attached to ${rawByTarget.size} target(s):`)
for (const label of rawByTarget.values()) console.log(`  ${label}`)

const hit = (list, fragment) => list.filter((u) => u.includes(fragment))
const rawHit = (fragment) => rawUrls.filter((r) => r.url.includes(fragment))
const reset = () => {
  playwrightUrls.length = 0
  rawUrls.length = 0
}

/* --- before the reader has answered ---------------------------------------- */
const welcome = await context.newPage()
await welcome.goto(`chrome-extension://${extensionId}/welcome.html`)
await welcome.bringToFront()
reset()
await settle(2_000)
record(
  "[absence] asks nobody at all before the reader has answered",
  rawHit("hn.algolia.com").length === 0,
  `playwright saw ${hit(playwrightUrls, "hn.algolia.com").length}, raw CDP saw ${rawHit("hn.algolia.com").length}`
)
await welcome.locator("#on").click().catch(() => {})
await settle(800)
await welcome.close()

/* --- a page Hacker News has discussed --------------------------------------- */
const page = context.pages()[0] ?? (await context.newPage())
reset()
await page.bringToFront()
await page.goto(ARTICLE, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {})
await settle(8_000)

const pwAlgolia = hit(playwrightUrls, "hn.algolia.com")
const rawAlgolia = rawHit("hn.algolia.com")
console.log(`\nplaywright: ${playwrightUrls.length} request(s), ${pwAlgolia.length} to algolia`)
console.log(`raw CDP:    ${rawUrls.length} request(s), ${rawAlgolia.length} to algolia`)
if (rawAlgolia.length > 0) console.log(`  first: [${rawAlgolia[0].from}] ${rawAlgolia[0].url.slice(0, 130)}`)

record(
  "[A] Playwright's context.on(\"request\") sees the worker's Lookup",
  pwAlgolia.length > 0,
  `${pwAlgolia.length} request(s) of ${playwrightUrls.length} total`
)
record(
  "[C] raw CDP sees the worker's Lookup, and says which target made it",
  rawAlgolia.length > 0 && rawAlgolia.every((r) => r.from.startsWith("service_worker")),
  rawAlgolia.length === 0 ? "none" : `${rawAlgolia.length} from ${new Set(rawAlgolia.map((r) => r.from)).size} target(s): ${rawAlgolia[0].from}`
)
record(
  "sends the canonicalized address, not the raw one",
  rawAlgolia.some((r) => r.url.includes("nature.com")),
  rawAlgolia[0]?.url.slice(0, 110) ?? "none"
)
record(
  "[absence] does not contact X",
  rawHit("x.com").length === 0 && rawHit("api.twitter").length === 0,
  `${rawHit("x.com").length} + ${rawHit("api.twitter").length}`
)

/* --- observer B: Steel's own log store -------------------------------------- */
let steelSaw = { total: 0, algolia: 0, note: "" }
for (const path of ["/v1/logs/query?limit=2000", "/v1/logs?limit=2000"]) {
  const response = await fetch(`${API}${path}`).catch(() => null)
  if (response === null || !response.ok) continue
  const body = await response.text()
  const algolia = (body.match(/hn\.algolia\.com/g) ?? []).length
  steelSaw = { total: body.length, algolia, note: `${path} -> ${response.status}` }
  if (algolia > 0) break
}
record(
  "[B] Steel's own log store records the Lookup",
  steelSaw.algolia > 0,
  `${steelSaw.note}, ${steelSaw.algolia} mention(s) of hn.algolia.com in ${steelSaw.total} bytes`
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
await quiet.goto(QUIET, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch((e) => console.log(`  quiet goto: ${e.message.split("\n")[0]}`))
const servedTitle = await quiet.title().catch(() => "")
record(
  "context.route() fulfils a request in a CDP-connected context",
  servedTitle === QUIET_TITLE,
  `title was ${JSON.stringify(servedTitle)}`
)
await settle(8_000)
const titleQuery = encodeURIComponent(QUIET_TITLE).replace(/%20/g, "+")
record(
  "asks about it by address AND by title",
  rawHit("hn.algolia.com").length > 0 && rawHit(titleQuery).length > 0,
  `${rawHit("hn.algolia.com").length} algolia request(s), ${rawHit(titleQuery).length} carrying the title`
)
record("[absence] stays quiet about X on a page with nothing", rawHit("x.com").length === 0)

console.log("\nsample of what raw CDP saw last (up to 12):")
for (const r of rawUrls.slice(0, 12)) console.log(`  [${r.from}] ${r.url.slice(0, 120)}`)

await browser.close()
process.exit(tally() === 0 ? 0 : 1)
