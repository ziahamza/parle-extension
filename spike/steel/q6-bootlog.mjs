/**
 * The one thing in `harness.ts` that nothing above measured: can the harness
 * hear the background worker's FIRST TURN?
 *
 * `harness.ts` attaches its console and pageerror handlers *before* awaiting the
 * worker, and says why in a comment that cost an hour to earn: "A worker that
 * throws during startup does so within milliseconds of being created, so a
 * handler attached after `waitForEvent` resolves has already missed the only
 * message that matters." That log is what the launch failure prints — it is the
 * difference between "the extension is not listening" and knowing why.
 *
 * The two harnesses are structurally different here and it is not a detail:
 *
 *   local — WE launch Chrome, so we exist before the extension does.
 *   Steel — Chrome is launched inside the container by `POST /v1/sessions`, and
 *           the earliest a client can connect is after that call returns.
 *
 * So this asks the same question of both, with the same build: a background that
 * logs one line at module top level. Does the line reach the harness?
 *
 *   node q6-bootlog.mjs local     # needs xvfb-run
 *   node q6-bootlog.mjs steel     # needs the compose container up
 *
 * The build is `fixtures/parle-marked`, unchanged and reused from
 * `stale-worker.mjs` — its `background.js` opens with
 * `console.info("PARLE-BUILD-MARKER-A")`. Nothing in apps/extension is touched.
 */
import * as fs from "node:fs"
import { chromium } from "playwright"
import { API, cdpWebSocket, record, releaseSession, settle, tally } from "./lib/steel.mjs"

const mode = process.argv[2] ?? "local"
const MARKER = "PARLE-BUILD-MARKER-" /* A or B; the fixture keeps whichever the last run left */
const BUILD = "/home/hzia/repos/parle/spike/steel/fixtures/parle-marked"

/** Attach exactly as harness.ts does, then wait for the worker. */
const listen = async (context) => {
  const log = []
  const attach = (w) => {
    w.on("console", (m) => log.push(`[${m.type()}] ${m.text()}`))
    w.on("pageerror", (e) => log.push(`[ERROR] ${e.message}`))
  }
  context.on("serviceworker", attach)
  context.serviceWorkers().forEach(attach)
  const existing = context.serviceWorkers()
  const worker = existing[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 30_000 }).catch(() => null))
  return { log, worker }
}

/** WE launch the browser: the harness exists before the extension does. */
const local = async () => {
  const profile = "/home/hzia/repos/parle/spike/steel/.bootlog-profile"
  fs.rmSync(profile, { recursive: true, force: true })
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    channel: "chromium",
    viewport: null,
    args: [
      `--disable-extensions-except=${BUILD}`,
      `--load-extension=${BUILD}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=DisableLoadExtensionCommandLineSwitch"
    ]
  })
  const { log, worker } = await listen(context)
  await settle(4_000)
  const listening = await worker?.evaluate(() =>
    chrome.webNavigation.onCommitted.hasListeners()).catch(() => null)
  await context.close()
  return { log, listening }
}

/**
 * Steel launches the browser. We connect afterwards, which is the whole point.
 *
 * `settle(3000)` is not padding — `POST /v1/sessions` returns before Chrome's
 * CDP endpoint is answering, and every script in this spike waits the same
 * amount before `connectOverCDP`. Shortening it does not move the answer; it
 * just fails to connect.
 */
const steel = async (label) => {
  const response = await fetch(`${API}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      extensions: ["parle-marked"],
      headless: false,
      skipFingerprintInjection: true
    })
  })
  if (!response.ok) throw new Error(`POST /v1/sessions ${response.status}: ${await response.text()}`)
  await settle(3_000)
  const browser = await chromium.connectOverCDP(await cdpWebSocket())
  const context = browser.contexts()[0]
  const { log, worker } = await listen(context)
  await settle(4_000)
  const listening = await worker?.evaluate(() =>
    chrome.webNavigation.onCommitted.hasListeners()).catch(() => null)
  await browser.close()
  console.log(`  ${label}: worker ${worker ? "found" : "MISSING"}, listening=${listening}, log=${JSON.stringify(log)}`)
  return { log, listening }
}

if (mode === "local") {
  const first = await local()
  console.log(`  local: listening=${first.listening}, log=${JSON.stringify(first.log)}`)
  record(
    "[local] the worker's FIRST-TURN console line reaches the harness",
    first.log.some((line) => /PARLE-BUILD-MARKER-[AB]/.test(line)),
    first.log.join(" | ") || "nothing was heard"
  )
  const second = await local()
  console.log(`  local (second launch): log=${JSON.stringify(second.log)}`)
  record(
    "[local] and again on a second launch, so it is not luck",
    second.log.some((line) => /PARLE-BUILD-MARKER-[AB]/.test(line)),
    second.log.join(" | ") || "nothing was heard"
  )
} else {
  const first = await steel("steel session 1 (fresh container)")
  record(
    "[steel] the worker's FIRST-TURN console line reaches the harness",
    first.log.some((line) => /PARLE-BUILD-MARKER-[AB]/.test(line)),
    first.log.join(" | ") || "nothing was heard — the worker had already booted when we connected"
  )
  record(
    "[steel] ...and the worker is reachable and listening regardless",
    first.listening === true,
    `listening=${first.listening}`
  )
  await releaseSession()
  await settle(2_000)
  const second = await steel("steel session 2 (same container, the CI re-run case)")
  record(
    "[steel] and on a second session in the same container",
    second.log.some((line) => /PARLE-BUILD-MARKER-[AB]/.test(line)),
    second.log.join(" | ") || "nothing was heard"
  )
}

process.exit(tally() === 0 ? 0 : 1)
