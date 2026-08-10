/**
 * QUESTION 5 — the same 20 pages, on both harnesses, in real seconds.
 *
 * One file, two backends, so the work being timed is provably identical:
 *
 *   node sweep.mjs local            # launchPersistentContext under Xvfb
 *   node sweep.mjs steel            # a Steel session over its CDP passthrough
 *
 * What one "page" costs is defined the same way in both: navigate the tab the
 * reader is actually looking at, then wait until the background has ASKED about
 * that page — observed as an `hn.algolia.com` request carrying that page's own
 * unique title. That is the product's real unit of work (navigation → Reading →
 * Enquiry → Lookup), not a proxy for it, and it is measured with the raw CDP
 * observer that `control-local-traffic.mjs` proved works on both.
 *
 * The 20 addresses and titles are minted per run, so nothing can be served from
 * anyone's cache — ours, Chrome's, or Algolia's — and run N+1 is not cheaper
 * than run N. That matters more than it sounds: every early attempt at this
 * measurement was contaminated by exactly that.
 *
 * Startup is timed separately from the sweep, because they are different
 * questions and a harness can be fast at one and slow at the other.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { chromium } from "playwright"
import { RawCdp } from "./lib/rawcdp.mjs"

const mode = process.argv[2] ?? "local"
const label = process.env.SWEEP_LABEL ?? mode
const PAGES = Number(process.env.SWEEP_PAGES ?? 20)
const PER_PAGE_TIMEOUT = Number(process.env.SWEEP_TIMEOUT ?? 30_000)
const EXTENSION = "/home/hzia/repos/parle/apps/extension/.output/chrome-mv3"

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase()
const subject = (i) => ({
  url: `https://parle-sweep-${stamp.toLowerCase()}-${i}.com/piece`,
  title: `Sweep ${stamp} P${i} Zzqx`,
  token: `Sweep+${stamp}+P${i}+Zzqx`
})

const settle = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Number(process.hrtime.bigint() / 1_000_000n)

const startLocal = async () => {
  const profile = process.env.SWEEP_PROFILE ?? `/home/hzia/repos/parle/spike/steel/.sweep-profile-${label}`
  const port = Number(process.env.SWEEP_DEBUG_PORT ?? 9500)
  fs.rmSync(profile, { recursive: true, force: true })
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    channel: "chromium",
    viewport: null,
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=DisableLoadExtensionCommandLineSwitch",
      `--remote-debugging-port=${port}`
    ]
  })
  const worker = context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 60_000 }))
  const raw = await RawCdp.open(`http://127.0.0.1:${port}`)
  return { context, worker, raw, close: () => context.close() }
}

const startSteel = async () => {
  const api = process.env.STEEL_API ?? "http://localhost:3000"
  const cdp = process.env.STEEL_CDP ?? "http://localhost:9223"
  const response = await fetch(`${api}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      extensions: ["parle"],
      headless: false,
      dimensions: { width: 1280, height: 900 },
      skipFingerprintInjection: true
    })
  })
  if (!response.ok) throw new Error(`POST /v1/sessions ${response.status}: ${await response.text()}`)
  await settle(2_500)
  const version = await (await fetch(`${cdp}/json/version`)).json()
  const ws = new URL(version.webSocketDebuggerUrl)
  ws.host = new URL(cdp).host
  const browser = await chromium.connectOverCDP(ws.toString())
  const context = browser.contexts()[0]
  for (let i = 0; i < 120 && context.serviceWorkers().length === 0; i += 1) await settle(250)
  const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
  const raw = await RawCdp.open(cdp)
  return { context, worker, raw, close: () => browser.close() }
}

const startedAt = now()
const h = mode === "steel" ? await startSteel() : await startLocal()
if (h.worker === undefined) throw new Error("no background service worker")

const seen = []
await h.raw.watchEverything((r) => seen.push(r.url))
const extensionId = new URL(h.worker.url()).host

/* Consent, so the sweep measures the armed product rather than a silent one. */
const welcome = await h.context.newPage()
await welcome.goto(`chrome-extension://${extensionId}/welcome.html`)
await welcome.bringToFront()
await welcome.locator("#on").click().catch(() => {})
await settle(600)
await welcome.close()
const readyAt = now()

await h.context.route(
  (url) => url.hostname.startsWith(`parle-sweep-${stamp.toLowerCase()}-`),
  (route) => {
    const index = Number(/-(\d+)\.com$/.exec(new URL(route.request().url()).hostname)?.[1] ?? 0)
    const { title } = subject(index)
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1>` +
        `<p>One page of a sweep.</p>`
    })
  }
)

const page = h.context.pages().find((p) => !p.url().startsWith("chrome-extension://")) ??
  (await h.context.newPage())

const sweepAt = now()
const perPage = []
let asked = 0
for (let i = 0; i < PAGES; i += 1) {
  const { url, token } = subject(i)
  const before = now()
  await page.bringToFront()
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: PER_PAGE_TIMEOUT }).catch(() => {})
  const deadline = Date.now() + PER_PAGE_TIMEOUT
  let found = false
  for (;;) {
    found = seen.some((u) => u.includes("hn.algolia.com") && u.includes(token))
    if (found || Date.now() > deadline) break
    await settle(100)
  }
  if (found) asked += 1
  perPage.push(now() - before)
}
const doneAt = now()

const sorted = [...perPage].sort((a, b) => a - b)
const result = {
  label,
  mode,
  pages: PAGES,
  askedAbout: asked,
  startupMs: readyAt - startedAt,
  sweepMs: doneAt - sweepAt,
  totalMs: doneAt - startedAt,
  medianPageMs: sorted[Math.floor(sorted.length / 2)],
  slowestPageMs: sorted[sorted.length - 1],
  fastestPageMs: sorted[0],
  perPageMs: perPage
}
console.log(JSON.stringify(result))

const out = process.env.SWEEP_OUT
if (out !== undefined) fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`)

h.raw.close()
await h.close().catch(() => {})
process.exit(asked === PAGES ? 0 : 2)
