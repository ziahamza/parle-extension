/**
 * Reading a Network page without a DOM.
 *
 * A scanner over markup, not a parser, for the same reason `@parle/networks`
 * writes one for old.reddit: there is no `DOMParser` in an MV3 service worker,
 * and harvesting must work in the background where the page's own scripts
 * cannot reach it. Everything here is a total function of a string that returns
 * fewer results rather than throwing — a harvest that can crash is a harvest
 * that takes the reader's Recollection with it.
 *
 * The matching is deliberately loose in two ways that both look like
 * sloppiness and are not. Class matching is by SUBSTRING, because every Network
 * here ships generated class attributes with trailing whitespace, varying order
 * and per-experiment suffixes, and anything anchored on an exact attribute
 * string is a parser that works until the first A/B test. Blocks are sliced
 * between marker occurrences rather than balanced, because balancing tags in a
 * regex is not possible and a real tokenizer would be a large dependency in a
 * bundle whose size is the product's install cost.
 *
 * What is deliberately strict: nothing here invents an identifier. A block that
 * does not carry a Discussion's native id is dropped by its caller, because a
 * Mention we cannot identify is one we can neither dedupe, nor observe twice,
 * nor cite.
 */

const entities: ReadonlyArray<readonly [RegExp, string]> = [
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, "\""],
  [/&#0?39;/g, "'"],
  [/&#x27;/gi, "'"],
  [/&#x2F;/gi, "/"],
  [/&nbsp;/g, " "],
  // Last, always: an early `&amp;` pass would turn `&amp;lt;` into a `<`.
  [/&amp;/g, "&"]
]

export const decodeEntities = (raw: string): string =>
  entities.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), raw)

