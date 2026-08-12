# The battery, run twice — then the fixes, then the battery twice again

_2026-08-10, working tree on `b549ec2` with all of today's work uncommitted. First written by the battle
runner after running the whole battery twice against the pinned 82-row corpus and recording four product
defects (P1–P3, F1). Updated the same day by the re-battle runner after the three fix streams landed: the
tree was reconciled (one fresh defect found in the reconciled seam and fixed the same hour — see §4b), the
kinds corpus grew two ADR 0005 insurance rows, and the identical battery ran twice more, start to finish,
from a clean slate (`e2e:clean`) each time, on the same pinned corpus. The pre-fix numbers and wire
recordings are preserved inside §4's ledger entries as the "before" of each fix._

> **Current-state addendum, 2026-08-11.** This document preserves the 2026-08-10 battle as historical
> evidence. Its title-search rows and 1,328-test count are not the current product: title search was
> subsequently removed in full. The current gate is 1,309 unit tests, `pnpm e2e` at 59/59, and
> `e2e:torture` at 48/48. The portable `e2e/run-browser.sh` uses Xvfb on Linux and visible Chrome on
> macOS because Chrome 151 does not load extensions headlessly.

The bar this file is written to: QA is trusted only when it names its own gaps. §7 is that list. Nothing in
§2 was adjusted to look green — corpus expectations were written from the ADRs before their first runs and
never edited to match one, and every WRONG below is either a defect (§4) or a standing, referenced
disagreement the table keeps red on purpose (§6).

## 1. What the battery is

Six steps, strictly serial. The sweep is the only concurrent phase, and its nine Chromes are paced by ONE
politeness gate, because Algolia meters this box's single IP (ADR 0014) and per-shard politeness is
collectively abusive.

| step | command | what it proves |
|---|---|---|
| 1 | `pnpm typecheck && pnpm test` | 20 turbo tasks; the whole unit suite across all 11 workspaces |
| 2 | `pnpm e2e` | the 56-check behaviour run: consent before anything, Lookups on the wire, Harvest provenance on the disk, the mark, the browser's own panel and the trusted-gesture hop, the Digest end-to-end against a local Provider, exclusion, quiet pages, forgetting — including the Safari-shaped overlay pass (6 of the 56) — **plus, since the P3 fix, the 17-check title race** (`title.e2e.ts`): five cold visits whose `<title>` lands at 0/300/550/900/1500 ms around the 400 ms settle window, each required to end with exactly one real-title topical query and zero address-shaped ones, and a never-titled page required to end settled with none. The title half is hermetic (Algolia route-served, 0 live requests) |
| 3 | `e2e:sweep` (`SWEEP_SHARDS=8`, `SWEEP_RESOLVED` pinned) | the WIDENED corpus: 82 front-door rows round-robined across 8 shards, each with its own profile and its own verified X display (`display.ts`), **plus** the page-KIND scenarios (`kinds.corpus.ts` — 23 rows since the re-battle: the original 21 plus the two ADR 0005 insurance rows of §4c) as a ninth co-gated worker. One token bucket for all nine; a raw-CDP observer per worker stamps every real `hn.algolia.com` request; the closing block reports MEASURED peak and sustained, merged |
| 4 | `e2e:torture`, then `TORTURE_ONLY="worker death"` ×4 | 8 adversarial scenarios, 44 checks: MV3 worker death mid-Enquiry (five times in total — flakiness here would be a product finding), 20-flip back/forward storms, two tabs on one Subject, Networks switched off mid-flight, pause/resume under an open panel, corrupt settings + starved quota, offline + wires cut mid-Enquiry, a hostile host page, eight days of clock skew. Zero external requests by construction — Algolia and Reddit are route-served inside the harness |
| 5 | `e2e:store` | the five 1280×800 Chrome Web Store frames: real extension, live Hacker News, local stand-in Provider (labelled as such in the run output) |
| 6 | the politeness ledger | measured Algolia traffic of every live phase, summed and compared to the ADR 0014 ceiling |

Standing OUTSIDE the battery, run on demand as fixed-defect regression harnesses: `e2e:rootfold` (F1's
shape made deterministic — a REAL local HTTP server issues a 301 held open 700 ms, ten cold profiles, all
ten must fold; §4a) and `e2e:kinds` standalone (the same 23 rows the sweep co-gates).

