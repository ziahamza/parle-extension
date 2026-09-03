import { afterEach, describe, expect, it, vi } from "vitest"
import { PanelOpened, Watch } from "../wire/Wire.ts"

interface FakePort {
  readonly posted: Array<unknown>
  readonly disconnected: Array<() => void>
  readonly postMessage: (message: unknown) => void
  readonly onMessage: { readonly addListener: (listener: (message: unknown) => void) => void }
  readonly onDisconnect: { readonly addListener: (listener: () => void) => void }
  readonly disconnect: () => void
}

const runtime = vi.hoisted(() => ({ ports: [] as Array<FakePort> }))

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      connect: () => {
        const disconnected: Array<() => void> = []
        const port: FakePort = {
          posted: [],
          disconnected,
          postMessage(message) { this.posted.push(message) },
          onMessage: { addListener: () => {} },
          onDisconnect: { addListener: (listener) => disconnected.push(listener) },
          disconnect: () => disconnected.slice().forEach((listener) => listener())
        }
        runtime.ports.push(port)
        return port
      }
    }
  }
}))

import { link } from "./Surface.ts"

afterEach(() => {
  vi.useRealTimers()
  runtime.ports.length = 0
})

describe("surface reconnection", () => {
  it("replays standing state before letting the surface send reconnect work", () => {
    vi.useFakeTimers()
    let wire: ReturnType<typeof link>
    wire = link("pill", () => {}, () => {
      wire.say(PanelOpened(1_700_000_000_000))
    })
    wire.say(Watch(7), true)

    const first = runtime.ports[0]
    expect(first?.posted).toEqual([Watch(7)])
    first?.disconnected.forEach((listener) => listener())
    vi.advanceTimersByTime(400)

    expect(runtime.ports).toHaveLength(2)
    expect(runtime.ports[1]?.posted).toEqual([
      Watch(7),
      PanelOpened(1_700_000_000_000)
    ])
    wire.close()
  })
})
