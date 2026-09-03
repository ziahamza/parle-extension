import { SubjectUrl } from "@parle/domain/Subject"
import { describe, expect, it } from "vitest"
import { emptyPanel, type Panel, type Row } from "../view/Panel.ts"
import { clearRecentOpenings, recentOpeningOf } from "./RecentOpening.ts"

const SUBJECT = SubjectUrl.make("https://example.com/piece")
const OPENED_AT = 1_700_000_100_000

const row = (key: string, overrides: Partial<Row> = {}): Row => ({
  key,
  network: "hackernews",
  networkName: "Hacker News",
  place: null,
  title: `Discussion ${key}`,
  score: 42,
  commentCount: 7,
  age: "1h",
  permalink: `https://news.ycombinator.com/item?id=${key}`,
  tier: "linked",
  alsoSubmitted: 3,
  comments: null,
  ...overrides
})

const panelWith = (overrides: Partial<Panel>): Panel => ({
  ...emptyPanel,
  ...overrides
})

describe("RecentOpening", () => {
  it("includes Discussions that exist only in the front-door fold", () => {
    const folded = row("folded", { tier: "passing" })
    const opening = recentOpeningOf(SUBJECT, "A piece", panelWith({
      folded: { says: "Older Discussions", label: "Show them", rows: [folded] }
    }), OPENED_AT)

    expect(opening.discussions).toEqual([{
      key: "folded",
      network: "hackernews",
      networkName: "Hacker News",
      place: null,
      title: "Discussion folded",
      score: 42,
      commentCount: 7,
      permalink: "https://news.ycombinator.com/item?id=folded",
      tier: "passing"
    }])
  })

  it("de-duplicates a Discussion across visible and folded collections", () => {
    const first = row("same", { title: "The linked copy" })
    const opening = recentOpeningOf(SUBJECT, "A piece", panelWith({
      linked: [first],
      passing: [row("same", { title: "The passing copy", tier: "passing" }), row("other")],
      folded: {
        says: "Older Discussions",
        label: "Show them",
        rows: [row("same", { title: "The folded copy" }), row("third")]
      }
    }), OPENED_AT)

    expect(opening.discussions.map(({ key, title }) => ({ key, title }))).toEqual([
      { key: "same", title: "The linked copy" },
      { key: "other", title: "Discussion other" },
      { key: "third", title: "Discussion third" }
    ])
  })

  it("carries the Archive link for this page, but no Standing link", () => {
    const archiveUrl = "https://web.archive.org/web/20240101000000/https://example.com/piece"
    const opening = recentOpeningOf(SUBJECT, "A piece", panelWith({
      context: {
        archive: [
          { text: "Still asking", href: null, links: [], tone: "waiting" },
          { text: "A kept copy", href: archiveUrl, links: [], tone: "found" }
        ],
        standing: [{
          text: "A reference",
          href: "https://en.wikipedia.org/wiki/Example",
          links: [],
          tone: "found"
        }]
      }
    }), OPENED_AT)

    expect(opening.archiveUrl).toBe(archiveUrl)
  })

  it("serialises exactly the minimal native fields", () => {
    const withSensitivePanelState = row("123", {
      comments: {
        _tag: "Read",
        comments: [{
          id: "private-to-the-panel",
          parentId: null,
          depth: 0,
          author: "somebody",
          text: "comment body must not cross the mirror seam",
          age: "now"
        }],
        beyond: 2
      }
    })
    const opening = recentOpeningOf(SUBJECT, "A piece", panelWith({
      address: "https://example.com/tracking-version",
      linked: [withSensitivePanelState],
      digest: {
        says: { tone: "found", text: "digest text must not cross the mirror seam" },
        findings: [{
          statement: "A finding",
          contested: true,
          sources: [{ label: "source", permalink: "https://example.com/source", comment: true }]
        }],
        partial: false,
        wrote: "A provider",
        offer: null
      }
    }), OPENED_AT)

    expect(JSON.parse(JSON.stringify(opening))).toEqual({
      schemaVersion: 1,
      command: "recordOpening",
      subject: "https://example.com/piece",
      title: "A piece",
      openedAt: OPENED_AT,
      discussions: [{
        key: "123",
        network: "hackernews",
        networkName: "Hacker News",
        place: null,
        title: "Discussion 123",
        score: 42,
        commentCount: 7,
        permalink: "https://news.ycombinator.com/item?id=123",
        tier: "linked"
      }]
    })
    expect(clearRecentOpenings(OPENED_AT)).toEqual({
      schemaVersion: 1,
      command: "clearRecentOpenings",
      clearedAt: OPENED_AT
    })
  })

  it("keeps every Discussion while bounding every variable-size display string", () => {
    const long = "🦜".repeat(5_000)
    const opening = recentOpeningOf(SUBJECT, long, panelWith({
      linked: Array.from({ length: 125 }, (_, at) => row(`discussion-${at}`, {
        key: `${at}-${long}`,
        networkName: long,
        place: long,
        title: long,
        permalink: `https://example.com/${long}`
      })),
      context: {
        archive: [{ text: "A kept copy", href: `https://archive.example/${long}`, links: [], tone: "found" }],
        standing: []
      }
    }), OPENED_AT)

    const first = opening.discussions[0]
    expect(opening.discussions).toHaveLength(125)
    expect(Array.from(opening.title)).toHaveLength(300)
    expect(Array.from(opening.archiveUrl ?? "")).toHaveLength(4_096)
    expect(Array.from(first?.key ?? "")).toHaveLength(512)
    expect(Array.from(first?.networkName ?? "")).toHaveLength(64)
    expect(Array.from(first?.place ?? "")).toHaveLength(128)
    expect(Array.from(first?.title ?? "")).toHaveLength(300)
    expect(Array.from(first?.permalink ?? "")).toHaveLength(4_096)
  })

  it("clips a subject longer than 4096 code points to the same URL bound", () => {
    const long = `https://example.com/${"🦜".repeat(5_000)}`
    const opening = recentOpeningOf(SubjectUrl.make(long), "A piece", emptyPanel, OPENED_AT)

    expect(Array.from(opening.subject)).toHaveLength(4_096)
    expect(opening.subject).toBe(Array.from(long).slice(0, 4_096).join(""))
  })
})
