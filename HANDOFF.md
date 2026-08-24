# Parle — handoff

Written 2026-08-11 for whoever picks this up next, agent or person. It assumes you have the repo and
nothing else. Read `CONTEXT.md` before you write code and `docs/adr/` before you argue with a decision.

---

## 1. What this is

A browser extension that tells you what the internet already said about the page you are reading.
You open a page; it asks Hacker News and Reddit whether anyone posted that address; a small mark appears
**only if something was found** — a stack of Network discs (HN / Reddit / X) you can drag anywhere,
defaulting to the top-right; clicking it opens a compact panel with one destination per Network,
the busiest conversation first and a small picker when that Network has more than one,
each themed like the Network it came from, and the busiest one is already open so you can read what
people actually said without leaving.

With your own AI key it also writes a **Digest** — a summary where every claim links to the comment it
came from, and a claim that cannot cite one *cannot be constructed* (see §6).

The goal, in the owner's words, is to make the web *"a lot safer to browse and a lot more thoughtful."*
The v2 feature — select a passage, fact-check it against what people said — is designed
([ADR 0008](docs/adr/0008-design-both-features-ship-discovery-first.md)) and not built.

**Constraints that are decided, not open:** no backend required, no login required, open source
(AGPL-3.0), Chrome + Safari/iOS + Firefox from one MV3 codebase, and the client works fully alone —
a backend, when it exists, may only make things *faster*, never *possible*
([ADR 0011](docs/adr/0011-the-client-is-autonomous-the-backend-is-an-accelerator.md)).

---

## 2. Where it stands, verified

```
main @ 0ea9779 · ziahamza/parle-extension
1,273 unit tests · 20/20 typecheck · e2e 73/73 · torture 48/48 · 22 ADRs
```

