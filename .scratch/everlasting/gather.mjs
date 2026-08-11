/**
 * Gather the negative set (everlasting/generic pages) and a comparison
 * positive set, and compute the two candidate signals the product owner named:
 * time span between first and last submission, and pairwise title divergence.
 *
 * Run:  node .scratch/everlasting/gather.mjs
 * Out:  .scratch/everlasting/everlasting-dataset.json
 */
import { writeFileSync } from "node:fs"
import { canonicalize, rulesVersion } from "../../packages/policy/dist/Canonical.js"
import { NEGATIVE, POSITIVE } from "./urls.mjs"

const OUT = new URL("./everlasting-dataset.json", import.meta.url).pathname
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

// ---------------------------------------------------------------- match key

/**
 * The Alias-equivalence used to decide a submission is about THIS page.
 *
 * The repo canonicalizer deliberately preserves scheme (an http-only host must
 * not get an invented https twin), but http:// and https:// submissions of the
 * same essay are plainly Aliases of one Subject — see the greatwork.html hits,
 * which are split across both. So the match key is the canonical address with
 * the scheme dropped. Everything else (www./m. stripping, tracking-param
 * removal, index-file removal, trailing slash) is the shipped rules, unchanged.
 */
const matchKey = (raw) => {
  const c = canonicalize(raw)
  if (c === undefined) return undefined
  return c.replace(/^https?:\/\//, "")
}

// ---------------------------------------------------------------- title norm

const STOP = new Set([
  "a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "is", "are", "it",
  "at", "by", "with", "from", "as", "that", "this", "be", "was", "were", "its",
  "how", "why", "what", "you", "your", "we", "our", "not", "no", "but", "if",
  "has", "have", "had", "will", "can", "s", "t"
])

/**
 * Normalise a submission title to a token set.
 *
 * - `Show HN:` / `Ask HN:` / `Tell HN:` prefixes are HN furniture, not content.
 * - A trailing year parenthetical — `(2023)` — is HN's resubmission convention.
 *   Keeping it would make every resubmission of a classic look divergent from
 *   the original, i.e. it would manufacture the exact false positive we are
 *   trying to avoid. Stripped on purpose, and this is the single most
 *   consequential normalisation choice in the measurement.
 * - `[pdf]`, `[video]`, `[audio]` are format tags, likewise furniture.
 */
const normalizeTitle = (title) => {
  let t = String(title ?? "").toLowerCase()
  t = t.replace(/^\s*(show|ask|tell|launch)\s+hn\s*:\s*/i, "")
  t = t.replace(/\((?:19|20)\d{2}\)\s*$/, "")
  t = t.replace(/\[(pdf|video|audio|slides|pic|paper)\]/g, " ")
  return t
}

const tokenize = (title, drop = new Set()) => {
  const set = new Set()
  for (const tok of normalizeTitle(title).split(/[^a-z0-9]+/)) {
    if (tok.length === 0) continue
    if (STOP.has(tok)) continue
    if (drop.has(tok)) continue
    set.add(tok)
  }
  return set
}

const jaccard = (a, b) => {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/** Brand tokens implied by the host, so we can see if the domain word carries the signal. */
const brandTokens = (host) => {
  const parts = host.split(".")
  const drop = new Set(["www", "com", "org", "net", "io", "co", "dev", "app", "gov", "edu", "int", "uk", "so", "sh", "md", "rs", "ai", "blog", "docs", "news", "en", "m"])
  return new Set(parts.filter((p) => !drop.has(p) && p.length > 2))
}

// ---------------------------------------------------------------- path shape

const pathShape = (canonical) => {
  const u = new URL(canonical)
  const segs = u.pathname.split("/").filter((s) => s.length > 0)
  const last = segs[segs.length - 1] ?? ""
  return {
    host: u.hostname,
    path: u.pathname,
    depth: segs.length,
    isRoot: segs.length === 0,
    /** `/en`, `/home`, `/index` and friends — a root wearing one segment. */
    isShallowRootish:
      segs.length === 0 ||
      (segs.length === 1 && /^(en|en-us|home|index|us|uk|main|start|www|3)$/i.test(segs[0])),
    hasQuery: u.search.length > 0,
    hasNumericId: segs.some((s) => /^\d{3,}$/.test(s)) || /\d{4,}/.test(last),
    /** Two or more hyphens, or a long word run — the shape of a headline slug. */
    hasSlug: /-.*-/.test(last) || (last.length >= 20 && /[a-z]/.test(last)),
    hasDateInPath: /\/(19|20)\d{2}\/(0?[1-9]|1[0-2])(\/|$)/.test(u.pathname),
    hasExtension: /\.(html?|php|aspx?|pdf|txt|md)$/i.test(last),
    lastSegment: last
  }
}

// ---------------------------------------------------------------- algolia

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Global pacer for Algolia. The endpoint answers 403 — not 429 — when a client
 * bursts, which the first run mistook for a hard failure and did not retry,
 * silently zeroing 51 rows. Requests are therefore spaced globally and 403 is
 * treated as backpressure.
 */
let nextSlot = 0
const paced = async (minGapMs) => {
  const now = Date.now()
  const at = Math.max(now, nextSlot)
  nextSlot = at + minGapMs
  if (at > now) await sleep(at - now)
}

const RATE_LIMIT_STATUS = new Set([403, 429])

const getJson = async (url, tries = 6) => {
  for (let i = 0; i < tries; i++) {
    await paced(220)
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25_000) })
      if (RATE_LIMIT_STATUS.has(res.status) || res.status >= 500) {
        await sleep([2000, 5000, 12_000, 25_000, 45_000, 60_000][i] ?? 60_000)
        continue
      }
      if (!res.ok) return { error: `http ${res.status}` }
      return { ok: await res.json() }
    } catch (e) {
      if (i === tries - 1) return { error: String(e?.message ?? e) }
      await sleep(2000 * (i + 1))
    }
  }
  return { error: "exhausted after retries" }
}

