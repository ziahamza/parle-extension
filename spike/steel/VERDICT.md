# Steel, measured against the harness we have

**Verdict: keep the home-grown harness. Do not adopt Steel, and do not run it alongside.**

Not because Steel failed. It passed every question that could have killed it — the MV3 background
service worker is reachable and `evaluate`-able, the unpacked build loads with its content scripts and
its side panel, service-worker network traffic is observable, and the closed shadow root is readable.
Every technique in `apps/extension/e2e/harness.ts` ports, including the two hard ones.

It is because of what the passes are made of. Everything that worked, worked through **raw Chrome
DevTools Protocol on port 9223** — Chrome's protocol, not Steel's product. Steel's own contributions to
this use case are a Docker image with Chromium in it, an extensions-by-name loader, and a session API
whose profile isolation is broken in a way that costs us the single guarantee this harness was built to
provide. Against that we would pay roughly half our concurrency, ~650 MB per worker, and the loss of a
three-line safety net.

The measurements are in `spike/steel/out/`. `spike/steel/run-all.sh` re-runs all of them.

---

## 0. What the harness actually delivers

Read before judging, not assumed. `apps/extension/e2e/harness.ts` (582 lines) and
`apps/extension/e2e/parle.e2e.ts` (860 lines, 56 checks) between them depend on the following. This
is the list any replacement has to satisfy.

| # | Capability the suite depends on | Where it lives | Steel | Evidence |
|---|---|---|---|---|
| 1 | MV3 background worker reachable; `worker.evaluate()` runs code inside it | `harness.ts:215-232` | yes | `out/q1-worker.txt` 6/6 |
| 2 | Listener liveness — `chrome.webNavigation.onCommitted.hasListeners()` etc. | `harness.ts:227-247` | yes | `out/q1-worker.txt` |
| 3 | Worker console + `pageerror`, attached **before** the worker's first turn | `harness.ts:206-215` | yes | `out/q6-bootlog-*.txt` (new, below) |
| 4 | `caches.open("parle")` read from inside the worker (`storedKeys`) | `harness.ts:263-270` | yes | `out/q1-worker.txt` |
| 5 | Unpacked MV3 loads; declared content script gets its isolated world | `harness.ts:180-185` | yes | `out/q2-extension.txt` |
| 6 | `chrome.sidePanel` permission survives; `getContexts({SIDE_PANEL})` | `harness.ts:356-360` | yes | `out/q2-extension.txt` |
| 7 | Trusted click → transient activation → `sidePanel.open()` accepted | `harness.ts:471-480` | yes | `out/q2-extension.txt`, `out/q4-shadow.txt` |
| 8 | `viewport: null`, so the article's own viewport shrinks beside the panel | `harness.ts:127`, `parle.e2e.ts:504-531` | yes | `out/q2-extension.txt` — 1279px → 893px |
| 9 | A second CDP client adopts the side-panel document | `harness.ts:373-389` | yes, same workaround | `out/q2-extension.txt` FAIL → `out/q2b-panel-adopt.txt` PASS |
| 10 | Closed shadow root: `count`/`text`/`textOf`/`styleOf` (computed)/`boxOf`/`attribute`/`roots` | `harness.ts:482-574` | yes | `out/q4-shadow.txt` 11/11 |
| 11 | Every outbound request, **including the worker's**, for presence *and absence* | `parle.e2e.ts:77-86` | yes via CDP; **not** via Steel's own logs | `out/q3d-decisive.txt` 7/7 |
| 12 | `context.route()` fulfilment (the served `ARTICLE`, `QUIET`, `ELSEWHERE`) | `parle.e2e.ts:467-477` | yes | `out/q3d-decisive.txt` |
| 13 | Two builds in one run, each with its own profile (`chrome-mv3` + `safari-mv3`) | `parle.e2e.ts:217-301` | needs two containers | one container is one browser — §2 |
| 14 | **A fresh service-worker registration every launch** | `harness.ts:169-172` | **no** | `out/stale-worker.txt` FAIL, `out/q3e-isolation.txt` FAIL |
| 15 | **A first-run profile (`decided: false`) — 3 checks are about the un-consented state** | same three lines | **no** (same cause) | as above |
| 16 | The browser reaching a stand-in Provider on this host's loopback | `e2e/provider.ts`, `parle.e2e.ts:618-771` | **not measured** — container networking | — |
| 17 | Screenshots that include browser chrome (`import -window root`) | `store.e2e.ts`, `shots.e2e.ts` | **not measured** — X lives inside the container | — |

