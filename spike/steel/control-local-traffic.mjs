/**
 * The control that makes q3's answer readable.
 *
 * Steel saw no service-worker traffic on either observer. That is only evidence
 * about Steel if the SAME observer code, pointed at the SAME extension, sees it
 * on the harness we already have. So this launches Chrome the way
 * `apps/extension/e2e/harness.ts` launches it — persistent context, headed under
 * Xvfb, `--load-extension` — and runs both observers over it:
 *
 *   A. `context.on("request")`, on a context obtained from
 *      `launchPersistentContext` rather than from `connectOverCDP`.
 *   C. `lib/rawcdp.mjs`, the same raw browser-level auto-attach, over this
 *      Chrome's own `--remote-debugging-port`.
 *
 * Nothing in the repo is modified: the profile is this directory's own, the
 * build is the one already on disk.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { chromium } from "playwright"
import { RawCdp } from "./lib/rawcdp.mjs"
import { record, settle, tally, until } from "./lib/steel.mjs"
import { pillPanel } from "./lib/pill.mjs"

const EXTENSION = "/home/hzia/repos/parle/apps/extension/.output/chrome-mv3"
const PROFILE = "/home/hzia/repos/parle/spike/steel/.local-profile"
const PORT = 9412
const stamp = Date.now().toString(36).toUpperCase()
const FRESH = `https://parle-local-control-${stamp.toLowerCase()}.com/piece`
const FRESH_TITLE = `Xqzvb Wrlmt ${stamp} Nnkp`

/* The same wipe harness.ts does, for the same reason. */
fs.rmSync(path.join(PROFILE, "Default", "Service Worker"), { recursive: true, force: true })

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  channel: "chromium",
  viewport: null,
  args: [
    `--disable-extensions-except=${EXTENSION}`,
    `--load-extension=${EXTENSION}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    `--remote-debugging-port=${PORT}`
  ]
})

const pwUrls = []
context.on("request", (r) => pwUrls.push(r.url()))

const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }))
const extensionId = new URL(worker.url()).host
console.log(`extension ${extensionId}`)

const raw = await RawCdp.open(`http://127.0.0.1:${PORT}`)
const rawUrls = []
await raw.watchEverything((r) => rawUrls.push(r))
await settle(1_500)
console.log(`raw CDP attached to ${raw.targets.size} target(s):`)
for (const label of raw.targets.values()) console.log(`  ${label.slice(0, 100)}`)

const welcome = await context.newPage()
await welcome.goto(`chrome-extension://${extensionId}/welcome.html`)
await welcome.bringToFront()
await welcome.locator("#on").click().catch(() => {})
await settle(800)
await welcome.close()

const page = context.pages()[0] ?? (await context.newPage())
await context.route(FRESH, (route) =>
  route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><meta charset="utf-8"><title>${FRESH_TITLE}</title><h1>${FRESH_TITLE}</h1>`
  }))

pwUrls.length = 0
rawUrls.length = 0
await page.bringToFront()
await page.goto(FRESH, { waitUntil: "domcontentloaded" }).catch(() => {})
await settle(12_000)

const rawAlgolia = rawUrls.filter((r) => r.url.includes("hn.algolia.com"))
const pwAlgolia = pwUrls.filter((u) => u.includes("hn.algolia.com"))
console.log(`\nraw CDP:    ${rawUrls.length} request(s), ${rawAlgolia.length} to algolia`)
console.log(`playwright: ${pwUrls.length} request(s), ${pwAlgolia.length} to algolia`)
for (const r of rawUrls.slice(0, 15)) console.log(`  [${r.from.slice(0, 55)}] ${r.url.slice(0, 120)}`)

record(
  "[A local] context.on(\"request\") on a launchPersistentContext sees the worker's Lookup",
  pwAlgolia.length > 0,
  `${pwAlgolia.length} of ${pwUrls.length}`
)
record(
  "[C local] the same raw CDP observer sees the worker's Lookup",
  rawAlgolia.length > 0,
  rawAlgolia.length === 0 ? "none" : `${rawAlgolia.length} from ${rawAlgolia[0].from.slice(0, 60)}`
)

const keys = await worker.evaluate(async () => {
  const store = await caches.open("parle")
  return (await store.keys()).map((r) => decodeURIComponent(new URL(r.url).pathname.slice(1)))
}).catch(() => ["<threw>"])
console.log(`keys: ${JSON.stringify(keys)}`)
record(
  "CONTROL — a Lookup record was written",
  keys.some((k) => k.startsWith("parle/lookup/")),
  `${keys.length} key(s)`
)

raw.close()
await context.close()
process.exit(tally() === 0 ? 0 : 1)