/**
 * Path-ish tokens that a root or near-root address cannot contain.
 *
 * Used ONLY as Algolia `advancedSyntax` negative terms, and only after
 * subtracting whatever tokens the target address actually contains. That
 * subtraction is what makes the filter *sound*: excluding a token the target
 * does not have can never remove a hit whose URL equals the target, so the
 * exact-match set is preserved exactly while the candidate pool collapses.
 *
 * This exists because relevance on this index is ordered by points with no
 * exactness boost, so for a host like nytimes.com (1,027,617 url-matching
 * submissions) the root's own submissions are unreachable inside the 1000-hit
 * cap. Filtering first brought that pool to 267 and made the count real.
 */
const GENERIC_DEEP_TOKENS = [
  ...Array.from({ length: 26 }, (_, i) => String(2000 + i)),
  "html", "htm", "php", "asp", "aspx", "jsp", "shtml", "pdf", "xml", "json", "txt",
  "blog", "blogs", "news", "article", "articles", "post", "posts", "story", "stories",
  "index", "page", "pages", "wiki", "watch", "product", "products", "item", "items",
  "view", "tag", "tags", "category", "categories", "comments", "archive", "archives",
  "video", "videos", "amp", "section", "sections", "topic", "topics", "live",
  "opinion", "business", "technology", "science", "world", "sports", "politics",
  "health", "culture", "arts", "magazine", "review", "reviews", "guide", "guides",
  "help", "support", "about", "contact", "careers", "jobs", "terms", "privacy",
  "legal", "press", "release", "releases", "announcing", "introducing", "docs",
  "documentation", "reference", "tutorial", "tutorials", "download", "downloads",
  "features", "customers", "solutions", "resources", "events", "community",
  "developer", "developers", "api", "search", "user", "users", "profile", "posts"
]

const urlTokens = (canonical) =>
  new Set(canonical.toLowerCase().split(/[^a-z0-9]+/).filter((s) => s.length > 0))

const ALGOLIA_CAP = 1000
const HN_EPOCH = 1160000000 // Oct 2006, before the first HN story

/**
 * Enumerate every submission matching a query, splitting the time axis
 * whenever a window saturates the 1000-hit cap.
 *
 * `complete` is true only when no window was left saturated — the report needs
 * to distinguish "this page has N submissions" from "this page has at least N",
 * and conflating the two is how a measurement quietly becomes a fiction.
 */
