/**
 * The canonicalization rules, as a pure function of a string.
 *
 * These rules are the reason `SubjectUrl` is branded: the key that every
 * Lookup, every Mention and every Discussion Index probe is written under is
 * produced HERE and nowhere else. Two components running different versions of
 * this file produce different keys for the same page, and the failure is
 * silent — nothing throws, the panel is merely empty — so {@link rulesVersion}
 * travels with every artifact contract that consumes a key.
 *
 * Three commitments shape everything below.
 *
 * **The fragment is dropped unconditionally.** It is the cheapest privacy win
 * available and it costs almost nothing: ~5% of general web URLs even have a
 * fragment, while a significant share of secret-bearing URLs carry the secret
 * ONLY there — RFC 6749 §4.2.2 implicit-grant tokens arrive in the fragment,
 * which a browser never sends to any server, but which `chrome.tabs` hands us
 * in full. Dropping it means the token cannot leave the machine even by
 * accident. SPA routes expressed as `#/thing` are merged as a consequence; that
 * is a knowingly accepted false merge on a shrinking population.
 *
 * **We do not read the page's own `rel=canonical` or `og:url`.** A page
 * asserting its own identity is not evidence we observed, and honouring it lets
 * a publisher merge or split Subjects at will — including merging a paywalled
 * variant into the free one, or splitting a page away from the URL a Network
 * actually holds a Discussion under. Only rules, observed redirects, and a
 * Network's own submitted URL may mint or revise identity (see `AliasEvidence`
 * in `@parle/domain/Subject`).
 *
 * **Unknown query parameters are KEPT.** The tracking list is a blocklist, not
 * an allowlist, because dropping a parameter nobody enumerated silently
 * collapses distinct pages into one key — `?p=1234` on WordPress, `?page=3` on
 * a forum, `?story=…` on a CMS. Over-canonicalizing produces a wrong answer;
 * under-canonicalizing produces a duplicate, and duplicates are repairable by
 * an Alias merge while collisions are not.
 */

/**
 * The version of these rules. Bump on ANY behaviour change here.
 *
 * A bump invalidates every stored key, so it is a deliberate, coordinated act:
 * the Discussion Index carries the same number and a client that disagrees with
 * the shipped artifact must ignore the artifact entirely rather than probe it
 * with keys it cannot have been built from.
 */
export const rulesVersion = 1

/** Parameters that identify the referrer or the campaign, never the page. */
const trackingParameters: ReadonlySet<string> = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gclsrc",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "twclid",
  "ttclid",
  "igshid",
  "igsh",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "_hsenc",
  "_hsmi",
  "_ga",
  "_gl",
  "ncid",
  "cmpid",
  "spm",
  "scm",
  "ref_src",
  "ref_url",
  "referrer",
  "referer",
  "s_kwcid",
  "smid",
  "smtyp",
  "guccounter",
  "guce_referrer",
  "guce_referrer_sig",
  "__twitter_impression",
  "at_medium",
  "at_campaign",
  "at_custom1",
  "at_custom2",
  "at_custom3",
  "at_custom4",
  "trk",
  "trkcampaign",
  "sr_share",
  "share_id",
  "vero_id",
  "vero_conv",
  "wt_zmc",
  "amp",
  "output",
  "outputtype"
])

/** Prefixes whose whole family is tracking: `utm_source`, `utm_content`, … */
const trackingPrefixes: ReadonlyArray<string> = ["utm_", "pk_", "piwik_", "matomo_", "hsa_", "vero_"]

const isTracking = (name: string): boolean => {
  const lower = name.toLowerCase()
  return trackingParameters.has(lower) || trackingPrefixes.some((p) => lower.startsWith(p))
}

/** Filenames that address the same resource as the directory containing them. */
const indexFiles: ReadonlySet<string> = new Set([
  "index.html",
  "index.htm",
  "index.php",
  "index.asp",
  "index.aspx",
  "index.jsp",
  "index.shtml",
  "default.html",
  "default.htm",
  "default.asp",
  "default.aspx"
])

/** Host labels that mark a mobile or AMP rendering of the same document. */
const surfaceLabels: ReadonlySet<string> = new Set(["www", "m", "mobile", "amp", "www2", "wwww"])

/**
 * Strip the labels that name a RENDERING rather than a site.
 *
 * `www.` is unconditional. `m.`, `mobile.` and `amp.` are stripped in leading
 * position, and `m` is additionally stripped in SECOND position because that is
 * where the entire Wikimedia estate puts it (`en.m.wikipedia.org`) — the single
 * largest mobile-variant family on the web, and one a leading-label-only rule
 * misses completely.
 */
const normalizeHost = (hostname: string): string => {
  let host = hostname.toLowerCase()
  // A trailing dot is the explicit-root form of the same name.
  while (host.endsWith(".")) host = host.slice(0, -1)

  // An IPv6 literal arrives bracketed and has no labels to strip.
  if (host.startsWith("[")) return host

  const labels = host.split(".")
  while (labels.length > 2 && surfaceLabels.has(labels[0]!)) labels.shift()
  if (labels.length > 3 && labels[1] === "m") labels.splice(1, 1)
  return labels.join(".")
}

/** Every host that serves the one YouTube video namespace. */
const youtubeHosts: ReadonlySet<string> = new Set([
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "music.youtube.com",
  "gaming.youtube.com"
])

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/

/** Path prefixes that are all ways of addressing one video. */
const videoPathPrefixes: ReadonlyArray<string> = ["shorts", "embed", "live", "v", "e"]

