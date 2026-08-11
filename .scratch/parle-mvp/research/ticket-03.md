# Research: ticket 03 — What is on the Exclusion List, where does it come from, and who can change it?

### Bottom line

Ship the Exclusion List as **four layers, not one list**, and stop pretending the domain list is the privacy story:

1. **Mechanical rules** (no list, no licence, no staleness) — private/non-web addresses, non-public suffixes, and **unconditional fragment stripping**. This is the only layer that is complete.
2. **A separately-licensed domain artifact** built from UT1 Capitole (CC BY-SA 4.0), CISA `.gov` (CC0-1.0), Blocklist Project `porn.txt` (Unlicense), capped by Majestic Million (CC BY 3.0), collapsed to eTLD+1 via the Public Suffix List (MPL-2.0), plus a **hand-maintained supplement** that is the project's own work.
3. **URL-shape rules** — credential parameter names and structural token detection, with the entropy heuristic demoted to a secondary gate.
4. **`noindex` as a hard additive exclusion** — the one page-signal that measured clean *and* useful, and the only thing that covers `docs.google.com/document/d/…`, Dropbox `/scl/`, Zoom `/j/`, Meet, and `secure.chase.com`, which no domain list reaches.

Plus one thing that is not a filter at all and is the cheapest genuine improvement available: **a user-editable list, a visible "this page was excluded" state, and a global manual-mode switch.** All three shipping analogues converged on exactly this.

The honest public claim is in the last section. It is not "your browsing is private," and it is not "we exclude URLs carrying credentials" either — that second one is also unsupportable at the recall we can actually demonstrate.

---

### 1. Composition of the Exclusion List

#### Layer A — mechanical (bundled, no external source, complete by construction)

| Rule | Notes |
|---|---|
| Scheme not `http:`/`https:` | `chrome:`, `chrome-extension:`, `moz-extension:`, `safari-web-extension:`, `about:`, `file:`, `edge:`, `data:`, `blob:`, `view-source:` |
| Loopback / link-local / private IP literals | `127.0.0.0/8`, `0.0.0.0`, `10/8`, **`172.16.0.0/12`**, `192.168/16`, `169.254/16`, **`100.64.0.0/10` (CGNAT)**, IPv6 **`[::1]`**, `fc00::/7`, `fe80::/10` |
| Single-label hostnames | `intranet`, `wiki`, `jira` — no dot, therefore no public suffix |
| Non-ICANN / internal suffixes | `.local`, `.internal`, `.corp`, `.home.arpa`, `.lan`, `.test`, `.invalid`, `.onion`, `.i2p` |
| Host has no entry in the PSL ICANN section | Structural catch-all for internal names |
| **URL fragment is discarded before any Lookup** | See §3 — cheapest large win in the whole design |

This layer is adapted from the Internet Archive's Wayback Machine extension (`webextension/scripts/utils.js`, AGPL-3.0 — identical to ADR 0010, so directly copyable with attribution). **Its shipped list is missing** `172.16.0.0/12`, IPv6 `[::1]`, `.local`, and single-label hosts; do not inherit those gaps. (https://github.com/internetarchive/wayback-machine-webextension)

This layer answers the "internal/corporate tools" category in full. No public list of internal tools exists **or can exist** — internal tools live on private or non-public-suffix hostnames by definition. That category should be reclassified in ADR 0005 from "list" to "rule."

#### Layer B — the domain artifact (built, licensed separately, updatable)

| Category | Source | Licence | Verified today |
|---|---|---|---|
| Banking / financial | UT1 `bank` + `financial` | CC BY-SA 4.0 | `bank.tar.gz` 32,126 B, `Last-Modified: Fri, 07 Aug 2026 20:50:16 GMT`; 6,646 + 472 lines |
| Webmail | UT1 `webmail` | CC BY-SA 4.0 | 404 lines |
| Social feeds / self-referential | UT1 `social_networks` | CC BY-SA 4.0 | 715 lines |
| US government | CISA `dotgov-data/current-full.csv` | CC0-1.0 | 16,451 domains; `LICENSE` opens "Creative Commons Legal Code / CC0 1.0 Universal" |
| Adult | UT1 `adult` ∪ Blocklist Project `porn.txt` ∩ Majestic Million | CC BY-SA 4.0 / Unlicense / CC BY 3.0 | Unlicense text confirmed at `blocklistproject/Lists/master/LICENSE`; Majestic page states "Licensed under a Creative Commons Attribution 3.0 Unported License" |
| Hospitals / clinics | Wikidata SPARQL (`P31/P279* Q16917`, `P856`) | CC0 1.0 | 14,152 distinct official hospital websites, measured by an independent agent; **I did not re-run this query** |
| eTLD+1 collapse | Public Suffix List | MPL-2.0 | `LICENSE` = "Mozilla Public License Version 2.0" |

