# Research: ticket 14 — Can a Reddit URL corpus be built at all, and from what?

## Answer

**Partly — and the answer changed while we were asking.** A Reddit URL corpus *is* technically buildable today from public archives (I re-downloaded from them this morning), but it has a 13-month hole, no upstream licence, and a decaying supply chain. More importantly, the premise of this ticket is now wrong in a way that raises the stakes: **the datacenter 403 is not primarily IP reputation — Reddit announced on 2026-05-28 that it is shutting down unauthenticated `.json` endpoints entirely, and explicitly named RSS as the next surface.** That means the client-side connector we assumed made the corpus optional is itself on a deprecation path, so the corpus matters *more*, at exactly the moment its sources are getting harder to justify.

**Recommendation: ship the Discussion Index Hacker-News-only for v1, and in parallel (a) mirror the Reddit archives now, this week, and (b) get counsel on one narrow question before any Reddit CI job is written.** Do not treat Reddit corpus coverage as a v1 dependency.

---

### Corrections to earlier findings — do not carry these forward

Three claims in the prior research were refuted on verification. They are wrong and should not be repeated in ADRs:

- ❌ *"The 403 is pure IP reputation."* **I verified the refutation directly.** Reddit's r/modnews post `1tq9vxo`, "Protecting communities from scrapers and platform abuse", posted 2026-05-28T17:14:17Z by admin `boat-botany`, says verbatim: *"Deprecating unauthenticated JSON access: We'll also be shutting down unauthenticated .json endpoints… Logged-in and authenticated access won't be impacted. Otherwise, developers who need structured access to Reddit content should use Devvit."* The same post asks *"another common surface for scraping is RSS… how and for what purpose do you use RSS feeds"* — i.e. RSS is explicitly queued behind it. ([Wayback capture 2026-05-29](https://web.archive.org/web/20260529092220/https://old.reddit.com/r/modnews/comments/1tq9vxo/protecting_communities_from_scrapers_and_platform/), fetched and grepped by me 2026-08-08.) IP reputation *also* exists (the HTML root 403s from our host) but is not the mechanism behind the `.json` 403.
- ❌ *"The block is blanket across the reddit.com content edge; HTML scraping is no workaround."* The first half is false. **Measured by me, 2026-08-08 from Hetzner AS24940 (135.181.208.223) — the same IP that gets the 403:** `https://www.reddit.com/search.rss?q=url%3Aarstechnica.com&sort=new` → **HTTP 200, 50,948 bytes, 25 `<entry>` elements, 25 real `/comments/` permalinks**, all from today. Same IP, same session: `/api/info.json?url=…` → 403 (190,240 bytes), `/robots.txt` → 200. RSS on that IP is throttled to roughly **one request per minute** (I got 429 on two of three attempts) — that is rate limiting, not the block.
- ❌ *"None of the archives carries any licence."* True for the three Reddit-side sources — I re-confirmed `licenseurl: None` / `rights: None` on both archive.org items and `LICENSE → 404` / `license: null` on `arctic_shift` — but false as a generalisation, and the counterexample is the one that matters for the fallback plan (see HN below).
- ❌ Minor: the block page is **not** a React app and contains no JavaScript or challenge; and the two 403 templates are selected by which block rule fires, not by hostname. Irrelevant to strategy, but don't build a detector on the hostname assumption.

---

### What is actually obtainable (measured by me today unless noted)

