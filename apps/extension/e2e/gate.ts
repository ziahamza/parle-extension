/**
 * The one politeness gate for a whole sharded run.
 *
 * ADR 0014: Hacker News' Algolia ceiling is 10,000/hr and it meters THE
 * READER'S IP. Every shard on this box shares one IP, so pacing per shard is
 * not pacing at all — 16 shards each being individually polite is collectively
 * abusive, and getting this box's IP blocked takes ALL future QA down with it.
 * Hence a single token bucket, owned by the coordinator, that every shard asks
 * before every page-load.
 *
 * PAGE-LOADS, not fetches — that asymmetry is the whole design. The extension
 * itself does the asking: one navigation makes the background issue up to
 * `MAX_ADDRESSES` (4) URL searches plus one title search, and nothing outside
 * the extension can intercept them without testing something other than the
 * shipped code. So the gate paces the cause (navigation) and charges it the
 * *expected* Algolia cost, and the sweep separately MEASURES the effect with a
 * CDP traffic observer (`traffic.ts`) and reports real req/s — the bucket is
 * the budget, the observer is the audit.
 *
 * The per-run LRU rides on the same counter. A Lookup already made in a given
 * profile is not made again (the extension's own Lookup Record sees to that),
 * so a repeat visit — an opener that is also a classic, a screenshot pass over
 * a page the shard already swept — is granted immediately and charged nothing.
 * The key is (profile, address) rather than address alone, because profiles do
 * not share caches: the same address in a *different* shard is a real request
 * and pays full price. The coordinator keeps cross-shard repeats out of the
 * partition for exactly that reason.
 *
 * Loopback HTTP long-poll rather than a lockfile counter: a shard asks and the
 * response simply does not arrive until the bucket can afford it, which gives
 * ordering (FIFO) and backpressure for free and needs no polling loop in N
 * places.
 */
import * as http from "node:http"
import type { AddressInfo } from "node:net"

export interface GateOptions {
  /** Sustained Algolia budget across ALL shards, in requests per second. */
  readonly requestsPerSecond?: number
  /** How deep a burst the bucket tolerates, in requests. */
  readonly burst?: number
  /**
   * What one fresh page-load is charged, in requests. Typical is two (one URL
   * search on the elected address, one title search); a heavily aliased page
   * can reach five. 2.5 keeps the *sustained* rate at or under budget while
   * letting the observer catch any page that costs more.
   */
  readonly costPerPage?: number
}

export interface Gate {
  readonly url: string
  /** Grants so far, for the closing report: [cached, charged]. */
  readonly tally: () => { readonly charged: number; readonly cached: number }
  readonly close: () => Promise<void>
}

const normalise = (address: string): string => address.trim().toLowerCase().replace(/\/+$/, "")

export const startGate = async (options: GateOptions = {}): Promise<Gate> => {
  const rate = options.requestsPerSecond ?? 5
  // Two page-loads' worth. Ten was measured letting four navigations land in
  // the same second at run start — a 10 req/s window Algolia would see even
  // though the sustained rate stayed under budget.
  const burst = options.burst ?? 5
  const cost = options.costPerPage ?? 2.5

  let tokens = burst
  let refilledAt = Date.now()
  let charged = 0
  let cached = 0
  const granted = new Set<string>()
  const waiting: Array<{ readonly key: string; readonly respond: () => void }> = []

  const pump = () => {
    const now = Date.now()
    tokens = Math.min(burst, tokens + (rate * (now - refilledAt)) / 1000)
    refilledAt = now
    while (waiting.length > 0 && tokens >= cost) {
      const next = waiting.shift()
      if (next === undefined) break
      tokens -= cost
      charged += 1
      granted.add(next.key)
      next.respond()
    }
  }
  const pumping = setInterval(pump, 50)

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname !== "/acquire") {
      response.writeHead(404).end()
      return
    }
    const profile = url.searchParams.get("profile") ?? ""
    const address = normalise(url.searchParams.get("address") ?? "")
    const key = `${profile} ${address}`
    const respond = (wasCached: boolean) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ cached: wasCached }))
    }
    // This profile has already loaded this address on this run: its extension
    // will not ask Algolia again, so there is nothing to pace.
    if (granted.has(key)) {
      cached += 1
      respond(true)
      return
    }
    waiting.push({ key, respond: () => respond(false) })
    pump()
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port

  return {
    url: `http://127.0.0.1:${port}`,
    tally: () => ({ charged, cached }),
    close: () => {
      clearInterval(pumping)
      return new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
    }
  }
}

/**
 * The shard's half: ask, and do not navigate until the answer comes. The reply
 * says whether the visit was charged or recognised as a repeat, which the shard
 * records but never acts on — pacing decisions belong to one place only.
 */
export const acquireVisit = async (
  gateUrl: string,
  profile: string,
  address: string
): Promise<{ readonly cached: boolean }> => {
  const query = `profile=${encodeURIComponent(profile)}&address=${encodeURIComponent(address)}`
  const response = await fetch(`${gateUrl}/acquire?${query}`)
  return (await response.json()) as { cached: boolean }
}
