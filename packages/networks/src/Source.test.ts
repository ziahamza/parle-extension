/**
 * The classification, tested directly, because every connector depends on it
 * and none of them can express a failure any other way.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { Consultation } from "@parle/domain/Coverage"
import { HackerNews } from "./HackerNews.ts"
import { Reddit } from "./Reddit.ts"
import { X } from "./X.ts"
import {
  answeredWith,
  asking,
  classify,
  Declined,
  Garbled,
  placeOf,
  refusalForStatus,
  Restrained
} from "./Source.ts"

const place = placeOf("hackernews", "linked")

const collect = (stream: Stream.Stream<Consultation, never, never>) =>
  Effect.runPromise(Stream.runCollect(stream))

describe("the service keys", () => {
  it("are four distinct strings, one per Network", () => {
    // Duplicates typecheck, and the second silently overwrites the first — so
    // an X fake would answer for Reddit and the gate would be a formality.
    const keys = [HackerNews.key, Reddit.key, X.key]
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual(["parle/source/HackerNews", "parle/source/Reddit", "parle/source/X"])
  })
})

describe("statuses become Refusal reasons", () => {
  it("names the ones the reader can act on", () => {
    expect(refusalForStatus(401)).toBe("not-signed-in")
    expect(refusalForStatus(429)).toBe("rate-limited")
    expect(refusalForStatus(408)).toBe("timed-out")
    expect(refusalForStatus(504)).toBe("timed-out")
  })

  it("does not invent a reason for a status it does not know", () => {
    expect(refusalForStatus(403)).toBe("forbidden")
    expect(refusalForStatus(451)).toBe("forbidden")
    expect(refusalForStatus(502)).toBe("forbidden")
  })
})

describe("failures become Consultations", () => {
  it("keeps a Garble apart from a Refusal", () => {
    // A Garble is never retried and never cached; a Refusal is retried and
    // never cached; a Silence is cached. Collapsing any two loses one of those.
    expect(classify(place, new Garbled({ detail: "truncated" }))._tag).toBe("Garble")
    expect(classify(place, new Declined({ reason: "forbidden" }))._tag).toBe("Refusal")
    expect(classify(place, new Restrained({ reason: "over-budget" }))._tag).toBe("Withholding")
  })

  it("carries the reason through, so the panel has something to render", () => {
    const withheld = classify(place, new Restrained({ reason: "kill-switched" }))
    expect(withheld._tag === "Withholding" && withheld.reason).toBe("kill-switched")
  })
})

describe("nothing found is a Silence, structurally", () => {
  it("cannot produce an Answered carrying no Mentions", () => {
    expect(answeredWith(place, [])._tag).toBe("Silence")
  })
})

describe("the Lookup envelope", () => {
  it("classifies a defect instead of letting it escape", async () => {
    // `E = never` is the contract. A bug in a connector must reach the reader
    // as a Network being unusable, not as an unhandled failure that takes the
    // whole Enquiry's error channel with it.
    const consultations = await collect(
      asking(
        place,
        Effect.sync(() => {
          throw new Error("connector bug")
        })
      )
    )
    expect(consultations.map((c) => c._tag)).toEqual(["Asking", "Garble"])
    const end = consultations[1]
    if (end?._tag === "Garble") expect(end.detail).toContain("connector bug")
  })

  it("classifies interruption as a Refusal about the attempt", async () => {
    // MV3 kills the service worker without running finalizers, so "we were
    // asking and will never find out" is a routine end for a Lookup. It is a
    // fact about us, never about the Subject, and must never be cached.
    const consultations = await collect(asking(place, Effect.interrupt))
    expect(consultations.map((c) => c._tag)).toEqual(["Asking", "Refusal"])
    const end = consultations[1]
    if (end?._tag === "Refusal") expect(end.reason).toBe("interrupted")
  })

  it("does not start a Lookup until the stream is run", async () => {
    let started = 0
    const stream = asking(
      place,
      Effect.sync(() => {
        started += 1
        return Consultation.cases.Silence.make({ place })
      })
    )
    expect(started).toBe(0)
    await collect(stream)
    expect(started).toBe(1)
  })
})
