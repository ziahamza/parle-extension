/**
 * The gap between "the browser started telling us" and "we started listening"
 * is where an MV3 worker loses the event that woke it. These are the properties
 * that close it.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { relay, streamOf } from "./Relay.ts"

describe("a relay", () => {
  it("attaches before it returns, not when someone reads it", () => {
    // The whole point. A lazy attach is a listener the browser never saw during
    // the worker's first turn, and therefore a worker it will not wake.
    let attachedAt: "construction" | "never" = "never"
    relay<number>(() => {
      attachedAt = "construction"
    })
    expect(attachedAt).toBe("construction")
  })

  it("holds what arrives before anyone is reading, and hands it over in order", () => {
    let fire: (value: number) => void = () => {}
    const source = relay<number>((emit) => {
      fire = emit
    })

    fire(1)
    fire(2)
    fire(3)

    const taken: Array<number> = []
    source.watch((value) => taken.push(value))
    expect(taken).toEqual([1, 2, 3])

    fire(4)
    expect(taken).toEqual([1, 2, 3, 4])
  })

  it("hands the backlog to the first reader only, never twice", () => {
    let fire: (value: number) => void = () => {}
    const source = relay<number>((emit) => {
      fire = emit
    })
    fire(1)

    const first: Array<number> = []
    const second: Array<number> = []
    source.watch((value) => first.push(value))
    source.watch((value) => second.push(value))

    expect(first).toEqual([1])
    expect(second).toEqual([])

    fire(2)
    expect(first).toEqual([1, 2])
    expect(second).toEqual([2])
  })

  it("stops telling a reader that let go, while staying attached itself", () => {
    // `unwatch` releases the READER. The platform listener underneath is never
    // removed — an MV3 worker gets no teardown notice, so a listener's lifetime
    // is the worker's, and detaching it is how you stop being woken.
    let fire: (value: number) => void = () => {}
    let attachments = 0
    const source = relay<number>((emit) => {
      attachments += 1
      fire = emit
    })

    const taken: Array<number> = []
    const unwatch = source.watch((value) => taken.push(value))
    fire(1)
    unwatch()
    fire(2)

    expect(taken).toEqual([1])
    // Still live, and never re-attached: a later reader picks up what arrived
    // while nobody was there.
    const later: Array<number> = []
    source.watch((value) => later.push(value))
    expect(later).toEqual([2])
    expect(attachments).toBe(1)
  })

  it("ends a reader that arrives after the source already finished", () => {
    let close: () => void = () => {}
    const source = relay<number>((_, done) => {
      close = done
    })
    close()

    let ended = false
    source.watch(() => {}, () => {
      ended = true
    })
    expect(ended).toBe(true)
  })

  it("becomes a Stream that replays the backlog and then ends", async () => {
    let fire: (value: number) => void = () => {}
    let close: () => void = () => {}
    const source = relay<number>((emit, done) => {
      fire = emit
      close = done
    })

    // Everything arrives BEFORE the stream is run — the ordering this exists
    // for. A port's first message is posted in the turn it connects.
    fire(1)
    fire(2)
    close()

    const taken = await Effect.runPromise(
      Stream.runCollect(streamOf(source))
    )
    expect([...taken]).toEqual([1, 2])
  })
})