## 2. The numbers, twice (post-fix re-battle; the pre-fix numbers live in §4's entries)

| step | re-battery 1 | re-battery 2 |
|---|---|---|
| typecheck | 20/20 tasks | 20/20 tasks |
| unit suite | **1,328 passed** + 12 skipped, 11 workspaces | **1,328 passed** + 12 skipped |
| `pnpm e2e` | **56/56** · 30 Algolia req, peak 5/s, sustained 0.78/s · **+ 17/17 title race**, 0 live | **56/56** · 30 req, peak 5/s, sustained 0.78/s · **+ 17/17**, 0 live |
| sweep — front doors, 8 shards | **49/82 ok, 5 WRONG, 28 notes** | **46/82 ok, 6 WRONG, 30 notes** |
| sweep — page kinds, co-gated worker | **22/23 ok, 0 WRONG, 1 unmeasurable** | **22/23 ok, 0 WRONG, 1 unmeasurable** |
| sweep wall / wire | 174.4s · **487 req, peak 20/s, sustained 2.99/s** (budget 5) · 8 repeats free off the run LRU | 173.9s · **487 req, peak 18/s, sustained 3.0/s** · 8 repeats free |
| torture | **44/44**, then worker-death 7/7 ×4 — **5/5 reps clean** | **44/44**, then 7/7 ×4 — **5/5 reps clean** |
| store | 5 frames, all exactly 1280×800, no warnings · 11 req, peak 5/s, sustained 0.48/s | 5 frames, all 1280×800, no warnings · 11 req, peak 5/s, sustained 0.46/s |
| battery Algolia total | **528 requests** | **528 requests** |

Worst one-second window anywhere: 20 req/s (once, in re-battery 1's sweep). Sustained never exceeded
3.0 req/s in a sweep and ~0.8 req/s battery-wide — the ADR 0014 ceiling (~5 req/s sustained, all shards
combined) held both times, so no runner re-run was owed. Compared to the pre-fix batteries the sweep
total FELL from 505–507 to 487 twice over: P1/P3 no longer spend up to 10 requests on one navigation,
which was most of what the old peaks were made of, and the kinds worker's wire cost was **exactly 117
requests in three consecutive re-battle runs** (125 pre-fix on the 21-row corpus — the fixes' removed
double-spend, net of the two added rows).

### Every WRONG, named

Front doors, re-battery 1 (5): `openai.com` (showing 1), `github.com/login` (showing 8),
`doc.rust-lang.org/book/` (showing 2), `nytimes.com/section/technology` (showing 1), and the deep-linked
`en.wikipedia.org/wiki/Main_Page` (showing 11). Re-battery 2 (6): the same five plus `microsoft.com`
(showing 1). All six are ADR 0019's own accepted ledger, kept red on purpose (§6); `microsoft.com` is its
documented weak-margin member, whose HN linked count crosses zero between runs — in re-battery 1 it
certified quiet instead (via HN answering 403: "quiet certified for the answering Networks only", §5).
`en.wikipedia.org/` itself — F1's row — folded 11 in both re-batteries' shard visits and both kinds
visits. Page kinds: **zero WRONG in either re-battery.** The one non-ok kinds row both times is
`reddit-comments-page-live`, a note by the reconciled skip-list rule (§5), unmeasurable from this IP.

### The fixed-defect rows, on the wire, both re-batteries

- `consent-interstitial-chain` (P1): **4 requests, all four aliases of `/real/doc`** —
  `consent?continue` never on the wire (pre-fix: 10 requests including the interstitial in four alias
  variants plus a bare-host title query).
- `spa-transient-states` (P2): burst-final only, with its REAL title; `burst-1`/`burst-2` never queried
  (pre-fix: 15 requests, every transient minted).
- `youtube-watch-live` (P3): title query is the video's real title, `t=42` nowhere (pre-fix: the raw URL
  as a title query, 3 leaks in 5 runs).
- `alias-judged-live-wikipedia` (F1): folded 11, real title (pre-fix battery 2: 0 folded, 4 Main_Page
  alias queries with the traversed Alias never reaching judgement).
