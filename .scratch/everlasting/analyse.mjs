/**
 * Report the distributions and, critically, where they overlap.
 * Run: node .scratch/everlasting/analyse.mjs
 */
import { readFileSync } from "node:fs"

const d = JSON.parse(readFileSync(new URL("./everlasting-dataset.json", import.meta.url), "utf8"))

const q = (xs, p) => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * p
  const lo = Math.floor(i), hi = Math.ceil(i)
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo)
}
const fmt = (x, dp = 2) => (x === null || x === undefined ? "  --  " : Number(x).toFixed(dp).padStart(7))
const pct = (a, b) => `${((100 * a) / b).toFixed(0)}%`

const line = (t) => console.log(t)
const rule = (t) => console.log(`\n${"=".repeat(78)}\n${t}\n${"=".repeat(78)}`)

// ------------------------------------------------------------------ cohorts

const rows = d.rows
const usable = (r, min) => r.metrics.n >= min
const neg = rows.filter((r) => r.label === "negative")
const pos = rows.filter((r) => r.label === "positive")

rule("0. COHORT SIZES")
line(`negative set assembled          : ${neg.length}`)
line(`  with >=1 HN submission        : ${neg.filter((r) => usable(r, 1)).length}`)
line(`  with >=2 (span/similarity ok) : ${neg.filter((r) => usable(r, 2)).length}`)
line(`  with >=3                      : ${neg.filter((r) => usable(r, 3)).length}`)
line(`  retrieval incomplete (lower bounds only) : ${neg.filter((r) => r.algolia.retrievalComplete === false).length}`)
line(`positive comparison set         : ${pos.length}`)
line(`  with >=2 HN submissions       : ${pos.filter((r) => usable(r, 2)).length}`)

const N = neg.filter((r) => usable(r, 2))
const P = pos.filter((r) => usable(r, 2))

// ------------------------------------------------------------- distributions

const dist = (rs, get) => {
  const xs = rs.map(get).filter((x) => x !== null && x !== undefined && Number.isFinite(x))
  return { n: xs.length, min: q(xs, 0), p10: q(xs, 0.1), p25: q(xs, 0.25), p50: q(xs, 0.5), p75: q(xs, 0.75), p90: q(xs, 0.9), max: q(xs, 1), mean: xs.reduce((a, b) => a + b, 0) / xs.length }
}

const table = (title, get, dp = 2) => {
  const a = dist(N, get), b = dist(P, get)
  line(`\n${title}`)
  line(`            n     min     p10     p25   median     p75     p90     max    mean`)
  line(`negative ${String(a.n).padStart(4)} ${fmt(a.min, dp)} ${fmt(a.p10, dp)} ${fmt(a.p25, dp)} ${fmt(a.p50, dp)} ${fmt(a.p75, dp)} ${fmt(a.p90, dp)} ${fmt(a.max, dp)} ${fmt(a.mean, dp)}`)
  line(`positive ${String(b.n).padStart(4)} ${fmt(b.min, dp)} ${fmt(b.p10, dp)} ${fmt(b.p25, dp)} ${fmt(b.p50, dp)} ${fmt(b.p75, dp)} ${fmt(b.p90, dp)} ${fmt(b.max, dp)} ${fmt(b.mean, dp)}`)
}

rule("1. THE PRODUCT OWNER'S PROPOSED SIGNAL: time span, first to last submission")
table("spanDays (last submission - first submission)", (r) => r.metrics.spanDays, 0)
table("spanYears", (r) => r.metrics.spanYears, 2)

rule("2. THE HYPOTHESIS UNDER TEST: title divergence across submissions")
table("mean pairwise token Jaccard (1.0 = identical titles)", (r) => r.metrics.meanPairwiseJaccard, 3)
table("median pairwise token Jaccard", (r) => r.metrics.medianPairwiseJaccard, 3)
table("mean pairwise Jaccard, brand tokens removed", (r) => r.metrics.meanPairwiseJaccardNoBrand, 3)
table("modal title share (largest identical-title group / n)", (r) => r.metrics.modalTitleShare, 3)
table("distinct normalised titles / n", (r) => r.metrics.distinctNormalizedTitles / r.metrics.n, 3)

rule("3. OTHER CANDIDATE SIGNALS")
table("submissions per year over the observed span", (r) => r.metrics.submissionsPerYear, 2)
table("share of consecutive gaps <= 7 days (burstiness)", (r) => r.metrics.gapsWithinWeekShare, 3)
table("submission count n", (r) => r.metrics.n, 0)

