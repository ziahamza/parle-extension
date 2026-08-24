/**
 * The whole matrix, because this function moves a reader off the page they
 * typed.
 *
 * Every rule gets a case that fires it and a case that does not, the ordering
 * between rules is asserted directly rather than inferred, and the loop guard
 * gets the widest set of hostile spellings this file's author could think of.
 * There is no browser here on purpose: if this needs a browser to test, it is
 * the wrong shape.
 */
import { describe, expect, it } from "vitest"
import { SubjectUrl } from "@parle/domain/Subject"
import type { ArchiveRecord } from "./Holding.ts"
import { decideLanding, isArchiveAddress, type LandingPolicy } from "./Landing.ts"

const NOW = Date.UTC(2026, 7, 24, 12, 0, 0)
const DAY = 86_400_000

const SUBJECT = SubjectUrl.make("https://www.nature.com/articles/d41586-024-02012-5")
const ARCHIVED = "https://web.archive.org/web/20260801120000/https://www.nature.com/articles/x"

const on: LandingPolicy = { autoOpen: true, maxSnapshotAgeDays: 365 }
const off: LandingPolicy = { autoOpen: false, maxSnapshotAgeDays: 365 }

const record = (overrides: Partial<ArchiveRecord> = {}): ArchiveRecord => ({
  subject: SUBJECT,
  archivedUrl: ARCHIVED,
  snapshotAt: NOW - 30 * DAY,
  snapshotStatus: "200",
  history: null,
  ...overrides
})

const decide = (
  r: ArchiveRecord = record(),
  subject: SubjectUrl = SUBJECT,
  policy: LandingPolicy = on,
  now: number = NOW
) => decideLanding(r, subject, policy, now)

describe("the happy path", () => {
  it("redirects to the archived copy, and to exactly the address it was given", () => {
    const landing = decide()
    expect(landing).toEqual({ _tag: "Redirect", archivedUrl: ARCHIVED })
  })
})

describe("the reader's own setting", () => {
  it("stays, saying so, when auto-open is off", () => {
    expect(decide(record(), SUBJECT, off)).toEqual({ _tag: "Stay", reason: "auto-open-off" })
  })

  it("outranks every other reason, so the reader is told about their setting", () => {
    // A record that would fail four other rules. The reason must still be the
    // setting: telling a reader "that snapshot was a 404" when they had the
    // feature switched off answers a question they did not ask.
    const hopeless = record({ archivedUrl: "javascript:alert(1)", snapshotStatus: "404", snapshotAt: null })
    expect(decide(hopeless, SubjectUrl.make("file:///tmp/x.html"), off)).toEqual({
      _tag: "Stay",
      reason: "auto-open-off"
    })
  })
})

describe("addresses we will not redirect from", () => {
  it("stays on anything that is not http(s)", () => {
    for (const address of [
      "file:///home/reader/notes.html",
      "chrome://extensions",
      "about:blank",
      "moz-extension://abc/page.html",
      "data:text/html,hi",
      "not a url at all"
    ]) {
      expect(decide(record(), SubjectUrl.make(address))).toEqual({
        _tag: "Stay",
        reason: "not-web"
      })
    }
  })

  it("stays when the Subject is already an archived copy — the loop guard", () => {
    for (const address of [
      "https://web.archive.org/web/20240619144848/https://www.nature.com/articles/x",
      "https://archive.org/wayback/available?url=x",
      "http://web.archive.org/web/2024/https://example.test/",
      "https://WEB.ARCHIVE.ORG/web/2024/https://example.test/"
    ]) {
      expect(decide(record(), SubjectUrl.make(address))).toEqual({
        _tag: "Stay",
        reason: "already-in-the-archive"
      })
    }
  })

  it("does not mistake a lookalike host for the Archive", () => {
    // If this were a substring match, `archive.org.evil.test` would be treated
    // as the Archive — which fails safe in the loop guard and fails OPEN in the
    // destination check below. Same predicate, so it is asserted once here.
    expect(isArchiveAddress("https://archive.org.evil.test/web/2024/x")).toBe(false)
    expect(isArchiveAddress("https://notarchive.org/x")).toBe(false)
    expect(isArchiveAddress("https://archive.org/x")).toBe(true)
    expect(isArchiveAddress("https://web.archive.org/x")).toBe(true)
    expect(isArchiveAddress("https://wayback-api.archive.org/x")).toBe(true)
    expect(isArchiveAddress("nonsense")).toBe(false)
  })
})

