// Step 2: for each candidate URL, gather (a) every HN submission of that exact URL,
// (b) on-page publication-date signals, (c) URL shape features.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const IN = process.argv[2];
const OUT = process.argv[3];
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ---------- URL normalisation (research-local; NOT the Alias rules) ----------
const TRACKING =
  /^(utm_|ref_|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$|s$|ref$|source$|__twitter_impression$|_hsenc$|_hsmi$|spm$)/i;

function normUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  let host = u.hostname.toLowerCase().replace(/^www\./, "");
  let path = u.pathname.replace(/\/+$/, "");
  if (/^\/(index\.html?|index\.php)$/i.test(path)) path = "";
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k));
  params.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const q = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
  return `${host}${path}${q}`;
}

function urlShape(raw) {
  const u = new URL(raw);
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const segs = u.pathname.split("/").filter(Boolean);
  const last = segs[segs.length - 1] ?? "";
  const isRootish =
    segs.length === 0 ||
    (segs.length === 1 &&
      /^(en|en-us|home|index\.html?|index\.php|us|uk|blog|news|about|docs|www)$/i.test(segs[0]));
  const hasSlug = segs.some((s) => {
    const base = s.replace(/\.(html?|php|aspx?)$/i, "");
    return (base.match(/[-_]/g) ?? []).length >= 2 && base.length >= 10;
  });
  const hasNumericId = segs.some((s) => /^\d{4,}$/.test(s)) || /\b(id|p|v)=\d+/.test(u.search);
  const hasDateInPath = /\/(19|20)\d\d(\/|-)/.test(u.pathname);
  return {
    host,
    pathDepth: segs.length,
    isRootish,
    hasSlug,
    hasNumericId,
    hasDateInPath,
    lastSegmentLength: last.length,
    hasQuery: u.search.length > 1,
  };
}

// ---------- helpers ----------
async function jget(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { "user-agent": "parle-research/0.1" },
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 429 || r.status >= 500) {
        await new Promise((s) => setTimeout(s, 2500 * (i + 1)));
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
    }
  }
}

const ALGOLIA_FIELDS =
  "attributesToRetrieve=title,url,points,num_comments,created_at_i,objectID,author&attributesToHighlight=";

function algoliaQueryFor(raw) {
  // Search the url attribute using the address without scheme; Algolia tokenises it.
  const u = new URL(raw);
  return (u.hostname.replace(/^www\./, "") + u.pathname + u.search).replace(/\/+$/, "");
}

async function algoliaSubmissions(raw, target) {
  const q = encodeURIComponent(algoliaQueryFor(raw));
  const base = `https://hn.algolia.com/api/v1`;
  const first = await jget(
    `${base}/search?query=${q}&restrictSearchableAttributes=url&hitsPerPage=1000&${ALGOLIA_FIELDS}`,
  );
  const byId = new Map();
  const consider = (hits) => {
    for (const h of hits) {
      if (!h.url) continue;
      if (normUrl(h.url) !== target) continue;
      byId.set(h.objectID, {
        objectID: h.objectID,
        title: h.title,
        url: h.url,
        author: h.author,
        points: h.points ?? 0,
        num_comments: h.num_comments ?? 0,
        created_at_i: h.created_at_i,
      });
    }
  };
  consider(first.hits);
  let truncated = false;
  if (first.nbHits > first.hits.length) {
    // Relevance ranking may have hidden older exact matches; sweep chronologically too.
    truncated = true;
    try {
      const byDate = await jget(
        `${base}/search_by_date?query=${q}&restrictSearchableAttributes=url&hitsPerPage=1000&${ALGOLIA_FIELDS}`,
      );
      consider(byDate.hits);
    } catch {
      /* keep relevance-only result */
    }
  }
  return {
    submissions: [...byId.values()].sort((a, b) => a.created_at_i - b.created_at_i),
    algoliaNbHits: first.nbHits,
    algoliaScanTruncated: truncated,
  };
}