- `carrier-query-page-read` and `late-title-topical-refire` (§4c insurance): the carrier page still
  queried (query string intact, one burst), and the late title re-fired byte-stable
  (`Qzmvrw Corpus Late Title Piece 88012` on the wire as the topical query).

## 3. What moved between the re-batteries — and why it moved

The two-battery comparison is itself a measurement. Every divergent row, named:

- `microsoft.com`: ok(quiet certified, HN refusing) → WRONG(showing 1). HN's linked answer for this
  address genuinely crosses zero run to run — the same live-index volatility the pre-fix batteries
  recorded for the same row. Accepted-ledger member either way; not product movement.
- Notes 28 → 30: the live-world bucket ("nothing came back to judge" plus HN refusals) grew from 10 to
  12; the 16 skip-list notes and the 2 measured-on-another-page redirects (`bbc.co.uk`→bbc.com,
  `calendar.google`→workspace, `openai.com/pricing`→chatgpt.com among them) repeated.
- Everything else — 56/56 + 17/17, kinds 22/23 with the same single note, the six fixed-defect and
  insurance rows' wire shapes, 44/44 + 4×7/7, 5 frames, 487 sweep requests, 117 kinds requests, 528
  battery total — repeated exactly.

Also live-world, every re-battle run: **Algolia intermittently answered 403 to this box.** The same six
kinds rows (`iframe-embeds-discussed-page`, `shortener-hop`, `locale-root-live`, `spa-pushstate-served`,
`amp-shaped-with-foreign-canonical`, `cjk-idn-served`) drew "refused (forbidden)" panels in all three
runs while their queried/never-queried assertions still held on the request record, and several
front-door rows certified quiet through a refusal. That is ADR 0014's metering made visible after a full
day of batteries from one IP; the refusal render is itself a proven ADR 0011 state, the gate's sustained
rate stayed at ~3 req/s against the 5 budget, and the deterministic corpus order is presumably why the
SAME Lookups meet the limiter each run. A residential re-run of the kinds sweep would tell refusal from
anything systematic; nothing in the assertions rests on the refused answers.

## 4. Product defects — all four FIXED, with the evidence

The four defects the pre-fix batteries recorded are fixed at their mechanisms, each with a regression
check proven RED against the pre-fix code before the fix landed. What follows preserves each defect's
original wire recording as its "before".

### 4a. The ledger

**P1 — FIXED: a slow redirect interstitial was looked up and disclosed its query string.**
Before: a consent-shaped 302 chain slower than the 400 ms settle window minted a Reading at
`consent?continue=%2Freal%2Fdoc` — sent to Algolia in four alias variants plus a bare-host title query,
10 requests for one navigation, reproduced in every pre-fix run.
Mechanism (found with an instrumented worker, not guessed): the settle window was never consulted —
`tabs.onUpdated` TITLE events rode `Extension.activated`, and background's `following` called
`board.sight` per event, so Chrome stamping the interstitial with a placeholder host title minted it
directly. For interception-served 302 chains `webNavigation.onCommitted` never fires at all, so
`tabs.onUpdated` was also the only account of the destination.
Fix, four mechanism changes: (1) `Extension.ts` splits title events into a `retitled` stream —
corrections, structurally unable to mint; (2) background routes them to `Board.retitle`, which attaches a
title only to the Reading whose Subject the address names and drops everything else; (3) `WebExtApi`
relays `tabs.onUpdated` ADDRESS changes alongside webNavigation into the Sighting stream, so a destination
webNavigation never announces still settles through the debounce (ADR 0005: no silent false negative);
(4) `ReadingWatch` gains a redirect-carrier dwell — an address whose query VALUES carry another address
(URL/path-shaped, name-agnostic; `carriesAnAddress`) must hold 5 settle windows (2 s) before settling, so
a consent wall flashed past is interrupted by the next hop and never queried, while one the reader stays
on settles late rather than never.
Regression checks, proven red pre-fix: ReadingWatch "never mints a Reading for a carrier interstitial
slower than the settle window"; Background "does not mint a Reading from a mid-navigation title event".
After, on the wire (both re-batteries): the §2 consent row — 4 requests, destination only.

