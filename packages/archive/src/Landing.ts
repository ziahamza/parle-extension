/**
 * Whether to send the reader to the archived copy instead of the page they
 * asked for — decided here, and nowhere else.
 *
 * This function gates a real navigation. Everything that makes navigation hard
 * to reason about is therefore kept out of it: no `chrome.tabs`, no `location`,
 * no `Clock`, no I/O, no Effect. It takes what it needs — the record, the
 * Subject, the reader's policy, and the current moment — and returns a decision
 * with a reason attached. That is what makes an exhaustive test of the matrix
 * possible, and an exhaustive test is the only acceptable form of evidence for
 * code that moves a reader off the page they typed.
 *
 * `now` is a parameter rather than a `Date.now()` inside, because a decision
 * that reads the clock is a decision you cannot test at a year boundary, and
 * because the torture battery deliberately skews the clock.
 *
 * **The rules, in the order they are applied.** Order is observable — it
 * decides which reason the reader is given when several apply — so it is fixed
 * here rather than left to the shape of the `if`s:
 *
 * 1. The reader turned it off. Their own setting outranks every fact about the
 *    page, and telling them anything else about why they were not moved would
 *    be beside the point.
 * 2. The Subject is not an http(s) address. `file:`, `chrome:`, `about:`,
 *    `moz-extension:` — redirecting off one of these is at best broken and at
 *    worst a way of dragging a local document's address into a URL we hand to
 *    another host.
 * 3. **The Subject is already in the Archive.** The loop guard, and the one
 *    rule with a failure mode that is not merely annoying: `web.archive.org/…`
 *    is itself a page the availability endpoint answers about, so a redirect
 *    fires, the reader lands on an archive page, the extension asks again, and
 *    it fires again. Checked on the host, so it covers `web.archive.org`,
 *    `archive.org` and every `*.archive.org` the Archive serves from.
 * 4. The archived address is not one we may send a reader to. It came off the
 *    wire; a decision to navigate is not a decision to trust a hostname a
 *    remote service put in a JSON field, so it must be http(s) AND on the
 *    Archive's own hosts.
 * 5. The snapshot is not a `200`. A capture of a 404, a 301 or a soft-error
 *    page is a capture of nothing the reader wanted, and swapping a live page
 *    for an archived error is strictly worse than doing nothing.
 * 6. The snapshot is older than the reader's policy allows. Including the case
 *    where we could not read its timestamp at all: an unknown age is not a
 *    young one.
 *
 * Anything that survives all six is a `Redirect`.
 */
import * as Schema from "effect/Schema"
import type { SubjectUrl } from "@parle/domain/Subject"
import type { ArchiveRecord } from "./Holding.ts"

/** The reader's setting. Not built yet; this is the shape it must supply. */
export interface LandingPolicy {
  /** Off by default, wherever this is eventually wired. */
  readonly autoOpen: boolean
  /**
   * How stale a snapshot may be and still be worth landing on, in days.
   *
   * `Infinity` means "any age". Zero or negative means nothing is fresh enough,
   * which is a coherent thing for a setting to say and is treated as such
   * rather than as a bug to be clamped away.
   */
  readonly maxSnapshotAgeDays: number
}

/**
 * Why the reader was left where they were.
 *
 * Each of these is a sentence a panel could have to explain, which is why none
 * of them is `unknown` or `error`. ADR 0005's rule applies to inaction as much
 * as to omission: a redirect that silently does not happen is a thing the
 * reader cannot ask about.
 */
export const StayReason = Schema.Literals([
  /** The reader has not asked for this. */
  "auto-open-off",
  /** Not an http(s) page. */
  "not-web",
  /** The Subject is already an archived copy. The loop guard. */
  "already-in-the-archive",
  /** The address the Archive gave us is not one we may navigate to. */
  "archived-url-unusable",
  /** The Archive captured something, but not a `200`. */
  "snapshot-not-ok",
  /** Older than the policy allows, or of unknown age. */
  "snapshot-too-old"
])
export type StayReason = typeof StayReason.Type

/** What to do about one Subject, and why. */
export const Landing = Schema.TaggedUnion({
  /** Send the reader here instead. Always an address on the Archive's hosts. */
  Redirect: { archivedUrl: Schema.String },
  /** Leave them where they are, for this reason. */
  Stay: { reason: StayReason }
})
export type Landing = typeof Landing.Type

const parse = (address: string): URL | null => {
  try {
    return new URL(address)
  } catch {
    return null
  }
}

const isWeb = (url: URL): boolean => url.protocol === "http:" || url.protocol === "https:"

/**
 * True for the Archive's own hosts.
 *
 * Suffix-matched on a dot so that `notarchive.org` and `archive.org.evil.test`
 * do not match, and bare `archive.org` does. Exported because the redirect
 * wiring will want the same predicate to decide whether to ask at all, and two
 * spellings of "is this the archive" is how a loop guard develops a hole.
 */
export const isArchiveAddress = (address: string): boolean => {
  const url = parse(address)
  if (url === null) return false
  const host = url.hostname.toLowerCase()
  return host === "archive.org" || host === "web.archive.org" || host.endsWith(".archive.org")
}

const MS_PER_DAY = 86_400_000

/**
 * The decision. Total, pure, and exhaustively tested — it will gate real
 * navigation.
 */
export const decideLanding = (
  record: ArchiveRecord,
  subject: SubjectUrl,
  policy: LandingPolicy,
  now: number
): Landing => {
  if (!policy.autoOpen) return Landing.cases.Stay.make({ reason: "auto-open-off" })

  const subjectUrl = parse(subject as string)
  if (subjectUrl === null || !isWeb(subjectUrl)) {
    return Landing.cases.Stay.make({ reason: "not-web" })
  }
  if (isArchiveAddress(subject as string)) {
    return Landing.cases.Stay.make({ reason: "already-in-the-archive" })
  }

  const archived = parse(record.archivedUrl)
  if (archived === null || !isWeb(archived) || !isArchiveAddress(record.archivedUrl)) {
    return Landing.cases.Stay.make({ reason: "archived-url-unusable" })
  }

  if (record.snapshotStatus !== "200") {
    return Landing.cases.Stay.make({ reason: "snapshot-not-ok" })
  }

  // An unreadable timestamp shares this branch with a genuinely old one. Both
  // mean "we cannot say this snapshot is recent enough", and the conservative
  // reading of that is the one that leaves the reader on the live page.
  if (record.snapshotAt === null) {
    return Landing.cases.Stay.make({ reason: "snapshot-too-old" })
  }
  // A snapshot dated in the future is clock skew, not staleness — the torture
  // battery makes that a routine condition — so a negative age is fresh.
  const ageDays = (now - record.snapshotAt) / MS_PER_DAY
  if (!(ageDays <= policy.maxSnapshotAgeDays)) {
    return Landing.cases.Stay.make({ reason: "snapshot-too-old" })
  }

  return Landing.cases.Redirect.make({ archivedUrl: record.archivedUrl })
}
