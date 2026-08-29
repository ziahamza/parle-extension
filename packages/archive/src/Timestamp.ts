/**
 * Wayback's 14-digit timestamp, parsed without asking `Date` to guess.
 *
 * Every time the Internet Archive states a moment — the `timestamp` on an
 * availability snapshot, the first column of a CDX row, the path segment in
 * `web.archive.org/web/<timestamp>/<url>` — it states it as exactly fourteen
 * digits, `YYYYMMDDhhmmss`, in UTC. Verified live 2026-08-24 against
 * `/cdx/search/cdx`: `20240619144848`.
 *
 * `Date.parse` is not used, and the reason is not style. Handed
 * `"20240619144848"` it returns `NaN` in V8; handed anything it *does*
 * recognise it applies the host's local zone to date-only forms and the ES spec
 * explicitly permits implementations to accept whatever else they like. Both
 * failure modes are silent, and a snapshot age that is silently eight hours
 * wrong is exactly the kind of thing that decides a redirect (see
 * {@link ./Landing.ts}) for the wrong reason and never shows up in a bug
 * report.
 *
 * So the digits are read as digits and range-checked before a `Date` is
 * involved at all, and the result is round-tripped against the components that
 * produced it. That round trip is what rejects `20230229120000` — a date that
 * does not exist, which `Date.UTC` would happily roll forward into 1 March
 * rather than refuse.
 *
 * `null` means "the Archive said something we cannot read as a moment". It is
 * never zero and never "now": a missing timestamp that arrives as an epoch of 0
 * is a snapshot from 1970, which reads as infinitely stale and would suppress a
 * redirect the reader was owed.
 */

/** Exactly fourteen digits, and nothing else. Anchored on purpose. */
const FOURTEEN_DIGITS = /^\d{14}$/

const digits = (raw: string, from: number, length: number): number =>
  Number(raw.slice(from, from + length))

/**
 * The moment a 14-digit Wayback timestamp names, in epoch milliseconds UTC.
 *
 * `setUTCFullYear` rather than `Date.UTC(year, ...)` because `Date.UTC` maps
 * years 0–99 onto 1900–1999. No Wayback capture predates 1996, so the mapping
 * would never bite in production — but a parser whose correctness depends on
 * the data never being strange is not a parser, and the fixture that finally
 * carries `0096…` will be in a test written by somebody who does not know that.
 */
export const parseWaybackTimestamp = (raw: string): number | null => {
  if (!FOURTEEN_DIGITS.test(raw)) return null

  const year = digits(raw, 0, 4)
  const month = digits(raw, 4, 2)
  const day = digits(raw, 6, 2)
  const hour = digits(raw, 8, 2)
  const minute = digits(raw, 10, 2)
  const second = digits(raw, 12, 2)

  // Range-checked before `Date` sees them, because `Date` ROLLS OVER rather
  // than refusing: hour 25 becomes the next day at 01:00 and second 61 becomes
  // the next minute. Both are answers, and both are wrong.
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  if (hour > 23 || minute > 59 || second > 59) return null

  const at = new Date(0)
  at.setUTCFullYear(year, month - 1, day)
  at.setUTCHours(hour, minute, second, 0)

  const ms = at.getTime()
  if (!Number.isFinite(ms)) return null

  // The round trip. 31 April and 29 February in a common year pass every range
  // check above and are still not days; this is the only thing that catches
  // them.
  if (at.getUTCFullYear() !== year) return null
  if (at.getUTCMonth() !== month - 1) return null
  if (at.getUTCDate() !== day) return null

  return ms
}

const pad = (value: number, width: number): string => String(value).padStart(width, "0")

/**
 * The inverse, for building a `web.archive.org/web/<timestamp>/…` address.
 *
 * Not currently on the read path — the availability API hands us a finished
 * URL, and constructing one ourselves would be us guessing at a snapshot that
 * may not exist. It is here so that the encoding lives in the same file as the
 * decoding and the two cannot drift apart, and it is round-tripped in the
 * tests for that reason.
 */
export const toWaybackTimestamp = (epochMs: number): string | null => {
  if (!Number.isFinite(epochMs)) return null
  const at = new Date(epochMs)
  const year = at.getUTCFullYear()
  if (year < 0 || year > 9999) return null
  return (
    pad(year, 4) +
    pad(at.getUTCMonth() + 1, 2) +
    pad(at.getUTCDate(), 2) +
    pad(at.getUTCHours(), 2) +
    pad(at.getUTCMinutes(), 2) +
    pad(at.getUTCSeconds(), 2)
  )
}
