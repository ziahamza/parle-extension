// Step 3: derive per-URL metrics, emit the dataset, print real distributions.
import { readFileSync, writeFileSync } from "node:fs";

const IN = process.argv[2];
const OUT = process.argv[3];
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

// ---------- title normalisation ----------
const STOP = new Set(
  ("a an the of to in and for on is it that with as at by be are from or how why what this " +
    "was were will your you we i not no do does can has have had but if then than there their " +
    "its his her they them our us all more most some any new").split(" "),
);
function titleTokens(t) {
  if (!t) return [];
  return t
    .toLowerCase()
    .replace(/\(\s*(19|20)\d\d\s*\)/g, " ") // HN year suffix "(2013)"
    .replace(/\[(pdf|video|audio|slides|paper|book|scanned|2\d{3})\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w) && w.length > 1);
}
function normTitle(t) {
  return titleTokens(t).sort().join(" ");
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function titleStats(subs) {
  const n = subs.length;
  if (n < 2) return { distinctTitles: n, identicalTitleShare: n ? 1 : 0, meanJaccard: null, minJaccard: null, medianJaccard: null };
  const sets = subs.map((s) => new Set(titleTokens(s.title)));
  const norms = subs.map((s) => normTitle(s.title));
  const counts = new Map();
  for (const t of norms) counts.set(t, (counts.get(t) ?? 0) + 1);
  const largest = Math.max(...counts.values());
  const js = [];
  for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) js.push(jaccard(sets[i], sets[k]));
  js.sort((a, b) => a - b);
  const mean = js.reduce((a, b) => a + b, 0) / js.length;
  return {
    distinctTitles: counts.size,
    identicalTitleShare: largest / n,
    meanJaccard: round(mean),
    minJaccard: round(js[0]),
    medianJaccard: round(js[Math.floor(js.length / 2)]),
  };
}

const round = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);

// ---------- derive ----------
const raw = JSON.parse(readFileSync(IN, "utf8"));
const records = [];
for (const r of raw) {
  if (r.skipped) continue;
  const subs = r.submissions ?? [];
  const times = subs.map((s) => s.created_at_i).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / DAY);
  gaps.sort((a, b) => a - b);
  const p = r.page ?? {};
  const group =
    r.source === "classic" ? "classic" : r.source === "generic_root" ? "generic_root" : "hn_positive";

  records.push({
    url: r.url,
    normalizedUrl: r.normalizedUrl,
    group,
    source: r.source,
    hnTitle: r.hnTitle ?? null,

    submissionCount: subs.length,
    firstSubmissionAt: times[0] ?? null,
    lastSubmissionAt: times[times.length - 1] ?? null,
    spreadDays: times.length ? round((times[times.length - 1] - times[0]) / DAY) : null,
    ageDays: times.length ? round((NOW - times[0]) / DAY) : null,
    spreadOverAge:
      times.length && NOW - times[0] > 0
        ? round((times[times.length - 1] - times[0]) / (NOW - times[0]))
        : null,
    medianGapDays: gaps.length ? round(gaps[Math.floor(gaps.length / 2)]) : null,
    maxGapDays: gaps.length ? round(gaps[gaps.length - 1]) : null,
    totalPoints: subs.reduce((a, s) => a + (s.points ?? 0), 0),
    maxPoints: subs.length ? Math.max(...subs.map((s) => s.points ?? 0)) : 0,
    totalComments: subs.reduce((a, s) => a + (s.num_comments ?? 0), 0),
    submissionsWithTraction: subs.filter((s) => (s.points ?? 0) >= 10).length,

    titles: titleStats(subs),

    shape: r.shape ?? null,

    page: {
      fetchStatus: p.fetchStatus ?? null,
      fetchError: p.fetchError ?? null,
      notHtml: p.notHtml ?? null,
      ogType: p.ogType ?? null,
      articlePublishedTime: p.articlePublishedTime ?? null,
      articleModifiedTime: p.articleModifiedTime ?? null,
      timeDatetime: p.timeDatetime ?? null,
      jsonLdDatePublished: p.jsonLdDatePublished ?? null,
      jsonLdTypes: p.jsonLdTypes ?? [],
      canonical: p.canonical ?? null,
      htmlTitle: p.htmlTitle ?? null,
      hasDatePublishedMetaAny: p.hasDatePublishedMetaAny ?? false,
    },

    algoliaNbHits: r.algoliaNbHits ?? null,
    algoliaScanTruncated: r.algoliaScanTruncated ?? false,
    algoliaError: r.algoliaError ?? null,

    submissions: subs,
  });
}

writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), count: records.length, records }, null, 2));

// ---------- report ----------
const pct = (arr, q) => {
  const a = arr.filter((x) => x !== null && x !== undefined).sort((x, y) => x - y);
  if (!a.length) return null;
  return round(a[Math.min(a.length - 1, Math.floor(q * a.length))]);
};
const groups = ["hn_positive", "classic", "generic_root"];
const by = (g) => records.filter((r) => r.group === g);

