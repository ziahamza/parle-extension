/**
 * Reading old.reddit's search page without a DOM.
 *
 * ADR 0013's tier 2 is HTML, and there is no `DOMParser` in an MV3 service
 * worker — the background context is where these requests must live, because
 * Reddit sends no `Access-Control-Allow-Origin` and a page-context fetch cannot
 * make them at all. So this is a scanner over markup, not a parser, and it is
 * written to fail by returning fewer results rather than by throwing: a
 * connector whose tier-2 fallback can crash has no tier 2.
 *
 * Every result is anchored on the comments permalink — `/r/<sub>/comments/<id>`
 * — or on `data-fullname="t3_<id>"`, because those are the two places the
 * native id appears and either alone is enough. A block that yields neither is
 * dropped: a Mention we cannot identify is a Mention we can neither dedupe, nor
 * observe twice, nor cite.
 *
 * The class-name matching is substring-based on purpose. Reddit ships
 * `class="search-result search-result-link  "` with trailing space and varies
 * attribute order between the logged-in and logged-out renderings, so anything
 * anchored on an exact attribute string is a parser that works until the first
 * A/B test.
 */

/** One row of an old.reddit search page. */
export interface SearchRow {
  /** The base-36 id, without the `t3_` prefix. */
  readonly nativeId: string
  /** The address the post was submitted under, where the row gave one. */
  readonly submitted: string | null
  readonly title: string | null
  readonly score: number | null
  readonly comments: number | null
}

const BLOCK_MARKER = "search-result-link"

const decodeEntities = (raw: string): string =>
  raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")

const stripTags = (raw: string): string => decodeEntities(raw.replace(/<[^>]*>/g, "")).trim()

const attribute = (openingTag: string, name: string): string | null => {
  const found = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(openingTag)
  return found?.[1] === undefined ? null : decodeEntities(found[1])
}

/** The first integer in a string like `• 127 points` or `18 comments`. */
const leadingCount = (raw: string): number | null => {
  const found = /-?\d[\d,]*/.exec(raw)
  if (!found?.[0]) return null
  const parsed = Number.parseInt(found[0].replace(/,/g, ""), 10)
  return Number.isNaN(parsed) ? null : parsed
}

interface Anchor {
  readonly classes: string
  readonly href: string | null
  readonly text: string
}

const anchorsIn = (block: string): ReadonlyArray<Anchor> => {
  const out: Array<Anchor> = []
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let found: RegExpExecArray | null
  while ((found = pattern.exec(block)) !== null) {
    const attributes = found[1] ?? ""
    out.push({
      classes: attribute(attributes, "class") ?? "",
      href: attribute(attributes, "href"),
      text: stripTags(found[2] ?? "")
    })
  }
  return out
}

const spanTextWithClass = (block: string, className: string): string | null => {
  const pattern = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi
  let found: RegExpExecArray | null
  while ((found = pattern.exec(block)) !== null) {
    if ((attribute(found[1] ?? "", "class") ?? "").includes(className)) {
      return stripTags(found[2] ?? "")
    }
  }
  return null
}

/** Split the page at each result marker. Cheap, and tolerant of nesting. */
const blocksIn = (html: string): ReadonlyArray<string> => {
  const starts: Array<number> = []
  let at = html.indexOf(BLOCK_MARKER)
  while (at !== -1) {
    // Walk back to the opening `<` of the tag carrying the marker, so the
    // block starts at an element boundary rather than mid-attribute.
    const open = html.lastIndexOf("<", at)
    starts.push(open === -1 ? at : open)
    at = html.indexOf(BLOCK_MARKER, at + BLOCK_MARKER.length)
  }
  return starts.map((start, index) => html.slice(start, starts[index + 1] ?? html.length))
}

const PERMALINK = /\/comments\/([a-z0-9]+)/i
const FULLNAME = /\bt3_([a-z0-9]+)/i

const readBlock = (block: string): SearchRow | null => {
  const anchors = anchorsIn(block)

  const commentsAnchor = anchors.find((anchor) => anchor.classes.includes("search-comments"))
  const permalink = commentsAnchor?.href ?? null

  const fromPermalink = permalink === null ? null : PERMALINK.exec(permalink)?.[1] ?? null
  const fromFullname = FULLNAME.exec(attribute(block.slice(0, block.indexOf(">") + 1), "data-fullname") ?? "")?.[1]
    ?? FULLNAME.exec(block)?.[1] ?? null

  const nativeId = fromPermalink ?? fromFullname
  if (!nativeId) return null

  const titleAnchor = anchors.find((anchor) => anchor.classes.includes("search-title"))

  return {
    nativeId,
    submitted: titleAnchor?.href ?? null,
    title: titleAnchor && titleAnchor.text.length > 0 ? titleAnchor.text : null,
    score: leadingCount(spanTextWithClass(block, "search-score") ?? ""),
    comments: commentsAnchor ? leadingCount(commentsAnchor.text) : null
  }
}

/**
 * Every identifiable result on an old.reddit search page, in page order.
 *
 * Duplicate ids are collapsed — the page repeats a result in the "related
 * subreddits" strip — keeping the first, which is the one carrying the score.
 */
export const readSearchPage = (html: string): ReadonlyArray<SearchRow> => {
  const seen = new Set<string>()
  const out: Array<SearchRow> = []
  for (const block of blocksIn(html)) {
    const result = readBlock(block)
    if (result === null || seen.has(result.nativeId)) continue
    seen.add(result.nativeId)
    out.push(result)
  }
  return out
}

/**
 * True when the body is one of Reddit's block pages served with a 200.
 *
 * `whoa there, pardner!` is the exact title of the network-policy block —
 * captured live from this sandbox on 2026-08-08, which is a datacenter IP and
 * therefore blocked outright. It has no search results, so without this it
 * scans to zero rows and files as a Silence: "Reddit answered, and nobody has
 * ever discussed this page." That is the single worst thing this connector
 * could say, because a Silence is the one outcome we are allowed to cache.
 */
export const isBlockPage = (html: string): boolean => {
  const head = html.slice(0, 4096).toLowerCase()
  return head.includes("whoa there, pardner") ||
    head.includes("<title>blocked</title>") ||
    head.includes("your request has been blocked")
}
