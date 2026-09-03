/**
 * "What does the Internet Archive hold about this page?", asked at most twice.
 *
 * Two endpoints, both keyless and both CORS-open, verified live 2026-08-24 from
 * this development box:
 *
 * 1. `GET archive.org/wayback/available?url=<subject>` →
 *    `{ archived_snapshots: { closest?: { url, timestamp, status, available } } }`.
 *    This is the product. The owner's intent is that a reader can click through
 *    to the archived copy, and `closest.url` is that click. `archived_snapshots`
 *    is `{}` — not absent, not null — when availability has no closest snapshot.
 *    That is not proof the Archive holds nothing; CDX confirms.
 *
 * 2. `GET web.archive.org/cdx/search/cdx?url=<subject>&output=json`
 *    `&fl=timestamp,statuscode,digest&collapse=digest&limit=500` → a JSON array
 *    of rows whose FIRST ROW IS THE HEADER (`["timestamp","statuscode","digest"]`)
 *    and not data. This is the history: page age, and how often the content
 *    changed.
 *
 * **They are asked in that order. Empty availability is not a miss.**
 * `wayback/available` answers `archived_snapshots: {}` for pages the CDX index
 * and live Wayback still hold — measured 2026-09-03 on the Nature article
 * `d41586-024-02012-5`, whose closest snapshot is `20260206051412`. Settling
 * `NothingArchived` from that body caches a silent false negative (ADR 0005)
 * and Enquiry's settle-once then sticks it. So a missing `closest` (or one
 * with no address) still spends the CDX request; `NothingArchived` is reached
 * only when CDX also holds no capture. A CDX failure is `CouldNotAsk` /
 * `Garbled`, never the cacheable miss. The extra round trip on a true miss is
 * the price of not lying. On pages availability already found, CDX still runs
 * second so the link can paint before the rate-limited half.
 *
 * **`limit=500` bounds the answer, and a clipped answer is reported as "at
 * least N".** ADR 0005: a filled retrieval window is never presented as a
 * total. `CaptureHistory.clipped` is set when the Archive filled the window,
 * and the only honest rendering of a clipped count says "at least".
 *
 * **A total capture count is not reported, because it is not free.** Getting it
 * means a second CDX query without `collapse=digest`, which is a third request
 * against the endpoint with the tightest ceiling, for a number that answers a
 * question nobody asked — "how many times did a crawler visit" is not "how old
 * is this page" nor "was it quietly edited". So the collapsed rows are what
 * "captures" means here and the field that counts them is named
 * `contentChanges` rather than anything that implies a total. See
 * {@link ./Holding.ts}.
 *
 * **429 is never retried.** Not once, not with backoff. The community-observed
 * ceiling on CDX is roughly 60 requests per minute per IP, enforced by a
 * firewall that bans for an HOUR when a client keeps asking through a 429 — and
 * the IP is the READER'S, exactly as in ADR 0014's Algolia argument. An
 * hour-long ban does not degrade this feature, it removes it, silently, for
 * every page they open for the rest of the hour. So this client carries no
 * retry policy at all: `HttpClient.retryTransient`'s transient set contains
 * 429, so composing it would have been the mistake, and a 5xx retry is not
 * worth reintroducing the shape that trips the ban.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type { SubjectUrl } from "@parle/domain/Subject"
import { type CaptureHistory, Holding } from "./Holding.ts"
import { parseWaybackTimestamp } from "./Timestamp.ts"
import { classify, classifyCause, expectJson, type Trouble, Unreadable } from "./Wire.ts"

const AVAILABILITY_ENDPOINT = "https://archive.org/wayback/available"
const CDX_ENDPOINT = "https://web.archive.org/cdx/search/cdx"

/**
 * How many CDX rows one Lookup will read.
 *
 * Five hundred collapsed rows is far past the point where any of the three
 * things this package reports changes: the first row, the last row, and a count
 * that is already going to be rendered as "hundreds". It exists to bound the
 * BODY — a heavily-captured front door has tens of thousands of captures, and
 * an unbounded CDX query for one is megabytes over a reader's connection for a
 * number in a panel.
 */
const CDX_WINDOW = 500

/**
 * Why there is no retry anywhere in this file.
 *
 * Named as a constant so that the next person to add `retryTransient` has to
 * delete this to do it. See the file header.
 */
