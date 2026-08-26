/**
 * Reading a published exclusion artifact, defensively.
 *
 * The artifact host is deliberately untrusted (see `Seed.withUpdate`: additive
 * only, version-gated), and this codec is the other half of that stance: the
 * file arrives as text from the network, and nothing about it is assumed. A
 * body that is not JSON, not an object, or structurally wrong is no artifact
 * at all. An ENTRY whose category this build has never heard of is dropped
 * alone — a newer publisher naming a new category must not cost an older
 * install the entries it can still understand, and rendering a category the
 * settings page has no words for would show the reader raw vocabulary.
 */
import * as Option from "effect/Option"
import { Category } from "./Exclusion.ts"
import type { DomainArtifact, ListedEntry } from "./Seed.ts"

const categories: ReadonlySet<string> = new Set(Category.members.map((one) => one.literal))

const isEntryShaped = (value: unknown): value is { readonly domain: unknown; readonly category: unknown } =>
  typeof value === "object" && value !== null

/**
 * The artifact in `text`, or none.
 *
 * Total: never throws, whatever the host served.
 */
export const readArtifact = (text: string): Option.Option<DomainArtifact> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return Option.none()
  }
  if (typeof parsed !== "object" || parsed === null) return Option.none()
  const held = parsed as { readonly version?: unknown; readonly entries?: unknown }
  if (typeof held.version !== "number" || !Number.isInteger(held.version) || held.version < 0) {
    return Option.none()
  }
  if (!Array.isArray(held.entries)) return Option.none()
  const entries: Array<ListedEntry> = []
  for (const one of held.entries) {
    if (!isEntryShaped(one)) return Option.none()
    if (typeof one.domain !== "string" || one.domain.length === 0) return Option.none()
    if (typeof one.category !== "string") return Option.none()
    // Unknown category: a vocabulary from a newer publisher. The entry is
    // dropped, the artifact is kept.
    if (!categories.has(one.category)) continue
    entries.push({ domain: one.domain.toLowerCase(), category: one.category as ListedEntry["category"] })
  }
  return Option.some({ version: held.version, entries })
}
