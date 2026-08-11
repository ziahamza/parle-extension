# Research: ticket 15 — Can Community Notes be joined to a Subject URL, and how?

## Bottom line

**NO — do not ship Community Notes as a page-URL → discussion signal.** The join is mechanically trivial and cheap; it is semantically wrong, and it is legally unresolved. Two independent blockers, either of which is sufficient:

1. **Semantics.** The URL in a note is a **citation slot by design**, not the note's target. The note's target is a `tweetId`. Best measured estimate across 117 hand-read notes: ~82–88% of note-cited URLs are *supporting evidence*, ~12–16% are *the authentic original of misused media*, and only **~1–3%** are *the thing being debunked*. Rendering "N Community Notes reference this page" on a cited page inverts the meaning of the note.
2. **Licence.** There is **no licence grant** for the dump. Apache-2.0 in `twitter/communitynotes` covers the code; `curl https://ton.twimg.com/birdwatch-public-data/LICENSE` → **404** (re-measured 2026-08-08). X's Developer Policy caps third-party redistribution of X Content at IDs only. Shipping note *text* in an AGPL-3.0 project has no established permission.

**Do:** close ticket 15 as NEGATIVE for the URL-join use case; keep Community Notes out of the Network connector set and out of the Discussion Index inputs; revise [ADR 0006](../../../docs/adr/0006-the-digest-reports-it-does-not-adjudicate.md), which currently names Community Notes as its exemplar. Keep exactly one lead open as a separate spike: `tweetId` → the *outbound link in the noted post*, which would be a genuinely correct join and needs the user's own X session — the mechanism [ADR 0001](../../../docs/adr/0001-x-access-via-user-session.md) already commits to.

---

### The dump: what it actually is (measured, 2026-08-07/08 snapshot)

| Fact | Value |
|---|---|
| Newest snapshot on 2026-08-08 03:53 UTC | `2026/08/07`; `2026/08/08` → 404 (published ~05:52 UTC daily) |
| Auth required | none — no cookies, no User-Agent needed |
| Retention | **exactly 7 days**: `last-modified: Fri, 07 Aug 2026 05:52:38 GMT` / `x-ton-expires: Fri, 14 Aug 2026 05:52:38 GMT`. `2026/07/28` → 404 |
| `notes` shards | 3 (`notes-0000{0,1,2}.zip`); `notes-00003.zip` → 404. 456 MiB compressed, ~1.46 GB raw |
| Rows | **2,951,683** notes, all `noteId` unique, all rows exactly 24 fields, dates 2021-01-28 → 2026-08-05 (48h publication lag, as documented) |
| Full dump | ~11.31 GiB compressed, of which `ratings` is 10.64 GiB. Skipping ratings: notes + noteStatusHistory = **624 MiB** |
| Delta feed | **none** — cumulative full snapshots only; refresh = full re-download. Underlying growth ~3,000–3,400 notes/day |

**Schema (measured, `head -1 | tr '\t' '\n'`):** the notes file is now **24 columns**, confirming the feared unannounced change. Col 24 is `isCollaborativeNote`, added per the official changelog on 2026-02-04. Cols 6–8 (`believable`/`harmful`/`validationDifficulty`) are deprecated and empty.

> **Parse from the header row, not from the docs.** Measured mismatches: docs say `participantId`, file says `noteAuthorParticipantId`; docs say `latestNonNMRStatus`, file says `mostRecentNonNMRStatus`; docs say `currentDecidedByKey`, file says `currentDecidedBy`. — https://raw.githubusercontent.com/twitter/communitynotes/main/documentation/under-the-hood/download-data.md