const enumerateWindows = async (queryString, extraParams, budget) => {
  const hits = new Map()
  const pending = [[HN_EPOCH, Math.floor(Date.now() / 1000) + 1]]
  let used = 0
  let saturatedLeft = 0
  const errors = []
  let nbHitsTotal = 0

  while (pending.length > 0) {
    if (used >= budget) {
      saturatedLeft += pending.length
      break
    }
    const [lo, hi] = pending.pop()
    const nf = `&numericFilters=${encodeURIComponent(`created_at_i>=${lo},created_at_i<${hi}`)}`
    const url =
      `https://hn.algolia.com/api/v1/search_by_date?restrictSearchableAttributes=url&tags=story` +
      `&hitsPerPage=${ALGOLIA_CAP}&query=${encodeURIComponent(queryString)}${extraParams}${nf}`
    used++
    const r = await getJson(url)
    if (r.error !== undefined) {
      errors.push(r.error)
      continue
    }
    const got = r.ok.hits ?? []
    for (const h of got) hits.set(h.objectID, h)
    nbHitsTotal += r.ok.nbHits ?? 0
    if ((r.ok.nbHits ?? 0) > got.length) {
      // Saturated. Halve the window; a one-second window cannot be split further.
      if (hi - lo <= 1) saturatedLeft++
      else {
        const mid = lo + Math.floor((hi - lo) / 2)
        pending.push([lo, mid], [mid, hi])
      }
    }
  }
  return { hits: [...hits.values()], used, complete: saturatedLeft === 0, errors, nbHitsTotal }
}

/**
 * Retrieval for one address, in escalating stages.
 *
 * 1. relevance top-1000 and date top-1000, unioned — two disjoint windows on
 *    the unfiltered pool, and enough on their own for most addresses.
 * 2. if the pool is over the cap, repeat under the sound negative-term filter,
 *    time-splitting whatever still saturates.
 * 3. separately, the top-50 relevance window — because that is the window the
 *    shipped connector actually uses (`hitsPerPage: 50` in HackerNews.ts), so
 *    it is what a reader would really be shown today.
 */
const algolia = async (canonical, isRootish) => {
  const q = canonical.replace(/^https?:\/\//, "")
  const base = `restrictSearchableAttributes=url&tags=story&hitsPerPage=1000&query=${encodeURIComponent(q)}`
  const byRel = await getJson(`https://hn.algolia.com/api/v1/search?${base}`)
  const byDate = await getJson(`https://hn.algolia.com/api/v1/search_by_date?${base}`)

  const hits = new Map()
  let nbHits = 0
  let complete = true
  const errors = []
  const stages = []

  for (const [name, r] of [["relevance", byRel], ["by_date", byDate]]) {
    if (r.error !== undefined) {
      errors.push(`${name}: ${r.error}`)
      complete = false
      continue
    }
    nbHits = Math.max(nbHits, r.ok.nbHits ?? 0)
    for (const h of r.ok.hits ?? []) hits.set(h.objectID, h)
    stages.push({ stage: name, nbHits: r.ok.nbHits ?? 0, returned: (r.ok.hits ?? []).length })
  }
  if (nbHits > ALGOLIA_CAP) complete = false

  let filter = null
  if (nbHits > ALGOLIA_CAP) {
    const own = urlTokens(canonical)
    // Algolia rejects a query over ~512 characters with a 400, so the negative
    // list is greedily truncated to fit. Truncating only leaves a larger
    // candidate pool — the filter stays sound either way, and the time-splitting
    // below is what makes up the difference.
    const negatives = []
    let budgetChars = 470 - q.length
    for (const t of GENERIC_DEEP_TOKENS) {
      if (own.has(t)) continue
      if (budgetChars - (t.length + 2) < 0) break
      negatives.push(t)
      budgetChars -= t.length + 2
    }
    const filtered = `${q} ${negatives.map((t) => `-${t}`).join(" ")}`
    // Budget is generous for rootish addresses (the ones this stage exists for)
    // and small elsewhere, where the deep-token filter buys much less.
    const w = await enumerateWindows(filtered, "&advancedSyntax=true", isRootish ? 200 : 24)
    for (const h of w.hits) hits.set(h.objectID, h)
    errors.push(...w.errors.map((e) => `filtered: ${e}`))
    filter = { negativeTermCount: negatives.length, windowsUsed: w.used, complete: w.complete, hits: w.hits.length }
    complete = w.complete && w.errors.length === 0
    stages.push({ stage: "filtered", windows: w.used, returned: w.hits.length, complete: w.complete })
  }

  // What the shipped connector sees.
  const parle = await getJson(
    `https://hn.algolia.com/api/v1/search?restrictSearchableAttributes=url&tags=story&hitsPerPage=50&query=${encodeURIComponent(q)}`
  )
  const parleHits = parle.error === undefined ? (parle.ok.hits ?? []) : null
  if (parle.error !== undefined) errors.push(`parleWindow: ${parle.error}`)

  return { hits: [...hits.values()], nbHits, complete, errors, stages, filter, parleHits }
}

// ---------------------------------------------------------------- page fetch

const meta = (html, patterns) => {
  for (const re of patterns) {
    const m = re.exec(html)
    if (m !== null) return m[1]
  }
  return null
}

const fetchPage = async (url) => {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000)
    })
    const status = res.status
    const ct = res.headers.get("content-type") ?? ""
    if (!ct.includes("html")) return { fetched: false, status, error: `content-type ${ct}` }
    const html = (await res.text()).slice(0, 600_000)

    const ogType = meta(html, [
      /<meta[^>]+property=["']og:type["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:type["']/i
    ])
    const publishedTime = meta(html, [
      /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
      /<meta[^>]+name=["'](?:pubdate|publish-date|date|DC\.date\.issued|parsely-pub-date)["'][^>]+content=["']([^"']+)["']/i
    ])
    const timeDatetime = meta(html, [/<time[^>]+datetime=["']([^"']+)["']/i])
    let jsonLdDatePublished = null
    for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      const hit = /"datePublished"\s*:\s*"([^"]+)"/.exec(m[1])
      if (hit !== null) {
        jsonLdDatePublished = hit[1]
        break
      }
    }
    let jsonLdType = null
    for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      const hit = /"@type"\s*:\s*"([^"]+)"/.exec(m[1])
      if (hit !== null) {
        jsonLdType = hit[1]
        break
      }
    }

    return {
      fetched: true,
      status,
      ogType,
      publishedTime,
      timeDatetime,
      jsonLdDatePublished,
      jsonLdType,
      hasAnyPublishDate: Boolean(publishedTime ?? jsonLdDatePublished ?? timeDatetime)
    }
  } catch (e) {
    return { fetched: false, status: null, error: String(e?.message ?? e) }
  }
}

