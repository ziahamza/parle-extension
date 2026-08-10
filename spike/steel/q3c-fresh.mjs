/**
 * QUESTION 3, third attempt — this time with the confound removed.
 *
 * q3b's control passed (the mark appeared, count 32) while both observers saw
 * zero requests to `hn.algolia.com`, which has two readings and they are not
 * remotely equivalent:
 *
 *   (i)  the observers are blind to service-worker traffic, or
 *   (ii) the background never asked, because it answered out of its own Lookup
 *        cache — which survives, because Steel reuses ONE user-data dir
 *        (`/tmp/steel-chrome`) across every session and wipes nothing.
 *
 * (ii) is the same class of trap `harness.ts` documents at length and deletes
 * `Default/Service Worker` on every launch to avoid. So this run removes the
 * whole profile first, and asks about an address and a title that have never
 * existed before — a random pair minted at run time, so no cache anywhere,
 * ours or Hacker News's, can have an answer for it.
 *
 * If traffic appears now, the observers work and Steel's reused profile is the
 * hazard. If it still does not, the observers are blind.
 */
import { execFileSync } from "node:child_process"
import { chromium } from "playwright"
import { CDP, cdpWebSocket, record, settle, startSession, tally, until } from "./lib/steel.mjs"
import { RawCdp } from "./lib/rawcdp.mjs"
import { pillPanel } from "./lib/pill.mjs"

/* The wipe `harness.ts` does with fs.rmSync, done through the container. */
const wipe = () => {
  const out = execFileSync("docker", [
    "exec", "steel-spike", "sh", "-c",
    "rm -rf /tmp/steel-chrome && echo wiped: $(ls /tmp | tr '\\n' ' ')"
  ]).toString().trim()
  console.log(out)
}
wipe()

const stamp = Date.now().toString(36).toUpperCase()
const FRESH = `https://parle-steel-spike-${stamp.toLowerCase()}.example/piece`
const FRESH_TITLE = `Xqzvb Wrlmt ${stamp} Nnkp`
console.log(`fresh address: ${FRESH}`)
console.log(`fresh title:   ${FRESH_TITLE}`)

const session = await startSession()
console.log(`session ${session.id}`)
await settle(3_000)

const raw = await RawCdp.open(CDP)
const rawUrls = []
await raw.watchEverything((r) => rawUrls.push(r))
await settle(1_500)
console.log(`raw CDP attached to ${raw.targets.size} target(s)`)
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

/* A wiped profile means a genuinely un-consented first run. */
const keysBefore = await worker.evaluate(async () => {
  const store = await caches.open("parle")
  return (await store.keys()).map((r) => decodeURIComponent(new URL(r.url).pathname.slice(1)))
}).catch(() => ["<threw>"])
console.log(`keys on a wiped profile: ${JSON.stringify(keysBefore)}`)
record(
  "wiping /tmp/steel-chrome really does give a first run",
  keysBefore.every((k) => !k.startsWith("parle/lookup/")),
  `${keysBefore.length} key(s)`
)

const welcome = await context.newPage()
await welcome.goto(`chrome-extension://${extensionId}/welcome.html`)
await welcome.bringToFront()
await welcome.locator("#on").click().catch(() => {})
await settle(800)
await welcome.close()

const page = context.pages().find((p) => !p.url().startsWith("chrome-extension://")) ?? (await context.newPage())
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
await settle(12_000)

const rawAlgolia = rawHit("hn.algolia.com")
const pwAlgolia = pwHit("hn.algolia.com")
console.log(`\nraw CDP:    ${rawUrls.length} request(s), ${rawAlgolia.length} to algolia`)
console.log(`playwright: ${pwUrls.length} request(s), ${pwAlgolia.length} to algolia`)
for (const r of rawUrls.slice(0, 15)) console.log(`  [${r.from.slice(0, 55)}] ${r.url.slice(0, 120)}`)

record(
  "[C] raw CDP sees the service worker's Lookup",
  rawAlgolia.length > 0,
  rawAlgolia.length === 0 ? "none" : `${rawAlgolia.length} from ${rawAlgolia[0].from.slice(0, 60)}`
)
record(
  "[A] Playwright's context.on(\"request\") sees the service worker's Lookup",
  pwAlgolia.length > 0,
  `${pwAlgolia.length} of ${pwUrls.length}`
)
const titleQuery = encodeURIComponent(FRESH_TITLE).replace(/%20/g, "+")
record(
  "the Lookup carries the page's own title, so it is really this page being asked about",
  rawHit(titleQuery).length > 0 || rawHit(encodeURIComponent(FRESH_TITLE)).length > 0,
  `${rawHit(titleQuery).length} carrying the title`
)

/* And the Lookup cache proves the request happened even if nobody watched. */
const keysAfter = await worker.evaluate(async () => {
  const store = await caches.open("parle")
  return (await store.keys()).map((r) => decodeURIComponent(new URL(r.url).pathname.slice(1)))
}).catch(() => ["<threw>"])
console.log(`\nkeys after the Lookup: ${JSON.stringify(keysAfter)}`)
record(
  "CONTROL — a Lookup record was written, so the background did go out",
  keysAfter.some((k) => k.startsWith("parle/lookup/")),
  `${keysAfter.length} key(s)`
)

raw.close()
await browser.close()
process.exit(tally() === 0 ? 0 : 1)
