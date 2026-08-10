/**
 * A CDP client with no Playwright in it, because question 3 turned out to need one.
 *
 * The first attempt at observing traffic used
 * `playwrightCdpSession.send(method, params, sessionId)` — Playwright's
 * `CDPSession.send` takes only two arguments, so the session id was silently
 * dropped, `Network.enable` went to the browser session (which has no Network
 * domain), the rejection was swallowed by the `.catch`, and the observer
 * recorded zero requests while reporting itself healthy. A silent observer is
 * the single most dangerous thing in a suite whose best checks are absence
 * claims, so that route is gone and this is what replaced it.
 *
 * `flatten: true` auto-attach at the BROWSER session is the only route that
 * reaches a service worker's network: sessions arrive as
 * `Target.attachedToTarget`, and every message afterwards carries its own
 * `sessionId` at the top level.
 */

export class RawCdp {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = []
    this.targets = new Map()
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) {
        const settle = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (settle !== undefined) {
          if (message.error !== undefined) settle.reject(new Error(JSON.stringify(message.error)))
          else settle.resolve(message.result)
        }
        return
      }
      for (const listener of this.listeners) listener(message)
    })
  }

  static async open(cdpHttp) {
    const version = await (await fetch(`${cdpHttp}/json/version`)).json()
    const advertised = new URL(version.webSocketDebuggerUrl)
    advertised.host = new URL(cdpHttp).host
    const socket = new WebSocket(advertised.toString())
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true })
      socket.addEventListener("error", reject, { once: true })
    })
    return new RawCdp(socket)
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    const message = sessionId === undefined
      ? { id, method, params }
      : { id, method, params, sessionId }
    this.socket.send(JSON.stringify(message))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  on(listener) {
    this.listeners.push(listener)
  }

  /**
   * Attach to every target, now and in future, and turn Network on in each.
   *
   * `waitForDebuggerOnStart` is true so that a target which starts making
   * requests immediately — which is exactly what an MV3 background worker
   * does — cannot get its first request in before we are listening.
   */
  async watchEverything(onRequest) {
    this.on((message) => {
      if (message.method === "Target.attachedToTarget") {
        const { sessionId, targetInfo } = message.params
        this.targets.set(sessionId, `${targetInfo.type}:${targetInfo.url}`)
        this.send("Network.enable", {}, sessionId).catch(() => {})
        this.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {})
        return
      }
      if (message.method === "Network.requestWillBeSent") {
        onRequest({
          url: message.params.request.url,
          method: message.params.request.method,
          from: this.targets.get(message.sessionId) ?? `session:${message.sessionId}`
        })
      }
    })
    await this.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true
    })
  }

  close() {
    this.socket.close()
  }
}