export const RATE_CEILING_NOTE =
  "~60 CDX requests/minute/IP, with hour-long firewall bans for asking through a 429; the IP is the reader's"

/**
 * The Archive's own status for a snapshot.
 *
 * String OR number, because the availability endpoint documents `"200"` and has
 * been observed to answer with both spellings across its rewrites, and because
 * a schema that insists on one turns the other into a Garble for a page that is
 * perfectly well archived. Normalised to a string on the way into
 * {@link ArchiveRecord}, where the only question asked of it is "is this
 * exactly 200".
 */
const SnapshotStatus = Schema.Union([Schema.String, Schema.Number])

/**
 * One availability snapshot.
 *
 * Every field optional AND nullable. This is the same trade `HackerNews.Hit`
 * makes and for the same reason: one advisory field the Archive stops sending
 * must not turn a good answer into a Garble. `url` is the only field whose
 * absence actually costs anything, and its absence is handled as "there is
 * nothing to click", not as a parse failure.
 */
const Snapshot = Schema.Struct({
  url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  timestamp: Schema.optionalKey(Schema.NullOr(Schema.String)),
  status: Schema.optionalKey(Schema.NullOr(SnapshotStatus)),
  available: Schema.optionalKey(Schema.NullOr(Schema.Boolean))
})

/**
 * What `wayback/available` answers with.
 *
 * `archived_snapshots` present-but-empty decodes cleanly to `{}`. That is
 * no longer filed as `NothingArchived` from here alone: empty availability
 * only means there is no `closest` to click, and CDX is asked to confirm. A
 * body we could not read still never becomes the cacheable miss.
 */
const Availability = Schema.Struct({
  archived_snapshots: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        closest: Schema.optionalKey(Schema.NullOr(Snapshot))
      })
    )
  )
})

/**
 * What the CDX endpoint answers with: rows of strings, header first.
 *
 * Strings all the way down — verified live, including `statuscode: "-"` for a
 * capture whose status the Archive never recorded, which is precisely why this
 * is not `Schema.Number`.
 */
const CdxRows = Schema.Array(Schema.Array(Schema.String))

const readAvailability = expectJson(Availability)
const readCdx = expectJson(CdxRows)

/**
 * Present unresolved history as a terminal miss without losing its useful link.
 *
 * Only a CDX 429 takes this path. Timeout, WAF, offline and interruption leave
 * history unresolved so first paint does not become the terminal-miss sentence;
 * `historyPending` describes that presentation state, not an active request.
 * Enquiry will not retry either result. Retrying a 429 bans the reader for an
 * hour, so that refusal is the one terminal history miss we present.
 */
const markHistoryUnavailable = (holding: Holding): Holding => {
  if (holding._tag !== "Found" || holding.record.historyPending !== true) return holding
  const record = holding.record
  return Holding.cases.Found.make({
    record: {
      subject: record.subject,
      archivedUrl: record.archivedUrl,
      snapshotAt: record.snapshotAt,
      snapshotStatus: record.snapshotStatus,
      history: record.history
    }
  })
}

/** Column positions, fixed by the `fl=` we asked for. */
const TIMESTAMP = 0
const STATUSCODE = 1
const DIGEST = 2

/**
 * Turn CDX rows into a history.
 *
 * The header row is dropped by position, not by sniffing its contents: `fl=`
 * fixes the column order, so row 0 is the header whenever there are rows at
 * all. A header-only body is a real answer meaning "no captures" and produces a
 * history of zeroes and nulls — not a `null` history, which means something
 * else entirely (see {@link ./Holding.ts}).
 *
 * `contentChanges` counts `200` captures whose digest differs from the previous
 * `200` capture. Re-collapsing after the status filter is required rather than
 * cosmetic: `collapse=digest` collapsed runs in the UNFILTERED sequence, so
 * removing the interleaved redirect rows can leave two identical digests
 * adjacent, and counting those as two changes would report churn that never
 * happened.
 */