Working and proven in a real browser: discovery against live Hacker News; Reddit (verified from the
owner's residential IP — see §5); the consent gate that provably blocks all traffic until answered; the
mark, the in-page panel on both Chrome and the Safari-shaped overlay; readable conversations; the front-door
fold; harvest; settings, skip list, per-site pause; the Digest end-to-end against a local stand-in
Provider.

**Two guarantees have been proven under abuse rather than asserted:**

1. Killing the MV3 service worker mid-Enquiry **ten times** never bought a second request budget. The
   Lookup Record writes intent *before* the request precisely so a worker that dies mid-flight cannot
   make the next lifetime pay again.
2. A fabricated or uncited Digest claim cannot be constructed — see §6.

---

## 3. Getting running

```bash
pnpm install
pnpm check                         # typecheck + tests: 20/20, 1,273 unit tests
pnpm build                          # → apps/extension/.output/chrome-mv3
```

Load `apps/extension/.output/chrome-mv3` at `chrome://extensions` → Developer mode → Load unpacked.
`qa/chrome-mv3-latest` carries `parle-chrome-mv3.zip` and `BUILD.txt`; see README. **Read `BUILD.txt` before using the zip** — it names the commit and the package version that produced it, which is the only way to know whether the branch is current. It is refreshed by a green `main` publish and by nothing else; §4 trap 8 is why that sentence is worded so carefully.

### End-to-end testing — this is the part you were handed for

Everything runs **real Chrome** with the real extension loaded, driven by Playwright. The launcher uses
Xvfb when it is available and the visible browser on macOS; Chrome 151 ignores `--load-extension` in
headless mode, so these cannot be honest headless checks. Not jsdom, not mocks. From `apps/extension/`:

The normal gate lives in `.github/workflows/ci.yml`: pushes to `main`, pull requests, and manual runs
split quality/package checks, the 73-check browser suite, the 48-check torture suite, and a real Apple
packaging job across GitHub
runners. Local runs are for focused development and manual Chrome QA, not for repeatedly paying the
whole regression cost on a contributor's machine. `.github/workflows/release-readiness.yml` is the
on-demand store-artifact job; it emits the upload zip and five audited 1280×800 screenshots.

| command | what it is |
|---|---|
| `pnpm e2e` | **the gate.** 73 behaviour checks: consent-before-anything, what went on the wire, what is on disk, the mark, the in-page panel on every surface, adaptive navigation geometry, the Digest, the Safari-shaped overlay |
| `pnpm e2e:torture` | 48 adversarial checks — compact nested/flat/deep-handoff interactions, worker death mid-flight, rapid navigation, two tabs one page, settings flipped mid-flight, storage full/corrupt, offline, a hostile page that overrides `attachShadow`, clock skew |
| `pnpm e2e:sweep` | the relevance sweep, 8 shards + a page-kinds worker behind one shared politeness gate |
| `pnpm e2e:kinds` | 23 page *shapes* — redirect chains, SPAs, AMP/canonical, paywalls, IDN, Trusted-Types, iframes |
| `pnpm e2e:rootfold` | 10 cold visits, 10 folds — the intermittency regression |
| `pnpm e2e:walk` | **browses and photographs, asserting nothing.** Frames land in `.e2e-shots/walk/` for a human to look at |
| `pnpm e2e:store` | regenerates the store screenshots |

**`apps/extension/e2e/BATTLE.md` is the system of record** for what the battery covers, its measured
numbers, every defect it has found, and — §7 — an unsparing list of what it still *cannot* see. Read §7
before you claim anything is verified.

**Politeness is a hard constraint, not a nicety.**
[ADR 0014](docs/adr/0014-no-network-oauth.md): Hacker News' Algolia limit is per-IP and the IP is
**the reader's**. The sweep enforces ~5 req/s across all shards through one token bucket. A naive
16-way parallel sweep issues ~90 req/s from one address, which is both abusive and how you get the
development box blocked — which then takes all future QA down with it. This has already happened
partially: Algolia intermittently 403s the dev box after a heavy day.

---

## 4. The traps — do not re-learn these

Each cost real time. They are in the code comments too, but here is the short list.

1. **A green test suite proved nothing once already.** 860 unit tests passed while the extension
   registered **zero listeners** in a real browser. `Effect.scoped(serve)` closed the scope the instant
   the generator returned, interrupting every forked child before it ran an instruction — and the fiber
   exited `Success`, so there was no error anywhere. The five subscriptions in
   `entrypoints/background.ts` are the *body* of an `Effect.all`, not `forkScoped` off the end. **Do not
   "tidy" that.**
2. **Chrome keeps the registered background script in the profile.** Reloading an unpacked extension at
   the same version does not replace it, so a run can pass against code that no longer exists. The
   harness deletes the profile's Service Worker directory before every launch.
3. **Vacuous checks are this project's recurring failure.** Four separate times a check passed while
   observing nothing: a dropped CDP `sessionId` made a traffic observer report zero requests while
   looking healthy; `statement.trim() === ""` did not strip zero-width characters, so a blank Finding
   rendered with a live citation. **Every regression check must be proven RED against the pre-fix code** —
   stash the fix, watch it fail, restore. This is not optional here.
4. **Historical, and kept because it will come up again if a native surface is ever revisited:**
   `chrome.sidePanel.open()` needed a real user gesture and had to be called synchronously — moving it
   into an Effect fiber broke it, and `trustedClick` in the harness was the only click that proved it.
   Chrome now uses the in-page panel on every surface, so nothing in the tree calls it.
5. **Playwright's default viewport pins `innerWidth`.** This mattered for telling a real side panel from
   an overlay (*does the article's viewport shrink?*), which read false against a working panel. Launch
   with `viewport: null` — still the right default for any geometry assertion.
6. **The panel's shadow root is closed.** Reach it with CDP `DOM.getDocument({pierce: true})`.
7. **Effect v4 beta (`4.0.0-beta.105`) differs materially from v3**, which is what all published material
   describes. No `Effect.Service`, `Context.Tag`, `Layer.scoped`, `Either`, `Stream.async`,
   `Schema.filter`, `Schema.Literal(a, b)`. Use `Context.Service<Self, Shape>()(...)`, `Effect.fn`,
   `Layer.effect`, `Schema.TaggedUnion` / `Schema.Literals`, `Result`. Deep imports only.
8. **A branch can be stale for its whole life without anyone noticing.** `qa/chrome-mv3-latest` is
   published by CI — except the step had no push credentials from the day it was written, so it
   never once succeeded. The job went red every time; nobody was reading that job, and `HANDOFF`
   and `README` both described the branch in the present tense, so the failure was loud and the
   lie was quiet. The receipt sat at `3.0.1` / `9f4c395` / 2026-08-17 — a zip pushed from a laptop
   — while the store had 3.1.0 in review, and anyone following the README's "latest main package"
   instructions got the wrong build.

   Two things came out of it. `BUILD.txt` exists so a stale artifact is detectable rather than
   plausible, and it is now the thing both documents tell you to read. And "the pipeline works" is
   not a claim any document can make on its own: it is only true of a path that has run green,
   which is why §3 says a green `main` publish and not "CI publishes".

---

## 5. Blocked on a human — the critical path

Nothing below can be done by an agent on the development box.

1. **Done, and now half of it lives here.** The website is live: `/parle`, `/parle/support` and
   `/parle/privacy` all answer 200, which is what the store requires. `store/check-listing.ts`
   fetches all three anonymously on a schedule, so this stops being something anyone has to
   remember.

   **`/parle` is now built from this repo** — `apps/site`, `pnpm build:site`, output in
   `apps/site/dist`. `/parle/support` and `/parle/privacy` are still served by
   `ziahamza-org/website`, and they are what the store listing links to.

   **The trap:** deploying `apps/site/dist` *over* `/parle` as a directory drops its two siblings,
   the scheduled check goes red, and the listing points at two 404s. Whatever publishes this must
   either write only `/parle/index.html` and its assets, or keep the Worker routes for
   `/parle/support` and `/parle/privacy` ahead of the static handler. Verify with
   `pnpm lint:listing` (or `node store/check-listing.ts`) after any deploy, not before.
2. **Done, 18 August 2026.** Item `bbigpojahnmkdbdnbcmadnhbjlemibom` is **published and public** —
   the MV2 takedown is over and the V3 revival was accepted, ratings and history intact. Releases are
   now automated: bump `apps/extension/package.json` and a push to `main` builds, audits, uploads and
   submits. See **`store/RELEASE.md`**. `store/SUBMIT.md` is the record of the first submission, not a
   procedure to repeat. The listing text and screenshots have no API and are still a manual paste —
   **`store/LISTING.md`**.
3. **iOS/Safari on real hardware.** Never run. Needs a Mac (the owner has one) and an Apple Developer
   account. `docs/adr/0003` makes iOS the constraining platform, so this is where the nastiest surprises
   are: WebKit layout, extension lifetime, the memory ceiling, Lockdown Mode.
4. **Reddit from a residential IP.** *Confirmed working* by the owner on 2026-08-11 — a "Reddit" tab
   appeared beside Hacker News. Everything Reddit-shaped in the automated battery is still proven only
   against served 403s, because the dev box is blocked. Re-verify any Reddit change on a real IP.

---

## 6. The two invariants that must not be weakened

**The citation invariant.** `Brief` is supplied to the decoder as a service, so
`admit: (raw) => Effect<Digest, SchemaError, Brief>`. There is no way to decode model output without
producing the material it was supposed to be reading. Three of four independently designed domain models
had a version of this that a fabricating Provider satisfied trivially — a check closing over the
payload's *own* source list is satisfied by a model that fabricates a source *and* a citation naming it.
A contested Finding must additionally cite an **identified comment**, not a whole Discussion.

**ADR 0005 — a silent false negative is the failure this project refuses.** A mechanism that hides a
Discussion is worse than one that costs a request, because the reader cannot complain about what they
never saw. This is why `LookupPolicy` returns a `Withholding` carrying a reason rather than a boolean,
why the front-door rule *folds with a count* rather than deleting, and why a filled retrieval window is
reported as "at least N" rather than as a total. When you are tempted to hide something to make the
panel tidier: don't, or make it foldable and counted.

---

## 7. Where this is heading

### Immediately actionable, no human needed

- **The backend track is entirely unstarted.** `apps/pipeline/` is an empty directory. This is the
  largest available piece with zero human dependency:
  - **Discussion Index** — a prebuilt, sharded, client-downloadable index of which URLs have been
    discussed, so the client can skip lookups it knows are pointless. Binary fuse filter, not bloom.
    Design question open: architecture, cadence, infrastructure.
  - **Shared Digests** — pre-written Digests for popular pages so a reader with no AI key still gets one
    ([ADR 0007](docs/adr/0007-shared-digests-are-gated-by-popularity.md)). Open: the popularity
    threshold, the cost model and its guardrails, change detection, and abuse bounds on the on-demand
    path. Must be tunable from artifacts without shipping a build.
  - Both are **accelerators only** (ADR 0011). If the index is absent, stale, or wrong, the client must
    behave exactly as it does today.
- **The Digest prompt** has never been evaluated against real models — only against a local stand-in.
  Open: the prompt, the output schema, and input selection.
- **Spread** ([ADR 0009](docs/adr/0009-audience-spread-not-outlet-ratings.md)) — audience spread, *not*
  outlet bias ratings. Named in the glossary, not built. Open: what it computes, when it is shown at
  all, and how to present it without misleading.
- **Fact-check (v2)** — select a passage, check it against what was said. Designed in ADR 0008; the
  Provider seam already carries the streaming multi-turn capability it needs.
- **Ranking and panel IA** — the tab strip is new and unevaluated. Open: the ranking function.
  Specifically unjudged: whether "busiest" is the right default tab, and whether `Hacker News · 432` is
  the right label.

### Known imperfect, with the evidence recorded

- The front-door rule's remaining misses are named in
  [ADR 0019](docs/adr/0019-aliases-are-judged-and-a-launch-is-not-a-front-door.md), each with the
  measurement that made widening the rule cost more than it bought. **Do not re-propose those widenings
  without new measurement** — several have already been refused twice.
- `packages/index-codec` exists and is tested (103 tests) but nothing produces an index for it to read.

---

## 8. What "production" means here

- **Distribution:** Chrome Web Store (**published**, v3.0.0 live, releases automated), then Firefox AMO,
  then the App Store for Safari/iOS. All from one MV3 build.
- **Hosting:** `ziahamza.com` on Cloudflare Workers — product page at `/parle`, privacy policy at
  `/parle/privacy`, support at `/parle/support`. Required by the store, and `store/check-listing.ts`
  fetches all three anonymously on a schedule so a rotted URL is found before a reviewer finds it. **`parle.co` was lost** and is not recoverable; the
  rename question is deferred (`.com`/`.ai`/`.dev`/`.app` are all taken).
- **The backend, when it exists:** Cloudflare Workers, infrastructure defined with Alchemy
  ([ADR 0002](docs/adr/0002-stack-effect-v4-alchemy-wxt-cloudflare.md)). Not yet used.
- **What production does NOT mean:** any user account, any identifier, any analytics, any telemetry.
  There is no server to receive them and that is a product decision, not an omission.

---

## 9. Where the rest of the thinking lives

- **`.scratch/parle-mvp/issues/`** — 19 design tickets. Each states a question, the constraints on it,
  and (where resolved) the answer and what it cost. The 11 still open are the source of §7. These were
  local-only until this handoff; they are tracked now because several contain measurements that would
  otherwise have to be redone.
- **`.scratch/parle-mvp/research/`** — the long-form material behind the resolved ones, including the
  four-lens domain-model panel that produced the citation invariant, and the relevance QA sweeps.
- **`.scratch/everlasting/`** — the 228-page corpus (`everlasting-dataset.json`) plus the scripts that
  gathered and analysed it. This is what the front-door rule and the repeat-fold were fitted and
  refused against. **Re-measure here before proposing a relevance change.**

Note `.gitignore` still excludes `.scratch/` in general — these paths are tracked explicitly, so new
scratch files stay out unless you force-add them too.

- **Not in the repo, and not recoverable by an agent:** any Reddit-verified automated test (see §5.4),
  and any evidence about real Safari/iOS.

---

## 10. How this project works, as a matter of practice

Worth stating because it is the reason the code is the shape it is, and deviating from it will produce
work that gets reverted.

- **Decisions are measured, not argued.** Several plausible ideas were *refused on evidence*: temporal
  bounding of discussions (carried no information); a flat substance floor for filtering noise (folds
  real pages at the same rate as junk); a generic-path word list (folds more of what readers came for
  than what they didn't). When you propose a rule, measure it against the corpus first, and record what
  it costs when you ship it.
- **ADRs record what was refused and why**, not only what was chosen. Two ADRs (0012, 0018) correct
  *earlier ADRs* on evidence. That is the intended pattern.
- **The reader-facing vocabulary is binding.** Only Discussion, Digest, Finding, Spread and Provider may
  appear in the UI. `render.test.ts` greps the rendered DOM to enforce it. Everything else in
  `CONTEXT.md` is how the code talks about itself.
- **The most valuable bugs came from a human looking at a screenshot.** The front-door rule exists
  because someone said "facebook.com shouldn't show that". The title search was deleted because someone
  said the caption under it read badly. No test produces those. `e2e/walk.e2e.ts` exists to make that
  kind of looking cheap — use it, and put screenshots in front of a person.
