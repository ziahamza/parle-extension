/**
 * Comparing a reference work's cited URL against a Subject's Aliases.
 *
 * A deliberate, minimal restatement of the matching discipline in
 * `packages/networks/src/Address.ts`. It is restated rather than imported
 * because this package depends on `@parle/domain` and `effect` and on nothing
 * else — a backlink source is not a Network connector, and giving it a
 * dependency on the connector package to borrow forty lines of string handling
 * would tie a later reference source to whatever the Network package is doing
 * that week. **The integration wave should collapse the two**, most likely by
 * lifting the helpers into `@parle/domain` alongside `Alias`; until then, the
 * two files must agree, and any rule added to one belongs in the other.
 *
 * The question here is the same narrow one: does the address this reference
 * work cites name the same document as an address we already believe points at
 * this Subject? It is NOT canonicalization and it never mints a `SubjectUrl`.
 *
 * The check is not optional even though MediaWiki's `exturlusage` index is a
 * prefix index rather than a fuzzy search. `euquery=example.com` matches every
 * path under that host — verified live 2026-08-24, where a query for
 * `example.com` returned `https://example.com/openid-return.php` among the
 * first ten rows. Kept unverified, that row would claim Wikipedia cites the
 * page the reader is on when it cites a different page on the same site.
 *
 * The normalization is deliberately shallow. Every rule is one defensible as
 * address-identity rather than as taste, because an over-eager rule merges two
 * Subjects and the failure is silent.
 */

/** Query parameters that identify the referrer rather than the document. */
const CAMPAIGN_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "ref",
  "ref_src",
  "ref_url",
  "twclid"
])

const isCampaignParam = (key: string): boolean =>
  CAMPAIGN_PARAMS.has(key) || key.startsWith("utm_")

/**
 * A comparison key for one address.
 *
 * Drops the scheme, a leading `www.`, the default port, the fragment, a
 * trailing slash, and campaign parameters; sorts what query remains so
 * parameter order cannot split one document into two.
 *
 * Dropping the SCHEME is load-bearing here in a way it is not for a Network
 * connector. Wikipedia's own index is keyed by protocol (see
 * {@link ./Wikipedia.ts}), so a citation written in 2009 as `http://` and an
 * Alias we hold as `https://` are the ordinary case rather than the exotic one.
 *
 * Falls back to the trimmed, lowercased input when the address will not parse,
 * so an unparseable address still compares equal to itself and never equal to
 * anything else.
 */
export const comparableAddress = (raw: string): string => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw.trim().toLowerCase()
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return raw.trim().toLowerCase()

  const host = url.host.toLowerCase().replace(/^www\./, "")
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : ""

  const kept: Array<string> = []
  url.searchParams.forEach((value, key) => {
    if (!isCampaignParam(key)) kept.push(`${key}=${value}`)
  })
  kept.sort()

  return kept.length > 0 ? `${host}${path}?${kept.join("&")}` : `${host}${path}`
}

/** True when two addresses name the same document under {@link comparableAddress}. */
export const sameAddress = (a: string, b: string): boolean =>
  comparableAddress(a) === comparableAddress(b)

/**
 * Which of `candidates` the cited URL matched, if any.
 *
 * Returns the candidate as the caller supplied it — not the normalized form —
 * because a Backlink records the address it matched and the reader is owed the
 * address we actually hold rather than a comparison artefact.
 */
export const matchingAddress = (
  cited: string,
  candidates: ReadonlyArray<string>
): string | undefined => {
  const key = comparableAddress(cited)
  return candidates.find((candidate) => comparableAddress(candidate) === key)
}

/**
 * The address without its scheme, which is the only form MediaWiki accepts.
 *
 * `euquery` is matched against a reversed-domain index that stores the protocol
 * separately, so `euquery=https://example.com/a` matches nothing at all — not
 * an error, a Silence, which is the shape this project spends the most effort
 * refusing to manufacture.
 */
export const withoutScheme = (raw: string): string => raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