export const historyFrom = (rows: ReadonlyArray<ReadonlyArray<string>>): CaptureHistory => {
  const data = rows.slice(1)

  let firstCaptureAt: number | null = null
  let latestCaptureAt: number | null = null
  let contentChanges = 0
  let previousDigest: string | null = null

  for (const row of data) {
    const at = parseWaybackTimestamp(row[TIMESTAMP] ?? "")
    if (at !== null) {
      if (firstCaptureAt === null) firstCaptureAt = at
      latestCaptureAt = at
    }
    if ((row[STATUSCODE] ?? "") !== "200") continue
    const digest = row[DIGEST] ?? ""
    if (digest === "" || digest === previousDigest) continue
    previousDigest = digest
    contentChanges += 1
  }

  return {
    firstCaptureAt,
    latestCaptureAt,
    contentChanges,
    // `>=` and not `===`: the Archive has been known to hand back the header
    // plus the window, and a window we cannot prove we saw the end of is a
    // window. ADR 0005 makes the safe direction the one that admits a floor.
    clipped: data.length >= CDX_WINDOW
  }
}

/**
 * The snapshot a reader can open, reconstructed from CDX when availability
 * had no `closest.url`.
 *
 * Prefers the latest `200` row; otherwise the latest row whose timestamp we
 * can read. The URL is built here because CDX was asked only for
 * `timestamp,statuscode,digest` — the original address is the Subject we
 * already have. `null` means the index held no usable capture, which is the
 * only remaining route to `NothingArchived`.
 */
export const snapshotFrom = (
  rows: ReadonlyArray<ReadonlyArray<string>>,
  subject: SubjectUrl
): { readonly archivedUrl: string; readonly snapshotAt: number; readonly snapshotStatus: string } | null => {
  const data = rows.slice(1)
  let latest: { timestamp: string; status: string; at: number } | null = null
  let latestOk: { timestamp: string; status: string; at: number } | null = null
  for (const row of data) {
    const timestamp = row[TIMESTAMP] ?? ""
    const at = parseWaybackTimestamp(timestamp)
    if (at === null) continue
    const status = row[STATUSCODE] ?? ""
    const picked = { timestamp, status, at }
    latest = picked
    if (status === "200") latestOk = picked
  }
  const chosen = latestOk ?? latest
  if (chosen === null) return null
  return {
    archivedUrl: `https://web.archive.org/web/${chosen.timestamp}/${subject as string}`,
    snapshotAt: chosen.at,
    snapshotStatus: chosen.status
  }
}

/** What one Archive Lookup can do. */
export interface ArchiveShape {
  /**
   * Ask about one Subject.
   *
   * Lazy by construction — building this Effect issues nothing, so the caller
   * decides when (and whether) the reader's IP is spent. No error channel: like
   * a connector, every outcome is CLASSIFIED into a {@link Holding} rather than
   * escaping as a failure, so no Archive bad day can reach an Enquiry's error
   * channel.
   */
  readonly lookup: (
    subject: SubjectUrl,
    /**
     * Called with the kept copy as soon as availability answers, before CDX.
     * Lets a panel paint the link without waiting on the rate-limited half, and
     * without treating that wait as a terminal CouldNotAsk.
     */
    noted?: (holding: Holding) => Effect.Effect<void>
  ) => Effect.Effect<Holding, never, never>
}