// ---------------------------------------------------------------- metrics

const quantile = (sorted, q) => {
  if (sorted.length === 0) return null
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

const NOW = Math.floor(Date.now() / 1000)
const DAY = 86400

/**
 * Submissions whose raw address carried a fragment.
 *
 * These collapse into the root because canonicalization drops fragments, which
 * is right for `#section-2` on an article and wrong for the pre-2013 hashbang
 * SPA: `twitter.com/#!/RealTimeWWII` and `twitter.com/#search?q=...` were
 * distinct pages and 574 of them land on the single key `twitter.com/`. That
 * manufactures a page with hundreds of unrelated titles spread over a decade —
 * the exact signature of an everlasting page, produced by our own rules rather
 * than by the world. Measured separately so it cannot be mistaken for evidence.
 */
const isFragmentCollapsed = (s) => typeof s.url === "string" && s.url.includes("#")

const metricsFor = (subs, host) => {
  const n = subs.length
  if (n === 0) return { n: 0 }
  const ts = subs.map((s) => s.created_at_i).sort((a, b) => a - b)
  const first = ts[0]
  const last = ts[ts.length - 1]
  const spanDays = (last - first) / DAY

  const brand = brandTokens(host)
  const tokSets = subs.map((s) => tokenize(s.title))
  const tokSetsNoBrand = subs.map((s) => tokenize(s.title, brand))

  const pairs = []
  const pairsNoBrand = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairs.push(jaccard(tokSets[i], tokSets[j]))
      pairsNoBrand.push(jaccard(tokSetsNoBrand[i], tokSetsNoBrand[j]))
    }
  }
  pairs.sort((a, b) => a - b)
  pairsNoBrand.sort((a, b) => a - b)
  const mean = (xs) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length)

  const normCounts = new Map()
  for (const s of subs) {
    const k = [...tokenize(s.title)].sort().join(" ")
    normCounts.set(k, (normCounts.get(k) ?? 0) + 1)
  }
  const modal = Math.max(...normCounts.values())

  // Burstiness: fraction of consecutive gaps under 7 days. A real item's
  // submissions cluster at publication; an organisation's are spread evenly.
  const gaps = []
  for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / DAY)
  const withinWeek = gaps.filter((g) => g <= 7).length

  return {
    n,
    firstTs: first,
    lastTs: last,
    firstDate: new Date(first * 1000).toISOString().slice(0, 10),
    lastDate: new Date(last * 1000).toISOString().slice(0, 10),
    spanDays: Number(spanDays.toFixed(2)),
    spanYears: Number((spanDays / 365.25).toFixed(3)),
    ageDaysOfFirst: Number(((NOW - first) / DAY).toFixed(1)),
    meanPairwiseJaccard: pairs.length === 0 ? null : Number(mean(pairs).toFixed(4)),
    medianPairwiseJaccard: pairs.length === 0 ? null : Number(quantile(pairs, 0.5).toFixed(4)),
    maxPairwiseJaccard: pairs.length === 0 ? null : Number(pairs[pairs.length - 1].toFixed(4)),
    minPairwiseJaccard: pairs.length === 0 ? null : Number(pairs[0].toFixed(4)),
    meanPairwiseJaccardNoBrand: pairsNoBrand.length === 0 ? null : Number(mean(pairsNoBrand).toFixed(4)),
    distinctNormalizedTitles: normCounts.size,
    modalTitleCount: modal,
    modalTitleShare: Number((modal / n).toFixed(4)),
    submissionsPerYear: spanDays > 30 ? Number((n / (spanDays / 365.25)).toFixed(3)) : null,
    gapsWithinWeekShare: gaps.length === 0 ? null : Number((withinWeek / gaps.length).toFixed(4)),
    totalPoints: subs.reduce((a, s) => a + (s.points ?? 0), 0),
    totalComments: subs.reduce((a, s) => a + (s.num_comments ?? 0), 0),
    maxPoints: Math.max(...subs.map((s) => s.points ?? 0)),
    distinctRawUrls: new Set(subs.map((s) => s.url)).size,
    fragmentCollapsedCount: subs.filter(isFragmentCollapsed).length,
    fragmentCollapsedShare: Number((subs.filter(isFragmentCollapsed).length / n).toFixed(4))
  }
}