**P2 — FIXED: sub-settle pushState bursts defeated the debounce in the live wiring.**
Before: three pushStates 60 ms apart each minted a Reading and a full burst — 15 requests where ~5 were
owed. Same seam as P1: each transient's title event was a sight, so the unit-proven debounce was simply
bypassed in the live wiring. Fixed by the same split; the settle discipline is now the only minter.
After (both re-batteries): burst-final only, 10 requests for the whole scenario, transients never queried.

**P3 — FIXED, both halves: the Topical Lookup could fire with Chrome's placeholder tab title.**
Before: when the topical query beat `<title>` parsing, the "title" sent was the raw URL
(`title: youtube.com/watch?v=dQw4w9WgXcQ&t=42s`), re-leaking the `t=` the canonicalizer had stripped;
3 of 5 recorded runs leaked.
Wire half: a shared `isRealTitle` in `@parle/networks` (widened to catch the schemeless self-echo the
battery actually recorded) withholds the Topical Lookup as `no-title` — and the check now sits UPSTREAM in
the Enquiry, before any connector runs, so it also protects Reddit's title search; the HackerNews
connector guard stays as defence in depth. Four wire-guard regressions in `HackerNews.test.ts` prove no
request leaves.
Correction half (the ADR 0005 debt — withheld must mean "not yet", never "not at all"): a third
Initiative, `retitle`. `Enquiry.retitle` joins the live Enquiry via `RcMap.has`+`get` (never minting one)
and re-opens ONLY Places sitting at Withholding `no-title`; policy judges the re-ask `automatic`, so it
can never override an exclusion, a pause, or manual mode. The correction arrives three ways: the
`retitled` stream → `Board.retitle`, a same-Subject `Board.sight`, and a warm-rejoin sight. Reader
`insist` with the title still missing re-withholds rather than sending the address.
Regression checks, proven red against the wire-guard-only build (the shipped state before the correction):
`title.e2e.ts` fell to 11/17 — the 550/900/1500 ms visits ended with NO topical query at all, the exact
silent false negative — and `Retitle.test.ts` to 5/7. With the fix: 17/17 in both re-batteries, plus the
`late-title-topical-refire` kinds row live on the wire.
After: youtube row green in both re-batteries with the real video title.

**F1 — FIXED: ADR 0019's root-fold flickered with the network weather.**
Before: `en.wikipedia.org/` → `/wiki/Main_Page` folded both visits in pre-fix battery 1 and neither in
battery 2 — the `traversed` pre-redirect Alias missed the judgement in both of b2's cold profiles.
Mechanism, diagnosed not guessed: a server redirect is exactly two platform events —
`onBeforeNavigate(origin)`, then `onCommitted(destination)`, which never gets an `intended` of its own —
so the gap between the two hops in the chain is the WHOLE network round-trip, and the old traversed filter
(`hop.at >= settledAt - settleMillis`) kept the origin Alias only when DNS + TLS + the 301 fit inside
400 ms. Client-side chains were immune (the destination's own `intended` anchors the clock early), which
is why only the server shape flickered. MV3 restart was ruled out: both misses were single fresh
navigations on a just-armed worker, and pinning latency above the window reproduces the miss with no
restart anywhere.
Fix (`ReadingWatch.ts`): each hop records its birth cause and whether a document ever loaded there; a
pure-`intended` hop older than the window is kept iff its immediate successor was BORN from a load commit
— the unique signature of a server-redirect origin — under a 30 s `REDIRECT_PATIENCE_MS` backstop.
Staleness of an intended hop is decided by navigation SUCCESSION (abandonment), not by the network's
weather; loaded hops keep the strict window.
Regression checks: unit "keeps the origin of a server redirect that was slower than the settle window",
shown red against the pre-fix filter; and `e2e:rootfold` — a REAL local HTTP server behind
`--host-resolver-rules` answers `/` with a 301 held open 700 ms, Algolia/Reddit route-served (0 live
requests), ten cold visits (fresh profile, fresh worker, first-run re-answered each time), every one
required to show the toolbar's "site front page, N older discussions". Re-battle runs: **10/10 FOLDED**
(5 lookups each, the origin never queried — which also wire-proves the server-redirect origin cannot
leak); with only the succession clause neutered, **0/3 FOLDED, exit 1** — the pre-fix behaviour,
deterministically. Harness discovery recorded in the file header: a Playwright-fulfilled 301 is NOT a
server redirect (the follow-up request escapes interception and the destination loads as a second
navigation with its own `onBeforeNavigate`), which also bounds what the pre-fix P1 caveat — "proven with
Playwright-fulfilled 302s" — actually proved.
After: wikipedia folded in all four measured visits across the two re-batteries.

### 4b. Found BY the re-battle, in the reconciled seam — fixed the same hour

**The popup opened as a page drew "Still looking." forever.** Re-battery 1's first run: 55/56 — the
ADR 0011 check "says why it will not look a page up" found the looking transient instead. Mechanism: the
activated/retitled split removed an accidental cover. The popup-as-page's port carries its own tab, so
`Watch(null)` names that tab → `watch(named)` → an `unopened` Reading that nothing will ever sight — its
`chrome-extension://` address is refused by `isReadable` (so no boundary can sight it), and the
`onActivated` snapshot races `tabs.get` against the address landing and can lose; pre-split, the popup's
own title event re-sighted it by accident. Fix (`background.ts`): the `Watch` ask on a NAMED tab resolves
that tab's address once, iff its Reading is `unopened` — ask-driven, the same class of act as `follow`'s
active-tab resolution and the pill's `Sighted` (a surface's gesture may resolve where the reader is NOW;
events may only correct — the invariant the split exists for). Regression: `Background.test.ts` "resolves
a surface's own never-sighted tab when asked, instead of looking forever" — red against the pre-fix code
(1 failed / 11 passed), green after (12/12). The battery was then restarted from clean; the numbers in §2
are entirely from the fixed tree.
Residual, recorded: a panel FOLLOWING the reader beside a brand-new empty tab shows the looking transient
(not the excluded copy) until the reader navigates — event-driven paths may not mint, even the honest
refusal. Cosmetic, and preferred over re-opening the P1/P2 seam.