| Source | Coverage | Size | Licence | Status |
|---|---|---|---|---|
| [`archive.org/pushshift_reddit_200506_to_202212`](https://archive.org/metadata/pushshift_reddit_200506_to_202212) | 2005-06 → 2022-12 | 211 submission files, **517.17 GB** (517,171,846,139 B) of 1994 GB total | **none** (`licenseurl: None`, `rights: None`) | ✅ live, plain unauthenticated HTTP, range-GETs work |
| [`archive.org/reddit_links`](https://archive.org/metadata/reddit_links) (Parquet) | 2005-07 → 2022-08 | 94,138,045,293 B single file; URL column alone ~29.4 GB | **none** | ✅ live; DuckDB column pruning over HTTP verified (reported) |
| Academic Torrents monthly (arctic_shift) | **2024-04 → 2026-06** | ~17–22 GB submissions/month | **none** (no LICENSE in repo) | ✅ `3bac8bd3…` (2026-06) → 200 |
| Academic Torrents full-history | 2005 → 2023-12 / 2025-12 | — | — | ❌ **404** (`9c263fc8…`, `3d426c47…`) — removed, not just missing |
| **2023-03 → 2024-03** | — | — | — | ❌ **no located public source** (archive.org has only 202301, 202302 — reported, not re-checked by me) |
| [Arctic Shift API](https://arctic-shift.photon-reddit.com/api/posts/search) | full history → live | 100 records/req cap | none | ✅ alive; newest record I pulled was `created_utc` 1786160420 = **2026-08-08T03:40Z**, ~35 min old, with a `url` field among 113 fields |

**Measured facts:** the archives are downloadable now, unauthenticated, from a datacenter IP — the 403 does not touch them. Arctic Shift is still ingesting Reddit in real time *despite* the JSON deprecation announcement, which is the single most interesting data point here (how it ingests is unknown to me).

**Inferred / reported, not verified by me — treat as estimates:** ~**750M distinct external submission URLs** across all history (defensible range 600M–900M), from two sampling methods that agree to ~25%; cross-month URL overlap only 0.06–1.53%, so global dedup buys ~1% and *n* ≈ sum over months; capture lag 38–241 days, so `num_comments` in the dumps is settled rather than zero.

**Bloom sizing (inferred, downstream of the 750M estimate — feeds ticket 13):** everything = ~900 MB @1% FPR, unshippable. Thresholding is the whole game: `num_comments>=5` → ~117 MB, `>=10` → ~67 MB (~56M URLs), `>=20` → ~36 MB, `>=50` → ~14 MB. Ongoing delta ~10 MB/month. **Recommend sizing at `>=10` and sharding.**

**Dead ends, don't re-investigate:** Arctic Shift does *not* publish a DuckDB-queryable Parquet dataset on HuggingFace — I re-checked, `?author=RaiderBDev` and `?search=arctic shift` both return `[]`. pullpush.io is behind an unconditional Cloudflare challenge from datacenter IPs (reported). Cloudflare Workers egress gets Reddit's 403 (reported, one public Worker deployment). The `reddit_links` Parquet is an unmaintained 2022 one-off with no successor.

### Ongoing coverage

There is no clean continuous feed.
- Reddit's own JSON listings: 403 now, **and formally deprecated**.
- RSS: works from a blocked IP (measured above) but at ~1 req/min, and Reddit has publicly flagged it as the next scraping surface to close. Usable for CI-time batch enrichment; **not** for a request-path connector, and not durable.
- Arctic Shift API: alive and fresh, but capped at 100 records/request and its README asks bulk consumers to use the monthly dumps instead. Full coverage would need ~15,000 req/day forever.
- Monthly dumps are the only honest continuous path → **the index is inherently 4–8 weeks stale by construction. Design the UX for that now.**

### Terms and licence — where the real blocker is

Honest state: **unresolved, and the earlier framing was both overstated and understated in different places.**

- Reddit's robots.txt is `User-agent: * / Disallow: /` (200, 538 bytes, re-measured). The conditional crawl carve-out in the User Agreement therefore grants nothing *via that parenthetical* — but the operative exception is "or in a separate agreement with Reddit," which routes to the Data API Terms. Those (Last Revised 2026-07-20) §2.4 *do* grant a narrow, revocable, non-sublicensable licence to "copy and display the User Content… to your App Users." That covers displaying discussions; it does not cover redistributing a derived index.
- The Responsible Builder Policy's "must not… share… This extends to commercial and non-commercial mining, scraping" is real and current — but it was **not** updated 2026-08-08 (that's Zendesk `updated_at` churn; real `edited_at` is 2026-06-05), and its "any research outside the RFR Program" sentence is scoped to approved RFR participants, not to us.
- Data API Terms §3.2/§6 (no retention beyond approved use case; delete cached *and derived* data on termination) are the clauses that actually bite a shipped, static, AGPL-redistributed bloom filter.
- **Unknown, and nobody in this research resolved it:** whether a non-invertible bloom filter of *third-party URLs* is "Reddit data" at all. It cannot enumerate or reproduce any URL, title, author or comment; it only confirms membership for a URL you already hold. Under US law facts and non-original compilations aren't copyrightable (Feist), which may make the licence question moot — but that is a legal call, not an engineering one, and it decides the entire ticket.

**Fallback that is already clean:** [`open-index/hacker-news`](https://huggingface.co/api/datasets/open-index/hacker-news) on HuggingFace carries `license:odc-by`, covers all HN items with the story `url` field, and I confirmed `lastModified: 2026-08-08T03:51Z` — it updates continuously. ODC-BY is attribution-only and compatible with AGPL redistribution. Caveat: it is a third-party mirror licensing the compilation it assembled, not the underlying posts.

---

### Effect on our architectural commitments

- **THREATENS (seriously): "connectors run in the browser using the user's own session, no backend."** The commitment survives *in form* — Reddit says "logged-in and authenticated access won't be impacted" — but the version we assumed (anonymous `api/info.json` from the user's residential IP, which is what Newsit does) is on an announced kill list. A logged-*out* user's browser hits the same policy; switching to a residential IP does not fix it. **The Reddit connector must be re-specified as session-dependent, like the X connector**, with graceful degradation when the user isn't logged in. Ticket 01 needs reopening.
- **INVALIDATES: "Reddit returned 403 because we're on a datacenter IP" (ADR 0011's stated reason).** The measured 403 is real, but the recorded cause is wrong. Fix the ADR — the wrong cause points at a wrong fix (residential proxies / user IPs) that will not work.
- **CONFIRMS: "the Discussion Index is a future optimization, built in CI, served as static files."** Nothing here breaks that mechanically, and the corpus for it is downloadable today. It also confirms the corpus is *strategically more valuable* than assumed, since it is the one Reddit path that doesn't depend on a live endpoint Reddit is closing.
- **THREATENS: ADR 0005 (offline prefilter before any network lookup) for non-tech content.** If Reddit coverage is legally blocked, the index is HN-only and the prefilter will miss on most non-tech pages. That is survivable for v1 but should be stated as a known limitation, not designed around silently.
- **THREATENS: AGPL-3.0-throughout (ADR 0010).** Every Reddit archive is licence-silent (default all-rights-reserved), so there is no upstream grant to redistribute derived data. The HN half has a real grant (ODC-BY); the Reddit half does not.
- **Neutral:** the Codex-OAuth Digest is untouched by any of this, except that Data API Terms §2.4's "no other purposes" catch-all is broad enough that inference-time summarization of Reddit content is not clearly permitted. Not resolvable from the text.

---

### Next actions

1. **Mirror now, decide later.** Pull `pushshift_reddit_200506_to_202212` (517 GB submissions) and the surviving 2024-04→2026-06 torrents to private storage this week. Two full-history torrent hashes have already 404'd and Reddit began blocking the Internet Archive in Aug 2025 — this data is disappearing and is not recoverable later. Mirroring is cheap, private, and reversible; it commits us to nothing.
2. **One legal question, before any Reddit CI job exists:** *is a non-invertible bloom filter of third-party URLs "Reddit data" for the purposes of the Responsible Builder Policy and Data API Terms §3.2/§6?* Everything else in this ticket is downstream of that single answer. Do not let an engineer decide it.
3. **Ship the index HN-only for v1**, built from `open-index/hacker-news` (ODC-BY, attribution required, live). Size the Reddit shard at `num_comments>=10` (~67 MB) so it can be added later without a format change, and shard by URL-hash prefix from day one.
4. **Reopen ticket 01 and amend ADR 0011** with the corrected cause: announced deprecation of unauthenticated `.json`, not IP reputation. Respec the Reddit connector as logged-in-session-dependent, best-effort, silently degrading, with a per-user kill switch.
5. **Test the DHT recovery path for the 13-month hole (2023-03 → 2024-03, ~100M URLs).** The dead Academic Torrents hashes 404 over HTTP metainfo, but a `magnet:?xt=urn:btih:<hash>` needs no tracker or metainfo file. Cheap to test with any torrent client; nobody has tried it. Failing that, ask u/RaiderBDev or u/Watchful1 directly.

**Needs a real device / real residential browser — cannot be settled from a server:**
6. **Does a logged-in Reddit session on a residential IP still get 200 on `/api/info.json`?** This is now *the* load-bearing measurement and nobody has made it — no researcher had a Reddit account. It decides whether the Reddit connector exists at all. The one reported 200 (AS3356, no cookies, 2026-08-08) came from a business/transit IP and is *unverified by me*; it is also post-announcement, which means the shutdown is rolling rather than complete, and could complete at any time.
7. **The same test logged out**, from the same browser and IP, to isolate session from IP.
8. **Does Chrome MV3 attach reddit.com cookies to a service-worker `fetch` by default?** Sources conflict; only `host_permissions` + explicit `credentials:'include'` is reliably documented. A 20-minute scratch unpacked-extension test settles it — and it also gates the X connector design, which depends entirely on the same mechanism.
9. **Safari/iOS is completely untested.** Different fetch/cookie and host-permission semantics, plus App Review's view of this pattern. Fold into ticket 08.
