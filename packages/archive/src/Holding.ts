/**
 * What the Internet Archive holds about one Subject, and the four ways that
 * question can end.
 *
 * The Archive is not a Network — nobody discussed anything there, so there is
 * no Discussion, no Mention and no Consultation. But the classification
 * doctrine in {@link ../../networks/src/Source.ts} is not about Networks, it is
 * about the difference between evidence about the world and evidence about our
 * attempt, and that difference is identical here:
 *
 *   - `NothingArchived` is the Silence analog. The Archive answered, cleanly,
 *     and holds no captures of this address. It is evidence about the world and
 *     it is the only outcome that may ever be cached.
 *   - `CouldNotAsk` is the Refusal analog. Rate-limited, offline, 5xx, or the
 *     worker was killed mid-flight. A fact about the attempt, never about the
 *     Subject, and never cached. `rate-limited` is not an edge case here: a
 *     plain unauthenticated GET of `archive.org/wayback/available` answered
 *     `429` with an HTML body from this development box on 2026-08-24, first
 *     request of the day.
 *   - `Garbled` is a 200 whose body was not usable. Never retried, never
 *     cached, and — the reason it exists at all — never mistaken for
 *     `NothingArchived`. Both of the Archive's endpoints sit behind a WAF that
 *     serves `text/html` with a 200, and an HTML block page parses to zero
 *     captures in any naive reading. Filed as `NothingArchived` it would be
 *     cached as "this page has never been archived", which is a silent false
 *     negative and the failure ADR 0005 refuses.
 *   - `Found` carries the record.
 *
 * The tags are spelled out rather than reusing the domain's `Consultation`
 * because a `Consultation` promises Mentions and Places, and an archived copy
 * is neither. `RefusalReason` IS reused: the reader-facing meanings are the
 * same words for the same conditions, and two vocabularies for "rate-limited"
 * is how a panel ends up saying two different things about one event.
 */
import * as Schema from "effect/Schema"
import { RefusalReason } from "@parle/domain/Coverage"
import { SubjectUrl } from "@parle/domain/Subject"

/**
 * What the CDX index says about a Subject's capture history.
 *
 * Separate from {@link ArchiveRecord} and nullable inside it because the two
 * halves of an Archive Lookup fail INDEPENDENTLY and the first half is the one
 * the product is actually for. The owner's intent is that a reader can click
 * through to the archived copy; that link comes from the availability endpoint
 * alone. CDX is the rate-limited endpoint (community-observed ~60 req/min/IP,
 * with hour-long firewall bans for retrying through a 429), so "we have the
 * link but not the history" is a routine state, not a corner. Collapsing it
 * into a whole `CouldNotAsk` would throw away the link to tidy away the
 * missing counts.
 *
 * `history: null` means no usable history arrived, and never "there is no
 * history". `historyPending` decides how that absence is presented. With no
 * marker it is the terminal "we could not ask" state. With the marker, history
 * remains unresolved: that begins while CDX is in flight and is deliberately
 * retained after a transient failure, unreadable response, or interruption, so
 * a useful first-paint link does not turn into a terminal miss. The marker does
 * not claim a request is still running and does not authorize another one; an
 * Enquiry still asks only once.
 */
export const CaptureHistory = Schema.Struct({
  /**
   * When the Archive first saw this address — the page's age, as far as the
   * Archive can attest to it.
   *
   * Taken from the first CDX row, which is chronological. `null` when the
   * answer held no rows at all (a header-only body), which is itself a real
   * answer and not a failure.
   */
  firstCaptureAt: Schema.NullOr(Schema.Number),
  /** The last row's timestamp. Not necessarily the snapshot linked above. */
  latestCaptureAt: Schema.NullOr(Schema.Number),
  /**
   * How many times the archived content CHANGED, not how many versions exist.
   *
   * The name is the honest one and it was chosen after reading real rows.
   * `collapse=digest` collapses *adjacent* runs of an identical digest, not the
   * whole answer: verified live 2026-08-24 on a Nature article, digest
   * `QAPUFX2Q…` appears at 20240619144848, 20240619153946 and 20240619165508 —
   * three rows, one digest, because other captures fell between them. So the
   * collapsed row count is the number of times a capture differed from the
   * capture before it. A page that alternates A/B/A counts three. That is the
   * right number for the stealth-edit signal this field exists to carry, and it
   * is emphatically NOT a count of distinct versions, so it is not called one.
   *
   * Counted over captures the Archive recorded with status `200` only. The same
   * live answer carried `303` rows and a `-` row interleaved with the real
   * ones; a redirect is not content, and counting redirect churn as content
   * churn would make every URL that ever changed its redirect look edited.
   */
  contentChanges: Schema.Number,
  /**
   * The Archive had more rows than the window we asked for.
   *
   * ADR 0005: a filled retrieval window is reported as "at least N", never as a
   * total. When this is true, `contentChanges` is a floor and the only honest
   * rendering says so.
   */
  clipped: Schema.Boolean
})
export type CaptureHistory = typeof CaptureHistory.Type

/**
 * One archived copy the reader can open, plus what we know about how it got
 * there.
 *
 * `snapshotStatus` is carried as the string the Archive sent rather than a
 * parsed number because that is what it is (`"200"`, and sometimes `"-"` for a
 * capture whose status was never recorded), and because the only consumer —
 * {@link ./Landing.ts} — needs to answer "is this exactly a 200" rather than to
 * do arithmetic on it.
 */
export const ArchiveRecord = Schema.Struct({
  /** The Subject this was looked up for, so a record cannot be misfiled. */
  subject: SubjectUrl,
  /**
   * The closest snapshot's own address on `web.archive.org`. The clickable
   * thing; the reason this package exists.
   */
  archivedUrl: Schema.String,
  /** When that snapshot was taken, epoch milliseconds UTC. */
  snapshotAt: Schema.NullOr(Schema.Number),
  /** The status the Archive recorded when it took that snapshot. */
  snapshotStatus: Schema.String,
  /** See {@link CaptureHistory}. `null` means no usable history arrived. */
  history: Schema.NullOr(CaptureHistory),
  /**
   * Capture history remains unresolved for presentation. Set before CDX starts
   * and retained when a transient failure, unreadable response, or interruption
   * must not replace the already-known link with a terminal miss. This does not
   * mean a network request is still active and does not cause a retry.
   */
  historyPending: Schema.optionalKey(Schema.Boolean)
})
export type ArchiveRecord = typeof ArchiveRecord.Type

/**
 * How one Archive Lookup ended. Total — every path through the service lands on
 * exactly one of these, and the service has no error channel.
 */
export const Holding = Schema.TaggedUnion({
  /** The Archive holds a copy, and here is the one to open. */
  Found: { record: ArchiveRecord },
  /**
   * The Archive answered and holds nothing. The one cacheable outcome.
   *
   * Reached only from a clean 200 that decoded and carried no `closest`
   * snapshot. Never from a body we could not read, and never from a status we
   * did not like.
   */
  NothingArchived: {},
  /** We could not get an answer. About us, not about the Subject. */
  CouldNotAsk: { reason: RefusalReason },
  /** The Archive answered 200 and the answer was not usable. */
  Garbled: { detail: Schema.String }
})
export type Holding = typeof Holding.Type
