import * as Effect from "effect/Effect"
import { relay, type Relay } from "@parle/browser/Relay"
import { SubjectUrl } from "@parle/domain/Subject"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { recentOpeningOf } from "../history/RecentOpening.ts"
import { emptyPanel } from "../view/Panel.ts"
import { type ArmedExtension, Extension, type TabAddress, type Wireup } from "./Extension.ts"

const native = vi.hoisted(() => ({
  calls: [] as Array<{ readonly application: string; readonly message: object }>,
  failure: null as Error | null,
  gate: null as Promise<void> | null,
  reply: { ok: true } as unknown
}))

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      sendNativeMessage: async (application: string, message: object) => {
        native.calls.push({ application, message })
        const gate = native.gate
        native.gate = null
        if (gate !== null) await gate
        if (native.failure !== null) throw native.failure
        return native.reply
      }
    }
  }
}))

const idle = <A>(): Relay<A> => relay(() => {})

const attached = (): ArmedExtension => ({
  platform: {} as ArmedExtension["platform"],
  activated: idle<TabAddress>(),
  retitled: idle<TabAddress>(),
  loaded: idle<TabAddress>(),
  closed: idle<number>(),
  installed: idle<void>(),
  connections: idle<Wireup>()
})

const opening = recentOpeningOf(
  SubjectUrl.make("https://private.example/a-page"),
  "A private title",
  emptyPanel,
  1_700_000_100_000
)
const CLEARED_AT = 1_700_000_200_000

const runWith = (
  safari: boolean,
  use: (extension: Extension["Service"]) => Effect.Effect<void>
): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function*() {
      yield* use(yield* Extension)
    }).pipe(Effect.provide(Extension.layerFrom(attached(), safari)))
  )

describe("Safari companion messaging", () => {
  beforeEach(() => {
    native.calls.length = 0
    native.failure = null
    native.gate = null
    native.reply = { ok: true }
  })

  it("is a no-op on every non-Safari build", async () => {
    await runWith(false, (extension) =>
      Effect.gen(function*() {
        yield* extension.recordRecentOpening(opening)
        expect(yield* extension.clearRecentOpenings(CLEARED_AT)).toBe(true)
      }))

    expect(native.calls).toEqual([])
  })

  it("sends the versioned record and clear commands to the containing app", async () => {
    await runWith(true, (extension) =>
      Effect.gen(function*() {
        yield* extension.recordRecentOpening(opening)
        expect(yield* extension.clearRecentOpenings(CLEARED_AT)).toBe(true)
      }))

    expect(native.calls).toEqual([
      { application: "com.ziahamza.parle", message: opening },
      {
        application: "com.ziahamza.parle",
        message: {
          schemaVersion: 1,
          command: "clearRecentOpenings",
          clearedAt: CLEARED_AT
        }
      }
    ])
  })

  it("does not mistake a native rejection reply for a successful clear", async () => {
    native.reply = { ok: false, error: "shared store unavailable" }

    await expect(runWith(true, (extension) =>
      Effect.flatMap(extension.clearRecentOpenings(CLEARED_AT), (ok) =>
        Effect.sync(() => expect(ok).toBe(false))))).resolves.toBeUndefined()
  })

  it("swallows a native failure and never copies its history payload into the warning", async () => {
    // Effect's default structured logger writes warning-level events through
    // `console.log` in node, retaining its own `WARN` level marker.
    const warning = vi.spyOn(console, "log").mockImplementation(() => {})
    native.failure = new Error(`native rejected ${opening.subject}`)

    await expect(runWith(true, (extension) =>
      Effect.flatMap(extension.recordRecentOpening(opening), (ok) =>
        Effect.sync(() => expect(ok).toBe(false))))).resolves.toBeUndefined()

    const logged = warning.mock.calls.flat().map(String).join(" ")
    expect(logged).toContain("Safari companion could not record an opening")
    expect(logged).not.toContain(opening.subject)
    warning.mockRestore()
  })

  it("does not let a timed-out native request overlap a later command", async () => {
    vi.useFakeTimers()
    let releaseFirst: (() => void) | undefined
    native.gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    try {
      const first = runWith(true, (extension) =>
        Effect.flatMap(extension.recordRecentOpening(opening), (ok) =>
          Effect.sync(() => expect(ok).toBe(false))))
      await vi.advanceTimersByTimeAsync(5_000)
      await first

      const second = runWith(true, (extension) =>
        Effect.flatMap(extension.clearRecentOpenings(CLEARED_AT), (ok) =>
          Effect.sync(() => expect(ok).toBe(true))))
      await vi.advanceTimersByTimeAsync(0)
      expect(native.calls).toHaveLength(1)

      releaseFirst?.()
      await vi.advanceTimersByTimeAsync(0)
      await second
      expect(native.calls.map(({ message }) => message)).toEqual([
        opening,
        {
          schemaVersion: 1,
          command: "clearRecentOpenings",
          clearedAt: CLEARED_AT
        }
      ])
    } finally {
      releaseFirst?.()
      native.gate = null
      vi.useRealTimers()
    }
  })
})
