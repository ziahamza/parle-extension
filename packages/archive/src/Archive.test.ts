/**
 * The ways this service could look like it works and not.
 *
 * Three of these are the reason the package has four outcomes instead of a
 * nullable record: an HTML block page must not read as "never archived", a 429
 * must not be retried, and a rate-limited CDX must not cost the reader the
 * link. The CDX fixture rows are copied from a live answer captured 2026-08-24,
 * interleaved `303`s and the `-` statuscode included, because those are what
 * made `contentChanges` the number it is.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { SubjectUrl } from "@parle/domain/Subject"
import { Archive, historyFrom } from "./Archive.ts"
import type { Holding } from "./Holding.ts"
import { type Exchange, interstitial, json, recording } from "./Recording.ts"

const SUBJECT = SubjectUrl.make("https://www.nature.com/articles/d41586-024-02012-5")

const isAvailability = (url: string) => url.includes("archive.org/wayback/available")
const isCdx = (url: string) => url.includes("/cdx/search/cdx")

const AVAILABLE = JSON.stringify({
  url: "www.nature.com/articles/d41586-024-02012-5",
  archived_snapshots: {
    closest: {
      status: "200",
      available: true,
      url: "http://web.archive.org/web/20240621130624/https://www.nature.com/articles/d41586-024-02012-5",
      timestamp: "20240621130624"
    }
  }
})

/** The Archive's ordinary "we hold nothing" answer: present, and empty. */
const NOTHING = JSON.stringify({
  url: "www.nowhere.test/",
  archived_snapshots: {}
})

/** Verbatim from a live CDX answer, header row first. */
const CDX = JSON.stringify([
  ["timestamp", "statuscode", "digest"],
  ["20240619144848", "303", "QAPUFX2QCBTF4E4SMEVSXAGXMB6UHRSQ"],
  ["20240619145647", "200", "AL7WJGPEDEEDQ5FKNQJAZEQ7XKX6L3LF"],
  ["20240619153946", "303", "QAPUFX2QCBTF4E4SMEVSXAGXMB6UHRSQ"],
  ["20240619165508", "200", "3Z2HOGDLKGOJVVMR6XRIRLQ6TDLX5GAD"],
  ["20240619165508", "303", "QAPUFX2QCBTF4E4SMEVSXAGXMB6UHRSQ"],
  ["20240620204207", "200", "SW5RRYXBMRBFCNJ33RECMH647NJ4ZO3V"],
  ["20240621021616", "-", "QAPUFX2QCBTF4E4SMEVSXAGXMB6UHRSQ"],
  ["20240621130624", "200", "JAPK3KGUG7BHC67KOEHTDW7OCBBRBWHH"]
])

/** A body with the header row and no data. A real answer, not a failure. */
const CDX_HEADER_ONLY = JSON.stringify([["timestamp", "statuscode", "digest"]])

const wellFormed = (url: string): Exchange =>
  isAvailability(url) ? json(AVAILABLE) : json(CDX)

interface Run {
  readonly holding: Holding
  readonly asked: ReadonlyArray<string>
}

const run = async (answer: (url: string) => Exchange): Promise<Run> => {
  const wire = recording(answer)
  const holding = await Effect.runPromise(
    Effect.gen(function*() {
      return yield* (yield* Archive).lookup(SUBJECT)
    }).pipe(Effect.provide(Archive.layer.pipe(Layer.provide(wire.layer))))
  )
  return { holding, asked: wire.asked }
}

const foundRecord = (holding: Holding) => {
  if (holding._tag !== "Found") throw new Error(`expected Found, got ${holding._tag}`)
  return holding.record
}

describe("the happy path", () => {
  it("finds the archived copy and hands over the link a reader clicks", async () => {
    const { holding } = await run(wellFormed)
    const record = foundRecord(holding)
    expect(record.archivedUrl).toBe(
      "http://web.archive.org/web/20240621130624/https://www.nature.com/articles/d41586-024-02012-5"
    )
    expect(record.snapshotAt).toBe(Date.UTC(2024, 5, 21, 13, 6, 24))
    expect(record.snapshotStatus).toBe("200")
    expect(record.subject).toBe(SUBJECT)
  })

  it("reports the page's age and how often the content changed", async () => {
    const { holding } = await run(wellFormed)
    const history = foundRecord(holding).history
    expect(history).toEqual({
      firstCaptureAt: Date.UTC(2024, 5, 19, 14, 48, 48),
      latestCaptureAt: Date.UTC(2024, 5, 21, 13, 6, 24),
      // Four `200` captures, four distinct digests. The three `303` rows and
      // the `-` row share one digest and are not content.
      contentChanges: 4,
      clipped: false
    })
  })

  it("spends exactly two requests, and asks the cheap endpoint first", async () => {
    const { asked } = await run(wellFormed)
    expect(asked).toHaveLength(2)
    expect(isAvailability(asked[0]!)).toBe(true)
    expect(isCdx(asked[1]!)).toBe(true)
  })

  it("asks CDX for collapsed rows within a bounded window", async () => {
    const { asked } = await run(wellFormed)
    const cdx = new URL(asked[1]!)
    expect(cdx.searchParams.get("output")).toBe("json")
    expect(cdx.searchParams.get("collapse")).toBe("digest")
    expect(cdx.searchParams.get("fl")).toBe("timestamp,statuscode,digest")
    expect(cdx.searchParams.get("limit")).toBe("500")
    expect(cdx.searchParams.get("url")).toBe(SUBJECT as string)
  })
})