### 4c. The fixes' own failure modes, kept under tripwire

Both P1's dwell and P3's withholding trade an immediate action for a delayed one, and ADR 0005 bounds
both: a delay may never become a withholding. Two corpus rows added by the re-battle assert the postponed
Lookup HAPPENS — written from the ADR before their first run, green in both re-batteries:

- `carrier-query-page-read`: a REAL page at `…/landing?from=%2Fnewsletter%2Fjuly` the reader stays on is
  still looked up (one burst, ≤6 requests), 1.6 s later than an ordinary page.
- `late-title-topical-refire`: a page whose `<title>` arrives 900 ms late (script-set, no title tag) ends
  with the real title's own bytes as the topical query — the row the wire-guard-only build fails silently.

Residuals of the fixes, recorded deliberately (none is a defect; each errs the direction the ADRs chose):
an interstitial auto-redirecting SLOWER than the 2 s dwell is indistinguishable from a page being read and
IS looked up after it; a plain-address interstitial (no URL-shaped query value) still settles at 400 ms
and discloses only its own address; a bare-domain carrier value (`?domain=example.com`) is not
caught; a title landing in the microtask window between the no-title decision and its publish can miss
that one re-fire, leaving a VISIBLE `no-title` Withholding corrected by the next title event or the
reader's insist; a page whose real title IS its own bare domain loses only its Topical Lookup, with the
panel saying why; the retitle re-ask never overrides exclusion/pause/manual; an MV3 worker restart still
un-folds until the next navigation (ADR 0019's recorded decision, unchanged — restart was proven NOT to
be F1's mechanism); a commit whose `onBeforeNavigate` the platform never delivered could carry a stale
pure-intended hop, bounded by 30 s and by direction of error (traversed reaches only panelOf's fold, one
click to undo, never Enquiry); the origin of a slow CLIENT-redirect chain a document ran on still drops
out of traversed (folding it in would reward the consent-wall shape); Safari's `tabs.onUpdated` fallback
has no `onBeforeNavigate`, so no root-fold exists there at all.

## 5. Harness defects found across the runs

- **FIXED — the 24-way display-allocation race.** `xvfb-run -a` loses concurrent runs to a display race
  (`spike/steel/out/parallel-local-24/run-3.log`). `e2e/display.ts` now spawns Xvfb on explicitly chosen
  numbers and lets Xvfb's own atomic display lock arbitrate; losing costs one retry, not one run. Proof
  harness (`display.proof.ts`): 24 concurrent real launches, three times — 24/24 in 6.7s / 6.6s / 6.7s,
  zero "Missing X server" losses. The sweep owns a display per shard; serial runs still use `xvfb-run`.
- **FIXED — `judgeRedditNetwork` misfiled a deliberate exclusion as WRONG.** `reddit.com` is seeded on the
  Exclusion List (`packages/policy/src/Seed.ts`), so on the Network's own page no Lookup runs and there is
  no refusal TO render. The judge now files excluded-upstream as a note — a measurement that did not
  happen — and still marks the one ADR 0005 lie ("nobody has discussed this page") WRONG. The refusal
  render stays proven where refusals genuinely occur: the torture suite's served 403s — and now also the
  live Algolia 403s of §3.
- **FIXED — quiet-under-refusal now says what it certified.** Verdict details read "quiet certified for
  the answering Networks only" so a refusal can never quietly pass as proof of silence. (Landed after
  pre-fix battery 2; both re-batteries carry the annotation, and re-battery 1's `microsoft.com` row is it
  working.)