**Three corrections to the source recipe that were established by adversarial re-measurement and that you must apply:**

- **Do not include UT1 `mail`.** There is no `mail` category. `mail` is a symlink to `forums` (identical file hashes), which is why `mail.tar.gz` 404s; its contents are bare IPv4 literals and defunct 2000s flash-chat sites. Likewise `porn`→`adult`, `ads`→`publicite`, `violence`/`aggressive`→`agressif`, `drugs`→`drogue`, `proxy`→`redirector`. Any recipe that sums `adult` and `porn` is double-counting one list.
- **UT1 has 69 real category directories, not 80**, and it has **no health, government, calendar, document-editor, office or search-engine category**. Against ADR 0005's six named sensitive categories, UT1 supplies two.
- **Curlie is licence-clean (CC BY 3.0) but semantically wrong for this job and must not be used raw.** Curlie categorises sites *about* a topic, not sites that *are* a service. Its Health branch contains `cityofws.org` (City of Winston-Salem), `manotickvet.com` (a vet), `kvfd.com` (a volunteer fire department); its Search_Engines branch contains `daringfireball.net`. Using it would silently suppress Lookups on ordinary editorial pages — the exact harm ADR 0005 exists to prevent. Its dump is also ~6 months stale (files dated 2026-02-02). Use **Wikidata** for health instead: it is service-type, CC0, and jurisdiction-neutral.

**Size, measured by me today** (downloaded UT1 `bank`+`financial`+`webmail`+`social_networks`, collapsed to eTLD+1 against `public_suffix_list.dat`, unioned with CISA):

```
UT1 four categories  ->  7,647 registrable domains
CISA .gov            -> 16,451
union                -> 24,091 domains, 388.0 KiB raw, 115.6 KiB gzip
```

Adding the Majestic-capped adult set (16,811 domains, measured independently) and Wikidata hospitals (~14,152) projects to **≈55,000 domains, ≈850 KiB raw, ≈280 KiB gzip**. That is a non-issue: the Chrome Web Store package limit is 2 GB.

**Do not use a Bloom filter.** At 41k–55k domains the optimal filter saves ~100 KiB and buys a 1-in-1,000 chance of silently treating an ordinary page as sensitive. That is precisely the invisible cost ADR 0005 §"Why not gate on a partial prefilter" refuses to trade for — and here it would be in the privacy layer, where the user has no way to notice or complain.

#### Layer C — the hand-maintained supplement (our own work, ~300–600 entries)

Four things no adopted source supplies. These are **facts (hostnames), not copyrightable expression**, and are the project's own compilation:

- **Current webmail.** UT1's `webmail` is fossilised. I verified today: it contains `protonmail.com` and `tutanota.com` but **not** `proton.me` or `tuta.com` — the current primary domains of both — and not `icloud.com`, `gmx.com`, `outlook.live.com`, `outlook.office.com`. It does list `eudoramail.com` and `caramail.com`.
- **Cloud documents & calendar**, from vendor-published machine-readable sources: Microsoft `endpoints.office.com` (serviceArea `Exchange` → `outlook.office.com`, `outlook.office365.com`, `outlook.cloud.microsoft`; `SharePoint` → `*.sharepoint.com`) and Google's Workspace admin allowlist (`drive.google.com`, `docs.google.com`, `sheets.google.com`, `slides.google.com`, `sites.google.com`).
- **Banking gaps.** Verified absent from UT1 today: `coinbase.com`, `monzo.com`, `schwab.com`, `vanguard.com`, `barclays.co.uk`, `lloydsbank.com`.
- **Social gaps.** Verified absent today: `bsky.app`, `threads.net`.

One design consequence to record: UT1's `social_networks` **contains `reddit.com` and `news.ycombinator.com`** (verified). Excluding them from *Lookup* is correct — a Lookup there is self-referential and pointless. It must **not** disable *Harvest* (ticket 02). The Exclusion List gates Lookups only; Harvest is a separate code path and must be explicitly exempted, or reading a Network stops crawling it.

#### Layer D — what we are *not* attempting

