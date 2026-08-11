Implemented, then swept in a real Chrome. **`pnpm typecheck` 20/20 · `vitest` 1,271 passed (was 1,162) · `wxt build` 403 KB · `pnpm e2e` 56/56.**

## What shipped

| file | what |
|---|---|
| `/home/hzia/repos/parle/packages/policy/src/FrontDoor.ts` | the rule — pure, no I/O, 37 tests |
| `/home/hzia/repos/parle/packages/memory/src/FrontDoorMemory.ts` | the negative memory, 12 tests |
| `/home/hzia/repos/parle/packages/domain/src/Gate.ts` | `mayAskX(coverage, impetus, standing?)` + `front-door` literal in `Coverage.ts` |
| `/home/hzia/repos/parle/apps/extension/src/view/panelOf.ts` | verdict + fold at panel assembly |
| `/home/hzia/repos/parle/apps/extension/src/view/render.ts` | the fold, drawn on both surfaces |
| `/home/hzia/repos/parle/apps/extension/e2e/frontdoor.e2e.ts` | the sweep (`pnpm --filter @parle/extension e2e:frontdoor`) |
| `/home/hzia/repos/parle/docs/adr/0017-front-doors-fold-old-discussions-and-are-remembered.md` | the decision |

Rule as built: `isRootish(address) AND (meanPairwiseTitleJaccard ≤ 0.35 OR any title reports an outage)`, applied only to Discussions **older than 30 days**, folding rather than deleting. Memory: `{because, rulesVersion, judgedThrough, judgedAt}`, keyed on the host, **concealed through `OpaqueKeys`** — a verdict is only ever written after an Enquiry, so the set of them is a list of sites the reader opened; `Recollection` keys plaintext for the opposite reason. It gates Topical Lookups and X's stale evidence, **never a Linked Lookup**.

I re-measured the rule against live Algolia (the exact connector query) before wiring it. Confirmed: sicpdistilled 0.400 vs a 0.35 threshold — the 0.05 margin is real. Also found and fixed a live-only divergence the parent's full-retrieval numbers hid: **`duckdb.org` 0.231, `bun.sh` 0.250, `zed.dev` 0.230, `tailwindcss.com` 0.315, `obsidian.md` 0.187** — product landings that fire in production and would not on full retrieval. I did **not** re-tune on a 40-page spot check; it is recorded in ADR 0017 as a known cost.

---

# QA sweep — real Chrome, 82 pages

Screenshots in `/home/hzia/repos/parle/apps/extension/.e2e-shots/` (`front-door-github{,-opened}.png`, `front-door-cloudflare{,-opened}.png`, `classic-grugbrain.png`, `classic-greatwork.png`, `front-door-{facebook,bankofamerica}.png`). Raw rows: `.e2e-shots/frontdoor-sweep.json`.

**53 as expected · 8 wrong · 21 unjudgeable.** Two harness bugs of mine had to be fixed first — the popup opened as a page carries `sender.tab`, so it reports *itself* (first two runs said "not a public web page" for all 27 HN links); and `renderAside` draws the page surface when rows exist, which has no "N discussions" sentence to scrape. Both are noted in the file.

### 1. Hacker News front page — 27 links, 27 hosts, **0 regressions**

Every one showed its Discussions. Nothing folded, nothing lost. `w3.org/Provider/Style/URI` 7, `theatlantic.com` 3, `youtube.com` 3, rest 1–2.

### 2. Reddit — **1 wrong**

| URL | expected | actual | verdict |
|---|---|---|---|
| `old.reddit.com/r/programming` | refused | **not asked — on the skip list** | **WRONG vs. the brief** |
| about.gitlab.com | quiet | **refused (forbidden)** | ok |

Reddit-the-page never reaches a Lookup — it is on the Exclusion List as a social feed, so it renders as a *Withholding* with a reason, not a Refusal. **Reddit-the-Network does 403 and does render as a Refusal**: on `github.com` and `microsoft.com` the account reads `Reddit · by address — refused us`. So the promise holds, but not on the page the brief named. I did not "fix" this — the Exclusion List getting there first is correct behaviour, and the brief's assumption was wrong.