Rows 1–12 are the interesting ones and they all port. Rows 14–17 are the answer to the question.

### The new measurement in this write-up

Row 3 was the one capability the spike had not isolated, and it is the one `harness.ts` spends a
paragraph on: handlers are attached *before* `waitForEvent("serviceworker")` because "a worker that
throws during startup does so within milliseconds of being created". On Steel the harness cannot exist
before the extension does — Chrome is launched inside the container by `POST /v1/sessions`, and the
earliest a client can connect is after that call returns. That looked like a structural gap, so it was
measured rather than asserted (`spike/steel/q6-bootlog.mjs`, against the `parle-marked` fixture whose
`background.js` opens with a `console.info`):

```
$ xvfb-run -a node q6-bootlog.mjs local
  local: listening=true, log=["[info] PARLE-BUILD-MARKER-B"]
  PASS  [local] the worker's FIRST-TURN console line reaches the harness
  PASS  [local] and again on a second launch, so it is not luck

$ node q6-bootlog.mjs steel
  steel session 1 (fresh container): worker found, listening=true, log=["[info] PARLE-BUILD-MARKER-B"]
  PASS  [steel] the worker's FIRST-TURN console line reaches the harness
  PASS  [steel] ...and the worker is reachable and listening regardless — listening=true
  steel session 2 (same container, the CI re-run case): log=["[info] PARLE-BUILD-MARKER-B"]
  PASS  [steel] and on a second session in the same container
```

**No difference.** The startup line survives on both, because a session create relaunches Chrome and the
worker's first turn lands after we have attached. One plausible objection to Steel, removed.

---

## 1. Does Steel do everything the current harness does?

Almost. Three things are at stake, in descending order of seriousness.

### (a) Lost: a run cannot pass against code that no longer exists

This is the disqualifying one. `harness.ts:169-172` deletes `<profile>/Default/Service Worker` before
every launch, and the comment above it is the most expensive lesson in the file: Chrome keeps the
background script it registered *in the profile*, and an unpacked extension reloaded at the same
manifest version does not replace it. A background rebuilt from `MARKER-A` to `MARKER-B` still logs
`MARKER-A`.

Reproduced on Steel, `out/stale-worker.txt`:

```
session 1: running=A onDisk=A
  PASS  session 1 is running the MARKER-A build
build on disk is now MARKER-B
session 2: running=A onDisk=B
  PASS  the rebuilt background really is on disk for session 2
  FAIL  session 2 EXECUTES the rebuilt background rather than the one Chrome kept
        — still executing MARKER-A while MARKER-B is on disk
```

Steel has no lever for this. Its documented `userDataDir` session option is broken by operator
precedence in `api/src/services/session.service.ts` — `options.userDataDir || options.persist === true ?
persistPath : defaultPath`, where `||` binds tighter than `?:`, so passing *any* `userDataDir` selects
Steel's own fixed directory. Measured, `out/q3e-isolation.txt`:

```
  FAIL  the session's userDataDir option is honoured
        — asked for /tmp/parle-spike-asked-for-this, got /app/api/user-data-dir
```

The only reset found is recreating the container, which does work (`out/stale-worker-restart.txt`, 1/1)
and costs 3.5 s at N=1 rising to 13.4 s at N=16 (`out/summary-timings.txt`). So the guarantee is not
lost outright — it is **bought back by discarding the thing we were adopting**. If every run is
`docker compose up --force-recreate`, Steel's session API has bought us nothing and we are running a
container that happens to have Chromium in it.

