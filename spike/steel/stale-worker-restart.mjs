/**
 * Does restarting the container fix what `stale-worker.mjs` found?
 *
 * It is the only lever available — `userDataDir` is ignored (q3e), and there is
 * no "wipe the profile" call in the API — so it had better work, and the cost
 * of it is what turns "start a session" into "recreate a container".
 *
 * Run as: set the build to MARKER-B, recreate the container, then ask the
 * worker which code it is executing.
 */
import { chromium } from "playwright"
import { API, cdpWebSocket, record, settle, tally } from "./lib/steel.mjs"

const response = await fetch(`${API}/v1/sessions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ extensions: ["parle-marked"], headless: false, skipFingerprintInjection: true })
})
if (!response.ok) throw new Error(await response.text())
await settle(3_000)

const browser = await chromium.connectOverCDP(await cdpWebSocket())
const context = browser.contexts()[0]
for (let i = 0; i < 80 && context.serviceWorkers().length === 0; i += 1) await settle(250)
const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
const running = await worker?.evaluate(() => globalThis.__PARLE_BUILD_MARKER ?? "<none>")
console.log(`after a container recreate, the worker is executing MARKER-${running}`)
record(
  "recreating the container does pick up the rebuilt background",
  running === "B",
  `running ${running}`
)
await browser.close()
process.exit(tally() === 0 ? 0 : 1)