describe("addresses we will not redirect TO", () => {
  it("stays when the archived address is not on the Archive's own hosts", () => {
    // The address came off the wire. Navigating is not a reason to trust a
    // hostname a remote service put in a JSON field.
    for (const address of [
      "https://evil.test/web/20240619144848/https://www.nature.com/x",
      "https://archive.org.evil.test/web/2024/x",
      "javascript:alert(1)",
      "data:text/html,hi",
      ""
    ]) {
      expect(decide(record({ archivedUrl: address }))).toEqual({
        _tag: "Stay",
        reason: "archived-url-unusable"
      })
    }
  })
})

describe("what the Archive actually captured", () => {
  it("stays when the snapshot was not a 200", () => {
    for (const status of ["404", "301", "302", "500", "-", ""]) {
      expect(decide(record({ snapshotStatus: status }))).toEqual({
        _tag: "Stay",
        reason: "snapshot-not-ok"
      })
    }
  })

  it("redirects only on exactly 200", () => {
    expect(decide(record({ snapshotStatus: "200" }))._tag).toBe("Redirect")
  })
})

describe("how stale is too stale", () => {
  it("redirects to a snapshot exactly at the policy's limit", () => {
    expect(decide(record({ snapshotAt: NOW - 365 * DAY }))).toEqual({
      _tag: "Redirect",
      archivedUrl: ARCHIVED
    })
  })

  it("stays for a snapshot one millisecond past the limit", () => {
    expect(decide(record({ snapshotAt: NOW - 365 * DAY - 1 }))).toEqual({
      _tag: "Stay",
      reason: "snapshot-too-old"
    })
  })

  it("treats an unreadable snapshot time as too old, never as fresh", () => {
    expect(decide(record({ snapshotAt: null }))).toEqual({
      _tag: "Stay",
      reason: "snapshot-too-old"
    })
  })

  it("treats a snapshot dated in the future as fresh, because that is clock skew", () => {
    expect(decide(record({ snapshotAt: NOW + 10 * DAY }))._tag).toBe("Redirect")
  })

  it("honours a policy of Infinity as 'any age'", () => {
    const ancient = record({ snapshotAt: Date.UTC(1997, 0, 1) })
    expect(decide(ancient, SUBJECT, { autoOpen: true, maxSnapshotAgeDays: Infinity })._tag)
      .toBe("Redirect")
  })

  it("honours a policy of zero as 'nothing is fresh enough', without clamping it away", () => {
    expect(decide(record(), SUBJECT, { autoOpen: true, maxSnapshotAgeDays: 0 })).toEqual({
      _tag: "Stay",
      reason: "snapshot-too-old"
    })
  })

  it("stays when the policy is NaN rather than redirecting on a comparison that is false", () => {
    // `age > NaN` is false, so a rule written as `if (age > max) stay` would
    // REDIRECT here. The rule is written as `if (!(age <= max)) stay` for
    // exactly this reason, and this is the check that would go red if anyone
    // flipped it back.
    expect(decide(record(), SUBJECT, { autoOpen: true, maxSnapshotAgeDays: Number.NaN })).toEqual({
      _tag: "Stay",
      reason: "snapshot-too-old"
    })
  })
})

describe("the order the rules are applied in", () => {
  it("reports the loop before the destination, so an archive page never reads as a bad link", () => {
    const onArchive = SubjectUrl.make("https://web.archive.org/web/2024/https://example.test/")
    expect(decide(record({ archivedUrl: "javascript:alert(1)" }), onArchive)).toEqual({
      _tag: "Stay",
      reason: "already-in-the-archive"
    })
  })

  it("reports a bad destination before a bad snapshot status", () => {
    expect(decide(record({ archivedUrl: "https://evil.test/x", snapshotStatus: "404" }))).toEqual({
      _tag: "Stay",
      reason: "archived-url-unusable"
    })
  })

  it("reports a bad snapshot status before staleness", () => {
    expect(decide(record({ snapshotStatus: "404", snapshotAt: null }))).toEqual({
      _tag: "Stay",
      reason: "snapshot-not-ok"
    })
  })

  it("reports a non-web Subject before anything about the Archive's answer", () => {
    expect(decide(record({ archivedUrl: "https://evil.test/x" }), SubjectUrl.make("about:blank")))
      .toEqual({ _tag: "Stay", reason: "not-web" })
  })
})