export class Archive extends Context.Service<Archive, ArchiveShape>()(
  "parle/archive/Archive"
) {
  static readonly layer = Layer.effect(
    Archive,
    Effect.gen(function*() {
      // Deliberately bare. See the file header: `retryTransient`'s transient
      // set contains 429, and 429 here means "stop, or be banned for an hour".
      const client = yield* HttpClient.HttpClient

      const availability = Effect.fn("Archive.availability")(function*(
        subject: SubjectUrl
      ): Effect.fn.Return<typeof Availability.Type, Trouble> {
        const response = yield* client.get(AVAILABILITY_ENDPOINT, {
          urlParams: { url: subject as string }
        })
        return yield* readAvailability(response)
      })

      const captures = Effect.fn("Archive.captures")(function*(
        subject: SubjectUrl
      ): Effect.fn.Return<{ history: CaptureHistory; snapshot: ReturnType<typeof snapshotFrom> }, Trouble> {
        const response = yield* client.get(CDX_ENDPOINT, {
          urlParams: {
            url: subject as string,
            output: "json",
            fl: "timestamp,statuscode,digest",
            collapse: "digest",
            limit: String(CDX_WINDOW)
          }
        })
        const rows = yield* readCdx(response)
        return { history: historyFrom(rows), snapshot: snapshotFrom(rows, subject) }
      })

      const answer = Effect.fn("Archive.lookup")(function*(
        subject: SubjectUrl,
        noted?: (holding: Holding) => Effect.Effect<void>
      ): Effect.fn.Return<Holding, Trouble> {
        const closest = (yield* availability(subject)).archived_snapshots?.closest
        const archivedUrl = closest?.url

        // Availability had no clickable snapshot. Confirm with CDX before the
        // one cacheable miss: `archived_snapshots: {}` is not evidence the
        // Archive holds nothing (Nature 2026-09-03, closest 20260206051412).
        // Do not `noted` a miss — first paint stays unasked until this returns.
        // A CDX failure is classified by the caller, never as NothingArchived.
        if (!archivedUrl) {
          const indexed = yield* captures(subject)
          if (indexed.snapshot === null) return Holding.cases.NothingArchived.make({})
          return Holding.cases.Found.make({
            record: {
              subject,
              archivedUrl: indexed.snapshot.archivedUrl,
              snapshotAt: indexed.snapshot.snapshotAt,
              snapshotStatus: indexed.snapshot.snapshotStatus,
              history: indexed.history
            }
          })
        }

        // `available: false` is the Archive telling us the snapshot it found is
        // not servable. That is not "nothing was archived" — the captures are
        // still there and the history is still true — but it is not a link we
        // may hand a reader either, so it is a Garble rather than a Silence.
        if (closest?.available === false) {
          return yield* Effect.fail(
            new Unreadable({ detail: "the closest snapshot is not available to serve" })
          )
        }

        const snapshotAt = closest.timestamp ? parseWaybackTimestamp(closest.timestamp) : null
        const snapshotStatus = closest.status === undefined || closest.status === null
          ? ""
          : String(closest.status)
        // Paint the link as soon as availability has it. `historyPending` says
        // the history is unresolved for presentation. It starts while CDX is in
        // flight, but does not promise that a request remains active.
        const unresolvedCopy = Holding.cases.Found.make({
          record: {
            subject,
            archivedUrl,
            snapshotAt,
            snapshotStatus,
            history: null,
            historyPending: true
          }
        })
        if (noted !== undefined) yield* noted(unresolvedCopy)

        // The second request, reached only because the first found something.
        // `Effect.result` so that a rate-limited CDX costs the history and NOT
        // the link — the link is what this package is for. A timeout, WAF
        // page, offline, or interruption is not presented as a terminal miss:
        // folding those into history: null with no marker is the Nature
        // first-open sentence "could not ask". Keep the unresolved copy so the
        // panel omits that clause. A 429 is the one CDX failure presented as
        // terminal — retrying it bans the reader IP for an hour. Enquiry will
        // not retry a Found either way.
        const history = yield* Effect.result(captures(subject))
        if (history._tag === "Success") {
          return Holding.cases.Found.make({
            record: {
              subject,
              archivedUrl,
              snapshotAt,
              snapshotStatus,
              history: history.success.history
            }
          })
        }
        const classified = classify(history.failure)
        if (classified._tag === "CouldNotAsk" && classified.reason === "rate-limited") {
          return markHistoryUnavailable(unresolvedCopy)
        }
        return unresolvedCopy
      })

      return Archive.of({
        lookup: (subject, noted) => {
          // Once the kept copy is known, interruption must not throw it away or
          // turn its unresolved history into a terminal miss.
          let knownCopy: Holding | undefined
          const onNoted = (holding: Holding) =>
            Effect.gen(function*() {
              knownCopy = holding
              if (noted !== undefined) yield* noted(holding)
            })
          const keepKnownCopyOr = (fallback: Holding): Holding =>
            knownCopy?._tag === "Found" ? knownCopy : fallback
          return Effect.suspend(() => answer(subject, onNoted)).pipe(
            Effect.catch((trouble) => Effect.succeed(keepKnownCopyOr(classify(trouble)))),
            Effect.catchCause((cause) => Effect.succeed(keepKnownCopyOr(classifyCause(cause))))
          )
        }
      })
    })
  )
}