**Status filtering (answers the ticket's third bullet).** Status is **not in `notes.tsv`**. `notes.classification` is the *author's own* verdict (79.9% `MISLEADING…` / 20.1% `NOT_MISLEADING`) and must never be read as a status. The field is `noteStatusHistory.currentStatus` (23 cols, 3,149,632 rows):

- `NEEDS_MORE_RATINGS` 2,750,506 (87.3%)
- `CURRENTLY_RATED_HELPFUL` **267,296 (8.49%)**
- `CURRENTLY_RATED_NOT_HELPFUL` 131,830 (4.2%)

Do **not** filter on `currentCoreStatus` — it is a per-submodel status carrying values absent from `currentStatus` (`FIRM_REJECT` 998,254; `NEEDS_YOUR_HELP` 3,165).

**Join hazard:** `notes.tsv` is *not* a superset of `noteStatusHistory`. 14,687 CRH `noteId`s have no row in `notes-0000{0,1,2}.tsv` (267,296 CRH in NSH vs 252,609 found in notes); NSH has 197,949 more rows overall. Any join must tolerate both directions.

### URL coverage — corrected

The first-pass figures (84.87% of notes carry a URL; 69.04% a non-X URL) were **refuted twice over** and should not be quoted:

- **Not reproducible.** Re-running the stated regex on a fresh download gives 84.84% / 68.88% under a proper registrable-domain rule for X-owned hosts. Five method variants failed to reproduce the originals; deltas up to 3,247 notes (≤0.14pp). Directionally right, exactly wrong.
- **Wrong host list.** The 11-host exclusion set misses ~9.7k X-owned occurrences (`communitynotes.twitter.com`, `business.twitter.com`, `video.twimg.com`, `mobile.twitter.com`, various `*.x.com`) and inconsistently includes `pbs.twimg.com` but not `video.twimg.com`/`abs.twimg.com`.
- **Wrong population — the material error.** The ticket requires CRH-only. All-notes percentages *underprice* the join.

**Use these instead (CRH-filtered, measured):**

- **98.78%** of the 252,609 joinable CRH notes contain ≥1 http(s) URL; **79.48%** contain a non-X URL.
- That yields ~354,402 (note, URL) pairs over **~232,000–240,000 distinct normalized URLs** across ~44,800 hosts. (Two independent runs give 232,100 and 240,324 — the spread is host-exclusion/normalisation detail.)
- **~85.7% of those URLs are cited by exactly one note.** 98.2% have a non-trivial path (article-like, not a homepage).
- Bloom-filter sizing: 232k URLs @ 10 bits = **~273 KiB**; @ 12 bits = ~328 KiB. Cost is a non-issue.

**Caveat that kills the coverage story anyway:** "non-X host" ≠ "an article a user is reading." The distribution is dominated by platforms and boilerplate: `youtube.com`+`youtu.be` 108k, `instagram.com` 45k, `google.com`+`share.google` 39k, `facebook.com` 21k, `reddit.com` 15k — plus **`web3antivirus.io` at 54,146 occurrences**, a single crypto-scam-report domain that is the 6th-largest non-X host in the entire corpus. Excluding platform/search/archive hosts drops the all-notes figure from 69.15% to 63.69%. The tail is very long: 193,900 distinct external hosts; top-10 = 15.7% of external URLs, top-1,000 = 65.4%.

### The decisive finding: what the URL *means*

This answers the ticket's core worry — "is the signal 'cited as evidence' or 'being debunked', and can we even tell?" **It is overwhelmingly the former, and per-URL we cannot reliably tell.**

Direction is **confirmed** by two independent hand-labelling passes; the original *magnitudes* and one of its three evidence lines were refuted.

**Corrected breakdown (CRH notes with an external URL):**

| Category | Share (per note) |
|---|---|
| (a) URL is **supporting evidence** for the correction | ~82–88% |
| (c) URL is the **authentic original** of misused media, or the page the post misrepresented while itself being accurate | **~12–16%** |
| (b) URL **is the thing being debunked** | ~1–3% |

- **(b) is genuinely rare.** 0/50 clear cases in general random sampling; **0/25 in the scam/phishing stratum** — the stratum deliberately chosen to manufacture counterexamples, where all 25 notes cited FTC / `help.x.com` policy / Forbes / Bitdefender rather than the malicious URL. Wilson 95% CI on 1/100 is 0.2%–5.4%.
- **The original's claim that (c) is 1–3% is REFUTED.** Measured: 15.33% of CRH-with-external-URL notes carry a social/video/archive URL and 9.96% carry *only* such URLs; ~13/20 hand-read from that class are (c) under the original's own definition ("Original video: …", "元動画", "the authentic, unedited video here"). **(c) is the architecturally decisive bucket**, because (c) URLs are YouTube/Instagram/TikTok/Reddit/Facebook/news pages — exactly what a Parle user browses — and for them *neither* "cited as evidence" *nor* "debunked" is a truthful label.
- **DISCARD the cue-regex line of evidence** (the "0.447% of notes contain an explicit object reference" figure). It cannot bound anything: an equivalent regex for a phenomenon whose true rate had been hand-measured at ~6.5% recovered only 1.82% (>3× recall shortfall), and its own precision was ~20% by hand-check.
- **DISCARD the structural argument** "the debunked object is a post on X, which is not a page a Parle user browses." It is unsound in both directions: `x.com/i/status/{tweetId}` *is* a browsable page, and when the noted post reposts IG/TikTok/YouTube/FB media the debunked object *does* live at an external browsable URL — which is exactly where every (b) case found clustered (e.g. `2037615171548393517` links a Facebook group post as "Deep fake news"; `2075226968715337913` links the Facebook video that *is* the fabricated content).

**What survives from the original and is load-bearing:** the URL slot is a citation slot **by design**. The note form's summary prompt is verbatim *"Please explain the evidence behind your choices…"* and there is a dedicated `trustworthySources` field asking *"Did you link to sources you believe most people would consider trustworthy?"* — confirmed against `download-data.md` lines 158–159.

**Corroborating structure:** the one category where the linked page genuinely *is* the bad thing — phishing/scam sites — is **systematically excluded from the data**, because authors defang those URLs so they are not parseable. A regex for `[.]`, `(.)`, `hxxp` matches 37,384 notes (1.27%). Real example (`1968678339326910888`): the malicious `staking[lombard-fin][.]com` is broken on purpose while the only live URL is the supporting `web3antivirus.io` scam report. Even the strongest (b) category hands you an (a) URL.

### The failure mode is loudest on the highest-traffic pages

44.2% of CRH note→URL pairs point at a URL cited by 2+ notes; 11.8% at a URL cited by 50+. Top normalized URLs by distinct CRH-note citations:

- `youtube.com/watch` — 5,725 notes
- `consumer.ftc.gov/articles/what-know-about-cryptocurrency-and-scams` — **1,735**
- `bbc.co.uk/news/technology-53759932` (a real BBC investigation into dropshipping) — **1,617**
- `all-senmonka.jp/moneyizm/77501` — 1,494
- `forbes.com/sites/mattnovak/…` (SpaceX crypto scams) — 1,466
- `www3.nhk.or.jp/news/special/net-koukoku/…` — 1,240; `jma.go.jp/jma/kishou/know/faq/faq24.html` — 1,115

A naive join tells a user reading **the FTC's own anti-scam page** that 1,735 Community Notes flagged it. That is the exact product error the ticket names, and it would be our most-visited, loudest false positive.

**The rate that would actually decide this is UNKNOWN.** Every (a)/(b)/(c) figure above is *per note*; Parle's index is *per URL*. These diverge hard — 85.7% of distinct URLs are singletons while a handful of boilerplate citations absorb thousands of mentions each, inflating the per-note (a) share relative to the per-URL share. Worse, a single note can carry both semantics: the one clear (b) exemplar, `1875028689999835150`, contains a (b) URL (`shadowban.yuzurisa.com` — "no longer works") *and* an (a) URL (`hisubway.online` — "a working alternative"). **No per-URL rate has been established, and no per-URL label is even well-defined.**

### Licence and terms — hard blocker, independent of semantics

- **No grant exists.** `https://ton.twimg.com/birdwatch-public-data/LICENSE` → **404** (re-measured 2026-08-08); also `README.txt`, `license.txt`. The Apache-2.0 file at https://raw.githubusercontent.com/twitter/communitynotes/main/LICENSE sits in a repo whose README scopes it to "our content, algorithms" — `/scoring/src` and `/documentation`.
- The only permission-adjacent language is aspirational and grants **analysis, not redistribution**: *"publicly available … so that anyone has free access to analyze the data."* Docs also state notes are "subject to X's Rules, Terms of Service and Privacy Policy."
- **Developer Policy**, verbatim (https://developer.x.com/en/developer-terms/policy): *"we restrict the redistribution of X Content to third parties. If you provide X Content to third parties, including downloadable datasets or via an API, you may only distribute Post IDs, Direct Message IDs, and/or User IDs."*
- **ToS**, verbatim (https://x.com/en/tos): to *"reproduce, modify, create derivative works, distribute … Content on the Services, you must use the interfaces and instructions we provide."*
- *[SPECULATION, labelled]* The Developer Policy is scoped to "Licensed Material" obtained via the X API, and the CN dumps are not the X API — so an argument exists that the ID-only cap does not bind a dump consumer. **No X statement confirming that reading could be found.** Third parties do redistribute (HuggingFace `deadbirds/x-community-notes-parquet-20250222`; `histlearn/community-notes-br` self-declaring CDLA-Permissive-2.0), but a third party's self-declared licence is not a grant from X.

**This blocks shipping any derived artifact regardless of how the semantics resolve.**

### Correction to the transport claim

An earlier finding stated the dump host sends **no** `Access-Control-Allow-Origin`. **That is wrong.** Re-measured 2026-08-08 03:53 UTC, both with and without an `Origin` header:

```
access-control-allow-origin: *
vary: origin
accept-ranges: bytes
cross-origin-resource-policy: cross-origin
```

CORS is **not** the obstacle. The conclusion is unchanged and rests on size alone: 456 MiB for notes and no delta feed mean this could never be a **Network connector**; it is inherently a **CI-built static artifact**, i.e. Discussion-Index-shaped. And a CI job would have to run at least weekly or lose the ability to fetch any snapshot at all (7-day retention, measured).

### Impact on our architectural commitments

- **"Works with no backend deployed; all Network connectors run in-browser"** — **CONFIRMED, untouched.** Community Notes was never viable as a Network connector (456 MiB, cumulative snapshots). Declining it removes a would-be exception rather than creating one.
- **"Discussion Index is a future CI-built bloom filter served as static files"** — **NOT invalidated, but constrained.** CN would have fit the shape perfectly (~273 KiB) and must nonetheless be excluded from its inputs, on semantics and licence. The Index's design in ticket 16 loses a candidate input, not a requirement.
- **"AGPL-3.0 throughout; adopted data must be redistributable"** ([ADR 0010](../../../docs/adr/0010-agpl-3.0-throughout.md)) — **THREATENED and decisive here.** This is the commitment that blocks CN independently of the product question. It should be read as a general filter on ticket 14 (Reddit corpus sourcing) too: *no explicit grant means no adoption.*
- **[ADR 0006](../../../docs/adr/0006-the-digest-reports-it-does-not-adjudicate.md) ("the digest reports, it does not adjudicate")** — **its exemplar is INVALIDATED.** The ADR's principle stands; Community Notes was named as the one place the product surfaces other people's verdicts without adjudicating, and that mechanism does not exist. The ADR needs a new exemplar or an explicit note that none currently exists.
- **Reddit 403 / X gated on HN-or-Reddit / Codex OAuth digest** — **untouched.**

### Next actions

1. **Close ticket 15 NEGATIVE.** No URL→Notes connector, no CN input to the Discussion Index.
2. **Edit ADR 0006** to remove Community Notes as its worked example, citing this resolution. *(Do this — it is currently load-bearing text that is now false.)*
3. **Fold the licence lesson into ticket 14.** "Publicly downloadable" ≠ "redistributable." Require a written grant, not an inference, before any corpus enters the repo or a CI artifact.
4. **Open a separate, small spike: `tweetId` → outbound link in the noted post.** This is the *only* semantically correct CN→page-URL join — where the noted post's own link is the object, the page genuinely *is* what the note addresses. The dumps contain no outbound-link field, so it requires the X API or **the user's own logged-in session**. Scope it to: can a content script on a `x.com/i/status/{id}` page read the post's outbound link? Blocked on / shares infrastructure with ticket 01's session findings. Treat as research, not MVP scope.
5. **Do NOT commission the LLM-classifier experiment yet.** An LLM pass over the ~208k CRH-with-external-URL notes would give a real precision/recall curve for isolating (b), and it is cheap — but even a perfect classifier leaves the licence blocker standing, and the per-URL labelling problem (one note, two opposite semantics) is not obviously solvable. Sequence licence first; only run the classifier if a grant arrives.
6. **If anyone wants to keep the door open:** DM `@CommunityNotes` for written permission to redistribute derived artifacts under AGPL-3.0 (the docs invite this). Cheap, asynchronous, and it settles the blocker either way.

**Needs a real device / real residential browser to settle:**
- **(4) above only.** Resolving `tweetId` → outbound link must be tested from a logged-in X session in a real browser, on both Chrome MV3 and Safari/iOS — the same rig ticket 01 and ticket 08 already require. Nothing else in this ticket does; all dump measurements are datacenter-reproducible with no auth.

**Still genuinely unknown (do not paper over):**
- The **per-URL** (a)/(b)/(c) rate — the only rate a URL-keyed index could act on — has never been computed, and may not be well-defined.
- Whether X considers the Developer Policy's ID-only cap to bind consumers of the CN public dumps. No statement either way could be found.
- The download path for the fifth documented dataset, **Note Requests** — every guessed path 404s. Marginal here, but it means the doc→path mapping is incomplete.
