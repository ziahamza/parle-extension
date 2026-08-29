/**
 * Which addresses to look a host up under, and where to stop looking.
 *
 * The raters file their ratings against a publication's domain — `bbc.co.uk`,
 * `nytimes.com` — but a reader arrives on `www.bbc.co.uk/news/...` or
 * `cooking.nytimes.com`. So a lookup walks up the labels until it finds an
 * entry. The walk has to stop before it reaches a *public suffix*, and that is
 * the whole difficulty: stopping one label too late on `bbc.co.uk` asks the
 * artifact about `co.uk`, and any entry ever filed under `co.uk` would then be
 * shown for every British site there is.
 *
 * **This is deliberately not a public suffix list.** The real list is ~15,000
 * lines, changes weekly, and would be a second shipped artifact with its own
 * staleness. What is here instead is a bounded, hand-written table of the
 * two-level suffixes that actually occur among the publishers the raters rate,
 * plus a rule that is safe when the table is wrong in either direction:
 *
 * - **A suffix missing from the table** costs one extra candidate — we ask the
 *   artifact about `co.xx`, it has no entry, the walk ends. A miss, not a
 *   mistake, and only if someone has filed an entry under a bare suffix, which
 *   the build never does.
 * - **A suffix wrongly in the table** stops the walk early, so a real parent
 *   domain goes unqueried. Again a miss.
 *
 * Both failures are silent absences of Standing rather than wrong Standings,
 * which is the direction this codebase's rules always fall (HANDOFF §6). The
 * table is bounded on purpose and should be extended by evidence — a publisher
 * that the artifact holds and the walk fails to reach — rather than by
 * completeness for its own sake.
 */

/**
 * Two-label public suffixes seen among the rated publishers, plus the common
 * neighbours of each so that a near miss does not become a wrong hit.
 *
 * `ac.uk`, `gov.uk` and friends are here even though no rater rates a
 * university: the cost of a spare line is nothing and the cost of the omission
 * is asking the artifact about `ac.uk`.
 */
export const TWO_LEVEL_SUFFIXES: ReadonlySet<string> = new Set([
  // United Kingdom
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "sch.uk", "ac.uk", "gov.uk", "nhs.uk", "police.uk",
  // Australia / New Zealand
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "asn.au", "id.au",
  "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz", "geek.nz",
  // Japan / Korea / China / Taiwan / Hong Kong
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp", "gr.jp", "lg.jp",
  "co.kr", "or.kr", "ne.kr", "re.kr", "go.kr",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
  "com.tw", "org.tw", "idv.tw", "com.hk", "org.hk", "edu.hk",
  // South and Southeast Asia
  "co.in", "net.in", "org.in", "gen.in", "firm.in", "gov.in", "ac.in",
  "com.pk", "com.bd", "com.np", "com.lk", "com.my", "org.my", "com.sg", "edu.sg",
  "co.th", "in.th", "com.ph", "com.vn", "co.id", "or.id", "web.id",
  // Africa and the Middle East
  "co.za", "org.za", "net.za", "ac.za", "gov.za",
  "com.ng", "com.gh", "co.ke", "or.ke", "com.eg", "com.sa", "com.tr", "gen.tr",
  "co.il", "org.il", "ac.il", "com.qa", "com.kw", "com.lb",
  // The Americas
  "com.br", "net.br", "org.br", "gov.br", "com.ar", "com.mx", "com.co", "com.pe",
  "com.uy", "com.ve", "com.ec", "com.bo", "com.py", "com.do", "com.gt", "com.pa",
  // Europe
  "com.es", "org.es", "com.pl", "net.pl", "org.pl", "com.pt", "com.gr",
  "com.ua", "com.ru", "org.ru", "net.ru", "com.hr", "com.cy", "com.mt",
  "co.rs", "co.hu", "co.at", "or.at", "co.no", "priv.no"
])

/** True when `host` is nothing but a suffix — `co.uk`, `com`, `uk`. */
export const isBareSuffix = (host: string): boolean => {
  const labels = host.split(".")
  return labels.length < 2 || (labels.length === 2 && TWO_LEVEL_SUFFIXES.has(host))
}

/**
 * The host, as the artifact would key it.
 *
 * Lowercased, stripped of a port, of a trailing root dot, and of any userinfo an
 * address might have carried. `www.` is NOT stripped here: it is dropped by the
 * walk instead, which reaches the same entry and keeps `matchedOn` honest about
 * having climbed.
 *
 * Returns `undefined` for things that are not publisher hosts at all — an IPv4
 * or IPv6 literal, `localhost`, an empty string. Those are the addresses ADR
 * 0005's Exclusion List already refuses to ask a Network about, and there is
 * nothing for a rater to have rated.
 */
export const normalizeHost = (raw: string): string | undefined => {
  let host = raw.trim().toLowerCase()
  const at = host.lastIndexOf("@")
  if (at >= 0) host = host.slice(at + 1)
  if (host.startsWith("[")) return undefined // IPv6 literal
  host = host.replace(/:\d+$/, "").replace(/\.$/, "")
  if (host.length === 0) return undefined
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return undefined
  if (/^\d+(\.\d+){3}$/.test(host)) return undefined // IPv4 literal
  return host
}

/**
 * The addresses to try, most specific first, stopping before any public suffix.
 *
 * `news.bbc.co.uk` → `news.bbc.co.uk`, `bbc.co.uk` — and not `co.uk`.
 * `a.b.example.com` → `a.b.example.com`, `b.example.com`, `example.com`.
 * `example.com` → `example.com`.
 * `co.uk` → nothing at all.
 */
export const lookupCandidates = (host: string): ReadonlyArray<string> => {
  const labels = host.split(".")
  const candidates: Array<string> = []
  for (let i = 0; i <= labels.length - 2; i++) {
    const candidate = labels.slice(i).join(".")
    if (isBareSuffix(candidate)) break
    candidates.push(candidate)
  }
  return candidates
}
