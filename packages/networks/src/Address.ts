/**
 * Comparing a Network's own submitted URL against a Subject's Aliases.
 *
 * This is NOT canonicalization and it never mints a `SubjectUrl` — that is
 * `SubjectIdentity`'s sole privilege. It answers one narrower question: does
 * the address this Discussion was submitted under name the same document as one
 * of the addresses we already believe points at this Subject?
 *
 * It exists because the strong tier cannot be taken on the search engine's
 * word. Verified live against Algolia on 2026-08-08: the URL-restricted query
 * for `nature.com/articles/d41586-024-02012-5` returns six hits, and the sixth
 * is item 40802874, submitted under `d41586-024-02082-5` — a DIFFERENT article.
 * Algolia tokenizes the URL and scores partial token overlap, so "the API
 * answered my url query" is evidence of nothing. Without this check that hit
 * becomes a Linked Mention — the tier that discharges the disclosure argument
 * in ADR 0001 and licenses an authenticated request against the reader's own X
 * account — on the strength of one differing digit.
 *
 * The normalization is deliberately shallow. Every rule here is one we can
 * defend as address-identity rather than as taste, because an over-eager rule
 * merges two Subjects and the failure is silent.
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
 * Drops the scheme (a submission under `http` and an Alias under `https` are
 * the same document), a leading `www.`, the default port, the fragment, a
 * trailing slash, and campaign parameters; sorts what query remains so
 * parameter order cannot split one document into two.
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
export const sameAddress = (a: string, b: string): boolean => comparableAddress(a) === comparableAddress(b)

/**
 * Which of `candidates` the Discussion's submitted URL matched, if any.
 *
 * Returns the candidate as the caller supplied it — not the normalized form —
 * because a Linked Mention records the Alias it matched, and the reader is owed
 * the address we actually hold rather than a comparison artefact.
 */
export const matchingAddress = (
  submitted: string,
  candidates: ReadonlyArray<string>
): string | undefined => {
  const key = comparableAddress(submitted)
  return candidates.find((candidate) => comparableAddress(candidate) === key)
}
