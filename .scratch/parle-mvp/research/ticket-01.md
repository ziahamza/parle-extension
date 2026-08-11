# Research: ticket 01 — Can the extension reach Reddit from a real browser, and by which path?

## Answer

**Bottom line: YES — partly, and by a different path than the ticket assumed.** The extension can reach Reddit from a real browser today, but only from the *browser* and only with **`credentials: 'include'`**. There are **two independent gates**, not one, and the previously-recorded cause ("it's pure IP reputation") is wrong. Ship the Reddit connector, but build it as two paths with a fallback, treat it as best-effort/degradable, and **re-plan the Reddit half of the Discussion Index — CI cannot build it.**

---

### The corrected model: two independent gates

I re-measured this today (2026-08-08) from both a datacenter host (Hetzner AS24940, 135.181.208.223) and a real consumer Chrome (AS3356 Lumen, San Jose — the same browser the earlier "control" used). The decisive experiment is an **omit-vs-include A/B in the same browser, same origin, same second**:

| Request | Datacenter IP (curl) | Real browser, `credentials:'omit'` | Real browser, `credentials:'include'` |
|---|---|---|---|
| `www.reddit.com/api/info.json?url=…` | **403** (190,240 B block page) | **403** (189,906 B block page) | **200**, 128,398 B, real JSON |
| `old.reddit.com/api/info.json?url=…` | **403** | **403** | **200**, 128,399 B |
| `www.reddit.com/` (HTML) | **403** | **200** (539,618 B) | **200** |
| `old.reddit.com/search?q=url:…` (HTML) | **403** | **200**, 11 `.search-result-link` results | **200**, 11 results |
| `www.reddit.com/r/programming/.rss` | **200** (32,382 B) | — | **200** |
| `/robots.txt` | **200** (538 B) | — | — |

All MEASURED by me today. Two conclusions follow, both empirical:

1. **Gate A — cookies gate `.json`.** JSON is 403 without Reddit cookies *even from a good consumer IP*, and 200 with them. This is not IP reputation.
2. **Gate B — IP reputation gates HTML.** HTML surfaces work cookie-free from the consumer IP but 403 from Hetzner. This *is* IP reputation, and it is real — it just isn't what causes the `.json` 403.

**Critically: a logged-in Reddit account is NOT required.** `GET /api/v1/me.json` on that browser returned **200 with no `name` field** — the session is anonymous — yet `.json` returned 200. What is load-bearing is the browser's **anonymous reddit.com cookie jar**, not an account. This is a significant privacy and UX win: unlike the X connector, Parle's Reddit connector does not need the user to be logged in to Reddit.

