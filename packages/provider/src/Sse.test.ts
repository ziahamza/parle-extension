/**
 * The decoder's job is to be boring about the grammar and ruthless about the
 * tail. These tests are mostly about the tail.
 */
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { describe, expect, it } from "vitest"
import * as Recorded from "./recorded/Wire.ts"
import * as Sse from "./Sse.ts"

const dispatched = (text: string) =>
  Effect.runSync(
    Stream.runCollect(Sse.fromBytes(Stream.succeed(new TextEncoder().encode(text))))
  )

describe("the SSE grammar", () => {
  it("joins a multi-line data payload, names the event, and ignores the rest", () => {
    const events = dispatched(Recorded.sseGrammar)

    expect(events).toEqual([
      { name: "named", data: "first\nsecond" },
      { name: "message", data: "no-space" },
      { name: "message", data: "last" }
    ])
  })

  it("does not dispatch an event that carried no data", () => {
    // `event: lonely` in the capture above has a blank line under it and
    // nothing else. Dispatching it would give consumers an event with an empty
    // payload to guard against for no reason.
    const named = dispatched(Recorded.sseGrammar).map((event) => event.name)
    expect(named).not.toContain("lonely")
  })
})

describe("a stream cut off mid-event", () => {
  it("keeps every event that completed", () => {
    const events = dispatched(Recorded.openAiTruncated)

    // Two events completed before the cut. Both survive.
    expect(events).toHaveLength(2)
    expect(events[0]?.data).toContain("Commenters dispute the benchmark methodology.")
    expect(events[1]?.data).toContain("Several report the same regression on ARM.")
  })

  it("drops the half-written event rather than inventing its end", () => {
    // The third `data:` line in the capture is cut inside its JSON. Emitting it
    // would hand the caller an unparseable payload and turn a salvageable
    // partial answer into a Garble.
    const events = dispatched(Recorded.openAiTruncated)
    expect(events.some((event) => event.data.includes("A third point"))).toBe(false)
  })

  it("does the same to a Codex stream", () => {
    const events = dispatched(Recorded.codexTruncated)
    expect(events).toHaveLength(1)
    expect(events[0]?.name).toBe("response.output_text.delta")
  })
})

describe("byte boundaries", () => {
  it("dispatches the same events however the bytes were chopped up", () => {
    // Bytes never arrive on event boundaries. Splitting the capture at every
    // single character is the harshest version of that.
    const encoder = new TextEncoder()
    const perByte = Stream.fromIterable(
      [...Recorded.openAiComplete].map((character) => encoder.encode(character))
    )

    const chopped = Effect.runSync(Stream.runCollect(Sse.fromBytes(perByte)))
    expect(chopped).toEqual(dispatched(Recorded.openAiComplete))
    expect(chopped).toHaveLength(5)
  })
})