const shapeTally = (rs, label) => {
  const t = { isRoot: 0, shallowRootish: 0, hasSlug: 0, hasDateInPath: 0, hasNumericId: 0, meanDepth: 0 }
  for (const r of rs) {
    if (r.shape.isRoot) t.isRoot++
    if (r.shape.isShallowRootish) t.shallowRootish++
    if (r.shape.hasSlug) t.hasSlug++
    if (r.shape.hasDateInPath) t.hasDateInPath++
    if (r.shape.hasNumericId) t.hasNumericId++
    t.meanDepth += r.shape.depth
  }
  t.meanDepth = (t.meanDepth / rs.length).toFixed(2)
  line(`${label.padEnd(9)} n=${String(rs.length).padStart(3)}  root ${pct(t.isRoot, rs.length).padStart(4)}  rootish ${pct(t.shallowRootish, rs.length).padStart(4)}  slug ${pct(t.hasSlug, rs.length).padStart(4)}  date-in-path ${pct(t.hasDateInPath, rs.length).padStart(4)}  numeric-id ${pct(t.hasNumericId, rs.length).padStart(4)}  mean depth ${t.meanDepth}`)
}
line("\nPath shape")
shapeTally(N, "negative")
shapeTally(P, "positive")

const pageTally = (rs, label) => {
  const fetched = rs.filter((r) => r.page?.fetched)
  const art = fetched.filter((r) => r.page.ogType === "article").length
  const web = fetched.filter((r) => r.page.ogType === "website").length
  const none = fetched.filter((r) => !r.page.ogType).length
  const pub = fetched.filter((r) => r.page.hasAnyPublishDate).length
  const artmeta = fetched.filter((r) => r.page.publishedTime || r.page.jsonLdDatePublished).length
  line(`${label.padEnd(9)} fetched ${String(fetched.length).padStart(3)}/${String(rs.length).padStart(3)}  og:type=article ${pct(art, fetched.length).padStart(4)}  =website ${pct(web, fetched.length).padStart(4)}  absent ${pct(none, fetched.length).padStart(4)}  any-pub-date ${pct(pub, fetched.length).padStart(4)}  strong-pub-date ${pct(artmeta, fetched.length).padStart(4)}`)
}
line("\nOn-page markup (best-effort fetch; many hosts block bots)")
pageTally(N, "negative")
pageTally(P, "positive")

// ------------------------------------------------------------------ overlap

rule("4. OVERLAP — where the two sets sit on top of each other")

const sweep = (name, get, dir, candidates) => {
  // dir=+1: suppress when value >= threshold. dir=-1: suppress when value <= threshold.
  line(`\n${name}`)
  line(`  threshold  suppressed-negatives   suppressed-positives(FALSE NEGATIVES)`)
  let best = null
  for (const th of candidates) {
    const hitN = N.filter((r) => {
      const v = get(r)
      return v !== null && v !== undefined && (dir > 0 ? v >= th : v <= th)
    }).length
    const hitP = P.filter((r) => {
      const v = get(r)
      return v !== null && v !== undefined && (dir > 0 ? v >= th : v <= th)
    }).length
    line(`  ${String(th).padStart(9)}  ${String(hitN).padStart(4)} / ${N.length} (${pct(hitN, N.length).padStart(4)})   ${String(hitP).padStart(4)} / ${P.length} (${pct(hitP, P.length).padStart(4)})`)
    const score = hitN / N.length - hitP / P.length
    if (best === null || score > best.score) best = { th, score, hitN, hitP }
  }
  line(`  best single threshold: ${best.th}  ->  catches ${pct(best.hitN, N.length)} of negatives at the cost of ${pct(best.hitP, P.length)} of positives`)
  return best
}

sweep("A. suppress when title divergence is high (mean pairwise Jaccard <= T)", (r) => r.metrics.meanPairwiseJaccard, -1, [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5])
sweep("B. suppress when span is long (spanDays >= T)  <- the naive proposal", (r) => r.metrics.spanDays, 1, [180, 365, 730, 1095, 1825, 2555, 3650])
sweep("C. suppress when modal title share is low (<= T)", (r) => r.metrics.modalTitleShare, -1, [0.2, 0.3, 0.4, 0.5, 0.6, 0.75])