describe("when the Archive holds nothing", () => {
  it("answers NothingArchived — the one outcome that is evidence about the world", async () => {
    const { holding } = await run(() => json(NOTHING))
    expect(holding).toEqual({ _tag: "NothingArchived" })
  })

  it("does not spend a CDX request counting the captures of a page with none", async () => {
    const { asked } = await run(() => json(NOTHING))
    expect(asked).toHaveLength(1)
    expect(isAvailability(asked[0]!)).toBe(true)
  })

  it("reads a missing archived_snapshots key the same way as an empty one", async () => {
    const { holding } = await run(() => json(JSON.stringify({ url: "x" })))
    expect(holding).toEqual({ _tag: "NothingArchived" })
  })
})

describe("when CDX answers with a header and nothing else", () => {
  it("still hands over the link, and reports zero changes rather than no history", async () => {
    // Zero versions and "we could not ask" are different facts. This is the
    // first, and it must not be reported as the second.
    const { holding } = await run((url) =>
      isAvailability(url) ? json(AVAILABLE) : json(CDX_HEADER_ONLY)
    )
    const record = foundRecord(holding)
    expect(record.archivedUrl).toContain("web.archive.org")
    expect(record.history).toEqual({
      firstCaptureAt: null,
      latestCaptureAt: null,
      contentChanges: 0,
      clipped: false
    })
  })

  it("reads a zero-byte CDX body as zero rows, not as a Garble", async () => {
    // `/cdx/search/cdx` answers a never-captured URL with `200
    // application/json` and no bytes at all. `JSON.parse("")` throws.
    const { holding } = await run((url) =>
      isAvailability(url) ? json(AVAILABLE) : json("")
    )
    expect(foundRecord(holding).history?.contentChanges).toBe(0)
  })
})

describe("when we are over the Archive's budget", () => {
  it("classifies a 429 as CouldNotAsk, never as NothingArchived", async () => {
    const { holding } = await run(() => ({
      status: 429,
      body: "<html><body><h1>429 Too Many Requests</h1></body></html>",
      headers: { "content-type": "text/html" }
    }))
    expect(holding).toEqual({ _tag: "CouldNotAsk", reason: "rate-limited" })
  })

  it("never asks again after a 429 — an hour-long ban is the price of retrying", async () => {
    const { asked } = await run(() => ({ status: 429, body: "", headers: { "content-type": "text/html" } }))
    expect(asked).toHaveLength(1)
  })

  it("keeps the link when it is only CDX that refuses, because the link is the point", async () => {
    const { holding, asked } = await run((url) =>
      isAvailability(url)
        ? json(AVAILABLE)
        : { status: 429, body: "", headers: { "content-type": "text/html" } }
    )
    const record = foundRecord(holding)
    expect(record.archivedUrl).toContain("web.archive.org")
    // `null` means "we could not ask", and is why the field is nullable rather
    // than zeroed.
    expect(record.history).toBeNull()
    expect(asked).toHaveLength(2)
  })
})

describe("when the answer is not an answer", () => {
  it("classifies an HTML interstitial served as 200 as Garbled", async () => {
    const { holding } = await run(() => interstitial())
    expect(holding._tag).toBe("Garbled")
  })

  it("rejects it on the content type, before anything tries to parse it", async () => {
    // Asserting the DETAIL and not only the tag, because this check was
    // vacuous without it: `<html>…` fails `JSON.parse` too, so deleting the
    // content-type gate left the tag correct and the reason wrong. A WAF page
    // whose first bytes happen to parse is the case the gate is actually for,
    // and only the detail can tell the two apart.
    const { holding } = await run(() => interstitial())
    if (holding._tag !== "Garbled") throw new Error("expected Garbled")
    expect(holding.detail).toContain("text/html")
  })

  it("never lets an interstitial become the cacheable outcome", async () => {
    const { holding } = await run(() => interstitial())
    expect(holding._tag).not.toBe("NothingArchived")
  })

  it("rejects an HTML body that would have parsed as JSON", async () => {
    // The gate's real job. Without it this decodes to `{}` and becomes
    // `NothingArchived` — cached, and a silent false negative about a page the
    // Archive may hold a hundred copies of.
    const { holding } = await run(() => ({
      status: 200,
      body: "{}",
      headers: { "content-type": "text/html; charset=utf-8" }
    }))
    expect(holding._tag).toBe("Garbled")
  })

  it("classifies a 200 whose JSON does not decode as Garbled", async () => {
    const { holding } = await run(() => json(JSON.stringify({ archived_snapshots: 42 })))
    expect(holding._tag).toBe("Garbled")
  })

  it("classifies a 200 that is not JSON at all as Garbled", async () => {
    const { holding } = await run(() => json("{ not json"))
    expect(holding._tag).toBe("Garbled")
  })

  it("refuses to hand over a snapshot the Archive says it cannot serve", async () => {
    const unavailable = JSON.stringify({
      archived_snapshots: {
        closest: { status: "200", available: false, url: "http://web.archive.org/web/2024/x", timestamp: "20240621130624" }
      }
    })
    const { holding } = await run(() => json(unavailable))
    expect(holding._tag).toBe("Garbled")
  })

  it("treats a snapshot with no url as nothing to open", async () => {
    const noUrl = JSON.stringify({
      archived_snapshots: { closest: { status: "200", available: true, timestamp: "20240621130624" } }
    })
    const { holding } = await run(() => json(noUrl))
    expect(holding).toEqual({ _tag: "NothingArchived" })
  })
})