// ---------------------------------------------------------------- driver

const pool = async (items, limit, fn) => {
  const out = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const k = i++
      if (k >= items.length) return
      out[k] = await fn(items[k], k)
    }
  })
  await Promise.all(workers)
  return out
}

const collect = async ([input, category], label, prior) => {
  const canonical = canonicalize(input)
  if (canonical === undefined) return { input, category, label, error: "not canonicalizable" }
  const key = matchKey(input)
  const shape = pathShape(canonical)

  // Resume: keep a prior page fetch (they are slow and many hosts block bots,
  // so re-running them buys nothing) and keep a prior Algolia answer that came
  // back clean. Only rows whose Algolia call errored are asked again.
  const priorGood =
    prior?.algolia !== undefined && prior.algolia.errors.length === 0 && prior.algolia.retrievalComplete === true
  const a = priorGood ? null : await algolia(canonical, shape.isShallowRootish)
  const page = prior?.page?.fetched === true ? prior.page : await fetchPage(input)

  const toSub = (h) => ({
    objectID: h.objectID,
    title: h.title,
    url: h.url,
    points: h.points ?? 0,
    num_comments: h.num_comments ?? 0,
    created_at_i: h.created_at_i,
    created_at: h.created_at,
    author: h.author
  })
  const exact = (list) =>
    list
      .filter((h) => typeof h.url === "string" && h.url.length > 0 && matchKey(h.url) === key)
      .map(toSub)
      .sort((x, y) => x.created_at_i - y.created_at_i)

  const submissions = priorGood ? prior.submissions : exact(a.hits)

  const algoliaSummary = priorGood
    ? prior.algolia
    : {
      nbHitsForHost: a.nbHits,
      hitsInspected: a.hits.length,
      retrievalComplete: a.complete,
      stages: a.stages,
      filter: a.filter,
      errors: a.errors,
      /**
       * How many exact matches the shipped connector's own top-50 relevance
       * window contains. Where this is 0 but `submissions` is not, the page is
       * one Parle shows nothing for today regardless of any new rule.
       */
      parleWindowExactMatches: a.parleHits === null ? null : exact(a.parleHits).length
    }

  process.stdout.write(
    `${priorGood ? "cached " : "fetched"} ${label} ${canonical} -> ${submissions.length}/${algoliaSummary.nbHitsForHost}` +
      `${algoliaSummary.retrievalComplete === false ? " INCOMPLETE" : ""}` +
      `${algoliaSummary.errors.length > 0 ? ` ERR ${algoliaSummary.errors.join(",")}` : ""}\n`
  )

  return {
    input,
    category,
    label,
    canonical,
    matchKey: key,
    shape,
    page,
    algolia: algoliaSummary,
    submissions,
    metrics: metricsFor(submissions, shape.host),
    /** The same measures with fragment-collapsed submissions removed. */
    metricsExFragments: metricsFor(submissions.filter((s) => !isFragmentCollapsed(s)), shape.host)
  }
}