rule("5. THE COUNTEREXAMPLE, MEASURED")
const named = [
  "https://paulgraham.com/greatwork.html",
  "https://paulgraham.com/genius.html",
  "http://catb.org/~esr/faqs/smart-questions.html",
  "https://norvig.com/21-days.html",
  "https://joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i",
  "https://en.wikipedia.org/wiki/Therac-25",
  "https://facebook.com/",
  "https://apple.com/",
  "https://google.com/",
  "https://stripe.com/",
  "https://bankofamerica.com/",
  "https://github.com/",
  "https://cloudflare.com/",
  "https://archive.org/",
  "https://stackoverflow.com/"
]
line("\n  page                                              n   spanYrs  meanJacc  modal  parle50")
for (const c of named) {
  const r = rows.find((x) => x.canonical === c)
  if (r === undefined || r.metrics.n === 0) continue
  const m = r.metrics
  line(`  ${(r.label === "positive" ? "[+] " : "[-] ") + c.replace(/^https?:\/\//, "")}`.padEnd(52) +
    `${String(m.n).padStart(4)}  ${fmt(m.spanYears, 2)}  ${fmt(m.meanPairwiseJaccard, 3)}  ${fmt(m.modalTitleShare, 2)}  ${String(r.algolia.parleWindowExactMatches).padStart(5)}`)
}

rule("6. THE OVERLAP ZONE, NAMED")
line("\nNegatives that LOOK like documents (high title agreement) — a span-and-title rule keeps showing these:")
N.filter((r) => r.metrics.meanPairwiseJaccard >= 0.4)
  .sort((a, b) => b.metrics.meanPairwiseJaccard - a.metrics.meanPairwiseJaccard)
  .slice(0, 14)
  .forEach((r) => line(`  ${fmt(r.metrics.meanPairwiseJaccard, 3)}  n=${String(r.metrics.n).padStart(3)}  span=${fmt(r.metrics.spanYears, 1)}y  ${r.canonical}`))

line("\nPositives that LOOK everlasting (low title agreement) — these are what a title rule would silently hide:")
P.filter((r) => r.metrics.meanPairwiseJaccard <= 0.35)
  .sort((a, b) => a.metrics.meanPairwiseJaccard - b.metrics.meanPairwiseJaccard)
  .forEach((r) => line(`  ${fmt(r.metrics.meanPairwiseJaccard, 3)}  n=${String(r.metrics.n).padStart(3)}  span=${fmt(r.metrics.spanYears, 1)}y  ${r.canonical}`))

rule("7. WHAT PARLE SHOWS TODAY (shipped connector, hitsPerPage=50)")
const withSubs = rows.filter((r) => r.metrics.n > 0 && r.algolia.parleWindowExactMatches !== null)
const invisible = withSubs.filter((r) => r.algolia.parleWindowExactMatches === 0)
line(`\npages with >=1 exact submission in full retrieval : ${withSubs.length}`)
line(`of those, pages where the shipped top-50 window finds NONE : ${invisible.length} (${pct(invisible.length, withSubs.length)})`)
line(`  negatives: ${invisible.filter((r) => r.label === "negative").length} / ${withSubs.filter((r) => r.label === "negative").length}`)
line(`  positives: ${invisible.filter((r) => r.label === "positive").length} / ${withSubs.filter((r) => r.label === "positive").length}`)
line("\nNegatives already invisible today (no new rule needed to suppress them):")
invisible.filter((r) => r.label === "negative").slice(0, 20).forEach((r) => line(`  n=${String(r.metrics.n).padStart(4)}  ${r.canonical}`))

rule("8. CANONICALIZATION ARTIFACT: fragment collapse")
const fragRows = rows.filter((r) => r.metrics.n > 0 && r.metrics.fragmentCollapsedCount > 0)
line(`\nrows where >=1 matched submission carried a fragment: ${fragRows.length}`)
fragRows.sort((a, b) => b.metrics.fragmentCollapsedShare - a.metrics.fragmentCollapsedShare).slice(0, 12)
  .forEach((r) => line(`  ${fmt(r.metrics.fragmentCollapsedShare, 2)}  ${String(r.metrics.fragmentCollapsedCount).padStart(4)}/${String(r.metrics.n).padStart(4)}  ${r.canonical}`))
line("\nSame two measures with fragment-collapsed submissions removed:")
const N2 = neg.filter((r) => r.metricsExFragments.n >= 2)
const P2 = pos.filter((r) => r.metricsExFragments.n >= 2)
const d2 = (rs, get) => dist(rs, get)
for (const [nm, get] of [["spanYears", (r) => r.metricsExFragments.spanYears], ["meanJaccard", (r) => r.metricsExFragments.meanPairwiseJaccard]]) {
  const a = d2(N2, get), b = d2(P2, get)
  line(`  ${nm.padEnd(12)} negative median ${fmt(a.p50, 3)} (n=${a.n})   positive median ${fmt(b.p50, 3)} (n=${b.n})`)
}

