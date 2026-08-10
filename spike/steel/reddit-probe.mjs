/**
 * The Reddit note — recorded so nobody has to guess what produced it.
 *
 * Reddit 403s this datacenter IP. Steel ships stealth configs, anti-bot
 * handling and rotating proxies, and it would be trivial to switch them on,
 * watch Reddit answer, and write "Reddit works under Steel". That would be a
 * fact about Steel's evasion, not about the product, which ships to an ordinary
 * reader's ordinary Chrome. So NOTHING is switched on here:
 *
 *   - no `proxyUrl`
 *   - `skipFingerprintInjection: true` (Steel's fingerprint spoofing OFF)
 *   - no stealth args, no user-agent override, no `blockAds`
 *   - the same request the shipped background makes, issued from inside the
 *     shipped background worker
 *
 * It is run identically against both harnesses, from the same host and the same
 * public IP, so the only variable is the harness. Whatever it says generalises
 * to nothing except "this box, today".
 *
 *   node reddit-probe.mjs local
 *   node reddit-probe.mjs steel
 */
import * as fs from "node:fs"
import { chromium } from "playwright"

const mode = process.argv[2] ?? "local"
const EXTENSION = "/home/hzia/repos/parle/apps/extension/.output/chrome-mv3"
const settle = (ms) => new Promise((r) => setTimeout(r, ms))

const TARGETS = [
  "https://www.reddit.com/api/info.json?url=https%3A%2F%2Fwww.nature.com%2Farticles%2Fd41586-024-02012-5",
  "https://old.reddit.com/search?sort=top&q=url%3Ahttps%3A%2F%2Fwww.nature.com%2Farticles%2Fd41586-024-02012-5",
  "https://hn.algolia.com/api/v1/search?query=https%3A%2F%2Fwww.nature.com%2Farticles%2Fd41586-024-02012-5&restrictSearchableAttributes=url&tags=story&hitsPerPage=30"
]

let worker
let close
if (mode === "steel") {
  const api = process.env.STEEL_API ?? "http://localhost:3000"
  const cdp = process.env.STEEL_CDP ?? "http://localhost:9223"
  const response = await fetch(`${api}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ extensions: ["parle"], headless: false, skipFingerprintInjection: true })
  })
  if (!response.ok) throw new Error(await response.text())
  await settle(3_000)
  const version = await (await fetch(`${cdp}/json/version`)).json()
  const ws = new URL(version.webSocketDebuggerUrl)
  ws.host = new URL(cdp).host
  const browser = await chromium.connectOverCDP(ws.toString())
  const context = browser.contexts()[0]
  for (let i = 0; i < 80 && context.serviceWorkers().length === 0; i += 1) await settle(250)
  worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
  close = () => browser.close()
} else {
  const profile = "/home/hzia/repos/parle/spike/steel/.reddit-profile"
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
      "--disable-features=DisableLoadExtensionCommandLineSwitch"
    ]
  })
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 60_000 }))
  close = () => context.close()
}

console.log(`mode: ${mode}`)
console.log(`user agent: ${await worker.evaluate(() => navigator.userAgent)}`)
console.log("config: no proxy, skipFingerprintInjection=true, no stealth args, no UA override")
console.log("")

for (const url of TARGETS) {
  const answer = await worker.evaluate(async (target) => {
    const started = Date.now()
    try {
      const response = await fetch(target)
      const body = await response.text()
      return { status: response.status, bytes: body.length, ms: Date.now() - started }
    } catch (error) {
      return { status: `threw: ${String(error)}`, bytes: 0, ms: Date.now() - started }
    }
  }, url)
  console.log(`  ${String(answer.status).padEnd(8)} ${String(answer.bytes).padStart(8)} bytes  ${String(answer.ms).padStart(5)}ms  ${url.slice(0, 70)}`)
}

await close()
