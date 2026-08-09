/**
 * The one test that talks to the real internet. Opt in with `PARLE_LIVE=1`.
 *
 * Skipped by default, because a suite that fails when a third party has a bad
 * afternoon teaches everyone to ignore red. It is kept because the recorded
 * fixtures are frozen: this is what tells us Algolia has changed its answer
 * shape, which it may do without telling anyone.
 *
 * Hacker News is the only Network this can be done for. Algolia is keyless and
 * CORS-open to every origin; Reddit answers 403 to any datacenter IP and X
 * needs the reader's own session.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { type Consultation } from "@parle/domain/Coverage"
import { SubjectUrl } from "@parle/domain/Subject"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import { HackerNews } from "./HackerNews.ts"
import { DiscussionSink } from "./Discussion.ts"
import { ObservationSink } from "./Observation.ts"
import { recordingRows, recordingSink } from "./Recording.ts"

declare const process: { readonly env: Record<string, string | undefined> } | undefined

const live = typeof process !== "undefined" && process.env["PARLE_LIVE"] === "1"

/** A page with several Hacker News submissions and a stable address. */
const SUBJECT = SubjectUrl.make("https://www.nature.com/articles/d41586-024-02012-5")

const ask = (
  use: (source: HackerNews["Service"]) => Stream.Stream<Consultation, never, never>
) => {
  const sink = recordingSink()
  const rows = recordingRows()
  return Effect.runPromise(
    Effect.gen(function*() {
      const source = yield* HackerNews
      const consultations = yield* Stream.runCollect(use(source))
      return { consultations, seen: sink.seen, noted: rows.noted }
    }).pipe(
      Effect.provideService(ObservationSink, sink.sink),
      Effect.provideService(DiscussionSink, rows.sink),
      Effect.provide(HackerNews.layer.pipe(Layer.provide(FetchHttpClient.layer)))
    )
  )
}

describe.skipIf(!live)("against the live Algolia API", () => {
  it("finds the submissions of a page that has some", { timeout: 30_000 }, async () => {
    const { consultations, seen } = await ask((hn) => hn.linked(SUBJECT, []))
    const end = consultations[consultations.length - 1]

    expect(consultations[0]?._tag).toBe("Asking")
    expect(end?._tag).toBe("Answered")
    if (end?._tag === "Answered") {
      expect(end.mentions.length).toBeGreaterThan(0)
      expect(end.mentions.every((m) => m._tag === "Linked")).toBe(true)
    }

    // Observations must be stamped now, not with the thread's posting date.
    expect(seen.length).toBeGreaterThan(0)
    for (const observation of seen) {
      expect(Math.abs(observation.receivedAt - Date.now())).toBeLessThan(60_000)
    }
  })

  it("still hands over a title and a posting time", { timeout: 30_000 }, async () => {
    // The recorded fixtures can only prove we read the fields we recorded. This
    // is what catches Algolia dropping or renaming one, which would render as
    // a panel of untitled rows dated 1970 and would break no schema.
    const { noted } = await ask((hn) => hn.linked(SUBJECT, []))
    expect(noted.length).toBeGreaterThan(0)
    for (const row of noted) {
      expect(row.title.length).toBeGreaterThan(0)
      expect(row.postedAt).not.toBeNull()
      expect(row.postedAt ?? 0).toBeLessThan(Date.now())
    }
  })

  it("is Silent about a page nobody has submitted", { timeout: 30_000 }, async () => {
    const nowhere = SubjectUrl.make(`https://example.invalid/${Date.now()}/nothing-here`)
    const { consultations } = await ask((hn) => hn.linked(nowhere, []))
    expect(consultations[consultations.length - 1]?._tag).toBe("Silence")
  })

  it("finds threads by title", { timeout: 30_000 }, async () => {
    const { consultations } = await ask((hn) => hn.topical(SUBJECT, "borrow checker"))
    const end = consultations[consultations.length - 1]
    expect(end?._tag).toBe("Answered")
    if (end?._tag === "Answered") {
      expect(end.mentions.every((m) => m._tag === "Topical")).toBe(true)
    }
  })
})