describe("other ways the Archive says no", () => {
  it("reads a 5xx as offline rather than as a refusal by the Archive", async () => {
    const { holding } = await run(() => ({ status: 503, body: "", headers: { "content-type": "text/html" } }))
    expect(holding).toEqual({ _tag: "CouldNotAsk", reason: "offline" })
  })

  it("reads a 403 as forbidden", async () => {
    const { holding } = await run(() => ({ status: 403, body: "", headers: { "content-type": "text/html" } }))
    expect(holding).toEqual({ _tag: "CouldNotAsk", reason: "forbidden" })
  })
})

describe("nothing is issued until the caller asks", () => {
  it("builds a Lookup without touching the wire", async () => {
    const wire = recording(wellFormed)
    await Effect.runPromise(
      Effect.gen(function*() {
        // Constructing the Effect must not be the same act as running it: the
        // caller decides when the reader's IP is spent.
        void (yield* Archive).lookup(SUBJECT)
      }).pipe(Effect.provide(Archive.layer.pipe(Layer.provide(wire.layer))))
    )
    expect(wire.asked).toHaveLength(0)
  })
})

describe("counting content changes", () => {
  it("counts a run of identical digests once even when a redirect fell between them", () => {
    // `collapse=digest` collapses ADJACENT runs in the unfiltered sequence, so
    // dropping the redirect rows can leave two identical digests next to each
    // other. Counting those as two would report an edit that never happened.
    const history = historyFrom([
      ["timestamp", "statuscode", "digest"],
      ["20240101000000", "200", "AAA"],
      ["20240102000000", "303", "XXX"],
      ["20240103000000", "200", "AAA"]
    ])
    expect(history.contentChanges).toBe(1)
  })

  it("counts a genuine change as a change", () => {
    const history = historyFrom([
      ["timestamp", "statuscode", "digest"],
      ["20240101000000", "200", "AAA"],
      ["20240102000000", "200", "BBB"],
      ["20240103000000", "200", "AAA"]
    ])
    // Three, not two: the page went A, B, A. That is what "how many times did
    // the content change" means, and it is why the field is not called
    // `distinctVersions`.
    expect(history.contentChanges).toBe(3)
  })

  it("takes the page's age from the first row whatever its status was", () => {
    const history = historyFrom([
      ["timestamp", "statuscode", "digest"],
      ["20240101000000", "303", "XXX"],
      ["20240102000000", "200", "AAA"]
    ])
    expect(history.firstCaptureAt).toBe(Date.UTC(2024, 0, 1))
    expect(history.latestCaptureAt).toBe(Date.UTC(2024, 0, 2))
  })

  it("marks a filled window as clipped, so the count is read as 'at least'", () => {
    const rows: Array<Array<string>> = [["timestamp", "statuscode", "digest"]]
    for (let i = 0; i < 500; i++) {
      rows.push(["20240101000000", "200", `D${i}`])
    }
    expect(historyFrom(rows).clipped).toBe(true)
    expect(historyFrom(rows.slice(0, 500)).clipped).toBe(false)
  })

  it("ignores a row whose timestamp it cannot read rather than dating the page to 1970", () => {
    const history = historyFrom([
      ["timestamp", "statuscode", "digest"],
      ["not-a-time", "200", "AAA"],
      ["20240102000000", "200", "BBB"]
    ])
    expect(history.firstCaptureAt).toBe(Date.UTC(2024, 0, 2))
  })
})

describe("availability paints before history", () => {
  it("notes a kept copy with no history before CDX answers", async () => {
    const seen: Array<Holding> = []
    const wire = recording(wellFormed)
    const holding = await Effect.runPromise(
      Effect.gen(function*() {
        return yield* (yield* Archive).lookup(SUBJECT, (partial) =>
          Effect.sync(() => {
            seen.push(partial)
          }))
      }).pipe(Effect.provide(Archive.layer.pipe(Layer.provide(wire.layer))))
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]?._tag).toBe("Found")
    if (seen[0]?._tag === "Found") expect(seen[0].record.history).toBeNull()
    expect(holding._tag).toBe("Found")
    if (holding._tag === "Found") expect(holding.record.history).not.toBeNull()
  })
})
