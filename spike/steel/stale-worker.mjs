/**
 * The harness's most expensive lesson, asked of Steel.
 *
 * From `harness.ts`, measured and recorded there: "Chrome keeps the background
 * script it registered *in the profile*, and an unpacked extension reloaded at
 * the same manifest version does not replace it. A background built with
 * `console.info("MARKER-A")`, rebuilt to log `MARKER-B` and rerun against this
 * profile, logged `MARKER-A`. A run can therefore pass against code that no
 * longer exists, which is worse than no run at all." The local harness deletes
 * `Default/Service Worker` before every launch because of it.
 *
 * Steel has one user-data dir per container (`/tmp/steel-chrome`), wipes
 * nothing between sessions, and — see q3e — ignores the `userDataDir` session
 * option. So this reproduces the experiment exactly: session 1 against a build
 * that logs MARKER-A, then the file is rewritten on the host to log MARKER-B,
 * then session 2. Whichever marker the worker logs is the answer.
 *
 * Both sessions ask for the same extension by the same name, which is what a
 * CI job re-running against a rebuilt artefact would do.
 */
import * as fs from "node:fs"
import { chromium } from "playwright"
import { API, CDP, cdpWebSocket, record, releaseSession, settle, tally } from "./lib/steel.mjs"

const BUILD = "/home/hzia/repos/parle/spike/steel/fixtures/parle-marked/background.js"

const setMarker = (letter) => {
  const source = fs.readFileSync(BUILD, "utf8")
  fs.writeFileSync(
    BUILD,
    source
      .replace(/__PARLE_BUILD_MARKER="[AB]"/, `__PARLE_BUILD_MARKER="${letter}"`)
      .replace(/PARLE-BUILD-MARKER-[AB]/, `PARLE-BUILD-MARKER-${letter}`)
  )
  console.log(`build on disk is now MARKER-${letter}`)
}

const session = async () => {
  const response = await fetch(`${API}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ extensions: ["parle-marked"], headless: false, skipFingerprintInjection: true })
  })
  if (!response.ok) throw new Error(await response.text())
  await settle(3_000)
  const browser = await chromium.connectOverCDP(await cdpWebSocket())
  const context = browser.contexts()[0]
  const log = []
  const attach = (w) => {
    w.on("console", (m) => log.push(m.text()))
  }
  context.on("serviceworker", attach)
  context.serviceWorkers().forEach(attach)
  for (let i = 0; i < 80 && context.serviceWorkers().length === 0; i += 1) await settle(250)
  const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
  /* Provoke a fresh worker start so its top-level line is logged to us. */
  await worker?.evaluate(() => chrome.runtime.getManifest().version).catch(() => {})
  await settle(2_000)
  /* Two different questions, and the difference is the whole point:
   *   `running` — the marker the EXECUTING worker set on its own globalThis;
   *   `onDisk`  — what the extension's background.js file says right now.
   * A run is only honest when they agree. */
  const running = await worker?.evaluate(() => globalThis.__PARLE_BUILD_MARKER ?? "<none>")
    .catch(() => "<unreadable>")
  const onDisk = await worker?.evaluate(async () => {
    const response = await fetch(chrome.runtime.getURL("background.js"))
    return /__PARLE_BUILD_MARKER="([AB])"/.exec(await response.text())?.[1] ?? "<none>"
  }).catch(() => "<unreadable>")
  await browser.close()
  return { log, running, onDisk }
}

setMarker("A")
const first = await session()
console.log(`session 1: running=${first.running} onDisk=${first.onDisk} log=${JSON.stringify(first.log.slice(0, 3))}`)
record(
  "session 1 is running the MARKER-A build",
  first.running === "A" && first.onDisk === "A",
  `running ${first.running}, on disk ${first.onDisk}`
)

await releaseSession()
await settle(2_000)
setMarker("B")

const second = await session()
console.log(`session 2: running=${second.running} onDisk=${second.onDisk} log=${JSON.stringify(second.log.slice(0, 3))}`)
record(
  "the rebuilt background really is on disk for session 2",
  second.onDisk === "B",
  `on disk ${second.onDisk}`
)
record(
  "session 2 EXECUTES the rebuilt background rather than the one Chrome kept",
  second.running === "B",
  second.running === "A"
    ? "still executing MARKER-A while MARKER-B is on disk — a run here passes against code that no longer exists"
    : `running ${second.running}`
)

setMarker("A")
process.exit(tally() === 0 ? 0 : 1)