const main = async () => {
  const jobs = [
    ...NEGATIVE.map((u) => [u, "negative"]),
    ...POSITIVE.map((u) => [u, "positive"])
  ]

  let priorByInput = new Map()
  try {
    const { readFileSync } = await import("node:fs")
    const old = JSON.parse(readFileSync(OUT, "utf8"))
    priorByInput = new Map(old.rows.map((r) => [r.input, r]))
    process.stdout.write(`resuming from ${old.rows.length} prior rows\n`)
  } catch {
    process.stdout.write("no prior dataset; full run\n")
  }

  const rows = await pool(jobs, 3, ([u, label]) => collect(u, label, priorByInput.get(u[0])))

  const dataset = {
    meta: {
      generatedAt: new Date().toISOString(),
      purpose:
        "Negative set (everlasting/generic pages that must NOT show Discussions) plus a comparison positive set, with the two candidate signals: first-to-last submission span, and pairwise title divergence.",
      canonicalizationRulesVersion: rulesVersion,
      matchRule:
        "A submission counts as being about this page when canonicalize(hit.url) equals canonicalize(input) after dropping the scheme. Scheme is dropped because the shipped canonicalizer deliberately preserves http vs https, but the two are Aliases of one Subject.",
      titleSimilarityMeasure: {
        name: "token Jaccard, mean over all unordered pairs",
        why:
          "Titles are bags of content words, not edit sequences. Normalised edit distance is dominated by length differences and word order ('BoA sues X' vs 'X sued by BoA' would score far apart while meaning the same thing), whereas Jaccard is order-invariant and length-normalised. It is also cheap over the <=30 titles a page typically has.",
        normalisation:
          "lowercase; strip 'Show HN:'/'Ask HN:'/'Tell HN:'/'Launch HN:'; strip a trailing year parenthetical such as '(2023)'; strip [pdf]/[video] format tags; split on non-alphanumerics; drop a small English stopword list; dedupe to a set.",
        yearStrippingNote:
          "Stripping '(2023)' is the most consequential choice here: it is HN's resubmission convention, so keeping it would make every resubmission of a classic look title-divergent from the original — manufacturing the exact false positive the counterexample warns about.",
        brandVariant:
          "meanPairwiseJaccardNoBrand repeats the measure with tokens derived from the registrable host removed, to check whether the domain word alone is carrying the signal."
      },
      algolia: {
        stages:
          "Per URL: (1) /search relevance top-1000 and /search_by_date recency top-1000, unioned; (2) if the url-matching pool exceeds the 1000 cap, the same query under advancedSyntax negative terms, with the time axis split recursively wherever a window still saturates; (3) separately, a relevance top-50 window, which is the window the shipped connector uses.",
        whyStageTwo:
          "Relevance on this index is ordered by points with no exactness boost. For nytimes.com the url-matching pool is 1,027,617 submissions, so the root's own submissions never appear inside the 1000-hit cap and naive retrieval reports zero. The negative-term filter collapses that pool (to 267 in the nytimes case) without touching the exact-match set.",
        soundnessOfTheFilter:
          "Negative terms are drawn from a fixed generic list of deep-path tokens, then any token present in the target address is subtracted. Excluding a token the target does not contain cannot remove a hit whose URL equals the target, so the exact-match set is preserved exactly.",
        retrievalComplete:
          "Per row. False means at least one time window was still saturated when the budget ran out, so that row's submission count is a lower bound. Rows are not silently promoted to exact counts.",
        parleWindowExactMatches:
          "Exact matches inside the shipped connector's own top-50 relevance window (packages/networks/src/HackerNews.ts uses hitsPerPage: 50). Where this is 0 but submissions is not, Parle shows the reader nothing for that page today, before any new rule is added."
      },
      counts: {
        negative: NEGATIVE.length,
        positive: POSITIVE.length
      }
    },
    rows
  }
  writeFileSync(OUT, JSON.stringify(dataset, null, 2))
  process.stdout.write(`\nwrote ${OUT}\n`)
}

await main()
