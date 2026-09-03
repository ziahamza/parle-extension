/**
 * The bounded snapshot sent to an Apple companion after the reader explicitly
 * opens Parle on a page.
 *
 * This is deliberately a projection of {@link Panel}, not a serialised Panel.
 * Comments, Digest text, referrers, tab identifiers and every other transient
 * detail have no field here, so they cannot reach the native mirror by
 * accident when Panel grows.
 */
import type { SubjectUrl } from "@parle/domain/Subject"
import type { Panel, Row, Tier } from "../view/Panel.ts"

const SCHEMA_VERSION = 1 as const

const MAX_OPENING_TITLE = 300
const MAX_DISCUSSION_KEY = 512
const MAX_NETWORK_NAME = 64
const MAX_PLACE = 128
const MAX_DISCUSSION_TITLE = 300
const MAX_URL = 4_096

/** Clip by Unicode code point, so the bound never leaves half a surrogate pair. */
const bounded = (value: string, limit: number): string => {
  const points = Array.from(value)
  return points.length <= limit ? value : points.slice(0, limit).join("")
}

export interface RecentOpeningDiscussion {
  readonly key: string
  readonly network: Row["network"]
  readonly networkName: string
  readonly place: string | null
  readonly title: string
  readonly score: number
  readonly commentCount: number
  readonly permalink: string
  readonly tier: Tier
}

/**
 * One native-mirror command, containing only what the companion needs to draw
 * the page and every Discussion Parle already knows belongs to it.
 */
export interface RecentOpening {
  readonly schemaVersion: 1
  readonly command: "recordOpening"
  readonly subject: SubjectUrl
  readonly title: string
  readonly openedAt: number
  readonly archiveUrl?: string
  readonly discussions: ReadonlyArray<RecentOpeningDiscussion>
}

export interface ClearRecentOpenings {
  readonly schemaVersion: 1
  readonly command: "clearRecentOpenings"
  /** The reader's clear gesture, fixed so a reconnect replay stays idempotent. */
  readonly clearedAt: number
}

/** The complete command understood by the first native mirror schema. */
export type RecentOpeningCommand = RecentOpening | ClearRecentOpenings

/** A value rather than an imperative API: sending it is the platform adapter's job. */
export const clearRecentOpenings = (clearedAt = Date.now()): ClearRecentOpenings => ({
  schemaVersion: SCHEMA_VERSION,
  command: "clearRecentOpenings",
  clearedAt
})

const discussionOf = (row: Row): RecentOpeningDiscussion => ({
  key: bounded(row.key, MAX_DISCUSSION_KEY),
  network: row.network,
  networkName: bounded(row.networkName, MAX_NETWORK_NAME),
  place: row.place === null ? null : bounded(row.place, MAX_PLACE),
  title: bounded(row.title, MAX_DISCUSSION_TITLE),
  score: row.score,
  commentCount: row.commentCount,
  permalink: bounded(row.permalink, MAX_URL),
  tier: row.tier
})

/**
 * Project a panel into the native history contract.
 *
 * Rows are considered the same Discussion by `Row.key`, the collision-free
 * Network/native-id key minted by the domain. First occurrence wins in visible
 * order: linked, passing, then folded. There is deliberately no second bound
 * here: the Panel already owns which rows exist, and the companion promises to
 * show every Discussion that was visible in that explicitly opened Panel.
 */
export const recentOpeningOf = (
  subject: SubjectUrl,
  title: string,
  panel: Panel,
  openedAt: number
): RecentOpening => {
  const rows = panel.folded === null
    ? [...panel.linked, ...panel.passing]
    : [...panel.linked, ...panel.passing, ...panel.folded.rows]
  const seen = new Set<string>()
  const discussions: Array<RecentOpeningDiscussion> = []

  for (const row of rows) {
    if (seen.has(row.key)) continue
    seen.add(row.key)
    discussions.push(discussionOf(row))
  }

  const archiveUrl = panel.context.archive.find((line) => line.href !== null && line.href !== "")?.href

  return {
    schemaVersion: SCHEMA_VERSION,
    command: "recordOpening",
    subject: bounded(subject, MAX_URL) as SubjectUrl,
    title: bounded(title, MAX_OPENING_TITLE),
    openedAt,
    ...(archiveUrl === undefined || archiveUrl === null
      ? {}
      : { archiveUrl: bounded(archiveUrl, MAX_URL) }),
    discussions
  }
}