function line(label, fn, fmt = (x) => x) {
  const cells = groups.map((g) => {
    const v = fn(by(g));
    return String(v === null ? "-" : fmt(v)).padStart(16);
  });
  console.log(label.padEnd(40) + cells.join(""));
}

console.log("\n=== dataset ===");
console.log(`records: ${records.length}`);
for (const g of groups) console.log(`  ${g}: ${by(g).length}`);
const withSub = records.filter((r) => r.submissionCount > 0);
console.log(`records with >=1 exact-URL HN submission: ${withSub.length}`);
console.log(`page fetch succeeded (html 2xx): ${records.filter((r) => r.page.fetchStatus && r.page.fetchStatus < 400 && !r.page.notHtml).length}`);
console.log(`page fetch failed/blocked: ${records.filter((r) => r.page.fetchError || (r.page.fetchStatus ?? 0) >= 400).length}`);

console.log("\n=== distributions (group columns) ===");
console.log("".padEnd(40) + groups.map((g) => g.padStart(16)).join(""));
line("n", (a) => a.length);
line("n with >=1 submission", (a) => a.filter((r) => r.submissionCount > 0).length);
line("n with >=2 submissions", (a) => a.filter((r) => r.submissionCount >= 2).length);
line("median submissionCount", (a) => pct(a.map((r) => r.submissionCount), 0.5));
line("p90 submissionCount", (a) => pct(a.map((r) => r.submissionCount), 0.9));
line("max submissionCount", (a) => Math.max(0, ...a.map((r) => r.submissionCount)));

const multi = (a) => a.filter((r) => r.submissionCount >= 2);
console.log("\n-- among URLs with >=2 submissions --");
line("n", (a) => multi(a).length);
line("median spreadDays", (a) => pct(multi(a).map((r) => r.spreadDays), 0.5));
line("p25 spreadDays", (a) => pct(multi(a).map((r) => r.spreadDays), 0.25));
line("p75 spreadDays", (a) => pct(multi(a).map((r) => r.spreadDays), 0.75));
line("p90 spreadDays", (a) => pct(multi(a).map((r) => r.spreadDays), 0.9));
line("share spread > 365d", (a) => { const m = multi(a); return m.length ? round(m.filter((r) => r.spreadDays > 365).length / m.length) : null; });
line("share spread > 1095d (3y)", (a) => { const m = multi(a); return m.length ? round(m.filter((r) => r.spreadDays > 1095).length / m.length) : null; });
line("median maxGapDays", (a) => pct(multi(a).map((r) => r.maxGapDays), 0.5));
line("median identicalTitleShare", (a) => pct(multi(a).map((r) => r.titles.identicalTitleShare), 0.5));
line("p25 identicalTitleShare", (a) => pct(multi(a).map((r) => r.titles.identicalTitleShare), 0.25));
line("median meanJaccard", (a) => pct(multi(a).map((r) => r.titles.meanJaccard), 0.5));
line("p25 meanJaccard", (a) => pct(multi(a).map((r) => r.titles.meanJaccard), 0.25));
line("p75 meanJaccard", (a) => pct(multi(a).map((r) => r.titles.meanJaccard), 0.75));
line("median minJaccard", (a) => pct(multi(a).map((r) => r.titles.minJaccard), 0.5));

console.log("\n-- url shape --");
line("share isRootish", (a) => { const s = a.filter((r) => r.shape); return s.length ? round(s.filter((r) => r.shape.isRootish).length / s.length) : null; });
line("median pathDepth", (a) => pct(a.map((r) => r.shape?.pathDepth ?? null), 0.5));
line("share hasSlug", (a) => { const s = a.filter((r) => r.shape); return s.length ? round(s.filter((r) => r.shape.hasSlug).length / s.length) : null; });
line("share hasNumericId", (a) => { const s = a.filter((r) => r.shape); return s.length ? round(s.filter((r) => r.shape.hasNumericId).length / s.length) : null; });
line("share hasDateInPath", (a) => { const s = a.filter((r) => r.shape); return s.length ? round(s.filter((r) => r.shape.hasDateInPath).length / s.length) : null; });

console.log("\n-- page signals (of pages that actually fetched as html) --");
const ok = (a) => a.filter((r) => r.page.fetchStatus && r.page.fetchStatus < 400 && !r.page.notHtml);
line("n fetched", (a) => ok(a).length);
line("share og:type=article", (a) => { const s = ok(a); return s.length ? round(s.filter((r) => /article|post/i.test(r.page.ogType ?? "")).length / s.length) : null; });
line("share og:type=website", (a) => { const s = ok(a); return s.length ? round(s.filter((r) => /^website$/i.test(r.page.ogType ?? "")).length / s.length) : null; });
line("share og:type missing", (a) => { const s = ok(a); return s.length ? round(s.filter((r) => !r.page.ogType).length / s.length) : null; });
line("share article:published_time", (a) => { const s = ok(a); return s.length ? round(s.filter((r) => r.page.articlePublishedTime).length / s.length) : null; });
line("share <time datetime>", (a) => { const s = ok(a); return s.length ? round(s.filter((r) => r.page.timeDatetime).length / s.length) : null; });
line("share JSON-LD datePublished", (a) => { const s = ok(a); return s.length ? round(s.filter((r) => r.page.jsonLdDatePublished).length / s.length) : null; });
line("share ANY publication date", (a) => { const s = ok(a); return s.length ? round(s.filter((r) => r.page.hasDatePublishedMetaAny).length / s.length) : null; });

