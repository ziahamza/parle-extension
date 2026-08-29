# Enrichment sources — what could join the panel, and on what terms

Researched 2026-08-24 against primary sources (official docs, terms pages, and live anonymous
HTTP tests from an extension-shaped origin). The question: which additional sources of
information could enrich what Parle shows about a Subject, under the standing constraints —
no backend required ([ADR 0011](../adr/0011-the-client-is-autonomous-the-backend-is-an-accelerator.md)),
no login and no per-user API key ([ADR 0014](../adr/0014-no-network-oauth.md)), requests issued
from the reader's own IP with politeness as a hard constraint, and every per-page Lookup
disclosing the reader's reading to whoever answers it — so a **static artifact compiled at
build time beats a live Lookup wherever both exist**.

One decision is already on file and shapes the headline request.
[ADR 0009](../adr/0009-audience-spread-not-outlet-ratings.md) refuses left/right outlet
ratings in favour of Spread, but its closing line leaves the door open: *"Licensed outlet
ratings remain a possible independent static artifact and a separate effort. Nothing here
forecloses them."* This document is the feasibility study for walking through that door.

---

## 1. The Ground News question: publisher bias ratings

**Ground News itself is not a source.** It has no public API, its terms prohibit scraping and
reuse ([terms](https://ground.news/terms-and-conditions)), and its ratings are not its own —
it averages **Media Bias/Fact Check, AllSides, and Ad Fontes Media**
([ground.news/media-bias](https://ground.news/media-bias)), paying at least Ad Fontes for the
privilege ([CJR](https://www.cjr.org/analysis/the-business-of-balance-ground-news.php)). So
"add Ground News" really means "deal with the three raters Ground News pays."

| Rater | Coverage | Access | Verdict |
|---|---|---|---|
| **AllSides** | ~2,400 outlets, 5-point scale | Ratings published under **CC BY-NC 4.0**; paid API for commercial use ([license page](https://www.allsides.com/tools-services/bias-ratings-license-api)) | **The only real left/right dataset with a public license.** Shippable as a static artifact with attribution — but the NC clause binds Parle to staying noncommercial while it's aboard |
| **Media Bias/Fact Check** | 11,000+ domains — the only Ground News-scale set | Official API $10–$200/mo (RapidAPI, no redistribution) or negotiated direct license; reduced arrangements offered for nonprofits/open projects ([MBFC Data API](https://mediabiasfactcheck.com/mbfcs-data-api/)) | **Email editor@mediabiasfactcheck.com.** The drmikecrowe/mbfcext extension precedent shows they have blessed a browser extension before. Unlicensed GitHub scrapes exist but are takedown bait for a project whose brand is trustworthiness |
| **Ad Fontes** | thousands, two-axis | Commercial data platform only, undisclosed pricing | Dead end for a free AGPL extension |

**Open supplements** (all shippable, all license-clean):

- **Wikipedia perennial sources list** ([WP:RSP](https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources)) —
  ~450 outlets' *reliability* consensus (generally reliable / marginal / deprecated), CC BY-SA,
  parseable at build time.
- **Wikidata** — CC0; sparse for bias itself (~312 newspapers carry P1387 political alignment)
  but the clean way to map AllSides outlet names to domains (P856 official website) and to
  supply publisher facts (founded, owner, country).
- **Iffy Index** ([iffy.news](https://iffy.news/index/)) — 1,300+ unreliable sites, CC BY 4.0,
  quarterly updates. Credibility warnings, no left/right dimension.

**Feasible shape:** a build-time compiled, domain-keyed JSON (~100–200 KB gzipped, ~2,500–3,000
domains) merging AllSides + RSP + Iffy + Wikidata, each rating labelled with its origin
("Lean Left — per AllSides"), shipped inside the extension. Zero Lookups, zero disclosure.
This is exactly the "independent static artifact" ADR 0009 anticipated. Whether to *show* it —
and how it coexists with Spread rather than replacing it — is a product decision ADR 0009
says must be argued on its own; the licensing note (CC BY-NC constrains commercialisation)
belongs in that argument.

## 2. New Networks (discussion sources)

Live-verified anonymous access, 2026-08-24:

| Network | URL lookup | Auth | Anon limit/IP | Fit |
|---|---|---|---|---|
| **Bluesky** | **Native**: `app.bsky.feed.searchPosts?url=` on `public.api.bsky.app` — purpose-built "posts linking to this URL", catches link-card embeds ([lexicon](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/searchPosts.json)) | None | ~3,000/5 min | **Best candidate.** Largest relevant audience (the tech/journalism exodus from X). Wrinkles: CDN 403s datacenter IPs (readers' residential IPs are fine — but live CI tests are not), unauthenticated cursor pagination is broken (one page of ≤100 suffices) |
| **Lemmy** | `GET /api/v3/search?q=<url>&type_=Url` — exact match, and one big instance (lemmy.world) returns **federated** posts from other instances (verified) | None | per-instance, ~60/10 min class | **Second.** CORS-open to extension origins (verified), most Reddit-shaped data of any candidate. Small audience, high link-aggregation hit-rate |
| **Lobsters** | Partial: `/domains/<domain>.json` + client-side filter (JSON search endpoint is gone — verified 400) | None | undocumented; volunteer-run, cache hard | Cheap to add; best comments-per-thread in tech, but heavy overlap with HN |
| **GitHub** | Issue/PR text search, CORS `*` | None | **10/min** search budget | Only on-demand or domain-gated; issues are a different flavour of Discussion |
| Mastodon | Status search and URL resolve require auth per instance | — | — | Blocked today; watch **Fediscovery** (standardised discovery providers, FOSDEM 2025) |
| Threads, Product Hunt, YouTube, Tildes, MetaFilter, Slashdot, Mbin, Digg | No keyless URL search (or no API) | — | — | Ruled out; revisit Digg when its post-beta API appears |

Integration cost per Network: the closed union in `packages/domain/src/Network.ts`, a
~350-line connector on the HackerNews template plus tests, LookupPolicy, panel theming, and a
disc. Bluesky and Lemmy both clear the bar HN set: keyless, anonymous, sanctioned, generous
limits.

## 3. Non-discussion enrichment

Ranked by value under the privacy grading (static artifact > per-domain Lookup > per-page Lookup):

1. **Wayback Machine page history** — Availability API + CDX (`collapse=digest`): first-archived
   date, capture count, and **how many times the content changed since publication** — a
   stealth-edit detector no competitor has. Keyless, anonymous, nonprofit; ~60 req/min observed
   ceiling, one lazy Lookup per panel open is nothing. The best *live* addition available.
2. **Publisher dossier (static)** — WP:RSP reliability + Wikidata facts (founded, owner,
   country), rebuilt each release. Zero disclosure, open licenses. Pairs naturally with §1.
3. **Fact-check index (static)** — Google's Data Commons republishes the ClaimReview corpus as
   a downloadable **CC BY** feed ([datacommons.org/factcheck](https://datacommons.org/factcheck/download)).
   Match page URL against `appearance` URLs offline — real fact-check surfacing without ever
   talking to Google at read time. (The live Fact Check Tools API needs a Google Cloud key and
   sends claim text to Google — wrong shape for Parle.)
4. **Domain prominence (static)** — Tranco rank tiers (build *without* the CC BY-NC Cloudflare
   Radar component), with anonymous RDAP registration-date lookup as fallback for unranked
   domains — "this domain is 3 months old" exactly when it matters.
5. **Scholarly context (per-page, niche)** — OpenAlex (CC0, keyless, 100k/day) with Crossref
   fallback, fired only when the page carries a DOI/arXiv ID.
6. **Coverage elsewhere (per-page, opt-in)** — GDELT DOC 2.0, the only keyless
   related-coverage API; noisy keyword matching, variable uptime, discloses reading topics —
   opt-in if at all.

Excluded with reasons on file: NewsGuard (licensed-only), Bing News API (retired 2025-08-11),
NewsAPI-class services (keys, dev-only free tiers), Google News RSS (unofficial, fragile),
Cloudflare Radar (NC license + per-user token).

---

## Recommended order

1. **Bluesky as a fourth Network** — highest value-to-effort, a purpose-built API, and the
   audience where article discussion now happens.
2. **Wayback page-history in the panel** — unique reader value, trivially polite.
3. **Lemmy as a fifth Network** — cheap alongside the Reddit-shaped code.
4. **The bias/reliability static artifact** — AllSides + RSP + Iffy + Wikidata now, and send
   the MBFC licensing email (the only route to Ground News-scale coverage). Product design
   must answer to ADR 0009: label origins, show it beside Spread, never as Parle's own
   judgement (ADR 0006).
5. **Static ClaimReview index, Tranco/RDAP domain signals, OpenAlex** — in that order, each an
   independent, bounded effort.

Full per-source citations live in the session research transcripts; every claim above carries
its primary source inline.