- **OPEN — `e2e/` is not typechecked.** `apps/extension/tsconfig.json` includes only `src/`, so the 20/20
  typecheck has never covered the harness; tsx strips types unchecked. The debt grew with the re-battle's
  three new harness files (`title.e2e.ts`, `rootfold.e2e.ts`, the corpus rows). Cheap to close; not
  closed today.
- **OPEN — the panel-read race may not be fully mitigated.** The kinds runner reads settle-until-stable
  because the topical answer (1 request) lands seconds before the linked one (4); pre-fix b2's wikipedia
  kinds row had the shape of a read that stabilised between the two. Documented in `kinds.e2e.ts`; not
  observed in either re-battery, but the mitigation is still heuristic.
- **Documented in-file (kinds runner):** a mid-run `context.route()` never returns after a page with its
  own service worker has loaded — hence the single up-front predicate route.
- **Instrumented:** `parle.e2e.ts`, `title.e2e.ts` and `store.e2e.ts` stamp their own Algolia requests
  and close with measured totals/peak/sustained, so no live phase reports politeness on faith. The sweep
  coordinator runs the kinds corpus as a co-gated worker (`SWEEP_KINDS=0` restores the pure front-door
  run) and merges every worker's wire stamps into one audit.

## 6. Where reality and the ADRs stand apart, deliberately

- The accepted front-door WRONGs are ADR 0019's own ledger, kept red on purpose: the §3/§4 refused
  widenings (`openai.com`, `microsoft.com`, `nytimes.com/section/technology` as n=1 rootish entrances;
  `github.com/login` as a deep-path entrance), `doc.rust-lang.org/book/` (two submissions agreeing at
  1.000 would not fold even if judged), and the deep-linked `/wiki/Main_Page` — "a reader who deep-links
  straight to `/wiki/Main_Page` still sees all eleven rows, and the sweep still records that row as
  wrong… uncertainty runs toward showing." The corpus is the tripwire that notices if any of these MOVE;
  greening them would disarm it. (The re-battle moved none of them: F1's fix reached the redirect-borne
  Alias only, exactly as ADR 0019 §1 scopes it.)
- ADR 0018 honoured on screen, both re-batteries: the 30-hit topical window draws ≤30 rows with no window
  note, and the 31-submission joelonsoftware census folds into "also submitted N times" with no note
  either (complete inside the 50-hit window).
- ADR 0012/0013 honoured: the HN item page is excluded from Lookup yet Harvest keys a Mention on the
  discussed article; paywalled NYT/WSJ pages are looked up by address through their 401/403 walls with
  worker traffic only to the Networks; iframes never produce a Reading; fragments never reach a query; a
  page's own `rel=canonical` is never trusted; IDN/percent-UTF8 addresses are byte-stable and found live.

## 7. What this battery still cannot see — unsparingly

