/**
 * The smallest possible Steel client: start a session, stop a session.
 *
 * Deliberately raw `fetch` rather than the `steel-sdk` package, so that what is
 * being measured is Steel's own HTTP contract and not a client library's
 * defaults. Every field passed here appears verbatim in the container log line
 * `[CDPService] Launch Options:`, which is how the launch args in
 * `out/q1-*.txt` were verified rather than assumed.
 */

export const API = process.env.STEEL_API ?? "http://localhost:3000"
export const CDP = process.env.STEEL_CDP ?? "http://localhost:9223"

/**
 * Ask Steel for a browser with our unpacked build loaded.
 *
 * `headless: false` is not a preference. Steel's default is headless and the
 * upstream image starts no X server; the compose file in this directory adds
 * Xvfb for exactly this call. Both modes are measured in `q2-headless.mjs`.
 */
export const startSession = async (options = {}) => {
  const body = {
    extensions: ["parle"],
    headless: false,
    dimensions: { width: 1280, height: 900 },
    skipFingerprintInjection: true,
    ...options
  }
  const response = await fetch(`${API}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`POST /v1/sessions ${response.status}: ${text}`)
  return JSON.parse(text)
}

export const releaseSession = async (api = API) => {
  const response = await fetch(`${api}/v1/sessions/release`, { method: "POST" })
  return response.status
}

/**
 * The browser-level CDP WebSocket, with the port put back.
 *
 * Measured, and it is the first thing that breaks: Steel's nginx front for CDP
 * sets `proxy_set_header Host $host`, so Chrome's `/json/version` comes back
 * advertising `ws://localhost/devtools/browser/<id>` — no port. Playwright's
 * `connectOverCDP("http://localhost:9223")` takes that at face value, dials
 * port 80, fails, and then reports something misleading about certificates.
 *
 * So the ws URL is rebuilt against the endpoint we actually asked for. One
 * line, but it has to be written by hand in every client, and nothing in the
 * error message points at it.
 */
export const cdpWebSocket = async (cdp = CDP) => {
  const version = await (await fetch(`${cdp}/json/version`)).json()
  const advertised = new URL(version.webSocketDebuggerUrl)
  const endpoint = new URL(cdp)
  advertised.host = endpoint.host
  return advertised.toString()
}

export const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll until true, or give up — never `await settle(bigNumber)` and hope. */
export const until = async (condition, within = 30_000) => {
  const deadline = Date.now() + within
  for (;;) {
    if (await condition()) return true
    if (Date.now() > deadline) return false
    await settle(250)
  }
}

let passed = 0
let failed = 0
export const record = (name, ok, detail = "") => {
  if (ok) passed += 1
  else failed += 1
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}
export const tally = () => {
  console.log(`\n${passed}/${passed + failed} checks passed`)
  return failed
}