// ---------- page metadata ----------
function metaOf(html) {
  const pick = (re) => {
    const m = html.match(re);
    return m ? m[1].trim().slice(0, 200) : null;
  };
  const attr = (prop) =>
    pick(
      new RegExp(
        `<meta[^>]+(?:property|name)\\s*=\\s*["']${prop}["'][^>]*content\\s*=\\s*["']([^"']+)["']`,
        "i",
      ),
    ) ??
    pick(
      new RegExp(
        `<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*(?:property|name)\\s*=\\s*["']${prop}["']`,
        "i",
      ),
    );

  const timeDatetime = pick(/<time[^>]+datetime\s*=\s*["']([^"']+)["']/i);

  let jsonLdDatePublished = null;
  let jsonLdTypes = [];
  const scripts = html.match(
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  if (scripts) {
    for (const s of scripts.slice(0, 6)) {
      const body = s.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "");
      try {
        const walk = (node) => {
          if (!node || typeof node !== "object") return;
          if (Array.isArray(node)) return node.forEach(walk);
          if (node["@type"]) {
            const t = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
            jsonLdTypes.push(...t.map(String));
          }
          if (!jsonLdDatePublished && typeof node.datePublished === "string")
            jsonLdDatePublished = node.datePublished.slice(0, 60);
          for (const v of Object.values(node)) walk(v);
        };
        walk(JSON.parse(body));
      } catch {
        const m = body.match(/"datePublished"\s*:\s*"([^"]+)"/);
        if (m && !jsonLdDatePublished) jsonLdDatePublished = m[1].slice(0, 60);
      }
    }
  }

  return {
    ogType: attr("og:type"),
    articlePublishedTime: attr("article:published_time"),
    articleModifiedTime: attr("article:modified_time"),
    timeDatetime,
    jsonLdDatePublished,
    jsonLdTypes: [...new Set(jsonLdTypes)].slice(0, 8),
    canonical: pick(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i),
    htmlTitle: pick(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.replace(/\s+/g, " ") ?? null,
    hasDatePublishedMetaAny: null, // filled below
  };
}

async function fetchPageMeta(raw) {
  try {
    const r = await fetch(raw, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.includes("html")) {
      try { r.body?.cancel(); } catch { /* ignore */ }
      return { fetchStatus: r.status, contentType: ct, fetchError: null, notHtml: true, finalUrl: r.url };
    }
    const buf = await r.arrayBuffer();
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 700_000));
    const m = metaOf(html);
    m.hasDatePublishedMetaAny = Boolean(
      m.articlePublishedTime || m.jsonLdDatePublished || m.timeDatetime,
    );
    return { fetchStatus: r.status, contentType: ct, fetchError: null, notHtml: false, finalUrl: r.url, ...m };
  } catch (e) {
    return { fetchStatus: null, contentType: null, fetchError: String(e.message ?? e).slice(0, 120) };
  }
}

// ---------- driver ----------
async function pool(items, n, fn) {
  let i = 0;
  const out = new Array(items.length);
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

const input = JSON.parse(readFileSync(IN, "utf8"));
const resume = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
const done = new Map(resume.map((r) => [r.url, r]));

const todo = input.filter((r) => !done.has(r.url));
console.error(`enriching ${todo.length} (${done.size} already done)`);

let n = 0;
const results = await pool(todo, 6, async (row) => {
  const target = normUrl(row.url);
  const rec = { ...row, normalizedUrl: target };
  if (!target) return { ...rec, skipped: "unparseable" };
  try {
    rec.shape = urlShape(row.url);
  } catch {
    rec.shape = null;
  }
  try {
    Object.assign(rec, await algoliaSubmissions(row.url, target));
  } catch (e) {
    rec.submissions = [];
    rec.algoliaError = String(e.message ?? e).slice(0, 120);
  }
  rec.page = await fetchPageMeta(row.url);
  if (++n % 25 === 0) console.error(`  ${n}/${todo.length}`);
  return rec;
});

const all = [...done.values(), ...results];
writeFileSync(OUT, JSON.stringify(all, null, 2));
console.error(`wrote ${all.length} records to ${OUT}`);
