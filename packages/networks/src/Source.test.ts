/**
 * The classification, tested directly, because every connector depends on it
 * and none of them can express a failure any other way.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { Consultation } from "@parle/domain/Coverage"
import { SubjectUrl } from "@parle/domain/Subject"
import { HackerNews } from "./HackerNews.ts"
import { Reddit } from "./Reddit.ts"
import { X } from "./X.ts"
import {
  answeredWith,
  asking,
  classify,
  Declined,
  Garbled,
  isRealTitle,
  placeOf,
  refusalForStatus,
  Restrained
} from "./Source.ts"

const place = placeOf("hackernews")

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

describe("a title is a title, not the address wearing one", () => {
  // Shared by the connectors' wire guards and by the Enquiry's upstream
  // withhold, so the two can never disagree about what a placeholder looks
  // like. The battle battery's P3 recording is the fixture: before `<title>`
  // parses, Chrome's tab title is the page's own address — with the scheme,
  // or (as actually recorded on the wire) without it.
  const subject = SubjectUrl.make("https://youtube.com/watch?v=dQw4w9WgXcQ")

  it("accepts an ordinary title", () => {
    expect(isRealTitle("Rick Astley - Never Gonna Give You Up", subject)).toBe(true)
  })

  it("rejects nothing, and whitespace", () => {
    expect(isRealTitle("", subject)).toBe(false)
    expect(isRealTitle("   ", subject)).toBe(false)
  })

  it("rejects the Subject URL echoed back", () => {
    expect(isRealTitle("https://youtube.com/watch?v=dQw4w9WgXcQ", subject)).toBe(false)
  })

  it("rejects any http(s) URL — a redirect's address echoed as a title", () => {
    expect(isRealTitle("https://consent.example/continue?next=%2Freal%2Fdoc", subject)).toBe(false)
    expect(isRealTitle("http://youtube.com/watch?v=dQw4w9WgXcQ&t=42s", subject)).toBe(false)
  })

  it("rejects the page's own address with the scheme dropped — the placeholder the battery recorded", () => {
    // Battery 1's wire recording, verbatim shape: `title: youtube.com/watch?…`.
    // No scheme, so it does not parse as a URL — it is only recognisable as a
    // placeholder because it is THIS page's own host.
    expect(isRealTitle("youtube.com/watch?v=dQw4w9WgXcQ&t=42s", subject)).toBe(false)
    expect(isRealTitle("www.youtube.com/watch?v=dQw4w9WgXcQ", subject)).toBe(false)
    expect(isRealTitle("youtube.com", subject)).toBe(false)
  })

  it("does not reject real titles that happen to be domain-shaped", () => {
    // "Node.js" parses as a host if you push a scheme in front of it. It is
    // not THIS page's host, so it is a title. The placeholder check is an
    // echo check, never a "looks like a domain" check.
    expect(isRealTitle("Node.js", subject)).toBe(true)
    expect(isRealTitle("news.ycombinator.com", subject)).toBe(true)
  })

  it("holds the residue it accepts: a page whose real title IS its own bare domain", () => {
    // Documented rather than discovered later: such a page loses its Topical
    // Lookup (the panel says why, and insist re-offers everything else), which
    // ADR 0005 prefers to an address on the wire dressed as a title.
    const front = SubjectUrl.make("https://example.com/")
    expect(isRealTitle("example.com", front)).toBe(false)
  })
})
