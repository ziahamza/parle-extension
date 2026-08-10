/**
 * QUESTION 1 — is the MV3 background service worker there, and can we reach it?
 *
 * Everything else in this spike is moot if this is no. Parle's background holds
 * every Lookup and the whole Coverage model; our harness reaches it with
 * `context.serviceWorkers()`, `worker.evaluate(...)` and the worker's console.
 * So this asks the same three things of Steel, in the same order, and refuses
 * to accept "a worker target exists" as an answer to any of them.
 *
 * Two routes are measured separately on purpose:
 *   - raw CDP `Target.getTargets`, which is what Steel's :9223 nginx passthrough
 *     really exposes, and
 *   - Playwright's `connectOverCDP` → `context.serviceWorkers()`, which is what
 *     56 existing checks are written against.
 * A yes on the first and a no on the second would mean the checks need
 * rewriting; a yes on both means they port.
 */
import { chromium } from "playwright"
import { CDP, cdpWebSocket, record, startSession, tally, until } from "./lib/steel.mjs"

const session = await startSession()
console.log(`session ${session.id}  status=${session.status}`)
console.log(`websocketUrl ${session.websocketUrl}`)

/* Give Chrome time to register the worker the way a first run would. */
await new Promise((r) => setTimeout(r, 3_000))

/* --- Route A: raw CDP, no Playwright in the way. --------------------------- */
const version = await (await fetch(`${CDP}/json/version`)).json()
console.log(`\nbrowser ${version.Browser}`)

const targets = await (await fetch(`${CDP}/json/list`)).json()
console.log("\n/json/list targets:")
for (const t of targets) console.log(`  ${t.type.padEnd(16)} ${t.url}`)

const workerTargets = targets.filter((t) => t.type === "service_worker")
record(
  "raw CDP lists a service_worker target for the extension",
  workerTargets.some((t) => t.url.startsWith("chrome-extension://")),
  workerTargets.map((t) => t.url).join(", ") || "none"
)

/* --- Route B: Playwright over CDP, the way our 56 checks are written. ------ */
const wsEndpoint = await cdpWebSocket()
console.log(`connecting over CDP: ${wsEndpoint}`)
const browser = await chromium.connectOverCDP(wsEndpoint)
const contexts = browser.contexts()
console.log(`\nplaywright contexts: ${contexts.length}`)

const context = contexts[0]
const workerLog = []
const attach = (w) => {
  w.on("console", (m) => workerLog.push(`[${m.type()}] ${m.text()}`))
  w.on("pageerror", (e) => workerLog.push(`[ERROR] ${e.message}`))
}
context.on("serviceworker", attach)
context.serviceWorkers().forEach(attach)

await until(() => context.serviceWorkers().length > 0, 20_000)
const workers = context.serviceWorkers()
console.log(`playwright serviceWorkers(): ${workers.length}`)
for (const w of workers) console.log(`  ${w.url()}`)

record(
  "context.serviceWorkers() returns the extension's worker",
  workers.some((w) => w.url().startsWith("chrome-extension://")),
  workers.map((w) => w.url()).join(", ") || "empty"
)

const worker = workers.find((w) => w.url().startsWith("chrome-extension://"))
if (worker === undefined) {
  console.log("\nno worker to evaluate against — stopping here")
  process.exit(tally() === 0 ? 0 : 1)
}

const extensionId = new URL(worker.url()).host
console.log(`\nextension id: ${extensionId}`)

/* Can we run code INSIDE the worker? */
const identity = await worker.evaluate(() => ({
  id: chrome.runtime.id,
  version: chrome.runtime.getManifest().version,
  name: chrome.runtime.getManifest().name
})).catch((e) => ({ error: String(e) }))
console.log("worker.evaluate identity:", JSON.stringify(identity))
record(
  "worker.evaluate runs code inside the background worker",
  identity.id === extensionId,
  JSON.stringify(identity)
)

/* The check that caught a background registering zero listeners. */
const listening = async () =>
  worker.evaluate(() => ({
    "webNavigation.onCommitted": chrome.webNavigation.onCommitted.hasListeners(),
    "tabs.onUpdated": chrome.tabs.onUpdated.hasListeners(),
    "runtime.onConnect": chrome.runtime.onConnect.hasListeners()
  })).catch(() => ({}))

let attached = {}
for (let attempt = 0; attempt < 20; attempt += 1) {
  attached = await listening()
  if (Object.values(attached).length > 0 && Object.values(attached).every(Boolean)) break
  await new Promise((r) => setTimeout(r, 250))
}
console.log("listeners:", JSON.stringify(attached))
record(
  "the same liveness check our harness makes (listeners attached)",
  Object.values(attached).length === 3 && Object.values(attached).every(Boolean),
  JSON.stringify(attached)
)

/* The Cache-API read the harness uses as ground truth for what is on disk. */
const keys = await worker.evaluate(async () => {
  if (globalThis.caches === undefined) return ["<no CacheStorage>"]
  const store = await globalThis.caches.open("parle")
  const held = await store.keys()
  return held.map((r) => decodeURIComponent(new URL(r.url).pathname.slice(1)))
}).catch((e) => [`<threw: ${e}>`])
console.log("stored keys:", JSON.stringify(keys))
record(
  "storedKeys() — CacheStorage readable from inside the worker",
  Array.isArray(keys) && !String(keys[0] ?? "").startsWith("<"),
  `${keys.length} key(s)`
)

/* Worker console. Provoke one so there is something to catch. */
await worker.evaluate(() => console.info("PARLE-SPIKE-MARKER")).catch(() => {})
await new Promise((r) => setTimeout(r, 1_000))
record(
  "the worker's console is readable from the harness side",
  workerLog.some((line) => line.includes("PARLE-SPIKE-MARKER")),
  workerLog.slice(-3).join(" | ") || "(nothing captured)"
)

console.log("\nworker log:")
for (const line of workerLog) console.log(`  ${line}`)

await browser.close()
process.exit(tally() === 0 ? 0 : 1)
