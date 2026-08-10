/**
 * The thing q3 tripped over, isolated and measured on purpose.
 *
 * `harness.ts` deletes `Default/Service Worker` before every launch because a
 * run that inherits the previous run's profile can pass against code and data
 * that no longer exist — "worse than no run at all", and the way a deliberately
 * broken build was once observed passing. That property is not optional; it is
 * the reason the local harness is trustworthy.
 *
 * So: what does Steel do between sessions?
 *
 *   1. Does `POST /v1/sessions` with the same options relaunch Chrome at all,
 *      or does the previous session's tabs and storage carry over?
 *   2. Does `POST /v1/sessions/release` end the browser?
 *   3. Does the documented `userDataDir` session option actually take effect?
 *      (Read `session.service.ts`: `options.userDataDir || options.persist ===
 *      true ? persistPath : defaultPath` — `||` binds tighter than `?:`, so
 *      passing ANY userDataDir selects Steel's own fixed persist directory and
 *      never the caller's. This checks that reading against the container.)
 */
import { API, record, releaseSession, settle, startSession, tally } from "./lib/steel.mjs"
import { RawCdp } from "./lib/rawcdp.mjs"
import { CDP } from "./lib/steel.mjs"

const marker = `PARLE-ISOLATION-${Date.now().toString(36).toUpperCase()}`

const targets = async () => (await (await fetch(`${CDP}/json/list`)).json()).map((t) => t.url)

/* --- session A: leave a mark ------------------------------------------------ */
const a = await startSession()
console.log(`session A ${a.id}`)
await settle(3_000)

const raw = await RawCdp.open(CDP)
const { targetId } = await raw.send("Target.createTarget", { url: `https://example.com/?${marker}` })
await settle(2_000)
const afterA = await targets()
console.log("targets in session A:")
for (const url of afterA) console.log(`  ${url.slice(0, 90)}`)
record("session A opened a page carrying a marker", afterA.some((u) => u.includes(marker)))
raw.close()

/* --- release, then session B with identical options ------------------------ */
const releaseStatus = await releaseSession()
console.log(`\nPOST /v1/sessions/release -> ${releaseStatus}`)
await settle(2_000)
const afterRelease = await fetch(`${CDP}/json/list`).then((r) => r.json()).catch(() => null)
/* Recorded as a measurement, not as a wish: release closes the session's
 * tabs but leaves the browser process and the CDP endpoint up, so a client
 * that assumes "released means gone" is wrong. */
record(
  "release closes the session's tabs",
  afterRelease === null || !afterRelease.some((t) => t.url.includes(marker)),
  afterRelease === null
    ? "CDP endpoint gone entirely"
    : `CDP endpoint still up with ${afterRelease.length} target(s): ${afterRelease.map((t) => t.url.slice(0, 40)).join(", ")}`
)

const b = await startSession()
console.log(`session B ${b.id}`)
await settle(3_000)
const afterB = await targets()
console.log("targets in session B:")
for (const url of afterB) console.log(`  ${url.slice(0, 90)}`)
record(
  "a NEW session does not inherit the previous session's tabs",
  !afterB.some((u) => u.includes(marker)),
  afterB.some((u) => u.includes(marker))
    ? "the marker page from session A is still open"
    : "clean"
)

/* --- does userDataDir do anything? ------------------------------------------ */
const asked = "/tmp/parle-spike-asked-for-this"
await fetch(`${API}/v1/sessions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ extensions: ["parle"], headless: false, userDataDir: asked })
}).then((r) => r.text()).catch(() => "")
await settle(3_000)

const { execFileSync } = await import("node:child_process")
const logs = execFileSync("docker", ["logs", "--tail", "400", "steel-spike"]).toString()
/* The launch options are logged as an escaped JSON string inside a JSON log
 * line, so the quotes on the wire are `\\"`. */
const dirs = [...logs.matchAll(/userDataDir\\?": ?\\?"([^\\"]+)/g)].map((m) => m[1])
const lastDir = dirs[dirs.length - 1] ?? "(not logged)"
console.log(`\nuserDataDir values Chrome was actually launched with: ${JSON.stringify([...new Set(dirs)])}`)
record(
  "the session's userDataDir option is honoured",
  lastDir === asked,
  `asked for ${asked}, got ${lastDir}`
)

/* --- does the extension's own storage survive a new session? ---------------- */
const listed = await targets()
console.log(`\nfinal targets: ${listed.length}`)
process.exit(tally() === 0 ? 0 : 1)
