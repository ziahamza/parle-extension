// Step 1: collect candidate submitted URLs from HN (front page, /best, recent /news pages).
import { writeFileSync } from "node:fs";

const OUT = process.argv[2];
const UA = "parle-research/0.1 (dataset gathering; contact hamza@gitstart.com)";

async function j(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25000) });
      if (r.status === 429) { await new Promise((s) => setTimeout(s, 3000 * (i + 1))); continue; }
      if (!r.ok) throw new Error(`${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
    }
  }
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        try { out.push(await fn(items[k])); } catch { /* skip */ }
      }
    }),
  );
  return out;
}

const rows = [];
const seen = new Set();
function add(url, title, source, objectID, points, num_comments, created_at_i) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  if (seen.has(url)) return;
  seen.add(url);
  rows.push({ url, hnTitle: title, source, objectID: String(objectID), points, num_comments, created_at_i });
}

// --- front page (Algolia tags=front_page) ---
{
  const d = await j("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=100");
  for (const h of d.hits) add(h.url, h.title, "front_page", h.objectID, h.points, h.num_comments, h.created_at_i);
  console.error(`front_page: ${d.hits.length} hits`);
}

// --- /best (Firebase beststories) ---
{
  const ids = (await j("https://hacker-news.firebaseio.com/v0/beststories.json")).slice(0, 250);
  const items = await pool(ids, 24, (id) => j(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, 2));
  let n = 0;
  for (const it of items) {
    if (!it || !it.url) continue;
    add(it.url, it.title, "best", it.id, it.score, it.descendants, it.time);
    n++;
  }
  console.error(`best: ${n} with urls of ${items.length}`);
}

// --- a few days of /news?p=N equivalent: recent stories by date ---
{
  const now = Math.floor(Date.now() / 1000);
  for (const [lo, hi, label] of [
    [now - 86400 * 1, now, "d1"],
    [now - 86400 * 2, now - 86400 * 1, "d2"],
    [now - 86400 * 3, now - 86400 * 2, "d3"],
    [now - 86400 * 4, now - 86400 * 3, "d4"],
    [now - 86400 * 5, now - 86400 * 4, "d5"],
  ]) {
    const u = `https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=created_at_i>${lo},created_at_i<${hi},points>25&hitsPerPage=200`;
    const d = await j(u);
    for (const h of d.hits) add(h.url, h.title, `news_${label}`, h.objectID, h.points, h.num_comments, h.created_at_i);
    console.error(`news_${label}: ${d.hits.length} hits`);
  }
}

writeFileSync(OUT, JSON.stringify(rows, null, 2));
console.error(`TOTAL distinct urls: ${rows.length}`);