console.log("\n=== the counterexample set: classics with the widest spread ===");
for (const r of records.filter((x) => x.group === "classic" && x.submissionCount >= 2).sort((a, b) => b.spreadDays - a.spreadDays).slice(0, 20)) {
  console.log(
    `${String(r.spreadDays).padStart(7)}d  n=${String(r.submissionCount).padStart(3)}  ` +
      `idTitle=${String(r.titles.identicalTitleShare).slice(0, 5).padEnd(5)} ` +
      `meanJ=${String(r.titles.meanJaccard).slice(0, 5).padEnd(5)} ` +
      `${r.normalizedUrl.slice(0, 62)}`,
  );
}

console.log("\n=== generic roots, widest spread ===");
for (const r of records.filter((x) => x.group === "generic_root" && x.submissionCount >= 2).sort((a, b) => b.spreadDays - a.spreadDays).slice(0, 20)) {
  console.log(
    `${String(r.spreadDays).padStart(7)}d  n=${String(r.submissionCount).padStart(3)}  ` +
      `idTitle=${String(r.titles.identicalTitleShare).slice(0, 5).padEnd(5)} ` +
      `meanJ=${String(r.titles.meanJaccard).slice(0, 5).padEnd(5)} ` +
      `${r.normalizedUrl.slice(0, 62)}`,
  );
}

console.log("\n=== HN positives with spread > 3 years (the ones a time-spread rule would suppress) ===");
const wide = records.filter((r) => r.group === "hn_positive" && r.spreadDays > 1095);
console.log(`count: ${wide.length} of ${multi(by("hn_positive")).length} multi-submission positives`);
for (const r of wide.sort((a, b) => b.spreadDays - a.spreadDays).slice(0, 25)) {
  console.log(
    `${String(r.spreadDays).padStart(7)}d  n=${String(r.submissionCount).padStart(3)}  ` +
      `idTitle=${String(r.titles.identicalTitleShare).slice(0, 5).padEnd(5)} ` +
      `meanJ=${String(r.titles.meanJaccard).slice(0, 5).padEnd(5)} ` +
      `root=${r.shape?.isRootish ? "Y" : "n"} ${r.normalizedUrl.slice(0, 58)}`,
  );
}

// ---------- separability of the two candidate rules ----------
console.log("\n=== separability: can a rule keep classics and drop generic roots? ===");
function evalRule(name, keep) {
  const pos = [...by("hn_positive"), ...by("classic")].filter((r) => r.submissionCount >= 1);
  const neg = by("generic_root").filter((r) => r.submissionCount >= 1);
  const cls = by("classic").filter((r) => r.submissionCount >= 1);
  const kp = pos.filter(keep).length, kn = neg.filter(keep).length, kc = cls.filter(keep).length;
  console.log(
    `${name.padEnd(46)} keeps ${String(kp).padStart(3)}/${String(pos.length).padEnd(3)} positives ` +
      `(${round(kp / pos.length)})  classics ${kc}/${cls.length} (${round(kc / cls.length)})  ` +
      `suppresses ${neg.length - kn}/${neg.length} generic (${round((neg.length - kn) / neg.length)})`,
  );
}
evalRule("A. spread <= 365d (naive time-bound)", (r) => (r.spreadDays ?? 0) <= 365);
evalRule("B. spread <= 1095d", (r) => (r.spreadDays ?? 0) <= 1095);
evalRule("C. not rootish", (r) => !r.shape?.isRootish);
evalRule("D. titles agree (meanJaccard >= 0.5 or n<2)", (r) => r.submissionCount < 2 || (r.titles.meanJaccard ?? 1) >= 0.5);
evalRule("E. titles agree (identicalShare >= 0.5 or n<2)", (r) => r.submissionCount < 2 || r.titles.identicalTitleShare >= 0.5);
evalRule("F. C or D", (r) => !r.shape?.isRootish || r.submissionCount < 2 || (r.titles.meanJaccard ?? 1) >= 0.5);
evalRule("G. C and (n<2 or D)", (r) => !r.shape?.isRootish && (r.submissionCount < 2 || (r.titles.meanJaccard ?? 1) >= 0.5));
evalRule("H. spread<=365 OR titles agree", (r) => (r.spreadDays ?? 0) <= 365 || (r.submissionCount >= 2 && (r.titles.meanJaccard ?? 0) >= 0.5));
evalRule("I. not rootish OR spread<=365", (r) => !r.shape?.isRootish || (r.spreadDays ?? 0) <= 365);
evalRule("J. has publication date on page", (r) => r.page.hasDatePublishedMetaAny === true);
evalRule("K. not rootish AND (date OR titles agree)", (r) => !r.shape?.isRootish && (r.page.hasDatePublishedMetaAny === true || r.submissionCount < 2 || (r.titles.meanJaccard ?? 1) >= 0.5));

console.log(`\ndataset written to ${OUT}`);
