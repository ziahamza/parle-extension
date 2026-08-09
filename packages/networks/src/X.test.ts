/**
 * X is off, and being off has to be a visible state rather than a silence.
 *
 * ADR 0001 buys X access with mitigations rather than with an opt-in, and one
 * of those mitigations is a build flag that compiles it out entirely. Off, the
 * reader is owed the reason — a Withholding — and the request must not be made
 * at all, which is the difference between "we chose not to ask" and "we asked
 * and something went wrong".
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { type Consultation } from "@parle/domain/Coverage"
import { SubjectUrl } from "@parle/domain/Subject"
import { TestClock } from "effect/testing"
import { ObservationSink } from "./Observation.ts"
import { recordingSink } from "./Recording.ts"
import { X, XEnabled, XSession, type XSessionShape } from "./X.ts"

const SUBJECT = SubjectUrl.make("https://example.com/a")

const session = (posts: ReadonlyArray<{
  readonly nativeId: string
  readonly submitted: string | null
  readonly score: number | null
  readonly replies: number | null
}>): XSessionShape => ({
  linked: () => Effect.succeed(posts),
  topical: () => Effect.succeed(posts)
})

interface Run {
  readonly consultations: ReadonlyArray<Consultation>
  readonly observed: number
}

const run = async (
  ask: (source: X["Service"]) => Stream.Stream<Consultation, never, never>,
  options: { readonly enabled?: boolean; readonly session?: XSessionShape } = {}
): Promise<Run> => {
  const sink = recordingSink()

  const consultations = await Effect.runPromise(
    Effect.gen(function*() {
      yield* TestClock.setTime(1_700_000_000_000)
      const source = yield* X
      return yield* Stream.runCollect(ask(source))
    }).pipe(
      Effect.provideService(ObservationSink, sink.sink),
      Effect.provideService(XEnabled, options.enabled ?? false),
      Effect.provideService(XSession, options.session ?? null),
      Effect.provide(X.layer),
      Effect.provide(TestClock.layer())
    )
  )

  return { consultations, observed: sink.seen.length }
}

describe("compiled out, by default", () => {
  it("withholds rather than refusing, and says why", async () => {
    const { consultations } = await run((x) => x.linked(SUBJECT, []))
    expect(consultations).toHaveLength(1)
    const only = consultations[0]
    expect(only?._tag).toBe("Withholding")
    if (only?._tag === "Withholding") expect(only.reason).toBe("compiled-out")
  })

  it("emits no Asking, because nothing was asked", async () => {
    // `Asking` is a claim that a request is in flight. Emitting one for a
    // Lookup we decided not to issue leaves a Place that says "still looking"
    // forever, and `isSettled` would agree with it.
    const { consultations } = await run((x) => x.linked(SUBJECT, []))
    expect(consultations.map((c) => c._tag)).not.toContain("Asking")
  })

  it("withholds on both questions, and names the right Place for each", async () => {
    const linked = await run((x) => x.linked(SUBJECT, []))
    const topical = await run((x) => x.topical(SUBJECT, "a title"))
    expect(linked.consultations[0]?.place).toEqual({
      _tag: "Network",
      network: "x",
      question: "linked"
    })
    expect(topical.consultations[0]?.place).toEqual({
      _tag: "Network",
      network: "x",
      question: "topical"
    })
  })

  it("does not reach the session even when one is present", async () => {
    let reached = false
    const watched: XSessionShape = {
      linked: () => {
        reached = true
        return Effect.succeed([])
      },
      topical: () => Effect.succeed([])
    }
    await run((x) => x.linked(SUBJECT, []), { session: watched })
    expect(reached).toBe(false)
  })
})

describe("switched on, with no session", () => {
  it("refuses as not-signed-in rather than pretending to have asked", async () => {
    const { consultations } = await run((x) => x.linked(SUBJECT, []), { enabled: true })
    expect(consultations.map((c) => c._tag)).toEqual(["Asking", "Refusal"])
    const end = consultations[1]
    if (end?._tag === "Refusal") expect(end.reason).toBe("not-signed-in")
  })
})

describe("switched on, with a session", () => {
  it("holds X to the same address check as everyone else", async () => {
    // It is the READER'S account issuing these requests, so a post that linked
    // somewhere else must not become a Linked Mention of this Subject.
    const { consultations } = await run(
      (x) => x.linked(SUBJECT, []),
      {
        enabled: true,
        session: session([
          { nativeId: "1", submitted: "https://example.com/a", score: 12, replies: 3 },
          { nativeId: "2", submitted: "https://elsewhere.example/b", score: 99, replies: 40 }
        ])
      }
    )
    const end = consultations[1]
    expect(end?._tag).toBe("Answered")
    if (end?._tag === "Answered") {
      expect(end.mentions.map((m) => m.discussion.nativeId as string)).toEqual(["1"])
      expect(end.mentions[0]?.discussion.network).toBe("x")
    }
  })

  it("stamps Observations from replies, and only for what it kept", async () => {
    const { consultations, observed } = await run(
      (x) => x.linked(SUBJECT, []),
      {
        enabled: true,
        session: session([
          { nativeId: "1", submitted: "https://example.com/a", score: 12, replies: 3 },
          { nativeId: "2", submitted: "https://elsewhere.example/b", score: 99, replies: 40 }
        ])
      }
    )
    expect(consultations[1]?._tag).toBe("Answered")
    expect(observed).toBe(1)
  })

  it("is Silent, not Answered-with-nothing, when the session found nothing", async () => {
    const { consultations } = await run((x) => x.linked(SUBJECT, []), {
      enabled: true,
      session: session([])
    })
    expect(consultations[1]?._tag).toBe("Silence")
  })
})
