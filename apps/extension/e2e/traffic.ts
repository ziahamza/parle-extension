/**
 * The audit half of politeness: what this browser ACTUALLY sent to Algolia.
 *
 * The gate (`gate.ts`) paces page-loads on an estimate; this watches the wire
 * and stamps every `hn.algolia.com` request, so the closing report states
 * measured peak and sustained req/s rather than the budget the run intended.
 * A politeness claim without this is the bucket grading its own homework.
 *
 * A raw CDP client with no Playwright in it, ported from the spike that earned
 * it (`spike/steel/lib/rawcdp.mjs`). The first attempt at observing traffic
 * used `playwrightCdpSession.send(method, params, sessionId)` — Playwright's
 * `CDPSession.send` takes only two arguments, so the session id was silently
 * dropped, `Network.enable` went to the browser session (which has no Network
 * domain), the rejection was swallowed, and the observer recorded zero requests
 * while reporting itself healthy. A silent observer is the single most
 * dangerous thing in a suite whose best checks are absence claims, so that
 * route is gone and this is what replaced it.
 *
 * `flatten: true` auto-attach at the BROWSER session is the only route that
 * reaches a service worker's network: sessions arrive as
 * `Target.attachedToTarget`, and every message afterwards carries its own
 * `sessionId` at the top level. `waitForDebuggerOnStart` is true so a target
 * that starts making requests immediately — which is exactly what an MV3
 * background worker does — cannot get its first request in before we are
 * listening.
 */
import { type JsonObject } from "@parle/domain/Refine"

export interface SeenRequest {
  readonly url: string
  readonly method: string
  /** Wall-clock ms, so timestamps merge across shards into one run-wide rate. */
  readonly at: number
}

interface CdpMessage {
  readonly id?: number
  readonly method?: string
  readonly sessionId?: string
  readonly params?: {
    readonly sessionId?: string
    readonly request?: { readonly url: string; readonly method: string }
  }
  readonly error?: unknown
  readonly result?: unknown
}

export interface TrafficWatch {
  /** Every matching request so far, in arrival order. */
  readonly seen: ReadonlyArray<SeenRequest>
  readonly close: () => void
}

export const watchTraffic = async (
  cdpHttp: string,
  matches: (url: string) => boolean
): Promise<TrafficWatch> => {
  // SAFETY: Chrome's CDP client is untyped; this is the documented return of that method.
  const version = (await (await fetch(`${cdpHttp}/json/version`)).json()) as {
    webSocketDebuggerUrl: string
  }
  const advertised = new URL(version.webSocketDebuggerUrl)
  advertised.host = new URL(cdpHttp).host
  const socket = new WebSocket(advertised.toString())
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true })
    socket.addEventListener("error", () => reject(new Error(`no CDP at ${cdpHttp}`)), { once: true })
  })

  let nextId = 1
  const pending = new Map<number, (message: CdpMessage) => void>()
  const send = (method: string, params: JsonObject = {}, sessionId?: string): Promise<CdpMessage> => {
    const id = nextId++
    socket.send(JSON.stringify(sessionId === undefined
      ? { id, method, params }
      : { id, method, params, sessionId }))
    return new Promise((resolve) => pending.set(id, resolve))
  }

  const seen: Array<SeenRequest> = []
  socket.addEventListener("message", (event) => {
    // SAFETY: Chrome's CDP client is untyped; this is the documented return of that method.
    const message = JSON.parse(String(event.data)) as CdpMessage
    if (message.id !== undefined) {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
      return
    }
    if (message.method === "Target.attachedToTarget") {
      const sessionId = message.params?.sessionId
      if (sessionId !== undefined) {
        void send("Network.enable", {}, sessionId)
        void send("Runtime.runIfWaitingForDebugger", {}, sessionId)
      }
      return
    }
    if (message.method === "Network.requestWillBeSent") {
      const request = message.params?.request
      if (request !== undefined && matches(request.url)) {
        seen.push({ url: request.url, method: request.method, at: Date.now() })
      }
    }
  })

  await send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true
  })

  return { seen, close: () => socket.close() }
}

/**
 * Peak and sustained rate over a merged set of request stamps.
 *
 * Peak is the largest count in any sliding one-second window (worst instant the
 * endpoint saw); sustained is total over the whole span. Both are what an
 * operator at Algolia would measure, which is the only definition that counts.
 */
export const ratesOf = (
  stamps: ReadonlyArray<number>
) => {
  if (stamps.length === 0) return { total: 0, peakPerSecond: 0, sustainedPerSecond: 0 }
  const sorted = [...stamps].sort((a, b) => a - b)
  let peak = 1
  let start = 0
  for (let end = 0; end < sorted.length; end += 1) {
    while (sorted[end]! - sorted[start]! > 1000) start += 1
    peak = Math.max(peak, end - start + 1)
  }
  const spanSeconds = Math.max((sorted[sorted.length - 1]! - sorted[0]!) / 1000, 1)
  return {
    total: sorted.length,
    peakPerSecond: peak,
    sustainedPerSecond: Number((sorted.length / spanSeconds).toFixed(2))
  }
}