rule("9. COMBINED RULES")
const evalRule = (name, fn, cohortN = N, cohortP = P) => {
  const hn = cohortN.filter(fn).length, hp = cohortP.filter(fn).length
  line(`  ${name.padEnd(62)} neg ${String(hn).padStart(3)}/${cohortN.length} (${pct(hn, cohortN.length).padStart(4)})  POS-LOST ${String(hp).padStart(2)}/${cohortP.length} (${pct(hp, cohortP.length).padStart(4)})`)
}
line("\nSuppression rules, measured on pages with >=2 submissions:")
evalRule("rootish path alone", (r) => r.shape.isShallowRootish)
evalRule("meanJaccard <= 0.20 alone", (r) => r.metrics.meanPairwiseJaccard <= 0.2)
evalRule("spanDays >= 365 alone", (r) => r.metrics.spanDays >= 365)
evalRule("rootish AND meanJaccard <= 0.35", (r) => r.shape.isShallowRootish && r.metrics.meanPairwiseJaccard <= 0.35)
evalRule("rootish AND meanJaccard <= 0.5", (r) => r.shape.isShallowRootish && r.metrics.meanPairwiseJaccard <= 0.5)
evalRule("rootish AND spanDays >= 365", (r) => r.shape.isShallowRootish && r.metrics.spanDays >= 365)
evalRule("rootish AND spanDays >= 365 AND meanJaccard <= 0.35", (r) => r.shape.isShallowRootish && r.metrics.spanDays >= 365 && r.metrics.meanPairwiseJaccard <= 0.35)
evalRule("meanJaccard <= 0.35 AND n >= 3", (r) => r.metrics.meanPairwiseJaccard <= 0.35 && r.metrics.n >= 3)
evalRule("rootish AND no publication-date markup", (r) => r.shape.isShallowRootish && r.page?.hasAnyPublishDate !== true)

rule("10. THE n=1 BLIND SPOT")
const one = rows.filter((r) => r.metrics.n === 1)
line(`\npages with exactly ONE submission: ${one.length}  (negative ${one.filter((r) => r.label === "negative").length}, positive ${one.filter((r) => r.label === "positive").length})`)
line("Neither signal exists here: a single submission has no span and no pair to compare.")
line(`  of those negatives, rootish path: ${one.filter((r) => r.label === "negative" && r.shape.isShallowRootish).length}`)
line(`  of those positives, rootish path: ${one.filter((r) => r.label === "positive" && r.shape.isShallowRootish).length}`)
line("\nThe product owner's 'the moment it is discussed on HN' case lives entirely here:")
line("a page's first submission is by definition n=1, span=0, and has no title pair.")

rule("11. PER-CATEGORY, AND THE NON-ROOT NEGATIVES (the honest test of the title signal)")
const cats = [...new Set(N.map((r) => r.category))]
line("\n  category            n   median-span-yrs  median-meanJacc  rootish")
for (const c of cats.sort()) {
  const rs = N.filter((r) => r.category === c)
  line(`  ${c.padEnd(18)} ${String(rs.length).padStart(3)}   ${fmt(q(rs.map((r) => r.metrics.spanYears), 0.5), 2)}          ${fmt(q(rs.map((r) => r.metrics.meanPairwiseJaccard), 0.5), 3)}      ${pct(rs.filter((r) => r.shape.isShallowRootish).length, rs.length)}`)
}
const NR = N.filter((r) => !r.shape.isShallowRootish)
line(`\nNon-rootish negatives (path shape cannot help here): ${NR.length}`)
line(`  median meanJaccard ${fmt(q(NR.map((r) => r.metrics.meanPairwiseJaccard), 0.5), 3)}   median spanYears ${fmt(q(NR.map((r) => r.metrics.spanYears), 0.5), 2)}`)
for (const t of [0.2, 0.35, 0.5]) {
  const hn = NR.filter((r) => r.metrics.meanPairwiseJaccard <= t).length
  const hp = P.filter((r) => r.metrics.meanPairwiseJaccard <= t).length
  line(`  meanJaccard <= ${t}: catches ${hn}/${NR.length} (${pct(hn, NR.length)}) of non-root negatives, costs ${hp}/${P.length} (${pct(hp, P.length)}) of positives`)
}
NR.sort((a, b) => a.metrics.meanPairwiseJaccard - b.metrics.meanPairwiseJaccard).forEach((r) =>
  line(`    ${fmt(r.metrics.meanPairwiseJaccard, 3)}  n=${String(r.metrics.n).padStart(3)}  ${r.category.padEnd(16)} ${r.canonical}`))