Reddit's front page 403s from here, so its links could not be scraped; I used a hand-picked r/programming-shaped list instead and said so in the file. 4 of 8 returned nothing at all (`blog.rust-lang.org/…/Rust-1.81.0.html`, `sqlite.org/whybytecode.html`, `arstechnica.com`, `theguardian.com/…/crowdstrike-outage`, `jvns.ca`) — the top-50 retrieval window, not this rule.

### 3. Pages that should show nothing — **7 wrong**

**Folded correctly:** github.com (6), cloudflare.com (9), amazon.com (7), apple.com (5), python.org (3), archive.org (3), nytimes.com (1).

**Still showing — every one, named:**

| URL | showed | why |
|---|---|---|
| `en.wikipedia.org/` → `/wiki/Main_Page` | **11** | redirects to a deep path; not rootish, never judged. "Wikipedia Is Down?", "Wikipedia is blacked out", "Wikipedia gets major redesign" — a textbook front door the rule cannot reach. **The worst miss in the sweep.** |
| `github.com/login` | 8 | deep path. 12 exact submissions, all ≤6 points, none about the login page |
| `openai.com/pricing` | 2 | deep path |
| `doc.rust-lang.org/book/` | 2 | deep path; arguably a real document (both titles "Rust Programming Language Book", 220 pts) |
| `nytimes.com/section/technology` | 1 | deep path |
| `openai.com/` | 1 | rootish, but n=1 — one submission cannot disagree with itself |

The four deep-path rows are the measured decision not to ship a generic-path word list (it costs `up.codes/careers`, a real page with 22 submissions). Wikipedia is not covered by that decision — it is a **redirect** to a deep path, and it is the case I would fix next.

**Quiet for a reason that is not this rule (7 rows):** `facebook.com`, `bankofamerica.com`, `google.com`, `wellsfargo.com`, `chase.com`, `linkedin.com`, `instagram.com`, gmail/calendar/docs/accounts, `stripe.com/pricing`, `reddit.com/r/programming`, `news.ycombinator.com/newest` — **all on the Exclusion List**. The product owner's two headline examples never reach the front-door rule at all. Worth knowing before this is credited with them.

**Quiet because nothing came back (6):** `netflix.com`→`/fi-en/`, `microsoft.com`→`/de-de`, `gitlab.com`→`about.gitlab.com`, `stackoverflow.com`→`/questions`, `npr.org`, `theverge.com`. Five of six are **redirects to a different Subject**; netflix.com has two "Netflix is down" submissions that the redirect makes unreachable.

### 4. Classics — **7/7 intact**

paulgraham greatwork **7**, ds **6**, genius **4** · danluu empirical-pl **4**, everything-is-broken **3** · **grugbrain.dev 4** · **sicpdistilled.com 4**. Both rootish classics — the two the 0.05 margin protects — render in full. Screenshot `classic-grugbrain.png`.

### Bug found in the browser and fixed

`github.com` printed the fold's whole sentence **twice**: `summaryOf` falls through to `panel.folded.says` when nothing is showing, and `foldedNode` drew it again. Fixed in `render.ts`, regression test added (`render.test.ts`, "said once"). Also fixed the toolbar tooltip, which said "Parle — nothing found" on a page holding six Discussions; it now reads "site front page, 6 older discussions".

The fold itself was verified end to end: clicked in a real browser, rows became visible, **zero requests** behind it.

---

## What I would not claim

- **The safety evidence is 35 rootish real pages**, 27 of them with one submission. Seeding Show HN homepage launches is the highest-value follow-up.
- **The retrieval gap is bigger than this rule.** 4 of 8 known-discussed pages and 6 front doors returned nothing because of the top-50 window. It is an undisclosed silent false negative on both sides and deserves its own ADR-0005 reckoning.
- `apps/extension/{wxt.config.ts,e2e/harness.ts,e2e/provider.ts,package.json}`, `public/`, `store/`, `e2e/store.e2e.ts` carry in-flight work from another session. My only edits there: `package.json` gained `e2e:frontdoor`, and `e2e/parle.e2e.ts` gained `NAMED_ROOTS` (the storage-roots check now names `parle/frontdoor/` and `parle/memory/salt`, and the settings copy names them to the reader — the check went red first, correctly).