The same three lines also give us the un-consented first-run profile that three checks are about
("asks nobody at all before the reader has answered", "harvests nothing, and stores nothing, before the
reader has answered", "the first-run screen offers a real choice"). Same cause, same fix, same price.

### (b) Unmeasured and non-trivial: 19 of the 56 checks need the browser to reach this host

`e2e/provider.ts` starts an OpenAI-compatible stand-in on this machine's loopback, and `parle.e2e.ts`
types that `baseUrl` into the real settings page so the real `Byok` layer carries the real key out to
it. Nineteen checks sit downstream of that — everything from "takes the key, and says so without
showing it back" to "never sends the key anywhere but the address the reader named".

Inside a container, `127.0.0.1` is the container. This is solvable (`--network host`, or
`host.docker.internal` plus a rewrite of the provider's advertised base URL), but it is unported work
that the spike did not do, and `--network host` interacts badly with the per-container port mapping that
Steel concurrency requires. Counted honestly as cost, not as a blocker.

### (c) Unmeasured: the photographic runs

`store.e2e.ts` needs a frame that is *exactly* 1280x800 with no black margin — `--window-size`,
`--window-position`, a screen sized to match, and `import -window root`, because four of the five store
shots contain browser chrome that `page.screenshot()` cannot see. Under Steel the X server is inside the
container. Probably a matter of running `import` in the container and copying the PNG out; nobody has
done it. Cost, not blocker.

### What is *not* lost

Everything else. Notably the two that looked most likely to break: `worker.evaluate` (row 1) and the
closed shadow root (row 10) both work exactly as they do today, through the same CDP calls. And Steel
does not lie about traffic — `out/q3d-decisive.txt` shows both raw CDP and Playwright seeing all ten of
the product's own Lookups, fully attributed to the `service_worker` target.

One caveat worth carrying forward regardless of this decision: **Steel's own log store does not record
worker traffic.** `api/src/services/cdp/instrumentation/target-manager.ts` attaches
`attachExtensionEvents` rather than `attachWorkerEvents` for extension service workers, and
`/v1/logs/stats` returned zero mentions of `hn.algolia.com` during a run that demonstrably made ten
requests to it. Absence-of-traffic is the assertion class we care most about; Steel's session logs
cannot support it. Drive CDP yourself.

Two other things measured and worth knowing: Steel injects its own isolated worlds
(`__steel_browser_interactions__`, `__puppeteer_utility_world__23.6.0`) into every page — machinery an
ordinary reader's Chrome does not have — and it runs Chromium 150.0.7871.124 against our local Chrome
for Testing 151.0.7922.34.

---

## 2. What does it add that we cannot get more cheaply?

### Parallelism — and yes, the alternative was measured

The claim that would justify Steel is "it gives us more concurrent browsers". It does not. **One Steel
container is one browser**: `CDPService` is a singleton and `activeSession` is one session, so
`POST /v1/sessions` reconfigures the running browser rather than adding another (corroborated in
`out/q3e-isolation.txt` — session B replaces session A's tabs in the same browser, and the container
logs "Reusing"). Concurrency therefore means N containers at 580–683 MiB each
(`out/parallel-steel-8/docker-stats.txt`).

The alternative — N `xvfb-run` Chromes on this box, which is what we already have — was run side by side
with the identical sweep script. Both columns are real seconds on this box (12 cores, 62 GB), 20 served
pages per run, completion signalled by a live `hn.algolia.com` request carrying that page's own unique
title. `out/summary-timings.txt`:

| concurrent runs | pages | existing harness (batch / median sweep) | Steel (batch / median sweep) | Steel bring-up |
|---|---|---|---|---|
| 1 | 20 | 11.0 s / 8.14 s | 13.3 s / 8.21 s | 3.5 s |
| 4 | 80 | 12.7 s / 8.22 s | 13.9 s / 8.29 s | 4.6 s |
| 8 | 160 | 14.5 s / 8.24 s | 16.5 s / 10.03 s | 7.1 s |
| 12 | 240 | (not run) | 47.9 s / 17.13 s — one run stalled 30.8 s, 239/240 | 11.6 s |
| 16 | 320 | 18.8 s / 9.79 s | 34.2 s / 23.50 s | 13.4 s |
| 24 | 440 | 34.9 s / 22.70 s, 22 of 24 runs completed | (not run) | — |

Head to head at N=1 (`out/sweep-local-1.json`, `out/sweep-steel-1.json`):

```
existing harness  startup 1.610s  sweep 8.146s  total  9.779s  median/page 462ms  20/20 asked about
Steel             startup 4.265s  sweep 8.215s  total 12.497s  median/page 482ms  20/20 asked about
```

Sweep time is a dead heat — per-page cost is the extension's own pacing plus Algolia, not the harness.
Steel costs +2.7 s per session, plus container bring-up on top.

**The existing harness is flat to 8 and ~20 % down at 16. Steel's knee is between 4 and 8 and it is 2.9x
slower per sweep at 16.** Roughly twice the usable concurrency for a third of the RAM. Nothing crashed
on Steel at any N; the local harness lost 2 of 24 runs at N=24 to an `xvfb-run -a` display-allocation
race (`out/parallel-local-24/run-3.log`: "Looks like you launched a headed browser without having a
XServer running") — a real limit today and a known fix: assign display numbers instead of `-a`.

Two honest caveats on those numbers. The 20 pages are served by `context.route`, so per-page cost
excludes real page-load time — this measures the product's unit of work (navigation → Reading → Enquiry
→ Lookup), not a live-web sweep. And once sharding removes the harness as the bottleneck, the next
ceiling is Algolia's tolerance for ~90 requests/second from one IP, which is a property of our
politeness budget and not of either harness.

### Proxies and stealth

Steel's rotating-proxy support is the one genuinely additive capability, and it is one option away in
what we already have: `chromium.launchPersistentContext` takes `proxy: { server, username, password }`
(verified in the installed `playwright-core@1.62.1` types, `launchPersistentContext` options block).

Stealth is an anti-goal here. The product ships to an ordinary reader's Chrome, so a pass obtained
through a stealth profile measures Steel, not Parle. Reddit was therefore probed with **nothing switched
on** — no `proxyUrl`, `skipFingerprintInjection: true` (Steel's fingerprint spoofing *off*), no stealth
args, no UA override, request issued from inside the shipped background worker, same host, same public
IP (`out/reddit-probe.txt`):

```
### STEEL   (UA Chrome/150.0.0.0)      ### LOCAL   (UA Chrome/151.0.0.0)
403   190238 bytes   24ms  reddit      403   190238 bytes   57ms  reddit
403     1522 bytes   11ms  old.reddit  403     1522 bytes   17ms  old.reddit
200     5584 bytes  337ms  algolia     200     5584 bytes  291ms  algolia
```

Identical, byte for byte. Steel makes no difference to Reddit in an ordinary configuration. No stealth
profile or proxy was enabled, so this says nothing about whether Steel *could* get past Reddit — and a
pass obtained that way would not generalise to an ordinary reader's Chrome anyway.

### Containerisation

Real value, if we ever need it, and not a reason to adopt Steel. The reusable part of Steel for this use
case is "Chromium + Xvfb in a container" — and the spike had to supply the Xvfb itself, because the
upstream image ships `xvfb` but starts no X server and headful is the only mode that honours
`--load-extension` (`spike/steel/compose.yml`). It also had to mount the build under
`/app/api/extensions/<name>` because Steel loads extensions by name only, and hand-repair the CDP
WebSocket URL, because Steel's nginx front sets `proxy_set_header Host $host` so `/json/version`
advertises `ws://localhost/devtools/...` with no port — `connectOverCDP` then dials port 80 and reports
`WebSocket error: self-signed certificate in certificate chain`, which points nowhere near the cause.

That is most of a Dockerfile's worth of work, done inside someone else's 2.64 GB image. If we need a
container, write the ~20-line Dockerfile around the harness we have.

---

## 3. The verdict

**Keep the home-grown harness.** Not adopt; not adopt-alongside.

Adopt-alongside is the answer that sounds prudent and is not. It means a second harness to keep green, a
second Chromium version to reason about (150 vs 151), a 2.64 GB image in the loop, and container
lifecycle in CI — in exchange for a set of capabilities we measured as *equal at best*, slower at N=1,
half as parallel at N=16, and short by one guarantee. There is no check in `parle.e2e.ts` that Steel can
make and the current harness cannot.

The one-sentence version for the product owner: **Steel is a competent way to run someone else's Chrome
on someone else's box, and every problem it solves for us is one we do not have.**

---

## 4. What would change our mind — named triggers

Each of these is checkable; none of them is "Steel got more stars".

1. **QA has to run somewhere that is not this box.** A hosted CI runner, a second engineer's laptop, a
   machine without a persistent Linux desktop-less host. *First move is still not Steel*: write the
   Dockerfile around the existing harness and see whether it takes an afternoon. Reach for Steel only if
   that Dockerfile turns out to be genuinely hard — the spike's `compose.yml` is a decent map of what
   the hard parts would be.

2. **Upstream fixes per-session profile isolation.** Concretely: the operator-precedence bug in
   `api/src/services/session.service.ts`, *and* an honoured per-session user-data directory. The test is
   already written — `spike/steel/q3e-isolation.mjs` must stop reporting "asked for X, got
   /app/api/user-data-dir", and `spike/steel/stale-worker.mjs` must go 3/3. If both pass, Steel's
   session API starts earning its keep and the stale-worker guarantee comes back at session cost rather
   than container cost. Revisit then.

3. **We need many different network identities as an ordinary reader would have them.** The honest
   version of the Reddit problem: this datacenter IP gets 403s, so the *success* path of the Reddit
   Network is untested in a browser. A residential proxy would exercise it as a real reader meets it.
   Even then, try `proxy:` on `launchPersistentContext` first — one option, already in our Playwright.

4. **Sustained need for more than ~16 concurrent browsers.** Weak trigger, because the local limit at 24
   is a known `xvfb-run -a` race with a known fix, and Steel is *worse* above 8, not better.

---

## 5. The real question: QA breadth (82 pages)

The product owner's underlying concern is that QA breadth is too narrow. Steel is not the answer to
that, and the measurements say so plainly.

**The box is not the constraint.** The existing harness already swept **320 pages in 18.8 seconds wall**
at 16 concurrent (`out/parallel-local-16.txt`), and 160 pages in 14.5 s at 8. Adding Steel would make
that slower, not faster.

**The constraint is that `frontdoor.e2e.ts` is one sequential loop through one browser and one side
panel.** It sweeps 82 addresses — up to 27 links off the live Hacker News front page (deduplicated by
host), 1 Reddit network probe, 8 Reddit-shaped articles, 39 front doors and section pages, 7 classics. Per page it pays a fixed
`settle(2500)` in `check`, plus up to 14 × 700 ms of polling in `visit`, plus a real page load. That is a
derived bound of roughly 3.2–12.3 s per page before load time — call it 5–17 minutes for the sweep, and
it is bounded by waiting, not by compute.

Three things would widen breadth, in order of return:

1. **Shard the sweep.** `launch()` already takes `profilePath` and `debugPort`, `parle.e2e.ts` already
   launches two browsers in one run, and the spike ran 16 concurrently on this box. Splitting the 82
   addresses across 8 harnesses is a change to `frontdoor.e2e.ts`, not to `harness.ts`, and on the
   measured numbers it turns a ~10-minute sweep into a ~1–2 minute one. That headroom is what buys
   hundreds of addresses instead of 82.
2. **Fix the `xvfb-run -a` display race** before relying on more than ~16 (assign display numbers rather
   than `-a`). It is the only failure mode either harness showed at any N.
3. **Then find the next real ceiling, which is politeness, not parallelism.** At 16-way the sweep issues
   on the order of 90 requests/second to `hn.algolia.com` from one IP. That is the thing to measure next,
   and no browser harness changes it.

And breadth is not only a count. The 82 addresses are hand-picked shapes; the gaps most likely to hide
bugs are *kinds* of page not yet represented — redirect chains, SPAs that change URL without a
navigation, paywalls, AMP/canonical mismatches, non-Latin titles. That is authoring work in
`frontdoor.e2e.ts`. Steel does nothing for it either way.

---

## Ground rules, discharged

```
$ cd /home/hzia/repos/parle && pnpm e2e
@parle/extension:e2e: 56/56 checks passed
  Time:    59.346s
```

Verified independently at the time of writing, after the spike. It also read 56/56 before the spike
(`out/baseline-e2e-run1.txt`) and immediately after it (`out/baseline-e2e-after.txt`, 1m1.189s).

Nothing outside `spike/` was written: `find . -newermt '2026-08-10 02:20' -type f` returns only paths
under `spike/steel/` (build output, profiles and `.turbo` excluded). This document and
`spike/steel/q6-bootlog.mjs` plus its two `out/` files are the only additions made while writing the
recommendation; `run-all.sh` gained the three lines that reproduce them.

Containers: `docker ps -a | grep -i steel` → none left. The 2.64 GB image
`ghcr.io/steel-dev/steel-browser-api:latest`
(`sha256:a58dd308875116fd5828c148d02c887075a2fd9dc3216eeeede64dce1277b23b`) is left pulled so a rerun is
fast; `docker rmi` it to reclaim the disk. The 200 MB upstream clone was deleted —
`spike/steel/.gitignore` records the commit it was read at
(`5880b48c1af107219ff3d904edbb8f6b76bea9b6`, 2026-07-20) and how to re-make it.