/** The visible text of a fragment, tags removed and entities decoded. */
export const stripTags = (raw: string): string =>
  decodeEntities(raw.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim()

/**
 * One attribute of an opening tag, in either quoting style.
 *
 * Unquoted attribute values are not supported on purpose: they cannot contain a
 * URL with a query string, so nothing this package reads is ever written that
 * way, and accepting them would mean matching up to whitespace and silently
 * truncating an honest quoted value that happened to follow a malformed one.
 */
export const attribute = (openingTag: string, name: string): string | null => {
  const found = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(openingTag)
  if (found === undefined || found === null) return null
  const value = found[2] ?? found[3]
  return value === undefined ? null : decodeEntities(value)
}

/**
 * The first integer in a string like `127 points` or `1.2K comments`.
 *
 * The `K`/`M` suffix must be **attached to the digits and end the word**.
 * Allowing whitespace before it, or another letter after it, is not a lenience
 * — it is a fabrication: `5 minutes ago` reads as five million and `12 Members`
 * as twelve million, and the number goes straight into an Observation, which
 * the glossary says is never corrected, only superseded. A score nobody
 * observed is worse than a score we do not have, because a missing one renders
 * as nothing and an invented one renders as a Movement.
 */
export const leadingCount = (raw: string): number | null => {
  const found = /-?\d[\d,]*(\.\d+)?([KM])?(?![\p{L}\d.])/iu.exec(raw)
  if (found === null || found[0] === undefined) return null
  const text = found[0]
  const suffix = found[2]?.toUpperCase()
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : 1
  const digits = text.replace(/[KM]$/i, "").replace(/,/g, "")
  const parsed = Number.parseFloat(digits) * multiplier
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

/** One `<a>` on the page: what it points at, what it says, and how it is styled. */
export interface Anchor {
  readonly classes: string
  readonly href: string | null
  readonly rel: string | null
  readonly text: string
}

export const anchorsIn = (block: string): ReadonlyArray<Anchor> => {
  const out: Array<Anchor> = []
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let found: RegExpExecArray | null
  while ((found = pattern.exec(block)) !== null) {
    const attributes = found[1] ?? ""
    out.push({
      classes: attribute(attributes, "class") ?? "",
      href: attribute(attributes, "href"),
      rel: attribute(attributes, "rel"),
      text: stripTags(found[2] ?? "")
    })
  }
  return out
}

/**
 * The text of the first element of `tag` whose attributes satisfy a test.
 *
 * The scan walks OPENING tags and then takes everything up to the next closing
 * tag of the same name. Matching `<tag …>(.*?)</tag>` pairs instead looks
 * equivalent and is not: every Network here nests spans inside spans, so a
 * non-greedy pair match consumes an outer element's opening tag together with
 * an inner element's closing tag and steps the cursor *past* the element being
 * looked for — which reads as "the page does not have a score" on a page that
 * plainly does. Walking openings cannot skip a candidate.
 *
 * Text still stops at the first closing tag, so an element with a same-named
 * child yields only that child's worth. That is the right limitation: the
 * alternative, counting depth, is a tokenizer, and a greedy match swallows the
 * rest of the page — which is how a parser starts producing titles containing
 * an entire timeline.
 */
export const textOfFirstWhere = (
  block: string,
  tag: string,
  matches: (attributes: string) => boolean
): string | null => {
  const openings = new RegExp(`<${tag}\\b([^>]*)>`, "gi")
  const closing = `</${tag.toLowerCase()}`
  const haystack = block.toLowerCase()
  let found: RegExpExecArray | null
  while ((found = openings.exec(block)) !== null) {
    if (!matches(found[1] ?? "")) continue
    const from = openings.lastIndex
    const close = haystack.indexOf(closing, from)
    return stripTags(block.slice(from, close === -1 ? block.length : close))
  }
  return null
}

/** The text of the first element of `tag` whose class contains `className`. */
export const textOfFirst = (block: string, tag: string, className: string): string | null =>
  textOfFirstWhere(block, tag, (attributes) => (attribute(attributes, "class") ?? "").includes(className))

/** The text of the first element of `tag` carrying `name="value"` exactly. */
export const textOfFirstWith = (block: string, tag: string, name: string, value: string): string | null =>
  textOfFirstWhere(block, tag, (attributes) => attribute(attributes, name) === value)

/** The opening tag of the first element of `tag` whose class contains `className`. */
export const openingTagOf = (block: string, tag: string, className: string): string | null => {
  const pattern = new RegExp(`<${tag}\\b([^>]*)>`, "gi")
  let found: RegExpExecArray | null
  while ((found = pattern.exec(block)) !== null) {
    const attributes = found[1] ?? ""
    if ((attribute(attributes, "class") ?? "").includes(className)) return attributes
  }
  return null
}

/** One named attribute of the first element of `tag` carrying it. */
export const attributeOfFirst = (block: string, tag: string, name: string): string | null => {
  const pattern = new RegExp(`<${tag}\\b([^>]*)>`, "gi")
  let found: RegExpExecArray | null
  while ((found = pattern.exec(block)) !== null) {
    const value = attribute(found[1] ?? "", name)
    if (value !== null) return value
  }
  return null
}

/**
 * Split a page at each occurrence of a marker.
 *
 * Cheap, and tolerant of nesting: each block runs from the element boundary
 * carrying one marker to the boundary carrying the next. Trailing markup after
 * the last block is included in it, which costs a parser nothing because every
 * field it reads is anchored on a class of its own.
 */
export const blocksAt = (markup: string, marker: string): ReadonlyArray<string> => {
  const starts: Array<number> = []
  let at = markup.indexOf(marker)
  while (at !== -1) {
    // Walk back to the opening `<`, so a block begins at an element boundary
    // rather than in the middle of an attribute value.
    const open = markup.lastIndexOf("<", at)
    starts.push(open === -1 ? at : open)
    at = markup.indexOf(marker, at + marker.length)
  }
  return starts.map((start, index) => markup.slice(start, starts[index + 1] ?? markup.length))
}

/**
 * An href as an absolute address, or `null` if it is not one.
 *
 * `null` for `javascript:`, `mailto:`, a bare `#fragment` and anything the URL
 * parser rejects. Those are not pages, so there is no Subject for a Mention to
 * be about — which is a different thing from a link we could not resolve, and
 * the two must not be confused: one is nothing, the other is something we
 * failed at.
 */
export const absolute = (href: string, base: string): string | null => {
  const trimmed = href.trim()
  if (trimmed === "" || trimmed.startsWith("#")) return null
  let resolved: URL
  try {
    resolved = new URL(trimmed, base)
  } catch {
    return null
  }
  return resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.toString() : null
}

/** The epoch milliseconds of a machine-readable timestamp, if it is one. */
export const instantOf = (raw: string | null): number | null => {
  if (raw === null) return null
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : parsed
}