- **Real Safari and real iOS interaction.** The Safari-shaped build takes the genuine Safari branch (no
  `sidePanel` permission → feature-detected in-page overlay, measured on both builds before being relied
  on) — in Chromium. CI now also runs Apple's packager and compiles both generated containing apps, but
  compilation is not interaction: WebKit layout, WebKit extension lifetime, the iOS memory ceiling and
  Lockdown Mode still need Safari plus a simulator/device. (F1's fix widens this gap's cost a little:
  the Safari fallback has no `onBeforeNavigate`, so no root-fold exists there to test.)
- **Real Reddit.** This box's IP is 403'd on every Reddit surface. The refusal path is proven against
  served 403s only; the reddit-comments Harvest half is unmeasurable from here (recorded as interference,
  never a verdict); and "Nobody has discussed this page" is literally unreachable on this box. Needs a
  residential IP. The P3 upstream guard now also covers Reddit's title search — proven at unit level
  only, for the same reason.
- **Real Provider.** Every Digest ever produced by this battery was written by `e2e/provider.ts`, a local
  OpenAI-compatible SSE stand-in. No paid endpoint, no ChatGPT session, no on-device model. Store shot 05
  carries the same caveat in its own run output.
- **X.** The battery only ever asserts X is NOT contacted. The connector's live behaviour has never been
  exercised from here.
- **Torture's politeness is by construction, not wire-audited** — its Algolia/Reddit are route-served
  in-process, but no CDP observer double-checks that suite the way both sweeps are double-checked. The
  same is true of `title.e2e.ts` and `e2e:rootfold`.
- **The server-redirect shape is wire-real for two hops, fulfilled-only for three.** `e2e:rootfold`
  retires the old "P1 proven with Playwright-fulfilled 302s" caveat for the two-event server shape: a
  real socket, a real 301, and the origin never queried. What remains fulfilled-only is the THREE-hop
  consent chain with a mid-chain interstitial — on a wire-real chain the interstitial's address may only
  ever be seen by `tabs.onUpdated` mid-flight, a shape the carrier dwell covers by design but that has
  not been measured against a real server from this box.
- **The N=1/4/16 comparison matrix** on the pinned corpus was interrupted and never resumed; N=8 is the
  measured point, alongside the 16-way spike (320 pages, 18.8s) and the 3×24/24 display proof.
- **Live-world noise is load-bearing.** Several rows per sweep answer "nothing came back to judge", HN's
  linked counts for weak-margin addresses cross zero between runs — and, new today, Algolia itself
  intermittently 403s this box after a day of batteries (§3), so even served-fixture rows can render a
  refusal. The pin freezes addresses, not the world; §3 is the honest cost.
- **The e2e typecheck gap** (§5) until someone widens the tsconfig.
- **What a green table does not claim:** these checks read drawn text, wire traffic, and disk truth — not
  pixels. `.e2e-shots/` and `store/screenshots/` exist so a human still looks at what shipped.

## Appendix: artifacts and how to re-run

Per battery: `.e2e-sweep/run.json` (merged rows, rates, per-shard stamps, kinds verdicts),
`.e2e-shots/frontdoor-sweep.json` and `kinds-sweep.json` (every verdict with its recorded queries),
`.e2e-shots/*.png`, `store/screenshots/*.png`. The re-battle's copies of both batteries' artifacts and
every step log live under the session scratchpad (`rb1-artifacts/`, `rb2-artifacts/`, `rb1-*.log`,
`rb2-*.log`, with the aborted first attempt preserved as `rb0-diagnostic-*`); the pre-fix batteries'
copies remain beside them (`b1-artifacts/`, `b2-artifacts/`).

The battery, by hand, in order:

```bash
pnpm --filter @parle/extension e2e:clean
pnpm typecheck && pnpm test
pnpm e2e
cd apps/extension
SWEEP_SHARDS=8 SWEEP_RESOLVED=/path/to/corpus-pinned.json pnpm run e2e:sweep   # SWEEP_KINDS=0 for the pure front-door run
pnpm run e2e:torture
for r in 2 3 4 5; do TORTURE_ONLY="worker death" e2e/run-browser.sh pnpm exec tsx e2e/torture.e2e.ts; done
pnpm run e2e:store
# the fixed-defect harnesses, on demand:
pnpm run e2e:rootfold            # F1: ten cold visits, all must fold (ROOTFOLD_VISITS=3 for a quick look)
pnpm run e2e:title               # P3: the title race, hermetic
```