**Documented cause of Gate A**, verified verbatim from a Wayback snapshot of r/modnews post `1tq9vxo`, "Protecting communities from scrapers and platform abuse" (admin post, 2026-05-28): *"Deprecating unauthenticated JSON access: We'll also be shutting down unauthenticated .json endpoints… Logged-in and authenticated access won't be impacted. Otherwise, developers who need structured access to Reddit content should use Devvit."* The same post continues: *"While we're at it, another common surface for scraping is RSS. Looking ahead, we'd love to know: how and for what purpose, do you use RSS feeds in your moderation flows?"* — Reddit has explicitly named RSS as the next surface under review.
(https://web.archive.org/web/20260729194803/https://old.reddit.com/r/modnews/comments/1tq9vxo/protecting_communities_from_scrapers_and_platform/)

### Claims from prior research that are now DISCARDED or CORRECTED

- ❌ **DISCARD: "Reddit's 403 is IP reputation, not cookies — every non-IP hypothesis was falsified."** Falsified by my omit/include A/B. That research never tested a cookie-bearing request against a cookie-less one on the same IP; its "no cookies, no auth" control was a real Chrome doing a top-level navigation, which *does* send cookies. Its 200 was a cookie-bearing request mislabelled as anonymous.
- ❌ **DISCARD: "The block is blanket on the whole reddit.com content edge."** From Hetzner, `.rss` returns 200 with full content while `/` and `.json` return 403; from a good IP, HTML returns 200 cookie-free.
- ⚠️ **CORRECT: "Reddit access now requires the user's own logged-in session (like X)."** Half right — it requires *cookies*, but an anonymous session suffices. The adversarial verifier flagged this as unmeasured; it is now measured and the weaker requirement holds.
- ⚠️ **CORRECT: the 403 page is not a React app and there is no challenge to solve** — it is static HTML+CSS with zero `<script>` tags. Separately, Reddit *does* operate a JS challenge on some paths (I observed `?js_challenge=1&solution=…&token=…` URL forms in Reddit's Wayback CDX index) — OBSERVED, mechanism not characterised, flagged as a durability risk.
- ⚠️ **CORRECT: `api/info.json` is "strictly better" than Newsit's HTML search.** It is richer (25 children vs 11 for the same target, MEASURED), but it is now the *more fragile* of the two — it is the one Reddit announced it is shutting down, and the one that breaks without cookies.

### Impact on our architectural commitments

- ✅ **CONFIRMS — "no backend deployed; connectors run in the browser."** Strengthened to a necessity. Both gates are only passable from a real user's browser: the browser supplies the cookies (Gate A) and the consumer IP (Gate B). Any server-side proxy fails both. Do not let "we could proxy this through a Worker" be re-litigated.
- ✅ **CONFIRMS — "the extension uses the user's own session,"** with a favourable amendment for Reddit: anonymous session cookies suffice, no login required.
- ⚠️ **THREATENS — Reddit as a first-class connector.** Hit rate now depends on the user's browser holding reddit.com cookies and on Chrome's third-party-cookie state (see below), not just on their IP. Real-world coverage is still unmeasured.
- 🔴 **INVALIDATES (for the Reddit half) — "Discussion Index built in CI, served as static files."** CI runners (GitHub Actions, Cloudflare Workers) are datacenter IPs with no cookie jar: they fail Gate A *and* Gate B. MEASURED from Hetzner: every HTML and JSON surface 403s. The only unauthenticated CI-reachable surface is Atom/RSS, rate-limited to roughly **one request per minute per IP** (`x-ratelimit-remaining: 0.0`, `x-ratelimit-reset: 38` observed on the second call) — and Reddit has publicly signalled RSS is next. **Re-plan that ticket now.** The HN half is unaffected.
- ⚠️ **THREATENS — AGPL redistribution.** `robots.txt` is `User-agent: * / Disallow: /` (200, 538 B, MEASURED today). Rule 8 was clarified in the same modnews post to cover "API misuse". Data API Terms §2.8/§3.2 restrict retention and redistribution. Keep any Discussion Index to a **bloom filter of URLs only** — never titles, scores, or comment text.
- ⚪ **NEUTRAL — the X gate ("query X only after HN or Reddit returns a result")** still works, but Reddit will fire it less often than the earlier research implied.

### Recommended design

**Two paths, in this order, both from the extension background with `host_permissions`:**

1. **Primary — `https://www.reddit.com/api/info.json?url=<encoded>` with `credentials: 'include'`.** Exact-URL semantics, 25 results, structured. MEASURED rate budget with cookies: `x-ratelimit-used: 6 / remaining: 94 / reset: 190` → a **100-request budget** shared with the user's own browsing. Read `x-ratelimit-remaining` off every response and back off. One request per page view.
2. **Fallback on 403 — `https://old.reddit.com/search?sort=top&q=url:<encoded>` (HTML), cookie-free.** MEASURED 200 with `credentials:'omit'` and 11 parseable `.search-result-link` results. This is Newsit's endpoint and it is exactly what survives the cookie gate. Note Newsit's `fetch(url)` with no options defaults to `credentials: 'same-origin'`, which sends *no* cookies cross-origin — INFERRED, and consistent with the fact that it still works.

This fallback is not belt-and-braces; it is the single mitigation covering three separate failure modes: users with no reddit.com cookies, users with third-party cookies blocked, and Safari's credentials bug.

**Do not use RSS on the request path** (~1 req/min per IP). It is only viable for batch work, and that use is on notice.

**CORS is a hard constraint, MEASURED:** a cross-origin `fetch` to `old.reddit.com` from a `www.reddit.com` page returned `Failed to fetch` — Reddit sends no `Access-Control-Allow-Origin`. This works *only* from an extension context with `host_permissions`; a content-script-only implementation is impossible.

**Ship it as degradable:** no user-visible error when Reddit 403s, a per-user kill switch, never a hard dependency. Reddit's own wiki reserves the right to block unauthenticated traffic at will, and the 2023→2026 trend is monotonically more restrictive.

### Open questions — what still needs a real device or a fresh profile

1. **Cold-start cookie bootstrap (blocking, cheap).** Does a browser profile that has *never* visited reddit.com get the cookie automatically? Plausible bootstrap: the extension does a credentialed `GET https://www.reddit.com/` first (MEASURED 200 cookie-free from a good IP), then retries `.json`. **UNTESTED** — needs a fresh Chrome profile. If it fails, path 2 is the answer and `.json` becomes opportunistic.
2. **Does a cross-site extension fetch actually carry reddit.com cookies?** Chrome documents that extension requests to a third party are treated as same-site when host permissions are held — but the same doc says this **"does not apply if third-party cookies are blocked"** (https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies). I could not measure Reddit's `SameSite` attributes on the session cookies. **20-minute test with a scratch unpacked extension.** This also settles the identical question for the X connector.
3. **Real-world 403 rate by network type.** My "good IP" is AS3356 Lumen transit, *not* a verified consumer residential ISP. Untested: Comcast/BT-class residential, mobile carrier, consumer VPN exits (datacenter-hosted — likely blocked like Hetzner), corporate NAT (shares the 100-request budget). Instrument a beta cohort. This number decides whether Reddit is a headline feature or a bonus.
4. **Safari/iOS.** FB15307169 (Safari 18, filed Sep 2024, reported still open Jan 2026) has extension `fetch()` dropping credentials despite `credentials:'include'` + host permissions (https://developer.apple.com/forums/thread/764279). If unfixed, `.json` is dead on Apple platforms and only path 2 works there. Needs real hardware.
5. **Whether a logged-in session raises the 100-request budget.** Unmeasured; probably irrelevant since we don't require login.
6. **OAuth is not a fallback.** Self-service registration is closed behind the Responsible Builder Policy (https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) and the free tier is 100 QPM **per `client_id`** — one shared budget across the whole userbase. DOCUMENTED from cited sources, not re-verified by me today. Delete it from the design.

### Next actions

1. **Re-plan the Discussion Index ticket** for a Reddit half that cannot be built from CI. (Blocking; do this before any index work starts.)
2. **Build the connector as JSON-with-credentials → HTML-fallback**, with `x-ratelimit-remaining` gating, a per-URL cache, and a kill switch.
3. **Run the scratch-extension cookie test** (settles items 2 and, for free, the X connector's core assumption).
4. **Run the fresh-profile bootstrap test.**
5. **Instrument beta telemetry** for Reddit 403 rate bucketed by success/failure only (no IP collection) before promoting Reddit to a headline feature.
6. **Record in the ADR** that Reddit access is best-effort, in acknowledged tension with `robots.txt` and Rule 8, and that we ship no cached Reddit content — URLs only.