**Health as a category cannot be solved by a domain list**, and the ADR should say so rather than carrying a commitment it cannot meet. The real risk lives behind authentication on hosts nobody enumerates (a patient portal, a lab-results page, an insurer's member area), while a list broad enough to catch it also suppresses the widely-discussed medical journalism where Parle is most valuable. The Wikidata hospital list is worth shipping — it catches `mychart.<hospital>.org`-shaped portals — but it is a partial mitigation, not category coverage. The residual is covered by `noindex` (§4) and by URL shape (§3), which ADR 0005 already enumerates separately.

---

### 2. Licensing — the part that is a legal problem, not a technical one

**The artifact cannot inherit AGPL-3.0. Ship it as a separate, separately-licensed data file.**

UT1 is a French *université*, so EU Database Directive 96/9/EC sui generis rights apply. CC BY-SA 4.0 §4(b), verbatim from https://creativecommons.org/licenses/by-sa/4.0/legalcode.txt:

> if You include all or a substantial portion of the database contents in a database in which You have Sui Generis Database Rights, then the database in which You have Sui Generis Database Rights (but not its individual contents) is Adapted Material, including for purposes of Section 3(b)

And §3(b)(1):

> The Adapter's License You apply must be a Creative Commons license with the same License Elements, this version or later, or a BY-SA Compatible License.

Creative Commons' definitive list (https://creativecommons.org/share-your-work/licensing-considerations/compatible-licenses/), fetched today, names exactly two:

> Free Art License: The Free Art license 1.3 was declared a "BY-SA–Compatible License" for version 4.0 on 21 October 2014. … GPLv3: The GNU General Public License version 3 was declared a "BY-SA–Compatible License" for version 4.0 on 8 October 2015. Note that compatibility with the GPLv3 is one-way only…

**AGPL-3.0 is not on that list, and GPLv3 is not AGPLv3.** ADR 0010 makes the repo AGPL-3.0 throughout; the derived Exclusion List must therefore carry **CC BY-SA 4.0** (or GPLv3, or FAL 1.3) as an aggregate alongside the code — never inlined into the JS bundle, never compiled into a structure inseparable from AGPL code.

Concretely: `packages/exclusion-list/` ships `exclusion-list.json`, `LICENSE` (CC BY-SA 4.0), and `NOTICE`. **UT1 supplies no attribution material** — its archive's `README` is 0 bytes and `global_usage` carries no copyright or licence notice — so §3(a)(1) attribution (creator, copyright notice, licence notice, disclaimer notice, URI) must be authored by us. Majestic's CC BY 3.0 attribution is also mandatory.

**Keep Majestic build-time only.** CC BY-SA 4.0 §4 explicitly licenses sui generis database rights; CC BY 3.0 does not. Use Majestic solely as an intersection filter so the shipped artifact is a *subset* of UT1/Blocklist Project, not a derivative of Majestic's ranking.

**Rejected sources, with reasons** — all verified, do not revisit:

| Source | Why rejected |
|---|---|
| DuckDuckGo Tracker Radar | CC BY-**NC**-SA 4.0. `LICENSE` verified today: "Licensed under the CC BY-NC-SA 4.0 license". GitHub's licence API reports only `NOASSERTION`, so automated tooling will not flag it. |
| Cloudflare Radar | CC BY-**NC** 4.0 per https://developers.cloudflare.com/radar/. The dataset doc page itself carries no licence at all. |
| Tranco (default list) | Contaminated with Cloudflare Radar since 2023-08-01 by Tranco's own attribution note, and publishes no licence for the composite; `/terms` and `/about` both 404. |
| Cisco Umbrella top-1M | No grant — only "© Cisco Umbrella, 2016". A copyright notice without a grant is a reservation of rights. |
| OISD | No licence anywhere on the site; also itself an aggregate, so it could not grant one. |
| abuse.ch / URLhaus | ToU §7.3 forbids derivative works without express consent; commercial use routes through Spamhaus. StevenBlack's "CC0" label for it is stale. |
| StevenBlack unified `hosts` | Repo is MIT but the aggregate contains MVPS (CC BY-NC-SA 4.0) and someonewhocares ("non-commercial with attribution"). |
| Hagezi | Declares GPL-3.0 over material it does not own — its own `sources.md` includes unlicensed OISD. |
| Shallalist | **Dead.** `shallalist.de` now serves an unrelated German marketing blog; download paths 404. Do not cite it as available. |
| URLBlacklist.com | Redirects to `smoothwall.com`, commercial. |
| EasyList / EasyPrivacy | Legally fine (GPLv3-or-later) but they are ad/tracker filter rules, not topical categories. |
| Curlie | Legally fine (CC BY 3.0) but semantically wrong — see §1. |

**Two open items that need a human, both flagged as blocking:**

- **UT1 written confirmation.** The visible declaration on https://dsi.ut-capitole.fr/blacklists/index_en.php is unambiguous — I fetched it today: `<H2>Licenses</H2> … <a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/">` — and the bundled `LICENSE.pdf` was verified to be BY-SA 4.0 by decoding its ToUnicode CMaps ("commercial" appears 0 times; canonical BY-NC-SA 4.0 has 13). But an **inert, commented-out RDF block declaring `by-nc-sa/4.0` sits directly beneath it** in the page source. Wayback shows it has been inside an HTML comment since the earliest snapshot (2012-05-13), when the visible declaration already read `by-sa/2.0` — so there is *no* evidence UT1 was ever visibly NonCommercial. It is still machine-readable metadata contradicting the visible grant. **One email to fabrice.prigent@ut-capitole.fr eliminates the risk on our single most load-bearing source.** Do it before launch.
- **AGPL-3.0 + Apple App Store.** This ticket surfaces it and cannot settle it. CC BY-SA 4.0 §2(a)(5)(c) and §3(b)(3) both forbid applying "Effective Technological Measures … that restrict exercise of the rights"; CC BY 3.0 §4(a) is equivalent. Apple's Standard EULA states "You may not transfer, redistribute or sublicense the Licensed Application." That is the VLC conflict (https://www.fsf.org/blogs/licensing/vlc-enforcement), and it applies to **ADR 0010's own AGPL-3.0 independently of any list**. ADR 0010 currently asserts "Store distribution itself is unaffected"; that assertion is contested and should not be relied on. Two mitigations worth putting to a lawyer: (a) supply a **custom EULA** via App Store Connect rather than accepting Apple's standard one; (b) publish the Exclusion List artifact at a **stable public URL under CC BY-SA 4.0** so recipients' rights are exercisable regardless of the app binary's terms. **Needs a lawyer, not an engineer. It gates the iOS target (ADR 0003), so resolve it before building that target, not after.**

---

### 3. URL-shape detection, with measured false-positive risk

This is where the prior analysis was most wrong and needs the most correction.

**Discard the claim that "entropy thresholds are unusable because they fire on 51.3% of ordinary URLs."** That figure is real but measures a threshold nobody uses. There is no ≥3.7 bits/char standard: truffleHog v2 uses base64 > 4.5 / hex > 3.0; Yelp `detect-secrets` uses `limit=4.5` / `limit=3.0`; gitleaks' 130 entropy declarations contain no 3.7 at all and never use entropy standalone. At the real thresholds, with the charset-tokenisation step the real tools perform first, the same 25,396-URL corpus yields **1.13%** (truffleHog) and **1.55%** (detect-secrets) — and all three cited counterexample slugs fail to fire.

The actual defect is different and worth understanding: **Shannon entropy is length-capped at log₂(len)**, so a 22-char base64url token tops out at 4.459 and can never reach 4.5, while 32-char hex tokens average 3.61 bits/char — *below* the 3.92 mean of ordinary English slugs. Real secrets are often lower-entropy than ordinary path segments. As a standalone ranker entropy scores AUC 0.541 (chance = 0.5); the single structural bit "segment contains no internal separator" scores 0.834.

**→ Use entropy only as a secondary gate on an already-matched structural pattern. Never standalone.**

**Discard the `wordish()` English-word suppressor entirely.** It was credited with the false-positive reduction, but ablation shows it delivers 99.3% of the drop while whole-segment anchoring delivers 0.7% — and it is not a public/private discriminator at all, it is an *English* discriminator: 1.05% FP on English TLDs versus **6.30% on `.jp`/`.cn`/`.kr`/`.ru`**. Worse, it blinds the detector to exactly the private URLs that matter: `https://www.notion.so/Team-Roadmap-6f2c19a84be74d8f9b3e5a7c1d0e2f48` goes from four rule hits to zero, and 7 of 8 realistic word-slug private URLs (Notion, Dropbox, SharePoint, legal, health portal, Calendly, internal GitLab) go from flagged to unflagged.

#### The rules to ship

| Rule | Measured FP | Notes |
|---|---|---|
| **Drop the fragment unconditionally** | ~0 | 0.08% of news URLs and 5.3% of general web URLs even *have* a fragment; **15% of secret-bearing URLs carry the secret only there**. Uniquely an extension problem: RFC 6749 §4.2.2 implicit-grant tokens arrive in the fragment, which the browser never sends to any server — but `chrome.tabs` hands it to us in full. Hypothesis already does this (`uriForBadgeRequest()` sets `url.hash = ''`). **Cheapest large win in the design.** |
| **High-precision credential parameter names** | **0.004% / 0.000%** | ~31% recall. Best value in the system. From primary specs: AWS SigV4 (`X-Amz-Algorithm`, `X-Amz-Credential`, `X-Amz-Signature`, …), Azure SAS, GCS/CloudFront signed URLs, Dropbox `rlkey`, plus `password`, `api_key`, `secret`, `session`, `jwt`, `access_token`, `id_token`, `oauth_token`, `magic`, `reset`, `invite`. |
| **Promote `sig`, `sv`, `st`, `se`, `sp`, `sr`, `e` into that list** | **0.000%** | These buy all the marginal recall at **exactly zero** FP cost. Azure SAS is otherwise entirely invisible. |
| **Drop `t`, `state`, `u`, `code`, `s` as standalone names** | — | These buy **zero** recall and cause **all 31** marginal false positives — landing on `youtu.be/…?t=317`, forum `showthread.php?t=…`, `?state=CA`. Ten further names (`auth`, `email`, `expires`, `key`, `nonce`, `policy`, `session`, `signature`, `ticket`, `token`) fired on nothing at all in either corpus. |
| **JWT regex** | 0.000% | Cheap, exact. |
| **Bare email address as a parameter value** | 0.000% | The WOT harm was literally email addresses embedded in URLs. |
| **Structural token detection on whole path segments / query values** | 1.60% news, 2.26% general | Bare UUID; bare hex ≥ 32; separator-free mixed-case-plus-digit base64url ≥ 20. **Widen the alphabet to include standard base64 `+ / =`** — the Azure SAS signature (44 chars, entropy 4.85) was missed only because it was excluded. |
| **Query allowlist, not blocklist** | — | Only 434 distinct parameter names appear across 32,394 real URLs. Ticket 06 canonicalization is already stripping most of the tail. An allowlist is the only construction that does not fail on the parameter nobody enumerated. |

**Proposed but unmeasured:** re-admit `code` **and** `state` only when they **co-occur**, which is the OAuth 2.0 authorization-code callback shape (RFC 6749 §4.1.2: `Location: https://client.example.com/cb?code=SplxlOBeZQQYbYS6WxSbIA&state=xyz`). Neither alone is worth its cost. Label this in the ADR as a proposal to be measured, not a result.

#### The ceiling — state this honestly in the ADR

Short share-secrets are **undetectable at any tolerable false-positive rate**. A threshold low enough to catch an 11–15 character token costs 15–27% of all ordinary pages, and recall still never exceeds ~87%. The unreachable cases are structural: an unlisted YouTube video is `?v=` + 11 base64url chars, byte-identical in shape to a public one; Overleaf read links are 12 lowercase chars; legacy Dropbox links are 15.

Two shapes are **provably undecidable** without a host rule: `notion.so/Team-Roadmap-<32 hex>` and `apnews.com/article/<slug>-<32 hex>` are the same string. Any rule catching the first excludes the entire AP wire.

**Do not quote a recall figure.** The 66.7% number comes from a hand-built 39-URL corpus (Wilson 95% CI ≈ 51–79%, ~28pp wide), which contains at least one non-secret (`youtube.com/watch?v=dQw4w9WgXcQ`) and several invented formats. Both false-positive corpora are anonymous logged-out crawls with no authenticated app URLs in them at all — so the FP rate is measured in the population least able to produce false positives, and is a lower bound on real utility loss. **Move `detect.py`, `sweep.py` and the corpora into the repo as a regression test, and build a browsing-derived corpus, before freezing any threshold.**

---

### 4. Page signals — one rule to ship, one to drop, one blocked on hardware

**Ship `noindex` as a hard additive exclusion.** The earlier conclusion that it is "almost useless (3.7% of private pages)" is refuted: that figure was measured on logged-out sign-in pages and corporate marketing homepages. Re-measured on genuinely private URL classes, prevalence is **~45% (17/38)**:

- Google Docs / Drive file URLs — `X-Robots-Tag: noindex, nofollow, nosnippet` (3/3)
- Dropbox `/scl/fo/`, `/scl/fi/` — meta *and* header; Box `/s/` — header
- Google Meet — `<meta name="robots" content="none">`; Zoom `/j/` and `/rec/share/`; `teams.live.com/meet` (4/4)
- Typeform form pages
- Real online-banking hosts, 4/10: `secure.chase.com/web/auth/dashboard`, `connect.secure.wellsfargo.com`, `onlinebanking.usbank.com`, `personal.vanguard.com`

False-positive rate on public content is **0.23%–0.68%** depending on whether `googlebot-news`-scoped directives are honoured (measured on 444 HTTP-200 pages drawn from real Reddit/HN-shared URLs). The earlier "1.65% FPR, and the false positives are LWN and Ars Technica" figure was inflated by two probe bugs and an off-by-one denominator; the honest set at 425 pages is **0.71%** — one syndicated FT reprint on Ars, one unlisted Substack post, and LWN's visible login form.

**This is the highest-value single rule in the whole ticket**, because it covers exactly the document-ID / share-token / meeting-ID URLs a domain list handles worst: `docs.google.com` must be excluded while `google.com` is not; `dropbox.com/scl/…` must be excluded while Dropbox marketing is not.

Three implementation requirements:

1. **Tokenize** the robots value on commas and whitespace and match whole directives. Match **both `noindex` and `none`** as whole tokens — Google Meet uses exactly `content="none"`, which Google's docs define as "Equivalent to noindex, nofollow" (https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag). **Never** match the `none` inside `max-image-preview:none`.
2. Read **only** `meta[name="robots"]` — not `Googlebot-News`, which produced a phantom Forbes false positive.
3. Read the **`X-Robots-Tag` header** too. Google Docs, Drive, Discord and Box signal *only* via the header. **A DOM-only implementation misses precisely the highest-value cases.**

**Drop the password-field rule.** After fixing the probe bugs and requiring visibility (`checkVisibility()`), its remaining hits are hidden login forms — Discourse literally ships `<form id='hidden-login-form' style="display: none;">`. And it fires when the user is logged **out**, which is when the page is least private.

**Do not gate on HTTP headers.** No single header is usable: `Cache-Control: private` is *inversely* informative (LR+ 0.50, 95% CI 0.27–0.93 — it is weak evidence a page is **public**); `Set-Cookie` measures 52% FP cold but only ~33% warm, so a third of its firings are an artifact of every probe being a first visit. Conjunctions do reach LR+ 23–43 at 0.7–2.1% FP, and `WWW-Authenticate` has 0.0% FP (and HTTP Basic is **not** extinct — 401 + `WWW-Authenticate: Basic` verified live today at `httpbin.org/basic-auth/user/pass`, `authenticationtest.com/HTTPAuth/`, `the-internet.herokuapp.com/basic_auth`; it was absent from the corpus because the corpus contained no intranet or router-admin pages). But none of this can be load-bearing, because:

**Safari response-header access is unresolved and Safari is the constraining platform (ADR 0003).** Apple's compatibility page states "`opt_extraInfoSpec` not supported for any of the events" — and `opt_extraInfoSpec` is exactly how you request `responseHeaders`. MDN browser-compat-data records full support at `safari 18.4` / `safari_ios 18.4`. **These directly contradict each other and cannot be resolved without hardware.** A 20-line test extension on a real iPhone settles it. **Route this to ticket 08.** Until it is settled, treat `X-Robots-Tag` as a Chrome enhancement and `meta[name="robots"]` as the cross-platform floor. Also note `declarativeNetRequest` is *not* a fallback — it cannot read anything; `onRuleMatchedDebug` is Chrome-only and unpacked-only.

**One timing consequence for ticket 07.** `noindex` is only readable once `<head>` is parsed, and ADR 0005 requires "see its Discussions immediately." Gate the Lookup on head-parse completion (a few milliseconds), not on `document_end`. And on SPA navigations there is no new document at all — Gmail, Slack, Notion, Linear and the cloud consoles route client-side — so the signal is evaluated once on the shell and never again for the actually-sensitive URLs. **The domain layer, not the signal layer, is what covers SPA app shells.** Say so explicitly.

---

### 5. Update mechanism

The constraint from ADR 0011 is that the bundled list must stand alone and updates are *pure improvement*. Make that a **checkable invariant, not a hope**:

- **Single source of truth in the repo.** `packages/exclusion-list/` holds the build script, the hand-maintained supplement (`supplement.txt`, reviewed by a human), and the generated `exclusion-list.<n>.json`. Version `n` is a monotonic integer.
- **The bundled artifact and the published artifact are the same file.** The build emits it once; the extension bundles it and CI publishes the identical bytes to the static artifact host. There is no drift to keep in sync because there is only one artifact per version.
- **Updates are additive-only, enforced at build time.** A published update may only **add** entries. Removals ship exclusively via a new extension release, which passes through store review. This makes "the CDN can only ever improve your privacy, never widen your exposure" a property of the format rather than a promise, and it makes a compromised or absent artifact host harmless.
- **Integrity.** The artifact carries a detached signature over its content hash, verified in the extension with Web Crypto against a public key baked into the bundle. No backend required — this satisfies ADR 0011.
- **Cadence.** Rebuild weekly (UT1 rebuilds daily; CISA daily; Blocklist Project ~3 weeks; Majestic monthly; Wikidata on demand). Publish only when the diff is non-empty.
- **Two build-time guardrails, because a bad upstream day could suppress a large part of the web:** (a) refuse to publish if the list changes size by more than a set percentage; (b) a **canary allowlist** of ~500 major news, reference and technical domains that must never appear in the artifact — build fails if one does. This is the mechanical defence against the Curlie failure mode.
- **Layer precedence at runtime, highest first:** user allow-anyway → user exclusions → mechanical rules → bundled artifact → published update. User decisions always win in both directions.

---

### 6. User control

Ticket 03 asks four questions; the answers are yes, yes, yes, and yes — and this layer is the single cheapest real improvement available, because it converts residual risk from "we failed to anticipate your bank" into "you told us once."

- **Per-site pause** — already committed.
- **Add your own exclusions** — by host, or host + path prefix. Persisted locally, never synced.
- **See the current list** — a settings page that is searchable and, critically, **tells you *why* a URL was excluded**: which layer, which category, which source.
- **Allow-anyway** — per-host override that beats every built-in layer, including the mechanical one for `http(s)` hosts.
- **A visible excluded state.** When the pill would have fired and did not, it shows a muted "excluded — check anyway?" affordance rather than nothing. This is the direct answer to ADR 0005's own objection: it turns a silent false negative into a visible one the user can act on and complain about. ADR 0005 already guarantees click-to-check works everywhere; this makes it *discoverable* on exactly the pages where it matters.
- **Global manual mode** — a single switch that turns off all automatic Lookups. Every one of the three shipping analogues has this (the Wayback extension's "private mode", CrowdWise's "Incognito mode", Newsit's per-host blacklist), and it is what App Review and a skeptical HN reader will both look for first.

**Worth recording in the ADR as prior art that cuts against us:** the only extension ever built for Parle's exact purpose that checked pages automatically — `agschwender/reddited-extension`, 2011 — shipped an **allowlist** of ~17 media domains as the default, and refused to auto-check HTTPS pages at all. And the only modern HN-discussion extension, `jstrieb/hackernews-button`, was built expressly to avoid per-page API queries and says so in its README. Parle is choosing the design this product category has twice rejected. That is defensible — ADR 0005 argues it well — but it should be recorded as a considered choice, not the obvious one. The Show HN thread for the closest competitor (https://news.ycombinator.com/item?id=24048786) had privacy objection to exactly this behaviour as its top-voted comment. Expect that on launch day.

**Licence check on everything adoptable — no obstacles:** Wayback extension AGPL-3.0 (identical); Hypothesis BSD-2-Clause (permissive, retain notice); `hackernews-button` GPL-3.0 and `reddited` GPL-3.0-or-later, both bridged by AGPL-3.0 §13 ¶2 ("permission to link or combine any covered work with a work licensed under version 3 of the GNU General Public License into a single combined work"), with the caveat that the GPL'd part stays GPLv3 and must be tracked per-file.

---

### 7. The honest public claim

Three things we **may not say**:

- ~~"Your browsing is private."~~ False.
- ~~"We exclude URLs carrying credentials."~~ Unsupportable — the demonstrated recall is roughly two thirds of the *shapes we thought to test*, on a 39-URL hand-built corpus, and short share-tokens are undetectable in principle.
- ~~"We protect sensitive categories."~~ I verified today that the best available list is missing `proton.me`, `tuta.com`, `icloud.com`, `outlook.office.com`, `gmx.com`, `coinbase.com`, `monzo.com`, `schwab.com`, `vanguard.com`, `barclays.co.uk`, `lloydsbank.com`, `bsky.app` and `threads.net`. **Reviewers at both stores will test exactly these domains.**

**The claim we can defend, in full (README, first-run screen):**

> Parle sends the address of the page you are reading to Hacker News, Reddit and X, to find out whether anyone has discussed it. That is the same thing as pasting the link into their search boxes — it is not anonymous, and those services see it.
>
> It does this automatically on most pages. It does **not** do it on pages that match a built-in exclusion list — banks, webmail, adult sites, government sites, social feeds, and private or internal addresses — or on pages whose address visibly contains a token or credential. It never sends the part of an address after the `#`.
>
> That exclusion list is a list. It is incomplete, and it will miss things, including services we have not heard of and short share links that look like ordinary addresses. You can read the whole list, add to it, override any entry, and turn automatic lookups off entirely.

**The one-sentence store-listing version:**

> Parle looks up the page you are reading on Hacker News, Reddit and X to show you what people said about it — which means it sends that page's address to those services, on every page except a built-in exclusion list you can see and edit.

**Two compliance notes this wording is built to satisfy:**

- Chrome Web Store Limited Use, fetched today: "Collection and use of web browsing activity is prohibited, except to the extent required for a user-facing feature described prominently in the Product's Chrome Web Store page **and in the Product's user interface**." Enforcement of the 2026 updates began **1 August 2026** — one week before this ticket. The disclosure is not a compliance chore; it is the load-bearing mitigation, and it must appear in the UI, not only the listing.
- The empirical line between "criticised" and "removed" in this category is **full-URL versus hostname**. WOT (~140M users, pulled 2016) — NDR identified 50+ users partly from email addresses embedded in URLs. Stylish (pulled 2018) — Robert Heaton's argument is verbatim Parle's problem: secret login-token URLs, and a medical provider using 1000-character URLs as the only authentication. Avast/AVG (pulled 2019, FTC order Feb 2024, $16.5M) — data "revealing consumers' religious beliefs, health concerns, political leanings." NewsGuard, which sends **hostname only**, was criticised by the author of uBlock Origin but never removed. **Parle is on the wrong side of that line by design**, which is why the fragment rule, the credential-parameter rule, and the prominent disclosure are not optional polish.

---

### 8. Proposed ADR 0005 amendments

1. Reclassify **internal/corporate tools** from "list-based exclusion" to **structural rule** — no list exists or can exist.
2. Reclassify **health, calendar, and documents** from "category list" to **partial coverage**: a Wikidata hospital list plus a hand-maintained vendor-hostname supplement plus `noindex` plus URL shape. State plainly that a domain list cannot satisfy the health category, and why (the risk is behind auth; a list broad enough to catch it kills medical journalism).
3. Add **`noindex` as a named exclusion mechanism**, with the header/meta split and the Safari limitation.
4. Add **unconditional fragment stripping** as a named rule.
5. Attach the **measured enumeration gaps** (§7) as evidence — they are the concrete form of the weakness the ADR already acknowledges in the abstract.
6. Record that **the Exclusion List gates Lookups only, never Harvest**.
7. Amend ADR 0010's "Store distribution itself is unaffected" to note the open App Store question.

### 9. What still needs a human

| Item | Who | Blocks |
|---|---|---|
| Email fabrice.prigent@ut-capitole.fr for written confirmation that UT1 is CC BY-SA 4.0 and the commented `by-nc-sa` RDF is superseded | Anyone with an email client | Shipping the artifact |
| Legal opinion: AGPL-3.0 and CC BY-SA/BY anti-ETM clauses vs Apple's Standard EULA; viability of a custom EULA | **A lawyer** | The iOS target (ADR 0003) |
| Safari/iOS device test: is `webRequest` `responseHeaders` readable on Safari 26? Apple's docs and MDN BCD directly contradict each other | Ticket 08 (real hardware) | Whether `X-Robots-Tag` is cross-platform |
| Store-review dry run against `proton.me`, `coinbase.com`, `bsky.app`, `outlook.office.com` before submission | Ticket 12 | Listing copy |
| Run the Wikidata hospital SPARQL query and measure precision, not just count (14,152 was measured by another agent; I did not reproduce it) | Engineering | Health coverage claim |
| Build a browsing-derived false-positive corpus including authenticated app URLs before freezing any URL-shape threshold | Engineering | The 1.6%/2.3% FP figures are lower bounds and possibly large underestimates |

**Could not establish:** whether a Cloudflare-Radar-free custom Tranco list can be generated (`https://tranco-list.eu/configure` returns HTTP 401 and requires an account), and what licence Tranco would assert over it. Majestic (CC BY 3.0) remains the only verified-clean popularity ranking. Also could not establish the licence of the EPFL Curated Curlie Dataset on figshare (DOI 10.6084/m9.figshare.19406693 — both the article page and the figshare API returned HTTP 403); the Homepage2Vec code is MIT but that need not extend to the deposit. Neither is on the critical path under this recommendation.