/**
 * Collapse every YouTube surface onto one video identity.
 *
 * `youtu.be/ID`, `youtube.com/watch?v=ID&t=317&list=PL…&index=4`,
 * `youtube.com/shorts/ID`, `youtube-nocookie.com/embed/ID` and
 * `m.youtube.com/watch?v=ID&si=…` are the same conversation on Hacker News, and
 * a reader who arrives at any of them must see it. Timestamp, playlist context
 * and share attribution are all discarded: they say where the reader is in the
 * video or who sent them, never which video it is.
 */
const youtubeIdentity = (host: string, path: string, params: URLSearchParams): string | undefined => {
  if (!youtubeHosts.has(host)) return undefined

  const segments = path.split("/").filter((s) => s.length > 0)

  if (host === "youtu.be") {
    const id = segments[0]
    return id !== undefined && videoIdPattern.test(id) ? id : undefined
  }
  if (segments[0] === "watch") {
    const id = params.get("v")
    return id !== null && videoIdPattern.test(id) ? id : undefined
  }
  if (segments.length >= 2 && videoPathPrefixes.includes(segments[0]!)) {
    const id = segments[1]!
    return videoIdPattern.test(id) ? id : undefined
  }
  return undefined
}

/**
 * Unwrap an AMP viewer or cache address back to the document it is showing.
 *
 * Google's AMP cache serves someone else's article from a host under
 * `ampproject.org`; treating that as its own Subject splits a discussed article
 * away from every Discussion about it. Returns the wrapped address so the
 * caller can canonicalize THAT instead.
 */
const unwrapAmpProxy = (url: URL): string | undefined => {
  const host = url.hostname.toLowerCase()

  if (host === "cdn.ampproject.org" || host.endsWith(".cdn.ampproject.org")) {
    // `/c/s/example.com/path` — `c` is content, `s` means the origin is https.
    const m = /^\/(?:c|v|i|wp)\/(s\/)?(.+)$/.exec(url.pathname)
    if (m !== null) return `${m[1] === undefined ? "http" : "https"}://${m[2]}${url.search}`
    return undefined
  }
  if (/^(?:www\.)?google\.[a-z.]+$/.test(host)) {
    const m = /^\/amp\/(s\/)?(.+)$/.exec(url.pathname)
    if (m !== null) return `${m[1] === undefined ? "http" : "https"}://${m[2]}${url.search}`
  }
  return undefined
}

/** Drop the path and query decorations that mark an AMP rendering. */
const stripAmpPath = (segments: ReadonlyArray<string>): ReadonlyArray<string> => {
  let out = segments.slice()
  if (out[0] === "amp" && out.length > 1) out = out.slice(1)
  const last = out[out.length - 1]
  if (last === "amp" || last === "amp.html" || last === "amp.htm") out = out.slice(0, -1)
  else if (last !== undefined && last.endsWith(".amp")) out[out.length - 1] = last.slice(0, -".amp".length)
  return out
}

/**
 * Elect the one address that represents this page, or `undefined` if the input
 * is not an address at all.
 *
 * Returning `undefined` rather than throwing is deliberate: an unparseable
 * address is an ordinary event on a page full of links, and the caller's next
 * move is identical to its move for an excluded page.
 */
export const canonicalize = (raw: string, depth = 0): string | undefined => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }

  // An AMP proxy is showing someone else's document; canonicalize that one.
  // Bounded, because a hostile chain could otherwise wrap itself forever.
  if (depth < 3) {
    const wrapped = unwrapAmpProxy(url)
    if (wrapped !== undefined) return canonicalize(wrapped, depth + 1)
  }

  const scheme = url.protocol.toLowerCase()
  // Not upgraded to https. The elected address must be one we could have
  // observed: inventing an https twin for an http-only host produces a Lookup
  // that is a systematic Silence. The two schemes are an Alias relationship.
  const host = normalizeHost(url.hostname)
  if (host.length === 0) return undefined
  const port = url.port === "" ? "" : `:${url.port}`

  const params = new URLSearchParams(url.search)

  const video = youtubeIdentity(host, url.pathname, params)
  if (video !== undefined) return `https://youtube.com/watch?v=${video}`

  let segments = stripAmpPath(url.pathname.split("/").filter((s) => s.length > 0))
  const last = segments[segments.length - 1]
  if (last !== undefined && indexFiles.has(last.toLowerCase())) segments = segments.slice(0, -1)

  // A trailing slash addresses the same document as no trailing slash on every
  // server anyone ships; root keeps its single slash so the address stays valid.
  const path = segments.length === 0 ? "/" : `/${segments.join("/")}`

  const kept: Array<readonly [string, string]> = []
  for (const [name, value] of params) {
    if (!isTracking(name)) kept.push([name, value])
  }
  // Sorted so that two orderings of the same parameters are one key. Values of
  // a repeated name keep their relative order, which is the only thing a server
  // can legitimately read from ordering.
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const query = kept.length === 0
    ? ""
    : `?${kept.map(([n, v]) => `${encodeURIComponent(n)}=${encodeURIComponent(v)}`).join("&")}`

  // Userinfo is deliberately not reproduced here. It is also a mechanical
  // exclusion (see Mechanical.ts) — this is belt and braces, so that a credential
  // cannot reach a Network even if a caller skips the Exclusion List.
  return `${scheme}//${host}${port}${path}${query}`
}
